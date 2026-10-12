"""Pure functions over the daily series the child writes: thinning for the
wire, scaling to a real population, and the headline stats. Stats are always
computed from the full series; thinning is the last thing that happens."""
from __future__ import annotations

import math

COUNT_STATS = ("peak_infections", "total_infected", "total_deaths", "seeds_day0")


def stride_for(n_points: int, max_points: int) -> int:
    if n_points <= 0 or max_points <= 0:
        return 1
    return max(1, math.ceil(n_points / max_points))


def thin(series: dict[str, list], max_points: int) -> dict[str, list]:
    n = len(series["day"])
    stride = stride_for(n, max_points)
    if stride == 1:
        return {key: list(values) for key, values in series.items()}
    keep = list(range(0, n, stride))
    if keep[-1] != n - 1:
        keep.append(n - 1)
    return {key: [values[i] for i in keep] for key, values in series.items()}


def scale_counts(values: list[float], factor: float) -> list[int]:
    return [int(round(v * factor)) for v in values]


def stats_from(series: dict[str, list], n_agents: int) -> dict:
    n_infected = series.get("n_infectious") or series["n_infected"]     # the 8.6 key, with the v1 key as the fallback
    peak_index = max(range(len(n_infected)), key=n_infected.__getitem__)
    deaths = series.get("cum_deaths")
    return {
        "peak_infections": int(round(n_infected[peak_index])),
        "peak_day": int(series["day"][peak_index]),
        "total_infected": int(round(series["cum_infections"][-1])),
        "total_deaths": int(round(deaths[-1])) if deaths else 0,
        "n_agents": n_agents,
        "sim_days": len(series["day"]),
    }


def scale_stats(stats: dict, pop_scale: float) -> dict:
    scaled = dict(stats)
    for key in COUNT_STATS:
        if key in stats:
            scaled[key] = int(round(stats[key] * pop_scale))
    return scaled


def scaled_outcome(stats: dict, series: dict[str, list], pop_scale: float) -> tuple[dict, dict]:
    scaled_stats = scale_stats(stats, pop_scale)
    scaled_series = {
        key: (list(values) if key == "day" else scale_counts(values, pop_scale))
        for key, values in series.items()
    }
    return scaled_stats, scaled_series


def scaled_bands(bands: dict, day: list, pop_scale: float, max_points: int) -> dict:
    """The replicate bands scaled like the series and thinned on the same stride."""
    out = {}
    for key, band in bands.items():
        thinned = thin({"day": day, "p10": scale_counts(band["p10"], pop_scale), "p90": scale_counts(band["p90"], pop_scale)}, max_points)
        out[key] = {"p10": thinned["p10"], "p90": thinned["p90"]}
    return out
