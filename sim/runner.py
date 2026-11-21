"""Run one simulation in a child process.

Where the platform has forkserver (Linux, macOS), the first run starts a server that imports Starsim once, and every run is a
child forked from it: separate from the service and from other runs, and killed at the timeout, without paying Starsim's import
(about a second) each time. warm() starts the server ahead of the first request. The server inherits sys.path and the cache
directories below; the child writes the result file and sends its traceback, if any, back on a pipe.

Elsewhere (Windows) the child is `python -m epichat.sim.run_params <params.json> <out.json>`, given the parent's import path, the
cache directories and the same timeout; stdout is ignored and stderr's tail is the error."""
from __future__ import annotations

import json
import multiprocessing as mp
import os
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from epichat.params.schema_v2 import SimParamsV2

STDERR_TAIL = 2000


@dataclass
class RunResult:
    ok: bool
    stats: dict
    series: dict
    error: str | None
    timed_out: bool
    duration_ms: int
    replicates: dict | None = None
    effective_params: dict | None = None      # the child's parameters as run (a fitted lever)


FORKS = "forkserver" in mp.get_all_start_methods()
_lock = threading.Lock()
_context = None


def cache_dirs() -> dict[str, str]:
    """Writable numba and matplotlib cache directories (Vercel's package directory is read-only)."""
    scratch = Path(tempfile.gettempdir()) / "epichat-sim"
    return {"NUMBA_CACHE_DIR": str(scratch / "numba"), "MPLCONFIGDIR": str(scratch / "mpl")}


def child_environment() -> dict[str, str]:
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(p for p in sys.path if p)
    env.update(cache_dirs())
    env.setdefault("PYTHONIOENCODING", "utf-8")
    return env


def _forkserver():
    """The forkserver context, set up once; its server, when started, imports Starsim through epichat.sim.run_params."""
    global _context
    with _lock:
        if _context is None:
            for key, value in cache_dirs().items():      # read by the server when it starts, so set before it does
                os.environ.setdefault(key, value)
            context = mp.get_context("forkserver")
            # with __main__ preloaded once in the server, its children skip running the main script again
            context.set_forkserver_preload(["__main__", "epichat.sim.run_params"])
            _context = context
    return _context


def warm() -> None:
    """Start the forkserver now, so the first run does not wait for Starsim's import."""
    if FORKS:
        from multiprocessing import forkserver
        _forkserver()
        forkserver.ensure_running()


def _child(params: dict, output_path: str, conn) -> None:
    from epichat.sim.run_params import child     # already imported in the forkserver, so this costs nothing
    child(params, output_path, conn)


def _read(output_path: Path, elapsed) -> RunResult:
    if not output_path.exists():
        return RunResult(False, {}, {}, "Simulation finished but wrote no result file.", False, elapsed())
    with open(output_path, encoding="utf-8") as f:
        payload = json.load(f)
    return RunResult(True, payload.get("stats", {}), payload.get("series", {}), None, False, elapsed(), payload.get("replicates"),
                     payload.get("effective_params"))


def run_params(params: SimParamsV2, output_path: Path, timeout: float) -> RunResult:
    output_path = Path(output_path)
    started = time.perf_counter()

    def elapsed() -> int:
        return int((time.perf_counter() - started) * 1000)

    try:
        return (_run_forked if FORKS else _run_subprocess)(params, output_path, timeout, elapsed)
    finally:
        output_path.unlink(missing_ok=True)


def _run_forked(params: SimParamsV2, output_path: Path, timeout: float, elapsed) -> RunResult:
    context = _forkserver()
    receive, send = context.Pipe(duplex=False)
    proc = context.Process(target=_child, args=(params.model_dump(mode="json"), str(output_path), send), daemon=True)
    proc.start()
    send.close()
    try:
        proc.join(timeout)
        if proc.is_alive():
            proc.kill()
            proc.join()
            return RunResult(False, {}, {}, f"Simulation timed out after {timeout:g} seconds.", True, elapsed())
        try:
            message = receive.recv() if receive.poll() else None
        except EOFError:                              # the child died before it could say why
            message = None
        if proc.exitcode != 0:
            tail = (message or "").strip()[-STDERR_TAIL:] or f"exit code {proc.exitcode}"
            return RunResult(False, {}, {}, tail, False, elapsed())
        return _read(output_path, elapsed)
    finally:
        receive.close()
        proc.close()


def _run_subprocess(params: SimParamsV2, output_path: Path, timeout: float, elapsed) -> RunResult:
    with tempfile.NamedTemporaryFile("w", prefix="epichat-params-", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(params.model_dump(mode="json"), f)
        params_path = Path(f.name)

    try:
        completed = subprocess.run(
            [sys.executable, "-m", "epichat.sim.run_params", str(params_path), str(output_path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, env=child_environment(),
        )
    except subprocess.TimeoutExpired:
        return RunResult(False, {}, {}, f"Simulation timed out after {timeout:g} seconds.", True, elapsed())
    finally:
        params_path.unlink(missing_ok=True)

    if completed.returncode != 0:
        tail = (completed.stderr or "").strip()[-STDERR_TAIL:] or f"exit code {completed.returncode}"
        return RunResult(False, {}, {}, tail, False, elapsed())
    return _read(output_path, elapsed)
