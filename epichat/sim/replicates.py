"""Spec 8.7: run n seeds sequentially in one process (the Starsim import is
paid once), return the lower-median replicate by total infections as the
result, and per-day 10th and 90th percentile bands across replicates. Before the
replicates, a fit to a known outcome moves its lever (Part 2, 7.7) and beta is
calibrated to the measured R0 where the formula is approximate (5.7): a fit on a
beta lever replaces the calibration; a fit that leaves R0 alone keeps it
(follow-up spec 6), once before the fit when the pilot does not depend on the
lever (the behaviour response, which the pilot runs without) and at every trial
when it does (the variation in susceptibility), so the fitted run is the run a
plain scenario with the fitted value gets; the payload carries the parameters
that ran."""
from __future__ import annotations

import numpy as np

from epichat.params.schema_v2 import SimParamsV2

from .builder import build_sim
from .calibrate import calibrate_by_measurement
from .fit import BETA_LEVERS, PILOT_LEVERS, fit_lever
from .outputs import extract

BAND_KEYS = ("n_infectious", "cum_infections")


def run_replicates(params: SimParamsV2, n: int | None = None) -> dict:
    n = int(n or params.run.n_replicates)
    first = params.run.rand_seed if params.run.rand_seed is not None else 1
    seeds = [int(first) + i for i in range(n)]
    fit_spec = params.run.fit
    if fit_spec is not None and fit_spec.lever in PILOT_LEVERS:             # this fit keeps R0 and the pilot depends on its lever
        trials: list[dict | None] = []

        def calibrated(trial: SimParamsV2) -> SimParamsV2:
            out, info = calibrate_by_measurement(trial, seeds[0])
            trials.append(info)
            return out

        params, fitted = fit_lever(params, seeds[0], calibrated)
        calibration = trials[-1] if trials else None                        # the calibration of the trial that ran last, the one kept
    elif fit_spec is not None and fit_spec.lever not in BETA_LEVERS:        # this fit keeps R0, so the pilot still sets beta first
        params, calibration = calibrate_by_measurement(params, seeds[0])
        params, fitted = fit_lever(params, seeds[0])
    else:
        params, fitted = fit_lever(params, seeds[0])                        # Part 2, 7.7: the lever moved to the known outcome
        params, calibration = (params, None) if fitted is not None else calibrate_by_measurement(params, seeds[0])   # 5.7; a beta fit supersedes the pilot
    results = []
    for seed in seeds:
        sim = build_sim(params, seed=seed)
        sim.run()
        results.append(extract(sim, params.run.n_agents, sim.seeds_day0, params.demographics.use_demographics))
    order = sorted(range(n), key=lambda i: results[i]["stats"]["total_infected"])
    rep = order[(n - 1) // 2]
    payload = {"stats": results[rep]["stats"], "series": results[rep]["series"], "effective_params": params.model_dump(mode="json")}
    if calibration is not None:
        payload["stats"] = {**payload["stats"], "r0_calibration": calibration}
    if fitted is not None:
        payload["stats"] = {**payload["stats"], "fit": fitted}
    if n > 1:
        bands = {}
        for key in BAND_KEYS:
            stack = np.array([r["series"][key] for r in results], dtype=float)
            bands[key] = {"p10": [float(v) for v in np.percentile(stack, 10, axis=0)],
                          "p90": [float(v) for v in np.percentile(stack, 90, axis=0)]}
        payload["replicates"] = {"n": n, "seeds": seeds, "representative": seeds[rep],
                                 "stats": [r["stats"] for r in results], "bands": bands}
    return payload
