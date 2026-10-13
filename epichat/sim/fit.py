"""Part 2, 7.7: the lever (disease.beta or network.network_beta) bisected on a log scale within its registry bounds until the run's
outcome is within tolerance of the value the participant knows, at most eight full-length runs with the first replicate's seed.
The attack rate and the peak size rise with the lever, the peak day falls with it. The first run uses the current value; until the
target is bracketed the lever doubles or halves (never past the registry bounds, where an unreachable target ends), then each run
takes the bracket's geometric midpoint."""
from __future__ import annotations

import math

from pydantic import ValidationError

from epichat.params.paths import get_path, set_path
from epichat.params.registry import REGISTRY_BY_PATH
from epichat.params.schema_v2 import SimParamsV2

from .builder import build_sim
from .outputs import extract

TOLERANCE = {"attack_rate": 0.02, "peak_day": 3.0, "peak_infections": 0.05}
MAX_RUNS = 8
FADEOUT_SEED_MULTIPLE = 2       # a run whose infections or peak stayed under twice its seeds faded out: its peak day is the seeds' bump
STEP = 2.0                      # the factor the lever moves by until the target is bracketed
RISING = {"attack_rate": True, "peak_infections": True, "peak_day": False}


def outcome(stats: dict, target: str, n_agents: int) -> float:
    if target == "attack_rate":
        return float(stats["total_infected"]) / n_agents
    return float(stats[target])


def within(target: str, achieved: float, wanted: float) -> bool:
    tol = TOLERANCE[target]
    gap = abs(achieved - wanted)
    return gap <= tol * wanted if target == "peak_infections" else gap <= tol


def evaluate(p: SimParamsV2, seed: int) -> dict:
    sim = build_sim(p, seed=seed)
    sim.run()
    return extract(sim, p.run.n_agents, sim.seeds_day0, p.demographics.use_demographics)["stats"]


def _with_lever(p: SimParamsV2, lever: str, value: float) -> SimParamsV2:
    body = p.model_dump()
    set_path(body, lever, value)
    return SimParamsV2.model_validate(body)


def _valid(p: SimParamsV2, lever: str, value: float) -> bool:
    try:
        _with_lever(p, lever, value)
    except ValidationError:
        return False
    return True


def _effective_hi(p: SimParamsV2, lever: str, value: float, hi_bound: float) -> float:
    """The largest value the lever can take: the registry's bound unless the joint rule (network_beta × (1 − e^(−β/365)) ≤ 1) cuts it
    (review I1), found by bisection on validity between the current value (which validated) and the registry bound."""
    if _valid(p, lever, hi_bound):
        return hi_bound
    lo, hi = value, hi_bound
    for _ in range(80):
        mid = math.sqrt(lo * hi)
        if _valid(p, lever, mid):
            lo = mid
        else:
            hi = mid
        if hi <= lo * (1 + 1e-7):
            break
    return lo


def fit_lever(p: SimParamsV2, seed: int) -> tuple[SimParamsV2, dict | None]:
    """The parameters to run (the lever moved when a fit is set) and {target, wanted, achieved, lever, value, runs}, or (p, None).
    The search doubles or halves the lever from its current value until the target is bracketed (stopping at the registry bound),
    then takes geometric midpoints; a run that faded out (under twice its seeds infected) counts as a lever too low."""
    f = p.run.fit
    if f is None:
        return p, None
    lo_bound, hi_bound = REGISTRY_BY_PATH[f.lever].bounds
    value = float(get_path(p.model_dump(), f.lever))
    hi_bound = _effective_hi(p, f.lever, value, hi_bound)
    lo = hi = None
    current = p
    runs, achieved = 0, None
    while runs < MAX_RUNS:
        current = _with_lever(p, f.lever, value)
        stats = evaluate(current, seed)
        achieved = outcome(stats, f.target, p.run.n_agents)
        runs += 1
        seeds = stats.get("seeds_day0") or stats.get("seeds") or 0
        faded = stats["total_infected"] <= FADEOUT_SEED_MULTIPLE * seeds or stats["peak_infections"] <= FADEOUT_SEED_MULTIPLE * seeds
        if within(f.target, achieved, f.value) and not faded:
            break
        too_low = faded or (achieved < f.value if RISING[f.target] else achieved > f.value)         # the lever must rise
        if too_low:
            lo = value
        else:
            hi = value
        if lo is not None and hi is not None:
            if hi <= lo * (1 + 1e-9):
                break
            nxt = math.sqrt(lo * hi)
        elif too_low:
            if value >= hi_bound * (1 - 1e-9):
                break                                                                    # the upper bound is the best the lever can do
            nxt = min(hi_bound, value * STEP)
        else:
            if value <= lo_bound * (1 + 1e-9):
                break
            nxt = max(lo_bound, value / STEP)
        value = min(round(nxt, 6), hi_bound)
    return current, {"target": f.target, "wanted": f.value, "achieved": round(float(achieved), 4), "lever": f.lever,
                     "value": float(get_path(current.model_dump(), f.lever)), "runs": runs}
