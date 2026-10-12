"""Spec 8.3: delayed seeding and initial immunity as Starsim interventions
(CRN-safe distributions, no numpy generators)."""
import numpy as np
import pytest
import starsim as ss

from epichat.sim.interventions import InitialImmunity, SeedInfections, SimpleTreatment
from epichat.sim.models import MODELS

EXTRA = {"seir": dict(dur_exp=ss.constant(ss.days(3))), "seirs": dict(dur_exp=ss.constant(ss.days(3)), dur_immune=ss.constant(ss.days(5))),
         "seiar": dict(dur_exp=ss.constant(ss.days(3))), "sirs": dict(dur_immune=ss.constant(ss.days(5)))}


def build(name, interventions, days=12, n_agents=1000, init_prev=0.0, beta=22.8125, **pars):
    kw = dict(init_prev=ss.bernoulli(p=init_prev), beta=ss.peryear(beta), dur_inf=ss.constant(ss.days(4)))
    if name == "sis":
        kw.update(waning=ss.peryear(0), imm_boost=0)
    else:
        kw["p_death"] = ss.bernoulli(p=0.0)
    kw.update(EXTRA.get(name, {}))
    kw.update(pars)
    sim = ss.Sim(n_agents=n_agents, diseases=MODELS[name](**kw), networks=ss.RandomNet(n_contacts=4), interventions=interventions,
                 start=ss.days(0), dur=ss.days(days), dt=ss.days(1), verbose=0, rand_seed=1)
    sim.init()
    return sim


def test_seed_infections_by_count_on_a_later_day():
    sim = build("sir", [SeedInfections(day=3, mode="count", value=25)])
    sim.run()
    res = sim.results.sir
    assert list(res.n_infected.values[:3]) == [0.0, 0.0, 0.0]
    assert sim.interventions[0].n_seeded == 25
    assert res.new_infections.values[3] >= 25 and res.cum_infections.values[-1] >= 25   # seeds count: the sim was initialized


def test_seed_infections_by_fraction_is_reproducible():
    a = build("seir", [SeedInfections(day=2, mode="fraction", value=0.05)])
    b = build("seir", [SeedInfections(day=2, mode="fraction", value=0.05)])
    a.run()
    b.run()
    assert 30 <= a.interventions[0].n_seeded <= 70
    assert a.interventions[0].n_seeded == b.interventions[0].n_seeded
    assert list(a.results.seir.cum_infections.values) == list(b.results.seir.cum_infections.values)


@pytest.mark.parametrize("name", sorted(MODELS))
def test_initial_immunity_takes_half_of_the_non_seeded_agents(name):
    waning = {"dur_immune": ss.constant(ss.days(100))} if name in ("sirs", "seirs") else {}   # longer than the run: nobody wanes here
    sim = build(name, [InitialImmunity(frac=0.5)], init_prev=0.1, beta=0.001, **waning)
    sim.run()
    d = sim.diseases[0]
    n = sim.interventions[0].n_immunised
    assert 0.48 * 900 - 40 <= n <= 0.52 * 900 + 40
    if name == "sis":
        assert float(np.mean(d.rel_sus.values)) < 0.6 and int((np.asarray(d.immunity.values) > 0).sum()) == n
    else:
        assert int(d.recovered.count()) >= n and int(d.susceptible.count()) <= 1000 - n - 80


@pytest.mark.parametrize("name", ["sirs", "seirs"])
def test_initial_immunity_wanes_in_the_waning_models(name):
    sim = build(name, [InitialImmunity(frac=0.5)], init_prev=0.0, beta=0.001, days=12)
    sim.run()
    d = sim.diseases[0]
    assert sim.interventions[0].n_immunised > 400
    assert int(d.recovered.count()) == 0 and int(d.susceptible.count()) == 1000     # dur_immune 5 days: everyone is back


def test_initial_immunity_wanes_in_sis_at_sis_waning():
    held = build("sis", [InitialImmunity(frac=0.5)], init_prev=0.0, beta=0.001, waning=ss.peryear(0))
    held.run()
    waned = build("sis", [InitialImmunity(frac=0.5)], init_prev=0.0, beta=0.001, waning=ss.peryear(52.0))
    waned.run()
    assert float(np.mean(held.diseases[0].rel_sus.values)) == pytest.approx(0.5, abs=0.05)
    assert float(np.mean(waned.diseases[0].rel_sus.values)) > 0.8


def test_initial_immunity_never_picks_day_zero_seeds():
    sim = build("sir", [InitialImmunity(frac=0.99)], init_prev=0.1, beta=0.001)
    sim.run()
    assert sim.results.sir.n_infected.values[0] >= 60          # the seeds were not moved to recovered
    assert sim.interventions[0].n_immunised <= 900


def test_simple_treatment_still_lives_here():
    sim = build("sir", [SimpleTreatment(prob=1.0, max_capacity=5, start_day=0)], init_prev=0.1, beta=0.001)
    sim.run()
    assert sim.results.sir.n_infected.values[1] == sim.results.sir.n_infected.values[0] - 5
