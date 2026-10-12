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
    assert np.all(d.rel_trans[d.asymptomatic.uids] == 0.5)
    infectious = d.infectious.uids
    symptomatic = infectious[~d.asymptomatic[infectious]]
    assert np.all(d.rel_trans[symptomatic] == 1.0)


def test_seiar_clears_the_asymptomatic_flag_on_recovery():
    sim = run(SEIAR, days=6, n=500, init_prev=ss.choose_n(100), beta=ss.peryear(1e-6),
              dur_exp=ss.constant(ss.days(1)), dur_inf=ss.constant(ss.days(2)), p_death=ss.bernoulli(p=0),
              p_asymp=ss.bernoulli(p=1.0), rel_trans_asymp=0.5)
    d = sim.diseases[0]
    assert int(d.asymptomatic.count()) == 0 and int(d.recovered.count()) == 100
    assert np.all(d.rel_trans.values == 1.0)
