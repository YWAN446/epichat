"""Part 2, 5.7 as amended: where the R0 formula is approximate (the hybrid network, or a contact duration above zero) the child runs
a short pilot with the formula's beta, measures R0, corrects beta by target / measured and repeats until the measurement is within
tolerance of the target or three corrections have been made.

The pilot is a first-generation experiment: the scenario without its interventions and initial immunity, in which only the day-0 seeds
transmit, and not on step 0, so each seed transmits on exactly the steps an ordinary case would and nothing spreads beyond the seeds'
own infections. The seeds are sized so that their expected direct infections are 15% of the agents (never under 20 seeds nor over
1000): with nothing else spreading, the depletion they cause is their own and the weights of measure_r0 correct it, so the seeds can be
many and the measurement's standard error stays near 3 to 4% from about 10,000 agents at a moderate R0 (it is larger with fewer
agents or a high R0, which the noise rule below absorbs). The pilot lasts four times the latent plus infectious means whatever the
run's own length: cut to a short run it would stop before its seeds had finished and the missing infections would be corrected
into beta. A correction is taken only when the measurement is off by more than
5% and by more than its own standard error, multiplies beta by at most 2, is kept only when it brings the measurement nearer the
target, and never leaves the registry's bound or the joint rule of network_beta and beta. (The first version let the whole epidemic
run and counted the seeds' infections as they were: the seeds' extra first step read 4 to 27% high, their descendants exhausted the
population at a high R0, and on a measles-like scenario the loop multiplied beta by 7.)"""
from __future__ import annotations

import math

from pydantic import ValidationError
from scipy.special import gammainc

from epichat.params.r0 import approx_r0, clamp_beta, per_contact_prob, r0_is_approximate
from epichat.params.schema_v2 import SimParamsV2, sim_days

from .builder import build_sim
from .outputs import Measurement, measure_r0

PILOT_SEEDS = 1000
PILOT_SEED_FLOOR = 20
PILOT_DIRECT_SHARE = 0.15       # the seeds' expected direct infections as a share of the agents; measured unbiased up to 0.30 on the random network
PILOT_WINDOW_MULTIPLE = 4
PILOT_MIN_DAYS = 4              # the registry's shortest run is 0.01 years
TOLERANCE = 0.05
NOISE_SIGMAS = 1                # no correction within this many standard errors of the measurement
MAX_STEP = 2.0                  # one correction multiplies beta by at most this, or divides it
MAX_CORRECTIONS = 3
SATURATION_LOSS = 0.02          # the share of the configured R0 lost to saturation above which the pilot runs (follow-up spec 4.3)


def gamma_loss(q: float, cv: float) -> float:
    """1 − E[min(x, 1/q)] for x gamma with mean 1 and coefficient of variation cv: the share of R0 lost when the per-contact
    probability q × x of a very susceptible agent is capped at 1 (E[min(X, c)] = P(k+1, c/θ) + c (1 − P(k, c/θ)) for shape k,
    scale θ, kθ = 1, P the regularized incomplete gamma function)."""
    if cv <= 0 or q <= 0:
        return 0.0
    shape, scale, cap = 1.0 / cv ** 2, cv ** 2, 1.0 / q
    return float(max(0.0, 1.0 - (gammainc(shape + 1.0, cap / scale) + cap * (1.0 - gammainc(shape, cap / scale)))))


def saturation_loss(p: SimParamsV2) -> float:
    """Follow-up spec 4.3: on the random network each contact is a draw with probability q × x for a target of personal multiplier
    x; the age-structured network's mixing pools take the multiplier linearly while R0 is being defined, and the hybrid network
    is measured anyway."""
    if p.network.network_type != "random":
        return 0.0
    return gamma_loss(p.network.network_beta * per_contact_prob(p.disease.beta), p.disease.rel_sus_cv)


def needs_calibration(p: SimParamsV2) -> bool:
    return bool(p.run.calibrate_r0 and (r0_is_approximate(p) or saturation_loss(p) > SATURATION_LOSS))


def pilot_seeds(p: SimParamsV2, target: float) -> int:
    wanted = round(PILOT_DIRECT_SHARE * p.run.n_agents / max(target, 1.0))
    return int(min(p.run.n_agents, max(PILOT_SEED_FLOOR, min(PILOT_SEEDS, wanted))))


def pilot_params(p: SimParamsV2, seed: int, target: float | None = None) -> SimParamsV2:
    """The pilot's scenario. target sizes the seeds (the formula's R0 of p when it is not given); the calibration passes its own
    target so every trial beta is measured with the same seeds."""
    d = p.disease
    window = PILOT_WINDOW_MULTIPLE * (d.dur_inf.mean_days + (d.dur_exp.mean_days if d.dur_exp is not None else 0.0))
    days = max(PILOT_MIN_DAYS, math.ceil(window))
    body = p.model_dump()
    n_seeds = pilot_seeds(p, approx_r0(p) if target is None else target)
    body["disease"].update(seed={"mode": "count", "value": n_seeds, "day": 0}, initial_immune_frac=0.0)
    body["interventions"] = []
    body["run"].update(sim_dur_years=days / 365, n_replicates=1, rand_seed=seed, calibrate_r0=False, fit=None)
    return SimParamsV2.model_validate(body)


def measure(p: SimParamsV2, seed: int, target: float | None = None) -> Measurement | None:
    sim = build_sim(pilot_params(p, seed, target), seed=seed, first_generation=True)
    sim.run()
    return measure_r0(sim, count_day0=True)          # nothing transmits on step 0 in a first-generation run, so nothing is left out


def _off(m: Measurement, target: float) -> bool:
    return abs(m.mean - target) > max(TOLERANCE * target, NOISE_SIGMAS * m.se)


def calibrate_by_measurement(p: SimParamsV2, seed: int) -> tuple[SimParamsV2, dict | None]:
    """The parameters to run (beta corrected when a pilot ran) and {target, measured, se, corrections, reached}, or (p, None) with no
    pilot or with a pilot that could measure nothing (a network that records no sources). A correction is kept only when it brings
    the measurement nearer the target; it never leaves the registry's bound or the joint rule of network_beta and beta. reached is
    false when the target was not met within tolerance, including when the seeds infected nobody."""
    if not needs_calibration(p):
        return p, None
    target = approx_r0(p)
    if target <= 0:
        return p, None
    current, m, corrections = p, measure(p, seed, target), 0
    if m is None:
        return p, None
    while m.mean > 0 and corrections < MAX_CORRECTIONS and _off(m, target):
        beta = clamp_beta(current.disease.beta * min(MAX_STEP, max(1.0 / MAX_STEP, target / m.mean)))
        if beta == current.disease.beta:
            break                                                    # at the registry's bound
        body = current.model_dump()
        body["disease"]["beta"] = beta
        try:
            trial = SimParamsV2.model_validate(body)
        except ValidationError:
            break                                                    # the joint rule: this network cannot take more
        tried = measure(trial, seed, target)
        if tried is None or abs(tried.mean - target) >= abs(m.mean - target):
            break                                                    # no nearer: keep the better beta
        current, m, corrections = trial, tried, corrections + 1
    return current, {"target": round(target, 4), "measured": round(m.mean, 4), "se": round(m.se, 4), "corrections": corrections,
                     "reached": bool(m.mean > 0 and not _off(m, target))}
