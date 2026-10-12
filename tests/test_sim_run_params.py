"""The child process the service spawns: params JSON in, result JSON out."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SMALL = {"disease_type": "sir", "beta": 22.8125, "n_agents": 300, "sim_dur_years": 10 / 365, "rand_seed": 1}


def run_child(params: dict, tmp_path: Path, args=None):
    params_path = tmp_path / "params.json"
    out_path = tmp_path / "out.json"
    params_path.write_text(json.dumps(params), encoding="utf-8")
    cmd = [sys.executable, "-m", "epichat.sim.run_params"] + ([str(params_path), str(out_path)] if args is None else args)
    completed = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=ROOT, timeout=300)
    return completed, out_path


def test_writes_stats_and_series_for_valid_params(tmp_path):
    completed, out_path = run_child(SMALL, tmp_path)
    assert completed.returncode == 0, completed.stderr
    payload = json.loads(out_path.read_text(encoding="utf-8"))
    assert set(payload) == {"stats", "series"}
    assert payload["stats"]["n_agents"] == 300 and payload["stats"]["sim_days"] == 11
    assert len(payload["series"]["day"]) == 11 and payload["series"]["cum_infections"][-1] >= 0


def test_null_seed_runs(tmp_path):
    completed, out_path = run_child({**SMALL, "rand_seed": None}, tmp_path)
    assert completed.returncode == 0, completed.stderr
    assert json.loads(out_path.read_text(encoding="utf-8"))["stats"]["sim_days"] == 11


def test_invalid_params_fail_with_the_field_on_stderr(tmp_path):
    completed, out_path = run_child({**SMALL, "disease_type": "seir"}, tmp_path)   # seir needs dur_exp
    assert completed.returncode != 0
    assert "dur_exp" in completed.stderr
    assert not out_path.exists()


def test_usage_error_is_exit_code_two(tmp_path):
    completed, _ = run_child(SMALL, tmp_path, args=["only-one-argument"])
    assert completed.returncode == 2 and "usage" in completed.stderr.lower()


def test_run_in_process_matches_the_child(tmp_path):
    from epichat.schema import SimParams
    from epichat.sim.run_params import run
    payload = run(SimParams(**SMALL))
    completed, out_path = run_child(SMALL, tmp_path)
    assert completed.returncode == 0, completed.stderr
    assert json.loads(out_path.read_text(encoding="utf-8")) == payload
