"""Spec 13, R0 calibration, with the section 18 rulings: 50k agents seeded with
50 infections (count mode; three seeds fade out too often), two years so every
epidemic finishes. Random network: the R0 implied by the final size,
-ln(1 - z) / z with the seeds included, is within 5% of the target for sir,
seir, seiar and sirs with constant and gamma durations at R0 1.5, 2.5 and 4.
Age-structured network: each group's attack rate, averaged over three seeds,
is within 0.03 of the heterogeneous final-size solution. About three minutes."""
import math

import numpy as np
import pytest

from epichat.params import r0
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.builder import build_sim
from epichat.sim.outputs import extract

N = 50_000


def scenario(model: str, dist: str, target: float) -> SimParamsV2:
    def dur(mean, sd):
        return {"mean_days": mean, "dist": dist, "sd_days": None if dist == "constant" else sd}
    disease = {"model": model, "dur_inf": dur(10.0, 4.0), "p_death": 0.0, "seed": {"mode": "count", "value": 50}}
    if model in ("seir", "seiar"):
        disease["dur_exp"] = dur(5.0, 2.0)
    if model == "sirs":
        disease["dur_immune"] = {"mean_days": 3650.0, "dist": "constant", "sd_days": None}     # nobody wanes within the run
    if model == "seiar":
        disease.update(p_asymp=0.3, rel_trans_asymp=0.5)
    p = SimParamsV2.model_validate({"disease": disease, "network": {"n_contacts": 4},
                                    "run": {"n_agents": N, "sim_dur_years": 2.0, "rand_seed": 1}})
    return r0.with_r0(p, target)


def implied_r0(total_infected: int, n: int) -> float:
    z = total_infected / n
    return -math.log(1 - z) / z


@pytest.mark.parametrize("target", [1.5, 2.5, 4.0])
@pytest.mark.parametrize("dist", ["constant", "gamma"])
@pytest.mark.parametrize("model", ["sir", "seir", "seiar", "sirs"])
def test_random_network_final_size_implies_the_target_r0(model, dist, target):
    p = scenario(model, dist, target)
    assert r0.approx_r0(p) == pytest.approx(target, rel=1e-6)
    sim = build_sim(p)
    sim.run()
    out = extract(sim, N, sim.seeds_day0, False)
    implied = implied_r0(out["stats"]["total_infected"], N)
    assert abs(implied - target) <= 0.05 * target, (model, dist, target, implied)


def heterogeneous_final_sizes(a: float) -> np.ndarray:
    """Section 18: z_j = 1 - exp(-sum_i C[i][j] (1 - exp(-a z_i))), network_beta 1."""
    z = np.full(3, 0.5)
    for _ in range(5000):
        z = 1 - np.exp(-(r0.CONTACT_MATRIX.T @ (1 - np.exp(-a * z))))
    return z


@pytest.mark.parametrize("target", [1.5, 2.5, 4.0])
def test_age_structured_group_attack_rates_follow_the_heterogeneous_final_size_system(target):
    base = SimParamsV2.model_validate({
        "disease": {"dur_inf": {"mean_days": 10.0}, "p_death": 0.0, "seed": {"mode": "count", "value": 50}},
        "network": {"network_type": "age_structured"},
        "demographics": {"age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8},
        "run": {"n_agents": N, "sim_dur_years": 2.0},
    })
    p = r0.with_r0(base, target)
    assert r0.approx_r0(p) == pytest.approx(target, rel=1e-6)
    a = r0.per_contact_prob(p.disease.beta) * r0.effective_days(p.disease)
    predicted = heterogeneous_final_sizes(a)
    rates = []
    for seed in (1, 2, 3):
        sim = build_sim(p, seed=seed)
        sim.run()
        age = np.asarray(sim.people.age.values)
        ever = ~np.asarray(sim.diseases[0].susceptible.values)
        rates.append([ever[age < 18].mean(), ever[(age >= 18) & (age < 65)].mean(), ever[age >= 65].mean()])
    mean = np.mean(rates, axis=0)
    assert np.all(np.abs(mean - predicted) <= 0.03), (target, mean, predicted)
    assert mean[2] < mean[0] < mean[1]          # the matrix's column sums order the groups


def test_age_structured_without_shares_calibrates_and_runs():
    p = r0.with_r0(SimParamsV2.model_validate({"network": {"network_type": "age_structured"}, "run": {"n_agents": 5000, "sim_dur_years": 0.5}}), 2.0)
    sim = build_sim(p)
    sim.run()
    assert sim.results.sir.cum_infections.values[-1] > 1000
