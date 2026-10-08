"""Run a rendered simulation script in a child process.

The child gets the parent's import path (so the copied package and the
installed Starsim are found on Vercel), writable numba and matplotlib cache
directories, and a hard timeout. Its result is a JSON file it writes itself;
stdout is ignored and stderr's tail is the error."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

STDERR_TAIL = 2000


@dataclass
class RunResult:
    ok: bool
    stats: dict
    series: dict
    error: str | None
    timed_out: bool
    duration_ms: int


def child_environment() -> dict[str, str]:
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(p for p in sys.path if p)
    scratch = Path(tempfile.gettempdir()) / "epichat-sim"
    env["NUMBA_CACHE_DIR"] = str(scratch / "numba")
    env["MPLCONFIGDIR"] = str(scratch / "mpl")
    env.setdefault("PYTHONIOENCODING", "utf-8")
    return env


def run_script(code: str, output_path: Path, timeout: float) -> RunResult:
    output_path = Path(output_path)
    started = time.perf_counter()
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(code)
        script_path = Path(f.name)

    def elapsed() -> int:
        return int((time.perf_counter() - started) * 1000)

    try:
        completed = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, env=child_environment(),
        )
    except subprocess.TimeoutExpired:
        return RunResult(False, {}, {}, f"Simulation timed out after {timeout:g} seconds.", True, elapsed())
    finally:
        script_path.unlink(missing_ok=True)

    try:
        if completed.returncode != 0:
            tail = (completed.stderr or "").strip()[-STDERR_TAIL:] or f"exit code {completed.returncode}"
            return RunResult(False, {}, {}, tail, False, elapsed())
        if not output_path.exists():
            return RunResult(False, {}, {}, "Simulation finished but wrote no result file.", False, elapsed())
        with open(output_path, encoding="utf-8") as f:
            payload = json.load(f)
        return RunResult(True, payload.get("stats", {}), payload.get("series", {}), None, False, elapsed())
    finally:
        output_path.unlink(missing_ok=True)
