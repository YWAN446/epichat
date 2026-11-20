"""Each reason the rule gives for running as agents names a scenario where a compartmental model gives a clearly different
answer, and same_answer one where the two agree (docs/superpowers/specs/2026-11-20-run-mode-choice-design.md)."""
from epichat.params import r0
from epichat.params.schema_v2 import SimParamsV2
from epichat.params.solver import recommend_solver
from epichat.sim.builder import build_sim

N = 10_000


def scenario(r0_target=None, interventions=None, disease=None, demographics=None, years=1.0, seed=None):
    body = {"disease": disease or {}, "demographics": demographics or {}, "interventions": interventions or [],
            "run": {"n_agents": N, "sim_dur_years": years}}
    if seed is not None:
        body["disease"]["seed"] = seed
    p = SimParamsV2.model_validate(body)
    return r0.with_r0(p, r0_target) if r0_target is not None else p


def infections(p, solver, seed=1):
    """Infections per person over the run, in the given mode."""
    body = p.model_dump()
    body["run"].update(solver=solver, rand_seed=seed)
    sim = build_sim(SimParamsV2.model_validate(body))
    sim.run()
    return float(sim.results[sim.diseases[0].name].infection.values.sum()) / N


def codes(p):
    return [r["code"] for r in recommend_solver(p)["reasons"]]


def test_waning_differs():
    p = scenario(disease={"model": "sirs", "dur_immune": {"mean_days": 180.0}}, years=3.0)
    assert "waning" in codes(p)
    assert infections(p, "ode") >= 2 * infections(p, "abm")


def test_temporary_measure_differs():
    p = scenario(interventions=[{"type": "transmission_reduction", "scale": 0.7, "start_day": 0, "end_day": 30}])
    assert "temporary_measure" in codes(p)
    assert infections(p, "ode") > 0.5
    assert sum(infections(p, "abm", seed) < 0.05 for seed in range(1, 6)) >= 3


def test_births_differ():
    p = scenario(r0_target=15.0, demographics={"use_demographics": True, "birth_rate": 30.0}, years=10.0)
    assert "births" in codes(p)
    assert infections(p, "ode") >= 1.2 * infections(p, "abm")


def test_early_dieout_differs():
    p = scenario(r0_target=1.2, seed={"mode": "count", "value": 2})
    assert "early_dieout" in codes(p)
    assert infections(p, "ode") > 0.2
    assert sum(infections(p, "abm", seed) < 0.01 for seed in range(1, 11)) >= 2


def test_same_answer_agrees():
    p = scenario()
    assert codes(p) == ["same_answer"]
    assert abs(infections(p, "ode") - infections(p, "abm")) < 0.03


def test_waning_near_its_threshold_agrees():
    p = scenario(disease={"model": "sirs", "dur_immune": {"mean_days": 180.0}}, years=360 / 365)
    assert "waning" not in codes(p)
    assert abs(infections(p, "ode") - infections(p, "abm")) < 0.03
