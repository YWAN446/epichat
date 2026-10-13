"""Spec 8.7: run n seeds sequentially in one process (the Starsim import is
paid once), return the lower-median replicate by total infections as the
result, and per-day 10th and 90th percentile bands across replicates. Before the
replicates, beta is calibrated to the measured R0 where the formula is approximate
(Part 2, 5.7), and the payload carries the parameters that ran."""
from __future__ import annotations

import numpy as np

from epichat.params.schema_v2 import SimParamsV2

from .builder import build_sim
from .calibrate import calibrate_by_measurement
from .outputs import extract

BAND_KEYS = ("n_infectious", "cum_infections")


def run_replicates(params: SimParamsV2, n: int | None = None) -> dict:
    n = int(n or params.run.n_replicates)
    first = params.run.rand_seed if params.run.rand_seed is not None else 1
    seeds = [int(first) + i for i in range(n)]
    params, calibration = calibrate_by_measurement(params, seeds[0])      # Part 2, 5.7: a pilot on the approximate networks
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
    if n > 1:
        bands = {}
        for key in BAND_KEYS:
            stack = np.array([r["series"][key] for r in results], dtype=float)
            bands[key] = {"p10": [float(v) for v in np.percentile(stack, 10, axis=0)],
                          "p90": [float(v) for v in np.percentile(stack, 90, axis=0)]}
        payload["replicates"] = {"n": n, "seeds": seeds, "representative": seeds[rep],
                                 "stats": [r["stats"] for r in results], "bands": bands}
    return payload
