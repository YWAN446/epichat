"""Series and stats from a finished sim, in the spec 8.6 shape. n_infected is
still sent as an alias of n_infectious for one release (section 18); deaths are
the disease's own, with the all-causes pair only when demographics are on. The
stats carry seeds_day0 and seeds (day 0 plus delayed), the latter for spec 10."""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd
import starsim as ss

from .interventions import SeedInfections

MEASURED_MAX_WEIGHT = 1.25       # a live run's seeds were no longer in a susceptible population above this mean depletion weight

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


@dataclass(frozen=True)
class Measurement:
    mean: float          # infections per seed, depletion-weighted
    se: float            # the standard error of that mean over the seeds
    seeds: int
    weight: float        # the mean of alive / susceptible over the infections counted; 1.0 when none were


def measure_r0(sim: ss.Sim, count_day0: bool) -> Measurement | None:
    """Part 2, 5.6 as amended: for each day-0 seed, the infections it caused in its first infectious episode (before it was infected
    again), each weighted by alive / susceptible at the step before, which corrects the depletion of susceptibles to first order.
    The weight is scaled by the share of the non-seed agents that was susceptible before anything spread, so agents immune from the
    start (initial_immune_frac: recovered in the SIR family) are not counted as depletion: with initial immunity the estimate reads
    the effective reproduction number, as 5.8's reference does.
    count_day0 False leaves out what the seeds transmitted on step 0: a seed is infectious from step 0, an ordinary case from the step
    after its infection, so a seed transmits on one more step. True counts everything (the pilot keeps its seeds quiet on step 0).
    None without day-0 seeds or on a network that records no per-agent sources (the age-structured MixingPools)."""
    log = infection_log(sim)
    if log is None or len(log) == 0:
        return None
    df = log.to_df()
    source = pd.to_numeric(df["source"], errors="coerce").to_numpy(dtype=float)
    t = np.array([float(getattr(x, "value", x)) for x in df["t"]])        # the log stores TimePars (days) on the numeric day axis
    targets = df["target"].to_numpy()
    seeded = (t == 0) & (np.isnan(source) | (source < 0))
    seeds = np.sort(targets[seeded].astype(np.int64))
    if len(seeds) == 0:
        return None
    later = ~seeded
    if later.any() and not (source[later] >= 0).any():
        return None                     # the network records no per-agent sources (ss.MixingPools writes -999999): unknown, not zero
    again = np.full(len(seeds), np.inf)                                    # the step each seed was infected again, if it was
    hit = later & np.isin(targets, seeds)
    np.minimum.at(again, np.searchsorted(seeds, targets[hit].astype(np.int64)), t[hit])
    by_seed = later & np.isin(source, seeds) & (t >= (0 if count_day0 else 1))
    index = np.searchsorted(seeds, source[by_seed].astype(np.int64))
    first = t[by_seed] < again[index]
    index, when = index[first], np.maximum(t[by_seed][first].astype(int) - 1, 0)
    name = list(sim.diseases.keys())[0]
    susceptible = np.asarray(sim.results[name]["n_susceptible"].values, dtype=float)
    alive = np.asarray(sim.results["n_alive"].values, dtype=float)
    spread = np.asarray(sim.results[name]["new_infections"].values, dtype=float)
    start = min(1.0, (susceptible[0] + spread[0]) / max(alive[0] - len(seeds), 1.0))     # susceptible before step 0's transmission
    weights = start * alive[when] / np.maximum(susceptible[when], 1.0)
    per_seed = np.bincount(index, weights=weights, minlength=len(seeds))
    se = float(per_seed.std(ddof=1) / math.sqrt(len(seeds))) if len(seeds) > 1 else 0.0
    return Measurement(float(per_seed.mean()), se, int(len(seeds)), float(weights.mean()) if len(weights) else 1.0)


def measured_r0(sim: ss.Sim) -> float | None:
    """The R0 a live run shows: measure_r0 without the seeds' step-0 transmissions, withheld (None) when the population was already
    depleted while the seeds were infectious (too many seeds for the R0), where no weighting recovers what the seeds would have done."""
    m = measure_r0(sim, count_day0=False)
    if m is None or m.weight > MEASURED_MAX_WEIGHT:
        return None
    return m.mean


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
