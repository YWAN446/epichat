"""Series and stats from a finished sim, in the spec 8.6 shape. n_infected is
still sent as an alias of n_infectious for one release (section 18); deaths are
the disease's own, with the all-causes pair only when demographics are on."""
from __future__ import annotations

import numpy as np
import starsim as ss

SERIES_KEYS = ("n_susceptible", "n_exposed", "n_infectious", "n_infected", "n_asymptomatic", "n_recovered",
               "new_infections", "cum_infections", "new_deaths", "cum_deaths", "new_deaths_all", "cum_deaths_all")


def _values(res, key) -> list[float]:
    return [float(v) for v in res[key].values]


def extract(sim: ss.Sim, n_agents: int, seeds_day0: int, demographics_on: bool) -> dict:
    name = list(sim.diseases.keys())[0]
    res = sim.results[name]
    npts = len(sim.results.timevec)
    series: dict[str, list] = {"day": list(range(npts))}
    series["n_susceptible"] = _values(res, "n_susceptible")
    if "n_exposed" in res:
        series["n_exposed"] = _values(res, "n_exposed")
    infectious = _values(res, "n_infectious" if "n_infectious" in res else "n_infected")
    series["n_infectious"] = infectious
    series["n_infected"] = list(infectious)
    if "n_asymptomatic" in res:
        series["n_asymptomatic"] = _values(res, "n_asymptomatic")
    if "n_recovered" in res:
        series["n_recovered"] = _values(res, "n_recovered")
    new_infections = np.array(res["new_infections"].values, dtype=float)      # a copy: never mutate Starsim's result
    new_infections[0] += seeds_day0                      # Starsim counts only incident infections; the seeds are prevalent
    series["new_infections"] = [float(v) for v in new_infections]
    series["cum_infections"] = [float(v) for v in np.cumsum(new_infections)]
    deaths = np.asarray(res["new_deaths_disease"].values, dtype=float) if "new_deaths_disease" in res else np.zeros(npts)
    series["new_deaths"] = [float(v) for v in deaths]
    series["cum_deaths"] = [float(v) for v in np.cumsum(deaths)]
    if demographics_on:
        series["new_deaths_all"] = [float(v) for v in sim.results.new_deaths.values]
        series["cum_deaths_all"] = [float(v) for v in sim.results.cum_deaths.values]
    peak = np.asarray(infectious)
    stats = {
        "peak_infections": int(peak.max()),
        "peak_day": int(peak.argmax()),
        "total_infected": int(round(series["cum_infections"][-1])),
        "total_deaths": int(round(series["cum_deaths"][-1])),
        "n_agents": int(n_agents),
        "sim_days": npts,
        "seeds_day0": int(seeds_day0),
    }
    return {"stats": stats, "series": series}
