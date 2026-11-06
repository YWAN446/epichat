"""build_sim: SimParamsV2 to an uninitialized Starsim 4 sim, as an ODE unless something needs agents."""
import numpy as np
import pytest
import starsim as ss

from epichat.params import tables
from epichat.params.migrate import coerce_params
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.builder import build_network, build_sim, needs_agents, resolve_seed
from epichat.sim.outputs import extract


def scenario(n: int = 2000, days: int = 60, seed: int | None = 1, **sections) -> SimParamsV2:
    body = {"disease": {"seed": {"mode": "count", "value": 20}}, "run": {"n_agents": n, "sim_dur_years": days / 365, "rand_seed": seed}}
    for key, value in sections.items():
        if isinstance(value, dict):
            body.setdefault(key, {}).update(value)
        else:
            body[key] = value
    return SimParamsV2.model_validate(body)


def run(p: SimParamsV2):
    sim = build_sim(p)
    sim.run()
    return sim, extract(sim, p)


@pytest.mark.parametrize("network, interventions, agents", [
    ({}, [], False),
    ({"network_type": "age_structured"}, [], False),
    ({"network_type": "hybrid"}, [], True),
    ({"contact_duration_days": 3.0}, [], True),
    ({"contacts_dist": "poisson"}, [], True),
    ({}, [{"type": "treatment", "coverage": 0.5}], False),
    ({}, [{"type": "treatment", "coverage": 0.5, "delay_days": 2}], True),
])
def test_the_solver_is_an_ode_unless_something_needs_agents(network, interventions, agents):
    p = scenario(network=network, interventions=interventions)
    assert needs_agents(p) is agents
    sim, _ = run(p)
    assert sim.solver == ("abm" if agents else "ode")


def test_well_mixed_contact_needs_no_network_and_the_others_have_theirs():
    assert build_network(scenario()) is None
    assert build_network(scenario(network={"network_type": "age_structured"})) is not None
    assert isinstance(build_network(scenario(network={"contact_duration_days": 2.0})), ss.RandomNet)


def test_resolve_seed_prefers_the_explicit_seed_then_the_params_seed_then_one():
    p = scenario(seed=9)
    assert resolve_seed(p, 3) == 3 and resolve_seed(p, None) == 9 and resolve_seed(scenario(seed=None), None) == 1


def test_an_agent_run_is_reproducible_by_seed_and_differs_between_seeds():
    p = scenario(network={"network_type": "hybrid"})
    a, b, c = build_sim(p, seed=1), build_sim(p, seed=1), build_sim(p, seed=2)
    for sim in (a, b, c):
        sim.run()
    cum = lambda sim: list(extract(sim, p)["series"]["cum_infections"])
    assert cum(a) == cum(b) != cum(c)


def test_count_and_fraction_seeding():
    _, out = run(scenario(disease={"seed": {"mode": "count", "value": 37}}))
    assert out["stats"]["seeds_day0"] == out["stats"]["seeds"] == 37 and out["series"]["n_infectious"][0] == 37
    _, out = run(scenario(disease={"seed": {"mode": "fraction", "value": 0.01}}))
    assert out["series"]["n_infectious"][0] == pytest.approx(20, rel=1e-6)


def test_delayed_seeding_infects_nobody_before_its_day():
    _, out = run(scenario(disease={"seed": {"mode": "count", "value": 30, "day": 10}}))
    s = out["series"]
    assert max(s["n_infectious"][:11]) == 0 and s["cum_infections"][9] == 0
    assert out["stats"]["seeds_day0"] == 0 and out["stats"]["seeds"] == 30 and s["n_infectious"][11] > 0


def test_initial_immunity_lowers_the_attack_rate():
    _, base = run(scenario(days=200))
    _, immune = run(scenario(days=200, disease={"initial_immune_frac": 0.5}))
    assert immune["series"]["n_recovered"][0] == pytest.approx(0.5 * (2000 - 20))            # a share of the people not seeded
    assert immune["stats"]["total_infected"] < 0.5 * base["stats"]["total_infected"]


def test_demographics_add_births_and_deaths_from_other_causes():
    p = scenario(days=730, demographics={"use_demographics": True, "birth_rate": 40.0, "death_rate": 20.0})
    sim, out = run(p)
    alive = np.asarray(sim.results.alive.values)
    assert alive[-1] > alive[0]                                      # births outnumber deaths
    assert out["series"]["cum_deaths_all"][-1] > 0 and "new_deaths_all" in out["series"]
    assert "cum_deaths_all" not in run(scenario())[1]["series"]


def test_a_country_gives_births_that_follow_its_projection_after_the_first_year():
    demographics = {"use_demographics": True, "birth_rate": 60.0, "death_rate": 0.1}
    series = tables.birth_rate_series("KEN", 2022, 3)
    assert len(series) == 3 and series[1] < 60.0
    flat, _ = run(scenario(days=3 * 365, demographics=demographics))
    kenya, _ = run(scenario(days=3 * 365, demographics={**demographics, "country": "KEN"}))
    alive = lambda sim: np.asarray(sim.results.alive.values)
    assert alive(kenya)[365] == pytest.approx(alive(flat)[365], rel=1e-6)          # the first year keeps the configured rate
    assert alive(kenya)[-1] < alive(flat)[-1]


def test_an_agent_run_with_a_country_draws_ages_from_its_pyramid():
    p = scenario(n=20000, network={"network_type": "hybrid"}, demographics={"country": "KEN", "age_source": "un_wpp"})
    sim = build_sim(p)
    sim.init()
    age = np.asarray(sim.people.age)
    c, _, e = tables.age_shares("KEN")
    assert abs((age < 18).mean() - c) < 0.02 and abs((age >= 65).mean() - e) < 0.01


def test_an_agent_run_with_shares_draws_ages_in_those_shares():
    p = scenario(n=10000, network={"network_type": "hybrid"}, disease={"rel_sus_age": {"elderly": 2.0}},
                 demographics={"age_source": "shares", "age_pct_under18": 50.0, "age_pct_18_64": 20.0, "age_pct_over65": 30.0})
    sim = build_sim(p)
    sim.init()
    age = np.asarray(sim.people.age)
    assert abs((age < 18).mean() - 0.5) < 0.02 and abs((age >= 65).mean() - 0.3) < 0.02


def test_v1_parameters_are_migrated_and_run():
    p = coerce_params({"disease_type": "seir", "beta": 22.8125, "dur_exp": 3.0, "n_agents": 1000, "sim_dur_years": 30 / 365, "rand_seed": 1})
    sim, out = run(p)
    assert sim.solver == "ode" and len(out["series"]["day"]) == 31 and "n_exposed" in out["series"]


def test_the_run_has_one_point_a_day_from_day_zero():
    sim = build_sim(scenario(days=45))
    sim.run()
    assert len(sim.results.timevec) == 46
