"""Series and stats from a finished sim. Counts are people (fractional when the run is an ODE); n_infected is sent as an alias of
n_infectious; deaths are the disease's own, with the all-causes pair only when demographics are on. Starsim records each stock at
the start of each day (day 0 is the initial state) and each flow over the day."""
from __future__ import annotations

import numpy as np
import starsim as ss

SERIES_KEYS = ("n_susceptible", "n_exposed", "n_infectious", "n_infected", "n_asymptomatic", "n_recovered",
               "new_infections", "cum_infections", "new_deaths", "cum_deaths", "new_deaths_all", "cum_deaths_all")


def _values(result) -> np.ndarray:
    return np.asarray(result.values, dtype=float)


def _floats(x) -> list[float]:
    return [float(v) for v in x]


def seeds(sim: ss.Sim) -> tuple[float, float]:
    """The day-0 seeds (the infectious at the start) and every seed, adding those a delayed seeding infected."""
    res = sim.results[sim.diseases[0].name]
    day0 = float(res.I.values[0])
    delayed = float(np.sum(sim.results.seed.delivered.values)) if "seed" in sim.results else 0.0
    return day0, day0 + delayed


def model_r0(sim: ss.Sim) -> float | None:
    """Starsim's R0 for the declared disease, when it can give one for this sim."""
    try:
        return float(sim.diseases[0].R0())
    except Exception:
        return None


def behavior_factors(infectious: np.ndarray, alive: np.ndarray, response) -> np.ndarray:
    """The behavior response's multiplier on each day it acts, from the share infectious (builder.behavior_multiplier's formula)."""
    share = infectious / np.maximum(alive, 1.0)
    m = int(response.memory_days)
    mean = np.array([share[max(0, t - m + 1):t + 1].mean() for t in range(len(share))])
    factors = 1.0 - response.scale * mean / (response.half_prevalence + mean)
    days = np.arange(len(share))
    inside = (days >= response.start_day) & ((days <= response.end_day) if response.end_day is not None else True)
    return np.where(inside, factors, 1.0)


def extract(sim: ss.Sim, params) -> dict:
    """params: the SimParamsV2 the sim was built from."""
    demographics_on = params.demographics.use_demographics
    disease = sim.diseases[0]
    res = sim.results[disease.name]
    npts = len(res.S)
    series: dict[str, list] = {"day": list(range(npts))}
    series["n_susceptible"] = _floats(_values(res.S))
    if "E" in res:
        series["n_exposed"] = _floats(_values(res.E))
    infectious = _values(res.I) + (_values(res.A) if "A" in res else 0.0)
    series["n_infectious"] = _floats(infectious)
    series["n_infected"] = _floats(infectious)
    if "A" in res:
        series["n_asymptomatic"] = _floats(_values(res.A))
    if "R" in res:
        series["n_recovered"] = _floats(_values(res.R))
    day0, all_seeds = seeds(sim)
    new_infections = _values(res.infection).copy()
    new_infections[0] += day0                  # the seeds are infectious at the start, not infected during day 0
    series["new_infections"] = _floats(new_infections)
    series["cum_infections"] = _floats(np.cumsum(new_infections))
    deaths = _values(res.death) if "death" in res else np.zeros(npts)
    series["new_deaths"] = _floats(deaths)
    series["cum_deaths"] = _floats(np.cumsum(deaths))
    if demographics_on:
        died = _values(sim.results.died)
        series["new_deaths_all"] = _floats(died)
        series["cum_deaths_all"] = _floats(np.cumsum(died))
    stats = {
        "peak_infections": int(round(infectious.max())),
        "peak_day": int(infectious.argmax()),
        "total_infected": int(round(series["cum_infections"][-1])),
        "total_deaths": int(round(series["cum_deaths"][-1])),
        "n_agents": int(round(float(sim.results.alive.values[0]))),
        "sim_days": npts,
        "seeds_day0": int(round(day0)),
        "seeds": int(round(all_seeds)),
        "solver": str(sim.solver),
        "r0_model": model_r0(sim),
    }
    response = next((i for i in params.interventions if i.type == "behavior_response"), None)
    if response is not None:
        factors = behavior_factors(infectious, _values(sim.results.alive), response)
        stats["behavior"] = {"min_factor": round(float(factors.min()), 4), "min_day": int(factors.argmin())}
    return {"stats": stats, "series": series}
