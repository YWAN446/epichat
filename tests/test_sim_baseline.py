"""The v1 parity baseline: six models, ten seeds each, captured once on Starsim
3.3.2 with the template pipeline (spec section 13) and committed. The builder's
parity test (test_sim_parity.py) compares against these medians."""
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "sim_baseline_v1.json"
MODELS = {"sir", "sis", "sirs", "seir", "seirs", "seiar"}


def test_baseline_has_every_model_ten_seeds_and_consistent_medians():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert data["starsim_version"] == "3.3.2"
    assert data["seeds"] == list(range(1, 11))
    assert set(data["cases"]) == MODELS
    for name, case in data["cases"].items():
        assert case["params"]["disease_type"] == name
        assert case["params"]["n_agents"] == 10000 and case["params"]["sim_dur_years"] == 1.0
        assert "rand_seed" not in case["params"]
        assert [r["seed"] for r in case["per_seed"]] == data["seeds"]
        for key in ("total_infected", "peak_day"):
            assert case["median"][key] == statistics.median(r[key] for r in case["per_seed"])
        assert case["median"]["total_infected"] > 0
        if name != "sis":   # sis counts reinfections, so its total exceeds the population
            assert case["median"]["total_infected"] <= 10000
        assert all(r["peak_infections"] > 0 for r in case["per_seed"])
