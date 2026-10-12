"""Series and stats from a finished sim, in the v1 shape the service, the web
app and the report already consume (spec 17; the 8.6 key set is phase 2)."""
from __future__ import annotations

import numpy as np
import starsim as ss

V1_SERIES_KEYS = ("n_susceptible", "n_exposed", "n_infected", "n_asymptomatic", "n_recovered", "new_infections", "cum_infections")


def extract(sim: ss.Sim, n_agents: int) -> dict:
    name = list(sim.diseases.keys())[0]
    res = sim.results[name]
    npts = len(sim.results.timevec)
    infectious_key = "n_infectious" if "n_infectious" in res else "n_infected"
    series: dict[str, list] = {"day": list(range(npts))}
    for key in V1_SERIES_KEYS:
        source = infectious_key if key == "n_infected" else key
        if source in res:
            series[key] = [float(v) for v in res[source].values]
    deaths = np.asarray(res["new_deaths_disease"].values, dtype=float) if "new_deaths_disease" in res else np.zeros(npts)
    series["new_deaths"] = [float(v) for v in deaths]
    series["cum_deaths"] = [float(v) for v in np.cumsum(deaths)]
    n_infected = np.asarray(series["n_infected"])
    stats = {
        "peak_infections": int(n_infected.max()),
        "peak_day": int(n_infected.argmax()),
        "total_infected": int(series["cum_infections"][-1]),
        "total_deaths": int(series["cum_deaths"][-1]),
        "n_agents": int(n_agents),
        "sim_days": npts,
    }
    return {"stats": stats, "series": series}
