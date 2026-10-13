"""Series and stats from a finished sim, in the spec 8.6 shape. n_infected is
still sent as an alias of n_infectious for one release (section 18); deaths are
the disease's own, with the all-causes pair only when demographics are on. The
stats carry seeds_day0 and seeds (day 0 plus delayed), the latter for spec 10."""
from __future__ import annotations

import numpy as np
import pandas as pd
import starsim as ss

from .interventions import SeedInfections

SERIES_KEYS = ("n_susceptible", "n_exposed", "n_infectious", "n_infected", "n_asymptomatic", "n_recovered",
               "new_infections", "cum_infections", "new_deaths", "cum_deaths", "new_deaths_all", "cum_deaths_all")


def _values(res, key) -> list[float]:
    return [float(v) for v in res[key].values]


def realized_seeds(sim: ss.Sim, seeds_day0: int) -> int:
    """The day-0 seeds plus what a delayed SeedInfections infected: spec 10's `seeds`."""
    delayed = sum(int(i.n_seeded) for i in sim.interventions.values() if isinstance(i, SeedInfections))
    return int(seeds_day0) + delayed


def infection_log(sim: ss.Sim):
    """The first disease's infection log: on the analyzer once the run has finalized (Starsim moves it there), else on the disease."""
    disease = sim.diseases[0]
    analyzer = sim.analyzers.get("infection_log") if hasattr(sim.analyzers, "get") else None
    if analyzer is not None and getattr(analyzer, "logs", None) and disease.name in analyzer.logs and analyzer.logs[disease.name] is not None:
        return analyzer.logs[disease.name]
    return getattr(disease, "infection_log", None)


def measured_r0(sim: ss.Sim) -> float | None:
    """Part 2, 5.6: the mean number of secondary infections caused by the day-0 seeds (the log's entries with source -1 at t 0);
    None without day-0 seeds or on a network that records no per-agent sources (the age-structured MixingPools), 0.0 when the
    seeds infected nobody."""
    log = infection_log(sim)
    if log is None or len(log) == 0:
        return None
    df = log.to_df()
    source = pd.to_numeric(df["source"], errors="coerce").to_numpy(dtype=float)
    t = np.array([float(getattr(x, "value", x)) for x in df["t"]])        # the log stores TimePars (days) on the numeric day axis
    targets = df["target"].to_numpy()
    seeded = (t == 0) & (np.isnan(source) | (source < 0))
    seeds = targets[seeded]
    if len(seeds) == 0:
        return None
    later = ~seeded
    if later.any() and not (source[later] >= 0).any():
        return None                     # the network records no per-agent sources (ss.MixingPools writes -999999): unknown, not zero
    return float(np.isin(source, seeds).sum()) / len(seeds)


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
        "seeds": realized_seeds(sim, seeds_day0),
    }
    stats["r0_measured"] = measured_r0(sim)          # Part 2, 5.6; a ratio, never scaled
    return {"stats": stats, "series": series}
