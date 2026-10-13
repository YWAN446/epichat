"""Part 2, 5.7: where the R0 formula is approximate (the hybrid network, or a contact duration above zero) the child runs a short pilot
with the formula's beta, measures the seeds' secondary infections, corrects beta by target / measured and repeats until the measured R0
is within 5% of the target or three corrections have been made. The pilot is the scenario without its interventions and initial
immunity (an R0 is measured in a susceptible population), seeded with at least 300 day-0 infections (2% of the agents when that is
fewer, never under 20) so the measurement's standard error stays near 5%, and runs for four times the latent plus infectious means."""
from __future__ import annotations

import math

from epichat.params.r0 import approx_r0, clamp_beta, r0_is_approximate
from epichat.params.schema_v2 import SimParamsV2, sim_days

from .builder import build_sim
from .outputs import measured_r0

PILOT_SEEDS = 300
PILOT_SEED_SHARE = 0.02
PILOT_SEED_FLOOR = 20
PILOT_WINDOW_MULTIPLE = 4
TOLERANCE = 0.05
MAX_CORRECTIONS = 3


def needs_calibration(p: SimParamsV2) -> bool:
    return r0_is_approximate(p) and p.run.calibrate_r0


def pilot_params(p: SimParamsV2, seed: int) -> SimParamsV2:
    d = p.disease
    window = PILOT_WINDOW_MULTIPLE * (d.dur_inf.mean_days + (d.dur_exp.mean_days if d.dur_exp is not None else 0.0))
    days = max(1, min(sim_days(p.run.sim_dur_years), math.ceil(window)))
    n_seeds = max(PILOT_SEED_FLOOR, min(PILOT_SEEDS, int(PILOT_SEED_SHARE * p.run.n_agents)))
    body = p.model_dump()
    body["disease"].update(seed={"mode": "count", "value": min(n_seeds, p.run.n_agents), "day": 0}, initial_immune_frac=0.0)
    body["interventions"] = []
    body["run"].update(sim_dur_years=days / 365, n_replicates=1, rand_seed=seed, calibrate_r0=False)
    return SimParamsV2.model_validate(body)


def measure(p: SimParamsV2, seed: int) -> float | None:
    sim = build_sim(pilot_params(p, seed), seed=seed)
    sim.run()
    return measured_r0(sim)


def calibrate_by_measurement(p: SimParamsV2, seed: int) -> tuple[SimParamsV2, dict | None]:
    """The parameters to run (beta corrected when a pilot ran) and {target, measured, corrections}, or (p, None) with no pilot."""
    if not needs_calibration(p):
        return p, None
    target = approx_r0(p)
    if target <= 0:
        return p, None
    current = p
    measured = measure(current, seed)
    corrections = 0
    while measured and corrections < MAX_CORRECTIONS and abs(measured - target) / target > TOLERANCE:
        current = current.model_copy(deep=True)
        current.disease.beta = clamp_beta(current.disease.beta * target / measured)
        corrections += 1
        measured = measure(current, seed)
    return current, {"target": round(target, 4), "measured": None if measured is None else round(measured, 4), "corrections": corrections}
