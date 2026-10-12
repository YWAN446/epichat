"""extract() produces the v1 series and stats from a finished Starsim 3.7 sim (spec 17)."""
import pytest

from epichat.schema import SimParams
from epichat.sim.builder import build_sim
from epichat.sim.outputs import extract

BASE = {"day", "n_susceptible", "n_infected", "new_infections", "cum_infections", "new_deaths", "cum_deaths"}
EXPECTED = {
    "sir": BASE | {"n_recovered"},
    "sis": BASE,
    "sirs": BASE | {"n_recovered"},
    "seir": BASE | {"n_recovered", "n_exposed"},
    "seirs": BASE | {"n_recovered", "n_exposed"},
    "seiar": BASE | {"n_recovered", "n_exposed", "n_asymptomatic"},
}
EXTRA = {"seir": dict(dur_exp=3.0), "seirs": dict(dur_exp=3.0, dur_immune=60.0), "seiar": dict(dur_exp=3.0), "sirs": dict(dur_immune=60.0)}


def run(name, **over):
    base = dict(disease_type=name, beta=22.8125, n_agents=500, sim_dur_years=20 / 365, rand_seed=1, init_prev=0.05, p_death=0.3)
    base.update(EXTRA.get(name, {}))
    base.update(over)
    params = SimParams(**base)
    sim = build_sim(params)
    sim.run()
    return extract(sim, params.n_agents), sim


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_series_keys_lengths_and_stats_follow_v1(name):
    out, sim = run(name)
    series, stats = out["series"], out["stats"]
    assert set(series) == EXPECTED[name]
    assert {len(v) for v in series.values()} == {21}
    assert series["day"] == list(range(21))
    assert stats["sim_days"] == 21 and stats["n_agents"] == 500
    assert stats["peak_infections"] == max(series["n_infected"])
    assert stats["peak_day"] == series["n_infected"].index(max(series["n_infected"]))
    assert stats["total_infected"] == round(series["cum_infections"][-1])
    assert stats["total_deaths"] == round(series["cum_deaths"][-1])
    assert all(isinstance(v, float) for key in series if key != "day" for v in series[key])


@pytest.mark.parametrize("name", ["seir", "seirs", "seiar"])
def test_n_infected_is_the_infectious_count_not_exposed_plus_infectious(name):
    out, sim = run(name)
    res = sim.results[name]
    assert out["series"]["n_infected"] == [float(v) for v in res.n_infectious.values]
    assert out["series"]["n_exposed"] == [float(v) for v in res.n_exposed.values]


def test_deaths_are_the_disease_deaths_only():
    out, sim = run("sir", use_demographics=True, birth_rate=20.0, death_rate=500.0, p_death=0.0)
    assert out["stats"]["total_deaths"] == 0 and max(out["series"]["new_deaths"]) == 0
    assert sim.results.cum_deaths.values[-1] > 0            # background deaths happened and were not counted
    out2, sim2 = run("sir", p_death=0.5)
    assert out2["stats"]["total_deaths"] == sim2.results.cum_deaths.values[-1] > 0
    cum = out2["series"]["cum_deaths"]
    assert all(b >= a for a, b in zip(cum, cum[1:]))
