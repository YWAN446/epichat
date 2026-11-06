"""The six models as one declared Starsim disease (epichat/sim/model.py): states, transitions, R0 and stratifications."""
import numpy as np
import pytest

from epichat.params.r0 import approx_r0, with_r0
from epichat.params.registry import MODELS
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.builder import build_sim
from epichat.sim.diagnostics import final_size
from epichat.sim.model import SUS_LEVELS, susceptibility_levels
from epichat.sim.outputs import extract

LATENT = {"mean_days": 3.0}
EXTRA = {"seir": dict(dur_exp=LATENT), "seirs": dict(dur_exp=LATENT, dur_immune={"mean_days": 60.0}), "seiar": dict(dur_exp=LATENT),
         "sirs": dict(dur_immune={"mean_days": 60.0})}
STATES = {"sir": "SIR", "seir": "SEIR", "sis": "SI", "sirs": "SIR", "seirs": "SEIR", "seiar": "SEIAR"}


def scenario(model: str = "sir", n: int = 10000, days: int = 120, network: dict | None = None, demographics: dict | None = None, **disease) -> SimParamsV2:
    body = {"disease": {"model": model, "seed": {"mode": "count", "value": 20}, **EXTRA.get(model, {}), **disease},
            "network": network or {}, "demographics": demographics or {}, "run": {"n_agents": n, "sim_dur_years": days / 365, "rand_seed": 1}}
    return SimParamsV2.model_validate(body)


def run(p: SimParamsV2):
    sim = build_sim(p)
    sim.run()
    return sim, extract(sim, p)


@pytest.mark.parametrize("model", MODELS)
def test_every_model_runs_as_an_ode_with_its_states_and_keeps_the_people(model):
    sim, out = run(scenario(model, p_death=0.0 if model == "sis" else 0.05))
    assert sim.solver == "ode" and out["stats"]["solver"] == "ode"
    disease = sim.diseases[0]
    assert disease.name == model and [s for s in "SEIAR" if s in sim.results[model]] == list(STATES[model])
    s = out["series"]
    stocks = sum(np.array(s[k]) for k in ("n_susceptible", "n_exposed", "n_infectious", "n_recovered") if k in s)
    deaths_before = np.concatenate([[0.0], np.array(s["cum_deaths"])[:-1]])     # stocks are at the start of a day, deaths over it
    assert np.allclose(stocks + deaths_before, 10000, rtol=1e-6)
    assert out["stats"]["total_infected"] > 1000                     # the default R0 is 2.5


@pytest.mark.parametrize("model", ("sir", "seir", "seiar"))
def test_approx_r0_is_starsims_r0_on_the_random_and_age_structured_networks(model):
    extra = dict(rel_trans_exposed=0.3) if model != "sir" else {}
    for network in ({}, {"network_type": "age_structured"}):
        p = with_r0(scenario(model, network=network, rel_sus_age={"children": 0.5, "adults": 1.0, "elderly": 2.0}, **extra), 2.0)
        sim, out = run(p)
        assert out["stats"]["r0_model"] == pytest.approx(approx_r0(p), rel=1e-6) == pytest.approx(2.0, rel=1e-5)


def test_the_age_structured_network_reads_rows_as_sources_and_columns_as_targets():
    # children infect adults (row children, column adults) but adults barely infect children
    rows = [[3.0, 6.0, 0.1], [0.1, 0.5, 0.1], [0.1, 0.1, 0.5]]
    groups = ("children", "adults", "elderly")
    contacts = {f"{s}_{t}": rows[i][j] for i, s in enumerate(groups) for j, t in enumerate(groups)}
    sim, _ = run(scenario(network={"network_type": "age_structured", "contacts": contacts}, beta=20.0, days=365))
    start, end = sim.results.sir.S.strata[0], sim.results.sir.S.strata[-1]
    assert end[1] / start[1] < 0.2                                 # most adults were infected, by the children


def test_fatality_by_age_kills_only_the_group_with_a_fatality():
    sim, out = run(scenario(p_death_age={"elderly": 0.5}, network={"network_type": "age_structured"}, days=200))
    assert out["stats"]["total_deaths"] > 0
    deaths = sim.results.sir.death.strata.sum(axis=0)                # by age group: children, adults, elderly
    assert deaths[0] == pytest.approx(0, abs=1e-6) and deaths[1] == pytest.approx(0, abs=1e-6) and deaths[2] > 0


def test_only_symptomatic_seiar_infections_die():
    _, all_symptomatic = run(scenario("seiar", p_asymp=0.0, p_death=0.1))
    _, half = run(scenario("seiar", p_asymp=0.5, p_death=0.1, rel_trans_asymp=1.0))
    ratio = lambda o: o["stats"]["total_deaths"] / o["stats"]["total_infected"]
    assert ratio(all_symptomatic) == pytest.approx(0.1, rel=0.05) and ratio(half) == pytest.approx(0.05, rel=0.1)


def test_sis_immunity_boost_and_waning():
    sim, out = run(scenario("sis"))
    assert "n_recovered" not in out["series"]                       # the classic SIS has no R
    sim, out = run(scenario("sis", sis_imm_boost=0.5, sis_waning=2.0))
    assert max(out["series"]["n_recovered"]) > 0


def test_the_waning_models_return_people_to_susceptible():
    _, out = run(scenario("sirs", days=365))
    s = out["series"]["n_susceptible"]
    assert s[-1] > min(s) + 100


def test_initial_immunity_starts_in_r():
    _, out = run(scenario(initial_immune_frac=0.4))
    assert out["series"]["n_recovered"][0] == pytest.approx(0.4 * (10000 - 20), rel=0.01)


def test_the_susceptibility_classes_have_mean_one_and_spread_with_the_cv():
    for cv in (0.5, 1.0, 2.0):
        levels = np.array(susceptibility_levels(cv))
        assert len(levels) == SUS_LEVELS and levels.mean() == pytest.approx(1.0) and np.all(np.diff(levels) > 0)
    assert np.std(susceptibility_levels(2.0)) > np.std(susceptibility_levels(1.0)) > np.std(susceptibility_levels(0.5))


def test_variation_in_susceptibility_keeps_r0_and_shrinks_the_epidemic_close_to_the_closed_form():
    for cv in (0.0, 1.0):
        p = with_r0(scenario(rel_sus_cv=cv, days=730, n=100000), 2.5)
        _, out = run(p)
        assert out["stats"]["r0_model"] == pytest.approx(2.5, rel=1e-6)
        assert out["stats"]["total_infected"] / 100000 == pytest.approx(final_size(2.5, cv), abs=0.03)
