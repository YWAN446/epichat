"""build_sim on schema v2 (spec 8, revised by 17 and 18): the v1 behaviours
carried over, plus distributions, seeding modes, initial immunity, SIS waning
and the transmissibility connector."""
import numpy as np
import pytest
import starsim as ss

from epichat.params.migrate import coerce_params
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.builder import CONTACT_MATRIX, SimpleTreatment, build_sim, resolve_seed, sim_days, to_dist
from epichat.sim.connectors import TransmissibilityModifiers
from epichat.sim.interventions import InitialImmunity, SeedInfections
from template_cases import cases

CASES = cases()
EXTRA = {"seir": dict(dur_exp=3.0), "seirs": dict(dur_exp=3.0, dur_immune=60.0), "seiar": dict(dur_exp=3.0), "sirs": dict(dur_immune=60.0)}
MODELS = ["sir", "sis", "sirs", "seir", "seirs", "seiar"]


def params(**over) -> SimParamsV2:
    """v1-shaped input, migrated: the shortest way to a v2 object in a test."""
    base = dict(disease_type="sir", beta=22.8125, n_agents=1000, sim_dur_years=30 / 365, rand_seed=1)
    base.update(over)
    return coerce_params(base)


def v2(**over) -> SimParamsV2:
    return SimParamsV2.model_validate({"run": {"n_agents": 1000, "sim_dur_years": 30 / 365, "rand_seed": 1}, **over})


@pytest.mark.parametrize("name", sorted(CASES))
def test_every_template_case_builds_and_runs(name):
    sim = build_sim(coerce_params(CASES[name].model_dump()))
    sim.run()
    assert list(sim.diseases.keys()) == [name]
    assert sim.t.npts == sim_days(0.5) + 1 == 183
    assert sim.results[name].n_infected.values[0] > 0


@pytest.mark.parametrize("years, points", [(30 / 365, 31), (0.01, 5), (1.0, 366), (2.0, 731)])
def test_point_count_matches_v1_for_fractional_years(years, points):
    sim = build_sim(params(n_agents=200, sim_dur_years=years))
    assert sim.t.npts == points


def test_resolve_seed_prefers_the_explicit_seed_then_the_params_seed_then_one():
    assert resolve_seed(params(rand_seed=7), None) == 7
    assert resolve_seed(params(rand_seed=7), 3) == 3
    assert resolve_seed(params(rand_seed=None), None) == 1


def test_explicit_seed_is_deterministic_and_differs_between_seeds():
    a = build_sim(params(), seed=3)
    a.run()
    b = build_sim(params(), seed=3)
    b.run()
    c = build_sim(params(), seed=4)
    c.run()
    assert list(a.results.sir.cum_infections.values) == list(b.results.sir.cum_infections.values)
    assert list(a.results.sir.cum_infections.values) != list(c.results.sir.cum_infections.values)


def test_disease_parameters_reach_starsim_with_units():
    sim = build_sim(params(disease_type="seirs", dur_exp=4.0, dur_inf=7.0, dur_immune=90.0, p_death=0.2, init_prev=0.02, beta=12.5))
    d = sim.diseases[0]
    assert str(d.pars.beta) == str(ss.peryear(12.5))
    assert str(d.pars.dur_inf.pars.v) == str(ss.days(7.0)) and str(d.pars.dur_exp.pars.v) == str(ss.days(4.0))
    assert str(d.pars.dur_immune.pars.v) == str(ss.days(90.0))
    assert d.pars.p_death.pars.p == 0.2 and d.pars.init_prev.pars.p == 0.02


def test_to_dist_builds_the_three_forms():
    assert isinstance(to_dist(params(dur_inf=10).disease.dur_inf), ss.constant)
    gamma = to_dist(v2(disease={"dur_inf": {"mean_days": 10, "dist": "gamma", "sd_days": 4}}).disease.dur_inf)
    assert isinstance(gamma, ss.gamma) and gamma.pars.a == pytest.approx(6.25) and str(gamma.pars.scale) == str(ss.days(1.6))
    logn = to_dist(v2(disease={"dur_inf": {"mean_days": 10, "dist": "lognormal", "sd_days": 4}}).disease.dur_inf)
    assert isinstance(logn, ss.lognorm_ex) and str(logn.pars.mean) == str(ss.days(10)) and str(logn.pars.std) == str(ss.days(4))


@pytest.mark.parametrize("dist", ["gamma", "lognormal"])
def test_distributed_durations_realize_the_mean_plus_half_a_day(dist):
    p = v2(disease={"beta": 0.001, "dur_inf": {"mean_days": 10, "dist": dist, "sd_days": 4}, "seed": {"mode": "count", "value": 4000}},
           run={"n_agents": 5000, "sim_dur_years": 60 / 365, "rand_seed": 1})
    sim = build_sim(p)
    sim.run()
    d = sim.diseases[0]
    seeds = d.ti_infected.notnan.uids
    realized = np.asarray(d.ti_recovered[seeds]) - np.asarray(d.ti_infected[seeds])
    assert abs(realized.mean() - 10.5) <= 0.5


def test_constant_duration_recovers_exactly_ten_days_after_infectiousness():
    sim = build_sim(v2(disease={"beta": 0.001, "seed": {"mode": "count", "value": 200}}, run={"n_agents": 1000, "sim_dur_years": 20 / 365, "rand_seed": 1}))
    sim.run()
    res = sim.results.sir
    assert res.n_infected.values[9] == 200 and res.n_infected.values[10] == 0 and res.n_recovered.values[10] == 200


@pytest.mark.parametrize("name", MODELS)
def test_compartments_plus_cumulative_deaths_sum_to_n_every_day(name):
    p = params(disease_type=name, p_death=0.3, init_prev=0.05, sim_dur_years=40 / 365, **EXTRA.get(name, {}))
    sim = build_sim(p)
    sim.run()
    res = sim.results[name]
    total = np.asarray(res.n_susceptible.values) + np.asarray(res.n_infected.values)
    if "n_recovered" in res:
        total = total + np.asarray(res.n_recovered.values)
    total = total + np.cumsum(np.asarray(res.new_deaths_disease.values))
    assert np.all(total == 1000)


def test_count_seeding_infects_exactly_that_many_on_day_zero():
    sim = build_sim(v2(disease={"seed": {"mode": "count", "value": 37}}))
    assert sim.seeds_day0 == 37 and int(sim.diseases[0].infected.count()) == 37
    assert isinstance(sim.diseases[0].pars.init_prev, ss.choose_n)


def test_delayed_seeding_infects_nobody_before_the_day_and_the_count_on_it():
    sim = build_sim(v2(disease={"seed": {"mode": "count", "value": 25, "day": 5}}))
    assert sim.seeds_day0 == 0 and sim.diseases[0].pars.init_prev.pars.p == 0.0
    assert isinstance(sim.interventions[0], SeedInfections)
    sim.run()
    res = sim.results.sir
    assert list(res.n_infected.values[:5]) == [0.0] * 5
    assert res.new_infections.values[5] >= 25 and sim.interventions[0].n_seeded == 25


@pytest.mark.parametrize("name", MODELS)
def test_initial_immunity_leaves_half_of_the_non_seeded_agents_immune(name):
    p = params(disease_type=name, init_prev=0.1, beta=0.001, interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 0}], **EXTRA.get(name, {}))
    assert p.disease.initial_immune_frac == 0.5 and p.interventions == []
    sim = build_sim(p)
    assert any(isinstance(i, InitialImmunity) for i in sim.interventions.values())
    sim.run()
    immunised = next(i for i in sim.interventions.values() if isinstance(i, InitialImmunity)).n_immunised
    share = immunised / (1000 - sim.seeds_day0)
    assert abs(share - 0.5) <= 0.04
    d = sim.diseases[0]
    immune_now = int((np.asarray(d.rel_sus.values) == 0).sum()) if name == "sis" else int(d.recovered.count())
    assert immune_now >= immunised                       # the seeds that recovered join them in the SIR family


def test_initially_immune_agents_return_to_susceptible_in_sirs():
    p = params(disease_type="sirs", dur_immune=7.0, init_prev=0.01, beta=0.001, sim_dur_years=15 / 365,      # 7 days is the registry's floor
               interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 0}])
    sim = build_sim(p)
    sim.run()
    assert sim.results.sirs.n_recovered.values[2] > 400 and sim.results.sirs.n_recovered.values[-1] < 20


def test_sis_waning_and_boost_reach_starsim():
    sim = build_sim(v2(disease={"model": "sis", "sis_waning": 26.0, "sis_imm_boost": 0.5}))
    d = sim.diseases[0]
    assert str(d.pars.waning) == str(ss.peryear(26.0)) and d.pars.imm_boost == 0.5 and "p_death" not in d.pars
    default = build_sim(v2(disease={"model": "sis"})).diseases[0]
    assert str(default.pars.waning) == str(ss.peryear(0)) and default.pars.imm_boost == 0


@pytest.mark.parametrize("seasonal", [False, True])
def test_seiar_asymptomatic_rel_trans_is_the_reduction_times_the_seasonal_factor(seasonal):
    interventions = [{"type": "seasonality", "scale": 0.3, "shift": 0.1}] if seasonal else []
    p = params(disease_type="seiar", dur_exp=1.0, p_asymp=1.0, rel_trans_asymp=0.25, init_prev=0.2, beta=0.001, sim_dur_years=10 / 365, interventions=interventions)
    sim = build_sim(p)
    assert isinstance(sim.connectors[0], TransmissibilityModifiers)
    sim.run()
    d = sim.diseases[0]
    asymp = d.asymptomatic.uids
    factor = sim.connectors[0].factors[-1]
    assert len(asymp) > 0 and factor == pytest.approx(1.0 if not seasonal else max(0.0, 1 + 0.3 * np.cos(2 * np.pi * (10 / 365 - 0.1))))
    assert np.allclose(np.asarray(d.rel_trans[asymp]), 0.25 * factor)


def test_routine_vaccine_starts_on_its_start_day():
    p = params(sim_dur_years=20 / 365, n_agents=2000, interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 10}])
    sim = build_sim(p)
    vx = next(i for i in sim.interventions.values() if isinstance(i, ss.routine_vx))
    assert vx.start_year == pytest.approx(10 / 365)
    sim.run()
    assert int((np.asarray(sim.diseases[0].rel_sus.values) == 0).sum()) > 0


@pytest.mark.parametrize("name", MODELS)
def test_treatment_runs_on_every_model(name):
    p = params(disease_type=name, interventions=[{"type": "treatment", "coverage": 0.5, "capacity": None, "start_day": 2}], **EXTRA.get(name, {}))
    sim = build_sim(p)
    assert any(isinstance(i, SimpleTreatment) for i in sim.interventions.values())
    sim.run()


def test_treatment_caps_the_number_treated_per_day():
    p = params(init_prev=0.5, interventions=[{"type": "treatment", "coverage": 1.0, "capacity": 7, "start_day": 0}])
    sim = build_sim(p)
    treatment = next(i for i in sim.interventions.values() if isinstance(i, SimpleTreatment))
    d = sim.diseases[0]
    treatment.step()
    assert int((np.asarray(d.ti_recovered.values) == 1).sum()) == 7


def test_age_structured_network_scales_the_contact_matrix_and_assigns_age_shares():
    p = params(network_type="age_structured", network_beta=2.0, n_agents=4000, age_pct_under18=30.0, age_pct_18_64=60.0, age_pct_over65=10.0)
    sim = build_sim(p)
    net = sim.networks[0]
    assert isinstance(net, ss.MixingPools)
    assert np.allclose(np.asarray(net.pars.n_contacts, dtype=float), CONTACT_MATRIX * 2.0)
    age = np.asarray(sim.people.age.values)
    assert abs((age < 18).mean() - 0.30) < 0.02 and abs((age >= 65).mean() - 0.10) < 0.02
    sim.run()


def test_age_structured_network_without_shares_builds_and_runs():
    sim = build_sim(params(network_type="age_structured", n_agents=2000))
    sim.run()
    assert int((np.asarray(sim.people.age.values) >= 65).sum()) == 0       # Starsim's default ages are 0 to 60 (section 18)
    assert sim.results.sir.cum_infections.values[-1] > 0


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
    p = params(rand_seed=None, n_agents=600, network_type="age_structured", age_pct_under18=30.0, age_pct_18_64=60.0, age_pct_over65=10.0,
               interventions=[{"type": "vaccine", "coverage": 0.3, "start_day": 0}])
    a, b = build_sim(p), build_sim(p)
    assert np.array_equal(np.asarray(a.people.age.values), np.asarray(b.people.age.values))
    a.run()
    b.run()
    assert np.array_equal(np.asarray(a.diseases[0].recovered.uids), np.asarray(b.diseases[0].recovered.uids))
    assert list(a.results.sir.cum_infections.values) == list(b.results.sir.cum_infections.values)
