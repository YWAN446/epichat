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


def test_a_campaign_reaches_its_coverage_within_its_window():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001}, "interventions": [{"type": "vaccine", "kind": "campaign", "coverage": 0.6, "start_day": 10, "end_day": 19}],
                                    "run": {"n_agents": 4000, "sim_dur_years": 40 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    vaccinated = np.asarray(sim.diseases[0].vaccine_protection) < 1.0
    assert abs(vaccinated.mean() - 0.6) < 0.03                                               # the whole window, 10 days, reaches 60%
    vx = next(i for i in sim.interventions.values() if hasattr(i, "ti_vaccinated"))
    ti = np.asarray(vx.ti_vaccinated)
    assert np.nanmin(ti) >= 10 and np.nanmax(ti) <= 19


def test_a_leaky_vaccine_halves_rel_sus_and_waning_restores_it():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001}, "interventions": [{"type": "vaccine", "kind": "campaign", "coverage": 1.0, "start_day": 5, "end_day": 5,
                                                                                    "efficacy": 0.5, "protection_days": 10}],
                                    "run": {"n_agents": 1000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    disease = sim.diseases[0]
    for _ in range(8):
        sim.run_one_step()
    susceptible = np.asarray(disease.susceptible)
    assert np.allclose(np.asarray(disease.rel_sus)[susceptible], 0.5)                         # day 7: everyone vaccinated on day 5 keeps half
    for _ in range(10):
        sim.run_one_step()
    assert np.allclose(np.asarray(disease.rel_sus)[np.asarray(disease.susceptible)], 1.0)     # day 17: the 10-day protection has worn off
    allornothing = SimParamsV2.model_validate({"disease": {"beta": 0.001}, "interventions": [{"type": "vaccine", "kind": "campaign", "coverage": 1.0, "start_day": 5, "end_day": 5, "efficacy": 0.5, "leaky": False}],
                                               "run": {"n_agents": 2000, "sim_dur_years": 10 / 365, "rand_seed": 1}})
    sim = build_sim(allornothing)
    sim.run()
    protection = np.asarray(sim.diseases[0].vaccine_protection)
    assert set(np.unique(protection)) <= {0.0, 1.0} and 0.4 < (protection == 0.0).mean() < 0.6


def test_a_day_zero_vaccine_with_efficacy_below_one_is_a_one_day_campaign():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001}, "interventions": [{"type": "vaccine", "coverage": 1.0, "start_day": 0, "efficacy": 0.3}],
                                    "run": {"n_agents": 500, "sim_dur_years": 5 / 365, "rand_seed": 1}})
    assert p.disease.initial_immune_frac == 0.0 and len(p.interventions) == 1
    sim = build_sim(p)
    sim.run()
    assert np.allclose(np.asarray(sim.diseases[0].vaccine_protection), 0.7)


def test_vaccination_by_age_reaches_only_the_range():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001}, "interventions": [{"type": "vaccine", "kind": "campaign", "coverage": 1.0, "start_day": 1, "end_day": 1, "age_min": 5, "age_max": 18}],
                                    "demographics": {"age_pct_under18": 40.0, "age_pct_18_64": 50.0, "age_pct_over65": 10.0},
                                    "run": {"n_agents": 3000, "sim_dur_years": 5 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    age = np.asarray(sim.people.age)
    sim.run()
    protected = np.asarray(sim.diseases[0].vaccine_protection) == 0.0
    assert protected[(age >= 5) & (age < 18)].mean() > 0.99 and not protected[(age < 5) | (age >= 18)].any()


def test_treatment_with_a_delay_waits_and_halves_transmissibility_while_waiting():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001, "dur_inf": {"mean_days": 30}, "seed": {"mode": "count", "value": 100}},
                                    "interventions": [{"type": "treatment", "coverage": 1.0, "capacity": 10, "delay_days": 3, "efficacy": 1.0, "rel_trans_treated": 0.5}],
                                    "run": {"n_agents": 1000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    disease = sim.diseases[0]
    recovered_by_day = []
    for day in range(8):
        sim.run_one_step()
        recovered_by_day.append(int(disease.recovered.count()))
    assert recovered_by_day[2] == 0 and recovered_by_day[4] >= 10                             # nobody before the 3-day delay; 10 a day after it
    waiting = np.asarray(disease.infectious) & (np.asarray(disease.treatment_factor) < 1.0)
    assert waiting.sum() >= 40 and np.allclose(np.asarray(disease.rel_trans)[waiting], 0.5 * np.asarray(disease.rel_trans_base)[waiting])


def test_treatment_efficacy_cures_a_share_and_symptomatic_only_skips_the_asymptomatic():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001, "dur_inf": {"mean_days": 30}, "seed": {"mode": "count", "value": 400}},
                                    "interventions": [{"type": "treatment", "coverage": 1.0, "efficacy": 0.5}],
                                    "run": {"n_agents": 1000, "sim_dur_years": 4 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    assert 150 < int(sim.diseases[0].recovered.count()) < 250                                   # half of 400 cured on the first treated day
    seiar = SimParamsV2.model_validate({"disease": {"model": "seiar", "beta": 0.001, "dur_exp": {"mean_days": 1}, "dur_inf": {"mean_days": 30}, "p_asymp": 0.5, "seed": {"mode": "count", "value": 400}},
                                        "interventions": [{"type": "treatment", "coverage": 1.0, "symptomatic_only": True}],
                                        "run": {"n_agents": 1000, "sim_dur_years": 6 / 365, "rand_seed": 1}})
    sim = build_sim(seiar)
    sim.run()
    d = sim.diseases[0]
    delivery = next(i for i in sim.interventions.values() if hasattr(i, "treated"))
    assert int(d.asymptomatic.count()) > 100 and int(d.recovered.count()) > 100
    assert not np.any(np.asarray(delivery.treated) & np.asarray(d.asymptomatic))             # no asymptomatic agent was treated


def test_a_school_closure_removes_the_school_layers_transmission_for_its_window():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    base = {"disease": {"beta": 300.0, "dur_inf": {"mean_days": 30}, "seed": {"mode": "count", "value": 30}},      # seeds outlive the closure
            "network": {"network_type": "hybrid", "community_contacts": 0, "work_contacts": 0, "household_size": 1.0},
            "demographics": {"age_pct_under18": 50.0, "age_pct_18_64": 45.0, "age_pct_over65": 5.0}, "run": {"n_agents": 3000, "sim_dur_years": 20 / 365, "rand_seed": 1}}
    open_ = build_sim(SimParamsV2.model_validate(base))
    open_.run()
    closed = SimParamsV2.model_validate({**base, "interventions": [{"type": "contact_reduction", "layer": "school", "scale": 1.0, "start_day": 0, "end_day": 9}]})   # scale: the fraction removed
    sim = build_sim(closed)
    sim.run()
    new = np.asarray(sim.results.sir.new_infections.values)
    assert new[1:10].sum() == 0 and new[11:].sum() > 0                                           # nothing while closed, infections once it reopens
    assert open_.results.sir.new_infections.values[1:10].sum() > 0
    s = sim.networks["s"]
    assert np.allclose(np.asarray(s.edges.beta), s.pars.beta) and s.pars.beta > 0                # betas restored after the window


def test_a_transmission_reduction_scales_the_connectors_factor_over_its_window():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"interventions": [{"type": "transmission_reduction", "scale": 0.3, "start_day": 5, "end_day": 10}, {"type": "seasonality", "scale": 0.2}],
                                    "run": {"n_agents": 500, "sim_dur_years": 15 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    factors = np.array(sim.connectors[0].factors)
    seasonal = np.array([sim.connectors[0].seasonal(ti) for ti in range(len(factors))])
    assert np.allclose(factors[:5], seasonal[:5]) and np.allclose(factors[5:11], 0.7 * seasonal[5:11]) and np.allclose(factors[11:], seasonal[11:])


def test_a_v1_shaped_treatment_still_runs_through_simple_treatment():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"interventions": [{"type": "treatment", "coverage": 0.5, "capacity": 20, "start_day": 3}], "run": {"n_agents": 500, "sim_dur_years": 5 / 365}})
    assert any(isinstance(i, SimpleTreatment) for i in build_sim(p).interventions.values())
    rich = SimParamsV2.model_validate({"interventions": [{"type": "treatment", "coverage": 0.5, "capacity": 20, "start_day": 3, "delay_days": 1}], "run": {"n_agents": 500, "sim_dur_years": 5 / 365}})
    assert not any(isinstance(i, SimpleTreatment) for i in build_sim(rich).interventions.values())
