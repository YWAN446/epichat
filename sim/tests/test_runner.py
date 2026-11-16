import os
import sys
import tempfile
import time
from pathlib import Path

from epichat.params.migrate import coerce_params
from epichat.params.schema_v2 import SimParamsV2
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
    result = run_params(_params(n_replicates=2), _out(), timeout=120)
    assert result.ok and result.replicates["seeds"] == [1, 2] and len(result.replicates["bands"]["n_infectious"]["p10"]) == 6


def test_child_failure_reports_the_stderr_tail_and_cleans_up():
    # a vaccine starting after the simulation ends makes Starsim raise inside the child
    out = _out()
    before = _temp_params_files()
    params = _params(interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 400}])
    result = run_params(params, out, timeout=120)
    assert not result.ok and not result.timed_out
    assert "Years must be within" in result.error and len(result.error) <= 2000
    assert not out.exists() and _temp_params_files() == before


def test_timeout_kills_the_child():
    started = time.perf_counter()
    result = run_params(_params(n_agents=20000, sim_dur_years=2.0), _out(), timeout=0.5)
    assert result.timed_out and not result.ok
    assert time.perf_counter() - started < 10
    assert "0.5" in result.error


def test_child_environment_has_the_import_path_and_cache_dirs():
    env = child_environment()
    assert str(Path(sys.path[0])) in env["PYTHONPATH"]
    assert env["NUMBA_CACHE_DIR"].endswith("numba") and env["MPLCONFIGDIR"].endswith("mpl")
    assert env["PYTHONIOENCODING"] == "utf-8"
