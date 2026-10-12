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
    assert "n_infectious" in payload["series"] and payload["stats"]["seeds_day0"] >= 0


def test_v2_params_with_replicates_write_the_replicates_block(tmp_path):
    params = {"schema_version": 2, "disease": {"seed": {"value": 0.05}}, "run": {"n_agents": 300, "sim_dur_years": 10 / 365, "rand_seed": 1, "n_replicates": 2}}
    completed, out_path = run_child(params, tmp_path)
    assert completed.returncode == 0, completed.stderr
    payload = json.loads(out_path.read_text(encoding="utf-8"))
    assert set(payload) == {"stats", "series", "replicates"} and payload["replicates"]["seeds"] == [1, 2]


def test_invalid_v2_params_fail_with_the_path_on_stderr(tmp_path):
    completed, out_path = run_child({"schema_version": 2, "disease": {"seed": {"mode": "count", "value": 5000}}, "run": {"n_agents": 300}}, tmp_path)
    assert completed.returncode != 0 and "disease.seed.value" in completed.stderr and not out_path.exists()


def test_null_seed_runs_and_is_reproducible(tmp_path):
    params = {**SMALL, "rand_seed": None, "network_type": "age_structured",
              "age_pct_under18": 30.0, "age_pct_18_64": 60.0, "age_pct_over65": 10.0,
              "interventions": [{"type": "vaccine", "coverage": 0.3, "start_day": 0}]}
    (tmp_path / "a").mkdir(); (tmp_path / "b").mkdir()
    first, out1 = run_child(params, tmp_path / "a")
    second, out2 = run_child(params, tmp_path / "b")
    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    p1, p2 = json.loads(out1.read_text(encoding="utf-8")), json.loads(out2.read_text(encoding="utf-8"))
    assert p1["stats"]["sim_days"] == 11
    assert p1 == p2


def test_invalid_params_fail_with_the_field_on_stderr(tmp_path):
    completed, out_path = run_child({**SMALL, "disease_type": "seir"}, tmp_path)   # seir needs dur_exp
    assert completed.returncode != 0
    assert "dur_exp" in completed.stderr
    assert not out_path.exists()


def test_usage_error_is_exit_code_two(tmp_path):
    completed, _ = run_child(SMALL, tmp_path, args=["only-one-argument"])
    assert completed.returncode == 2 and "usage" in completed.stderr.lower()


def test_run_in_process_matches_the_child(tmp_path):
    from epichat.sim.run_params import run
    payload = run(SMALL)
    completed, out_path = run_child(SMALL, tmp_path)
    assert completed.returncode == 0, completed.stderr
    assert json.loads(out_path.read_text(encoding="utf-8")) == payload
