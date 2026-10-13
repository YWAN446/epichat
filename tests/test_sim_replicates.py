"""Spec 8.7: n seeds in one process, the lower-median replicate as the result, bands across them."""
from epichat.params.migrate import coerce_params
from epichat.sim.replicates import run_replicates

SMALL = {"disease_type": "sir", "beta": 22.8125, "n_agents": 400, "sim_dur_years": 20 / 365, "rand_seed": 5}


def v2(n_replicates=1, rand_seed=5):
    """v1 has no replicates, so the count is set on the migrated object."""
    p = coerce_params(SMALL)
    p.run.n_replicates = n_replicates
    p.run.rand_seed = rand_seed
    return p


def test_single_replicate_has_no_replicates_block():
    out = run_replicates(v2())
    assert set(out) == {"stats", "series", "effective_params"} and out["stats"]["n_agents"] == 400


def test_three_replicates_seed_in_order_and_report_the_lower_median():
    out = run_replicates(v2(3), n=3)
    rep = out["replicates"]
    assert rep["n"] == 3 and rep["seeds"] == [5, 6, 7] and len(rep["stats"]) == 3
    totals = [s["total_infected"] for s in rep["stats"]]
    assert out["stats"]["total_infected"] == sorted(totals)[1]
    assert rep["representative"] == rep["seeds"][totals.index(out["stats"]["total_infected"])]
    for key in ("n_infectious", "cum_infections"):
        band = rep["bands"][key]
        assert len(band["p10"]) == len(band["p90"]) == 21
        assert all(lo <= hi for lo, hi in zip(band["p10"], band["p90"]))
    assert out["series"]["cum_infections"][-1] == out["stats"]["total_infected"]


def test_null_seed_starts_at_one_and_n_comes_from_the_params():
    out = run_replicates(v2(2, rand_seed=None))
    assert out["replicates"]["seeds"] == [1, 2]
    again = run_replicates(v2(2, rand_seed=None))
    assert out == again


def test_two_replicates_take_the_lower_of_the_two():
    out = run_replicates(v2(2))
    totals = sorted(s["total_infected"] for s in out["replicates"]["stats"])
    assert out["stats"]["total_infected"] == totals[0]
