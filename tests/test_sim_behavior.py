"""Follow-up spec, section 5: transmission falls as the share infectious rises and recovers as it falls."""
import numpy as np
import pytest

from epichat.params.r0 import with_r0
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.builder import build_sim
from epichat.sim.outputs import behavior_factors, extract


def scenario(entry: dict | None, days: int = 365, extra: list | None = None, **disease) -> SimParamsV2:
    body = {"disease": {"seed": {"mode": "count", "value": 50}, **disease},
            "interventions": ([{"type": "behavior_response", **entry}] if entry is not None else []) + (extra or []),
            "run": {"n_agents": 10000, "sim_dur_years": days / 365, "rand_seed": 1}}
    return with_r0(SimParamsV2.model_validate(body), 2.5)


def run(p: SimParamsV2):
    sim = build_sim(p)
    sim.run()
    return sim, extract(sim, p)


def test_the_factor_is_the_formula_over_the_memory_window():
    response = SimParamsV2.model_validate({"interventions": [{"type": "behavior_response", "scale": 0.6, "half_prevalence": 0.02,
                                                              "memory_days": 3, "start_day": 2, "end_day": 6}]}).interventions[0]
    infectious = np.array([0, 100, 200, 300, 400, 500, 600, 700], dtype=float)
    factors = behavior_factors(infectious, np.full(8, 1000.0), response)
    share = infectious / 1000
    for t in range(8):
        mean = share[max(0, t - 2): t + 1].mean()
        expected = 1 - 0.6 * mean / (0.02 + mean) if 2 <= t <= 6 else 1.0
        assert factors[t] == pytest.approx(expected), t


def test_the_peak_and_the_total_fall_and_the_response_relaxes():
    _, base = run(scenario(None, days=730))
    _, out = run(scenario({"scale": 0.6, "half_prevalence": 0.01}, days=730))
    assert out["stats"]["peak_infections"] < 0.5 * base["stats"]["peak_infections"]
    assert out["stats"]["total_infected"] < base["stats"]["total_infected"] - 0.10 * 10000
    assert out["stats"]["total_infected"] > 0.45 * 10000                           # it relaxes, so it cannot go far below the herd immunity threshold
    b = out["stats"]["behavior"]
    assert 0.4 < b["min_factor"] < 0.9 and "behavior" not in base["stats"]


def test_it_acts_only_inside_its_window():
    _, base = run(scenario(None, days=60))
    _, windowed = run(scenario({"scale": 0.8, "start_day": 20, "end_day": 39}, days=60))
    assert windowed["series"]["new_infections"][:20] == pytest.approx(base["series"]["new_infections"][:20])
    assert windowed["series"]["new_infections"][30] < base["series"]["new_infections"][30]


def test_a_population_that_dies_out_is_no_division():
    p = scenario({"scale": 0.6}, days=90, p_death=1.0, seed={"mode": "count", "value": 10000})
    _, out = run(p)
    assert np.isfinite(out["stats"]["behavior"]["min_factor"]) and out["stats"]["total_deaths"] == 10000
