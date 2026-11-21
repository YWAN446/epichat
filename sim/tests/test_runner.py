import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pytest

from epichat.params.migrate import coerce_params
from epichat.params.schema_v2 import SimParamsV2
import runner
from runner import RunResult, child_environment, run_params


def _out() -> Path:
    return Path(tempfile.gettempdir()) / f"epichat-test-{os.getpid()}-{time.time_ns()}.json"


def _params(**over) -> SimParamsV2:
    base = dict(disease_type="sir", beta=22.8125, n_agents=200, sim_dur_years=5 / 365, rand_seed=1)
    base.update(over)
    p = coerce_params(base)
    if "n_replicates" in over:
        p.run.n_replicates = over["n_replicates"]
    return p


def _temp_params_files() -> set[str]:
    return {p.name for p in Path(tempfile.gettempdir()).glob("epichat-params-*.json")}


def test_success_reads_the_result_file_and_removes_both_files():
    out = _out()
    before = _temp_params_files()
    result = run_params(_params(), out, timeout=120)
    assert isinstance(result, RunResult)
    assert result.ok and not result.timed_out and result.error is None, result.error
    assert result.stats["sim_days"] == 6 and len(result.series["day"]) == 6
    assert result.duration_ms > 0
    assert result.replicates is None and "n_infectious" in result.series
    assert not out.exists()
    assert _temp_params_files() == before


def test_replicates_come_back_from_the_child():
    p = _params(n_replicates=2)
    p.network.network_type = "hybrid"                      # runs as agents: an ODE is deterministic and runs once
    result = run_params(p, _out(), timeout=120)
    assert result.ok and result.replicates["seeds"] == [1, 2] and len(result.replicates["bands"]["n_infectious"]["p10"]) == 6


def test_child_failure_reports_the_stderr_tail_and_cleans_up():
    # a vaccine starting after the simulation ends makes the builder raise inside the child
    out = _out()
    before = _temp_params_files()
    params = _params(interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 400}])
    result = run_params(params, out, timeout=120)
    assert not result.ok and not result.timed_out
    assert "is outside the sim" in result.error and len(result.error) <= 2000
    assert not out.exists() and _temp_params_files() == before


def test_timeout_kills_the_child():
    p = _params(n_agents=200000, sim_dur_years=2.0)
    p.network.network_type = "hybrid"                      # as agents, a few seconds; an ODE would finish in time
    started = time.perf_counter()
    result = run_params(p, _out(), timeout=0.5)
    assert result.timed_out and not result.ok
    assert time.perf_counter() - started < 10
    assert "0.5" in result.error


def test_child_environment_has_the_import_path_and_cache_dirs():
    env = child_environment()
    assert str(Path(sys.path[0])) in env["PYTHONPATH"]
    assert env["NUMBA_CACHE_DIR"].endswith("numba") and env["MPLCONFIGDIR"].endswith("mpl")
    assert env["PYTHONIOENCODING"] == "utf-8"


def test_runs_fork_from_a_server_that_has_imported_starsim(monkeypatch):
    """Where forkserver exists a run costs the sim, not Starsim's import; the command-line child gives the same answer."""
    if not runner.FORKS:
        return
    runner.warm()
    run_params(_params(), _out(), timeout=120)              # the first run waits for the server's imports
    started = time.perf_counter()
    forked = run_params(_params(), _out(), timeout=120)
    assert forked.ok and time.perf_counter() - started < 0.5, forked.duration_ms
    monkeypatch.setattr(runner, "FORKS", False)
    spawned = run_params(_params(), _out(), timeout=120)
    assert spawned.ok and spawned.series == forked.series and spawned.stats == forked.stats


def test_sim_runner_subprocess_forces_a_subprocess_anywhere():
    """SIM_RUNNER=subprocess is the switch back to one process per run; Vercel forks like everywhere else."""
    import multiprocessing as mp
    available = "forkserver" in mp.get_all_start_methods()
    assert runner.forkserver_allowed({"SIM_RUNNER": "subprocess"}) is False
    assert runner.forkserver_allowed({"SIM_RUNNER": "subprocess", "VERCEL": "1"}) is False
    assert runner.forkserver_allowed({"VERCEL": "1"}) is available
    assert runner.forkserver_allowed({}) is available


# Vercel's launcher (vc__handler__python, then vercel_runtime.vc_init) is the process's __main__, has no `if __name__ ==
# "__main__"` guard, and starts the whole service when it runs: its lifespan warms the forkserver. Multiprocessing re-runs
# __main__ in each child, so on Vercel (2026-11-21) every child booted a second service and exited with code 1.
_LAUNCHER = '''
import json, sys
from pathlib import Path
import runner
from epichat.params.migrate import coerce_params
runner.warm()
params = coerce_params(dict(disease_type="sir", beta=22.8125, n_agents=200, sim_dur_years=5 / 365, rand_seed=1))
result = runner.run_params(params, Path(sys.argv[1]), timeout=120)
print("RESULT " + json.dumps({"ok": result.ok, "error": result.error}))
'''


@pytest.mark.parametrize("as_module", [True, False], ids=["python -m launcher", "python launcher.py"])
def test_a_launcher_that_starts_the_service_on_import_is_not_rerun_in_the_child(tmp_path, as_module):
    if not runner.FORKS:
        pytest.skip("forkserver is not available on this platform")
    (tmp_path / "vercel_like_launcher.py").write_text(_LAUNCHER, encoding="utf-8")
    env = child_environment()
    env["PYTHONPATH"] = os.pathsep.join([str(tmp_path), env["PYTHONPATH"]])
    env.pop("SIM_RUNNER", None)
    target = ["-m", "vercel_like_launcher"] if as_module else [str(tmp_path / "vercel_like_launcher.py")]
    done = subprocess.run([sys.executable, *target, str(_out())], capture_output=True, text=True, env=env, timeout=300,
                          cwd=tmp_path)
    lines = [line for line in done.stdout.splitlines() if line.startswith("RESULT ")]
    assert lines, f"exit {done.returncode}\n{done.stderr[-3000:]}"
    assert json.loads(lines[-1][len("RESULT "):]) == {"ok": True, "error": None}


def test_a_child_that_fails_before_running_reports_why(monkeypatch):
    """A forked child that cannot even import the runner sends its traceback instead of dying with a bare exit code 1."""
    from types import SimpleNamespace
    import pytest
    sent = []
    monkeypatch.setitem(sys.modules, "epichat.sim.run_params", None)        # makes the import fail as it would in a broken child
    with pytest.raises(ImportError):
        runner._child({}, "unused.json", SimpleNamespace(send=sent.append))
    assert sent and "epichat.sim.run_params" in sent[0]
