"""Part 2, 7.7 and follow-up spec 6: one lever moved within its bounds until the run's outcome is within tolerance of the value the
participant knows, at most eight full-length runs with the first replicate's seed. With disease.beta or network.network_beta the
attack rate and the peak size rise with the lever and the peak day falls; with disease.rel_sus_cv or the behaviour response's scale
they fall as the lever rises and R0 stays where it was set (those two fit an attack rate or a peak size, not a peak day). The
first run uses the current value (a lever at 0 starts at 0.5); until the target is bracketed the lever doubles or halves, never past
its bounds, where an unreachable target ends; then each run takes the bracket's midpoint (geometric for the beta levers, whose
lower bound is above 0)."""
from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

from pydantic import ValidationError

from epichat.params.paths import get_path, set_path
from epichat.params.registry import REGISTRY_BY_PATH
from epichat.params.schema_v2 import SimParamsV2

from .builder import build_sim
from .outputs import extract

TOLERANCE = {"attack_rate": 0.02, "peak_day": 3.0, "peak_infections": 0.05}
MAX_RUNS = 8
FADEOUT_SEED_MULTIPLE = 2       # a run that infected under twice its seeds faded out; for a peak day, so did one whose peak stayed under twice its seeds
STEP = 2.0                      # the factor the lever moves by until the target is bracketed
RISING = {"attack_rate": True, "peak_infections": True, "peak_day": False}       # with a lever the outcome rises with
BETA_LEVERS = ("disease.beta", "network.network_beta")
PILOT_LEVERS = ("disease.rel_sus_cv",)       # levers the R0 pilot depends on: each trial is calibrated at its own value
RESPONSE_SCALE_MAX = 0.95       # a response of 1 would stop transmission outright at a high prevalence
MIN_STEP = 0.02                 # a lever whose lower bound is 0, halved below this, goes to 0


@dataclass(frozen=True)
class Lever:
    bounds: tuple[float, float]
    rising: bool                # the attack rate and the peak rise with the lever
    start: float | None = None  # where a lever at 0 starts


LEVERS: dict[str, Lever] = {
    "disease.beta": Lever(REGISTRY_BY_PATH["disease.beta"].bounds, True),
    "network.network_beta": Lever(REGISTRY_BY_PATH["network.network_beta"].bounds, True),
    "disease.rel_sus_cv": Lever(REGISTRY_BY_PATH["disease.rel_sus_cv"].bounds, False, 0.5),
    "behavior_response.scale": Lever((0.0, RESPONSE_SCALE_MAX), False, 0.5),
}


def _response(body: dict) -> dict:
    return next(i for i in body["interventions"] if i["type"] == "behavior_response")


def lever_value(body: dict, lever: str) -> float:
    return float(_response(body)["scale"] if lever == "behavior_response.scale" else get_path(body, lever))


def set_lever(body: dict, lever: str, value: float) -> None:
    if lever == "behavior_response.scale":
        _response(body)["scale"] = value
    else:
        set_path(body, lever, value)


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
    set_lever(body, lever, value)
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


def fit_lever(p: SimParamsV2, seed: int, prepare: Callable[[SimParamsV2], SimParamsV2] | None = None) -> tuple[SimParamsV2, dict | None]:
    """The parameters to run (the lever moved when a fit is set) and {target, wanted, achieved, lever, value, runs}, or (p, None).
    The search doubles or halves the lever from its current value until the target is bracketed (stopping at the lever's bound),
    then takes midpoints. A run that faded out (under twice its seeds infected) means too little transmission: a lever the outcome
    rises with is too low, a lever it falls with is too high. For a peak day a peak under twice the seeds is a fade-out too (the
    day would be the seeds' bump); for an attack rate or a peak size it is not, since a behaviour response holds the peak down
    while the infections go on. prepare, when given, turns each trial's parameters into the ones that run (the R0 calibration at
    that trial's value, for a lever the pilot depends on)."""
    f = p.run.fit
    if f is None:
        return p, None
    spec = LEVERS[f.lever]
    lo_bound, hi_bound = spec.bounds
    value = lever_value(p.model_dump(), f.lever)
    if value <= 0 and spec.start is not None:
        value = spec.start
    if f.lever in BETA_LEVERS:
        hi_bound = _effective_hi(p, f.lever, value, hi_bound)
    geometric = lo_bound > 0
    lo = hi = None
    current = p
    runs, achieved = 0, None
    while runs < MAX_RUNS:
        current = _with_lever(p, f.lever, value)
        if prepare is not None:
            current = prepare(current)
        stats = evaluate(current, seed)
        achieved = outcome(stats, f.target, p.run.n_agents)
        runs += 1
        seeds = stats.get("seeds_day0") or stats.get("seeds") or 0
        faded = stats["total_infected"] <= FADEOUT_SEED_MULTIPLE * seeds or (
            f.target == "peak_day" and stats["peak_infections"] <= FADEOUT_SEED_MULTIPLE * seeds)
        if within(f.target, achieved, f.value) and not faded:
            break
        if spec.rising:
            must_rise = faded or (achieved < f.value if RISING[f.target] else achieved > f.value)
        else:
            must_rise = not faded and achieved > f.value        # too many infected: more variation, or a stronger response
        if must_rise:
            lo = value
        else:
            hi = value
        if lo is not None and hi is not None:
            if hi <= lo * (1 + 1e-9) + 1e-12:
                break
            nxt = math.sqrt(lo * hi) if geometric else (lo + hi) / 2
        elif must_rise:
            if value >= hi_bound * (1 - 1e-9):
                break                                           # the upper bound is the best the lever can do
            nxt = min(hi_bound, value * STEP)
        else:
            if value <= lo_bound * (1 + 1e-9) + 1e-12:
                break
            nxt = max(lo_bound, value / STEP)
            if not geometric and nxt < MIN_STEP:
                nxt = lo_bound
        value = min(round(nxt, 6), hi_bound)
    return current, {"target": f.target, "wanted": f.value, "achieved": round(float(achieved), 4), "lever": f.lever,
                     "value": lever_value(current.model_dump(), f.lever), "runs": runs}
