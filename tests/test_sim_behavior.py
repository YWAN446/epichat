"""Follow-up spec, section 5: transmission falls as the share infectious rises and recovers as it falls."""
import numpy as np
import pytest

from epichat.params.r0 import with_r0
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.builder import build_sim
from epichat.sim.calibrate import pilot_params
from epichat.sim.outputs import extract

G10 = {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}


def scenario(entry: dict | None, n: int = 10000, years: float = 1.0, target: float = 2.5, extra: list | None = None, **disease) -> SimParamsV2:
    body = {"disease": {"dur_inf": dict(G10), "p_death": 0.0, "seed": {"mode": "count", "value": 50}, **disease},
            "interventions": ([{"type": "behavior_response", **entry}] if entry is not None else []) + (extra or []),
            "run": {"n_agents": n, "sim_dur_years": years, "rand_seed": 1}}
    return with_r0(SimParamsV2.model_validate(body), target)


def run(p: SimParamsV2):
    sim = build_sim(p)
    sim.run()
    return sim, extract(sim, p.run.n_agents, sim.seeds_day0, False)


def test_the_factor_is_the_formula_on_every_step():
    p = scenario({"scale": 0.6, "half_prevalence": 0.02, "memory_days": 5}, years=120 / 365)
    sim, out = run(p)
    c = sim.connectors[0]
    factors, shares = np.array(c.behavior_factors), np.array(c.shares)
    assert len(factors) == len(shares) == len(out["series"]["day"]) and shares[0] == 50 / 10000         # step 0: the seeds, before anything spread
    for t in range(len(factors)):
        mean = shares[max(0, t - 4): t + 1].mean()                                                         # the last five steps, today included
        assert factors[t] == pytest.approx(1 - 0.6 * mean / (0.02 + mean), abs=1e-12), t
    # the share the connector sees is the share infectious as the step begins: yesterday's count less today's recoveries
    series = np.array(out["series"]["n_infectious"]) / 10000
    assert np.all(shares[1:] <= series[:-1] + 1e-12) and np.corrcoef(shares[1:], series[:-1])[0, 1] > 0.99
    assert np.allclose(np.array(c.factors), factors)                                                      # no seasonality, no dated reduction


def test_it_is_one_with_nobody_infectious_and_outside_its_window():
    late = scenario({"scale": 0.8}, years=40 / 365, seed={"mode": "count", "value": 50, "day": 10})
    sim, _ = run(late)
    f = np.array(sim.connectors[0].behavior_factors)
    assert np.all(f[:10] == 1.0) and f.min() < 1.0
    windowed = scenario({"scale": 0.8, "start_day": 20, "end_day": 39}, years=60 / 365)
    sim, _ = run(windowed)
    f = np.array(sim.connectors[0].behavior_factors)
    assert np.all(f[:20] == 1.0) and np.all(f[40:] == 1.0) and f[20:40].max() < 1.0


def test_it_multiplies_with_seasonality_and_a_dated_reduction():
    extra = [{"type": "seasonality", "scale": 0.2}, {"type": "transmission_reduction", "scale": 0.3, "start_day": 5, "end_day": 15}]
    sim, _ = run(scenario({"scale": 0.5}, years=30 / 365, extra=extra))
    c = sim.connectors[0]
    seasonal = np.array([c.seasonal(t) for t in range(len(c.factors))])
    dated = np.array([0.7 if 5 <= t <= 15 else 1.0 for t in range(len(c.factors))])
    assert np.allclose(np.array(c.factors), seasonal * dated * np.array(c.behavior_factors)) and min(c.behavior_factors) < 1.0


def test_the_peak_and_the_total_fall_and_the_response_relaxes():
    _, base = run(scenario(None, years=2.0))
    sim, out = run(scenario({"scale": 0.6, "half_prevalence": 0.01}, years=2.0))
    assert out["stats"]["peak_infections"] < 0.5 * base["stats"]["peak_infections"]
    assert out["stats"]["total_infected"] < base["stats"]["total_infected"] - 0.10 * 10000
    assert out["stats"]["total_infected"] > 0.45 * 10000                           # it relaxes, so it cannot go far below the herd immunity threshold (5.3)
    f = sim.connectors[0].behavior_factors
    assert f[-1] > 0.97 and f[-1] > min(f) + 0.2                                    # relaxed once the infections are gone
    b = out["stats"]["behavior"]
    assert b["min_factor"] == pytest.approx(min(f), abs=1e-4) and b["min_day"] == int(np.argmin(f)) and 0.4 < b["min_factor"] < 0.9
    assert "behavior" not in base["stats"]


def test_the_pilot_runs_without_the_response_and_a_dead_population_is_no_division():
    p = scenario({"scale": 0.6})
    assert pilot_params(p, 1).interventions == []
    doomed = scenario({"scale": 0.6}, n=500, years=90 / 365, p_death=1.0, seed={"mode": "count", "value": 500, "day": 0})
    sim, out = run(doomed)
    f = sim.connectors[0].behavior_factors
    assert len(sim.people.auids) == 0 and all(np.isfinite(v) and 0.0 <= v <= 1.0 for v in f) and f[-1] == 1.0
