"""Follow-up spec, section 4: a per-agent gamma multiplier on susceptibility, mean 1."""
import numpy as np
import pytest
import starsim as ss

from epichat.params.r0 import with_r0
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.builder import build_sim
from epichat.sim.diagnostics import final_size
from epichat.sim.outputs import extract

G10 = {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}


def scenario(cv: float, target: float = 2.5, n: int = 20000, years: float = 1.0, seeds: int = 100, **over) -> SimParamsV2:
    body = {"disease": {"dur_inf": dict(G10), "p_death": 0.0, "rel_sus_cv": cv, "seed": {"mode": "count", "value": seeds}},
            "run": {"n_agents": n, "sim_dur_years": years, "rand_seed": 1}}
    for key, value in over.items():
        body.setdefault(key, {}).update(value)
    return with_r0(SimParamsV2.model_validate(body), target)


def test_each_agent_gets_a_multiplier_with_mean_one_and_the_configured_variation():
    for cv in (0.5, 1.0, 2.0):
        x = np.asarray(build_sim(scenario(cv, n=50000)).diseases[0].rel_sus_ind)
        assert abs(x.mean() - 1.0) < 0.03 and abs(x.std() / x.mean() - cv) < 0.05 * max(cv, 1.0), (cv, x.mean(), x.std())


def test_without_variation_nothing_is_drawn():
    d = build_sim(scenario(0.0, n=2000)).diseases[0]
    assert np.all(np.asarray(d.rel_sus_ind) == 1.0) and not isinstance(d.rel_sus_ind.default, ss.Dist)    # no stream is added, so no other draw moves
    assert isinstance(build_sim(scenario(1.0, n=2000)).diseases[0].rel_sus_ind.default, ss.Dist)


def test_the_variation_does_not_change_r0():
    from epichat.params.r0 import approx_r0
    assert approx_r0(scenario(1.0)) == pytest.approx(approx_r0(scenario(0.0)), rel=1e-12) and scenario(1.0).disease.beta == scenario(0.0).disease.beta


def test_susceptibility_is_the_product_of_its_factors():
    p = scenario(1.0, n=3000, years=10 / 365, disease={"rel_sus_age": {"children": 1.5, "adults": 1.0, "elderly": 0.7}},
                 demographics={"age_pct_under18": 40.0, "age_pct_18_64": 50.0, "age_pct_over65": 10.0})
    body = p.model_dump()
    body["interventions"] = [{"type": "vaccine", "kind": "campaign", "coverage": 0.5, "start_day": 2, "end_day": 2, "efficacy": 0.6}]
    sim = build_sim(SimParamsV2.model_validate(body))
    for _ in range(5):
        sim.run_one_step()
    d = sim.diseases[0]
    age = np.asarray(sim.people.age)
    base = np.select([age < 18, age < 65], [1.5, 1.0], default=0.7)
    protection = np.asarray(d.vaccine_protection)
    assert 0.3 < (protection < 1.0).mean() < 0.7                                                          # the campaign happened
    assert np.allclose(np.asarray(d.rel_sus), base * np.asarray(d.rel_sus_ind) * protection)
    assert len(np.unique(np.round(np.asarray(d.rel_sus_ind), 6))) > 1000


def test_newborns_get_a_multiplier():
    p = scenario(1.0, n=3000, years=90 / 365, demographics={"use_demographics": True, "birth_rate": 300.0, "death_rate": 5.0})
    sim = build_sim(p)
    sim.run()
    uids = np.asarray(sim.people.uid)                                    # the living agents; the raw arrays also hold unused slots
    born = np.asarray(sim.diseases[0].rel_sus_ind.raw)[uids[uids >= 3000]]
    assert len(born) > 100 and np.all(np.isfinite(born)) and np.all(born > 0) and 0.6 < born.std() / born.mean() < 1.4, (len(born), born.mean(), born.std())
    assert 0.8 < born.mean() < 1.2


def test_the_final_size_follows_the_closed_form():
    assert final_size(2.5) == pytest.approx(0.8926, abs=1e-3) and final_size(2.5, 0.0) == final_size(2.5)
    assert final_size(2.5, 0.5) == pytest.approx(0.804, abs=2e-3) and final_size(2.5, 1.0) == pytest.approx(0.600, abs=1e-3)
    assert final_size(2.5, 2.0) == pytest.approx(0.287, abs=2e-3) and final_size(1.5, 1.0) == pytest.approx(0.333, abs=2e-3)
    assert final_size(0.9, 1.0) == 0.0 and final_size(1.0, 2.0) == 0.0
    for cv, expected in ((0.0, 0.893), (1.0, 0.600)):
        p = scenario(cv, n=50000, years=1.5)
        sim = build_sim(p)
        sim.run()
        attack = extract(sim, 50000, sim.seeds_day0, False)["stats"]["total_infected"] / 50000
        assert abs(attack - expected) < 0.03, (cv, attack)


def test_the_mean_multiplier_of_the_susceptible_is_recorded_and_falls():
    # the R0 measurement weighs an infection by the susceptibility that is left, so each step records the susceptibles' mean multiplier
    sim = build_sim(scenario(1.0, n=10000, years=120 / 365))
    sim.run()
    d = sim.diseases[0]
    means = np.asarray(d.sus_ind_means)
    assert len(means) == len(sim.results.timevec) and np.all(np.isfinite(means))
    assert means[0] == pytest.approx(np.asarray(d.rel_sus_ind).mean(), rel=0.01)       # before anything spread: everyone but the seeds
    assert means[60] < means[0] and means[-1] < 0.6 * means[0]                        # the most susceptible were infected first
    plain = build_sim(scenario(0.0, n=2000, years=20 / 365))
    plain.run()
    assert plain.diseases[0].sus_ind_means == []                                       # nothing is recorded without variation
