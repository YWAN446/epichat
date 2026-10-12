"""build_sim reproduces the v1 templates on Starsim 3.7 (spec 8, as revised by 17)."""
import numpy as np
import pytest
import starsim as ss

from epichat.schema import SimParams
from epichat.sim.builder import CONTACT_MATRIX, SimpleTreatment, build_sim, resolve_seed, sim_days
from template_cases import cases

CASES = cases()
EXTRA = {"seir": dict(dur_exp=3.0), "seirs": dict(dur_exp=3.0, dur_immune=60.0), "seiar": dict(dur_exp=3.0),
         "sirs": dict(dur_immune=60.0)}


def params(**over) -> SimParams:
    base = dict(disease_type="sir", beta=22.8125, n_agents=1000, sim_dur_years=30 / 365, rand_seed=1)
    base.update(over)
    return SimParams(**base)


@pytest.mark.parametrize("name", sorted(CASES))
def test_every_template_case_builds_and_runs(name):
    sim = build_sim(CASES[name])
    sim.run()
    assert list(sim.diseases.keys()) == [name]
    assert sim.t.npts == sim_days(0.5) + 1 == 183
    assert sim.results[name].n_infected.values[0] > 0   # the template cases use beta 0.05 per year: seeds, no spread


@pytest.mark.parametrize("years, points", [(30 / 365, 31), (0.01, 5), (1.0, 366), (2.0, 731)])
def test_point_count_matches_v1_for_fractional_years(years, points):
    sim = build_sim(params(n_agents=200, sim_dur_years=years))
    assert sim.t.npts == points
    assert sim_days(years) == points - 1


def test_resolve_seed_prefers_the_explicit_seed_then_the_params_seed():
    assert resolve_seed(params(rand_seed=7), None) == 7
    assert resolve_seed(params(rand_seed=7), 3) == 3
    assert resolve_seed(params(rand_seed=None), None) is None


def test_explicit_seed_is_deterministic_and_differs_between_seeds():
    a = build_sim(params(), seed=3); a.run()
    b = build_sim(params(), seed=3); b.run()
    c = build_sim(params(), seed=4); c.run()
    assert list(a.results.sir.cum_infections.values) == list(b.results.sir.cum_infections.values)
    assert list(a.results.sir.cum_infections.values) != list(c.results.sir.cum_infections.values)


def test_disease_parameters_reach_starsim_with_units():
    sim = build_sim(params(disease_type="seirs", dur_exp=4.0, dur_inf=7.0, dur_immune=90.0, p_death=0.2, init_prev=0.02, beta=12.5))
    d = sim.diseases[0]
    assert str(d.pars.beta) == str(ss.peryear(12.5))
    assert str(d.pars.dur_inf.pars.v) == str(ss.days(7.0)) and str(d.pars.dur_exp.pars.v) == str(ss.days(4.0))
    assert str(d.pars.dur_immune.pars.v) == str(ss.days(90.0))
    assert d.pars.p_death.pars.p == 0.2 and d.pars.init_prev.pars.p == 0.02


def test_sis_ignores_p_death_and_has_no_deaths():
    sim = build_sim(params(disease_type="sis", p_death=0.5, init_prev=0.1))
    sim.run()
    assert "p_death" not in sim.diseases[0].pars
    assert sim.results.cum_deaths.values[-1] == 0
    assert sim.results.sis.new_deaths_disease.values.sum() == 0


@pytest.mark.parametrize("name", ["sir", "sis", "sirs", "seir", "seirs", "seiar"])
def test_day_zero_vaccine_immunises_the_coverage_share_of_susceptibles(name):
    p = params(disease_type=name, init_prev=0.01, interventions=[{"type": "vaccine", "coverage": 0.3, "start_day": 0}],
               **EXTRA.get(name, {}))
    sim = build_sim(p)
    d = sim.diseases[0]
    if name == "sis":
        seeds = 1000 - int(d.susceptible.count())
        expected = int(0.3 * (1000 - seeds))
        assert int((np.asarray(d.rel_sus.values) == 0).sum()) == expected
        assert int((np.asarray(d.immunity.values) > 0).sum()) == expected
    else:
        seeds = int((~d.susceptible).count()) - int(d.recovered.count())
        expected = int(0.3 * (1000 - seeds))
        assert int(d.recovered.count()) == expected


def test_routine_vaccine_starts_on_its_start_day():
    p = params(sim_dur_years=20 / 365, n_agents=2000, interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 10}])
    sim = build_sim(p)
    assert sim.interventions[0].start_year == pytest.approx(10 / 365)
    sim.run()
    assert int((np.asarray(sim.diseases[0].rel_sus.values) == 0).sum()) > 0


@pytest.mark.parametrize("name", ["sir", "sis", "sirs", "seir", "seirs", "seiar"])
def test_treatment_runs_on_every_model(name):
    p = params(disease_type=name, interventions=[{"type": "treatment", "coverage": 0.5, "capacity": None, "start_day": 2}],
               **EXTRA.get(name, {}))
    sim = build_sim(p)
    assert isinstance(sim.interventions[0], SimpleTreatment)
    sim.run()


def test_treatment_caps_the_number_treated_per_day():
    p = params(init_prev=0.5, interventions=[{"type": "treatment", "coverage": 1.0, "capacity": 7, "start_day": 0}])
    sim = build_sim(p)
    treatment = sim.interventions[0]
    d = sim.diseases[0]
    treatment.step()
    assert int((np.asarray(d.ti_recovered.values) == 1).sum()) == 7


def test_seasonality_is_a_connector_on_the_disease():
    sim = build_sim(params(interventions=[{"type": "seasonality", "scale": 0.3, "shift": 0.1}]))
    sea = sim.connectors[0]
    assert isinstance(sea, ss.seasonality) and sea.pars.scale == 0.3 and sea.pars.shift == 0.1 and sea.pars.diseases == "sir"


def test_age_structured_network_scales_the_contact_matrix_and_assigns_age_shares():
    p = params(network_type="age_structured", network_beta=2.0, n_agents=4000,
               age_pct_under18=30.0, age_pct_18_64=60.0, age_pct_over65=10.0)
    sim = build_sim(p)
    net = sim.networks[0]
    assert isinstance(net, ss.MixingPools)
    assert np.allclose(np.asarray(net.pars.n_contacts, dtype=float), CONTACT_MATRIX * 2.0)
    age = np.asarray(sim.people.age.values)
    assert abs((age < 18).mean() - 0.30) < 0.02 and abs((age >= 65).mean() - 0.10) < 0.02
    sim.run()


def test_random_network_without_age_shares_keeps_default_ages():
    sim = build_sim(params(n_agents=500))
    assert isinstance(sim.networks[0], ss.RandomNet)
    assert sim.networks[0].pars.n_contacts.pars.v == 4


def test_demographics_modules_carry_the_rates_per_thousand():
    sim = build_sim(params(use_demographics=True, birth_rate=25.0, death_rate=8.0))
    assert set(sim.demographics.keys()) == {"births", "deaths"}
    assert str(sim.demographics.births.pars.birth_rate) == str(ss.peryear(25.0))
    assert str(sim.demographics.deaths.pars.death_rate) == str(ss.peryear(8.0))
    assert sim.demographics.births.pars.rate_units == 1e-3
    sim.run()


def test_null_seed_is_reproducible_on_every_random_path():
    # Starsim falls back to seed 1 when rand_seed is null; the numpy generators behind the
    # age assignment and the day-0 vaccine move must follow the same effective seed
    p = params(rand_seed=None, n_agents=600, network_type="age_structured",
               age_pct_under18=30.0, age_pct_18_64=60.0, age_pct_over65=10.0,
               interventions=[{"type": "vaccine", "coverage": 0.3, "start_day": 0}])
    a, b = build_sim(p), build_sim(p)
    assert np.array_equal(np.asarray(a.people.age.values), np.asarray(b.people.age.values))
    assert np.array_equal(np.asarray(a.diseases[0].recovered.uids), np.asarray(b.diseases[0].recovered.uids))
    a.run(); b.run()
    assert list(a.results.sir.cum_infections.values) == list(b.results.sir.cum_infections.values)
