"""EpiChat's six models on Starsim 3.7 base classes (spec 7.1, phase 0 behaviour)."""
import numpy as np
import pytest
import starsim as ss

from epichat.sim.models import MODELS, SEIAR, SEIR, SEIRS, SIR, SIRS, SIS


def run(model, days=40, n=800, seed=1, **pars):
    sim = ss.Sim(n_agents=n, networks=ss.RandomNet(n_contacts=4), diseases=model(**pars),
                 start=ss.days(0), dur=ss.days(days), dt=ss.days(1), rand_seed=seed, verbose=0)
    sim.run()
    return sim


def test_registry_names_every_model():
    assert MODELS == {"sir": SIR, "seir": SEIR, "sis": SIS, "sirs": SIRS, "seirs": SEIRS, "seiar": SEIAR}


@pytest.mark.parametrize("name", ["sir", "seir", "sirs", "seirs", "seiar"])
def test_models_count_the_deaths_they_request(name):
    pars = dict(init_prev=ss.bernoulli(p=0.05), beta=ss.peryear(30), dur_inf=ss.constant(ss.days(5)), p_death=ss.bernoulli(p=0.5))
    if name in ("seir", "seirs", "seiar"):
        pars["dur_exp"] = ss.constant(ss.days(2))
    if name in ("sirs", "seirs"):
        pars["dur_immune"] = ss.constant(ss.days(30))
    sim = run(MODELS[name], **pars)
    disease_deaths = sim.results[name].new_deaths_disease.values
    assert disease_deaths.sum() > 0
    # no demographics, so every death in the population is a disease death
    assert disease_deaths.sum() == sim.results.cum_deaths.values[-1]
    assert len(disease_deaths) == 41


def test_sis_has_no_immunity_and_no_deaths_by_default():
    sim = run(SIS, init_prev=ss.bernoulli(p=0.05), beta=ss.peryear(30), dur_inf=ss.constant(ss.days(5)),
              waning=ss.peryear(0), imm_boost=0)
    d = sim.diseases[0]
    assert np.all(d.rel_sus.values == 1.0)
    res = sim.results.sis
    assert "n_recovered" not in res and "new_deaths_disease" in res
    assert res.new_deaths_disease.values.sum() == 0
    assert res.n_susceptible.values[-1] + res.n_infected.values[-1] == 800


def test_sirs_immunity_wanes_back_to_susceptible():
    # fifty seeds, (almost) no transmission: all recover by day 3 and wane back by day 8
    sim = run(SIRS, days=12, n=500, init_prev=ss.choose_n(50), beta=ss.peryear(1e-6),
              dur_inf=ss.constant(ss.days(3)), dur_immune=ss.constant(ss.days(5)), p_death=ss.bernoulli(p=0))
    res = sim.results.sirs
    assert res.n_recovered.values[3] == 50 and res.n_susceptible.values[3] == 450
    assert res.n_recovered.values[8] == 0 and res.n_susceptible.values[8] == 500


def test_seirs_immunity_wanes_after_the_latent_and_infectious_periods():
    sim = run(SEIRS, days=14, n=500, init_prev=ss.choose_n(50), beta=ss.peryear(1e-6),
              dur_exp=ss.constant(ss.days(2)), dur_inf=ss.constant(ss.days(3)), dur_immune=ss.constant(ss.days(5)),
              p_death=ss.bernoulli(p=0))
    res = sim.results.seirs
    assert res.n_exposed.values[1] == 50 and res.n_infectious.values[2] == 50
    assert res.n_recovered.values[5] == 50 and res.n_recovered.values[10] == 0
    assert res.n_susceptible.values[10] == 500


def test_seiar_marks_an_asymptomatic_share_with_reduced_transmissibility():
    sim = run(SEIAR, days=3, n=2000, init_prev=ss.choose_n(1000), beta=ss.peryear(1e-6),
              dur_exp=ss.constant(ss.days(1)), dur_inf=ss.constant(ss.days(10)), p_death=ss.bernoulli(p=0),
              p_asymp=ss.bernoulli(p=0.4), rel_trans_asymp=0.5)
    d = sim.diseases[0]
    res = sim.results.seiar
    assert "n_asymptomatic" in res
    n_asymp = int(d.asymptomatic.count())
    assert 330 <= n_asymp <= 470                      # 40% of 1000, binomial spread
    assert int(res.n_asymptomatic.values[-1]) == n_asymp
    assert int(res.n_infectious.values[-1]) == 1000  # symptomatic and asymptomatic agents are both infectious
    assert np.all(d.rel_trans_base[d.asymptomatic.uids] == 0.5)   # the connector, not the model, writes rel_trans
    infectious = d.infectious.uids
    symptomatic = infectious[~d.asymptomatic[infectious]]
    assert np.all(d.rel_trans_base[symptomatic] == 1.0)


def test_seiar_clears_the_asymptomatic_flag_on_recovery():
    sim = run(SEIAR, days=6, n=500, init_prev=ss.choose_n(100), beta=ss.peryear(1e-6),
              dur_exp=ss.constant(ss.days(1)), dur_inf=ss.constant(ss.days(2)), p_death=ss.bernoulli(p=0),
              p_asymp=ss.bernoulli(p=1.0), rel_trans_asymp=0.5)
    d = sim.diseases[0]
    assert int(d.asymptomatic.count()) == 0 and int(d.recovered.count()) == 100
    assert np.all(d.rel_trans.values == 1.0)


def _pars(name, **over):
    pars = dict(init_prev=ss.bernoulli(p=0.05), beta=ss.peryear(30), dur_inf=ss.constant(ss.days(5)))
    if name != "sis":
        pars["p_death"] = ss.bernoulli(p=0.0)
    if name in ("seir", "seirs", "seiar"):
        pars["dur_exp"] = ss.constant(ss.days(2))
    if name in ("sirs", "seirs"):
        pars["dur_immune"] = ss.constant(ss.days(30))
    pars.update(over)
    return pars


@pytest.mark.parametrize("name", sorted(MODELS))
def test_every_model_has_a_transmissibility_base_state(name):
    sim = run(MODELS[name], days=2, **_pars(name))
    d = sim.diseases[0]
    assert np.all(d.rel_trans_base[d.susceptible.uids] == 1.0) and len(d.rel_trans_base) == len(sim.people)


def test_seiar_asymptomatic_agents_lower_the_base_not_rel_trans_directly():
    sim = run(SEIAR, days=3, n=2000, init_prev=ss.choose_n(1000), beta=ss.peryear(1e-6),
              dur_exp=ss.constant(ss.days(1)), dur_inf=ss.constant(ss.days(10)), p_death=ss.bernoulli(p=0),
              p_asymp=ss.bernoulli(p=1.0), rel_trans_asymp=0.25)
    d = sim.diseases[0]
    asymp = d.asymptomatic.uids
    assert len(asymp) == 1000
    assert np.all(d.rel_trans_base[asymp] == 0.25)
    assert np.all(d.rel_trans.values == 1.0)          # without the connector of Task 9, rel_trans is untouched


def test_seiar_only_symptomatic_infections_die():
    common = dict(days=20, n=1000, init_prev=ss.choose_n(500), beta=ss.peryear(1e-6), dur_exp=ss.constant(ss.days(1)),
                  dur_inf=ss.constant(ss.days(3)), p_death=ss.bernoulli(p=0.5))
    all_asymp = run(SEIAR, p_asymp=ss.bernoulli(p=1.0), **common)
    assert all_asymp.results.seiar.new_deaths_disease.values.sum() == 0 and all_asymp.results.cum_deaths.values[-1] == 0
    none_asymp = run(SEIAR, p_asymp=ss.bernoulli(p=0.0), **common)
    deaths = none_asymp.results.seiar.new_deaths_disease.values.sum()
    assert 200 <= deaths <= 300                        # half of the 500 seeds, binomial spread (sd 11)


def test_seiar_recovery_restores_the_base():
    sim = run(SEIAR, days=6, n=500, init_prev=ss.choose_n(100), beta=ss.peryear(1e-6),
              dur_exp=ss.constant(ss.days(1)), dur_inf=ss.constant(ss.days(2)), p_death=ss.bernoulli(p=0),
              p_asymp=ss.bernoulli(p=1.0), rel_trans_asymp=0.5)
    d = sim.diseases[0]
    assert int(d.recovered.count()) == 100 and np.all(d.rel_trans_base.values == 1.0)


def test_exposed_agents_transmit_only_when_rel_trans_exposed_is_set():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    base = {"model": "seir", "beta": 300.0, "dur_exp": {"mean_days": 10}, "dur_inf": {"mean_days": 0.5}, "p_death": 0.0,
            "seed": {"mode": "count", "value": 20}}
    silent = SimParamsV2.model_validate({"disease": base, "run": {"n_agents": 2000, "sim_dur_years": 8 / 365, "rand_seed": 1}})
    sim = build_sim(silent)
    sim.run()
    assert sim.results.seir.cum_infections.values[-1] == 0          # nobody left the latent period: no transmission without the flag
    loud = SimParamsV2.model_validate({"disease": {**base, "rel_trans_exposed": 1.0}, "run": {"n_agents": 2000, "sim_dur_years": 8 / 365, "rand_seed": 1}})
    sim = build_sim(loud)
    sim.run()
    loud_total = sim.results.seir.cum_infections.values[-1]
    assert loud_total > 100                                         # the exposed infected others at the full rate
    half = SimParamsV2.model_validate({"disease": {**base, "rel_trans_exposed": 0.5}, "run": {"n_agents": 2000, "sim_dur_years": 8 / 365, "rand_seed": 1}})
    sim = build_sim(half)
    sim.run()
    assert 0 < sim.results.seir.cum_infections.values[-1] < loud_total     # at half the value: fewer, not none


def test_fatality_by_age_kills_only_the_groups_with_a_fatality():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({
        "disease": {"model": "sir", "beta": 300.0, "dur_inf": {"mean_days": 5}, "p_death": 0.0, "p_death_age": {"elderly": 1.0}, "seed": {"mode": "fraction", "value": 0.2}},
        "demographics": {"age_pct_under18": 30.0, "age_pct_18_64": 50.0, "age_pct_over65": 20.0},
        "run": {"n_agents": 2000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    ages_at_start = np.asarray(sim.people.age.raw).copy()
    sim.run()
    disease = sim.diseases[0]
    dead = np.isfinite(np.asarray(disease.ti_dead.raw))
    assert dead.sum() > 100
    assert np.all(ages_at_start[dead] >= 65)


def test_the_latent_models_keep_the_exposed_silent_without_the_connector():
    # the exposed fraction is a kernel weight, not a state the connector must carry: a bare sim transmits nothing from the exposed at the default 0
    pars = dict(init_prev=ss.bernoulli(p=0.01), beta=ss.peryear(300), dur_exp=ss.constant(ss.days(10)), dur_inf=ss.constant(ss.days(0.5)), p_death=ss.bernoulli(p=0.0))
    silent = run(SEIR, days=8, n=2000, **pars)
    assert silent.results.seir.cum_infections.values[-1] == 0
    loud = run(SEIR, days=8, n=2000, rel_trans_exposed=1.0, **pars)
    assert loud.results.seir.cum_infections.values[-1] > 100
