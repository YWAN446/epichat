"""Spec 8.7: an ODE run is deterministic and runs once; runs as agents give n seeds, the lower-median replicate and bands."""
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.replicates import run_replicates


def scenario(n_replicates: int = 1, rand_seed: int | None = 5, network: dict | None = None) -> SimParamsV2:
    return SimParamsV2.model_validate({"disease": {"seed": {"mode": "count", "value": 10}}, "network": network or {},
                                       "run": {"n_agents": 1000, "sim_dur_years": 40 / 365, "rand_seed": rand_seed, "n_replicates": n_replicates}})


HYBRID = {"network_type": "hybrid"}
LASTING = {"contact_duration_days": 5.0}


def test_an_ode_run_runs_once_whatever_the_replicates():
    out = run_replicates(scenario(5))
    assert set(out) == {"stats", "series", "effective_params"} and out["stats"]["solver"] == "ode"
    assert out["effective_params"]["run"]["n_replicates"] == 5


def test_agent_runs_seed_in_order_report_the_lower_median_and_bands():
    for network in (HYBRID, LASTING):
        out = run_replicates(scenario(3, network=network))
        rep = out["replicates"]
        assert out["stats"]["solver"] == "abm" and rep["n"] == 3 and rep["seeds"] == [5, 6, 7] and len(rep["stats"]) == 3
        totals = [s["total_infected"] for s in rep["stats"]]
        assert out["stats"]["total_infected"] == sorted(totals)[1]
        assert rep["stats"][rep["seeds"].index(rep["representative"])] == out["stats"]
        for key in ("n_infectious", "cum_infections"):
            band = rep["bands"][key]
            assert len(band["p10"]) == len(band["p90"]) == 41 and all(lo <= hi for lo, hi in zip(band["p10"], band["p90"]))
        assert out["series"]["cum_infections"][-1] == out["stats"]["total_infected"]


def test_a_single_agent_replicate_has_no_replicates_block():
    out = run_replicates(scenario(1, network=HYBRID))
    assert out["stats"]["solver"] == "abm" and "replicates" not in out


def test_two_replicates_take_the_lower_and_a_null_seed_starts_at_one():
    out = run_replicates(scenario(2, rand_seed=None, network=HYBRID))
    assert out["replicates"]["seeds"] == [1, 2]
    assert out["stats"]["total_infected"] == min(s["total_infected"] for s in out["replicates"]["stats"])
    assert out == run_replicates(scenario(2, rand_seed=None, network=HYBRID))
