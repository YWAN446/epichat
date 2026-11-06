"""extract(): the 8.6 series and the stats from a finished Starsim 4 sim."""
import pytest

from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.builder import build_sim
from epichat.sim.outputs import SERIES_KEYS, extract

BASE = {"day", "n_susceptible", "n_infectious", "n_infected", "new_infections", "cum_infections", "new_deaths", "cum_deaths"}
EXPECTED = {
    "sir": BASE | {"n_recovered"},
    "sis": BASE,
    "sirs": BASE | {"n_recovered"},
    "seir": BASE | {"n_recovered", "n_exposed"},
    "seirs": BASE | {"n_recovered", "n_exposed"},
    "seiar": BASE | {"n_recovered", "n_exposed", "n_asymptomatic"},
}
LATENT = {"mean_days": 3.0}
EXTRA = {"seir": dict(dur_exp=LATENT), "seirs": dict(dur_exp=LATENT, dur_immune={"mean_days": 60.0}), "seiar": dict(dur_exp=LATENT),
         "sirs": dict(dur_immune={"mean_days": 60.0})}
STATS = {"peak_infections", "peak_day", "total_infected", "total_deaths", "n_agents", "sim_days", "seeds_day0", "seeds", "solver", "r0_model"}


def run(model: str = "sir", days: int = 20, network: dict | None = None, interventions=(), demographics: dict | None = None, **disease):
    deaths = {} if model == "sis" else {"p_death": 0.3}
    body = {"disease": {"model": model, "seed": {"mode": "count", "value": 25}, **deaths, **EXTRA.get(model, {}), **disease},
            "network": network or {}, "demographics": demographics or {}, "interventions": list(interventions),
            "run": {"n_agents": 500, "sim_dur_years": days / 365, "rand_seed": 1}}
    p = SimParamsV2.model_validate(body)
    sim = build_sim(p)
    sim.run()
    return extract(sim, p), sim


@pytest.mark.parametrize("model", sorted(EXPECTED))
def test_series_keys_lengths_and_stats(model):
    out, sim = run(model)
    series, stats = out["series"], out["stats"]
    assert set(out) == {"stats", "series"} and set(series) == EXPECTED[model] and set(SERIES_KEYS) >= EXPECTED[model] - {"day"}
    assert {len(v) for v in series.values()} == {21} and series["day"] == list(range(21))
    assert series["n_infected"] == series["n_infectious"]
    assert set(stats) == STATS and stats["solver"] == "ode" and stats["r0_model"] == pytest.approx(2.125 if model == "seiar" else 2.5)   # seiar: 30% asymptomatic at half
    assert stats["sim_days"] == 21 and stats["n_agents"] == 500 and stats["seeds_day0"] == stats["seeds"] == 25
    assert stats["peak_infections"] == round(max(series["n_infectious"]))
    assert stats["peak_day"] == series["n_infectious"].index(max(series["n_infectious"]))
    assert stats["total_infected"] == round(series["cum_infections"][-1]) and stats["total_deaths"] == round(series["cum_deaths"][-1])
    assert all(isinstance(v, float) for key in series if key != "day" for v in series[key])


def test_the_day_zero_seeds_count_once_as_new_infections_on_day_zero():
    out, sim = run()
    infections = sim.results.sir.infection.values
    assert out["series"]["new_infections"][0] == pytest.approx(25 + infections[0])
    assert out["series"]["cum_infections"][-1] == pytest.approx(25 + infections.sum())


def test_seiar_infectious_count_includes_the_asymptomatic_and_excludes_the_exposed():
    out, _ = run("seiar")
    s = out["series"]
    assert all(i >= a for i, a in zip(s["n_infectious"], s["n_asymptomatic"])) and max(s["n_asymptomatic"]) > 0
    assert s["n_infectious"][0] == 25 and s["n_exposed"][0] == 0


def test_a_delayed_seeding_is_in_the_seeds_but_not_in_the_day_zero_seeds():
    out, _ = run(days=10, seed={"mode": "count", "value": 30, "day": 4})
    assert out["stats"]["seeds_day0"] == 0 and out["stats"]["seeds"] == 30
    assert out["series"]["cum_infections"][3] == 0 and out["series"]["cum_infections"][-1] >= 30


def test_deaths_are_the_diseases_and_all_causes_come_only_with_demographics():
    out, _ = run(p_death=0.0, demographics={"use_demographics": True, "birth_rate": 20.0, "death_rate": 500.0})
    assert out["stats"]["total_deaths"] == 0 and out["series"]["cum_deaths_all"][-1] > 0
    out, _ = run()
    assert out["stats"]["total_deaths"] > 0 and "cum_deaths_all" not in out["series"]


def test_an_agent_run_has_whole_counts_and_r0_is_none_where_starsim_cannot_give_one():
    out, sim = run(network={"network_type": "hybrid"})
    assert sim.solver == "abm" and out["stats"]["solver"] == "abm"
    assert all(float(v).is_integer() for v in out["series"]["n_infectious"])
    assert out["stats"]["r0_model"] is None or out["stats"]["r0_model"] > 0


def test_the_behaviour_response_reports_its_lowest_factor():
    out, _ = run(days=60, interventions=[{"type": "behavior_response", "scale": 0.6}])
    b = out["stats"]["behavior"]
    assert 0.4 < b["min_factor"] < 1 and 0 <= b["min_day"] <= 60
    assert "behavior" not in run()[0]["stats"]
