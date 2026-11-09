"""Run a scenario: fit its lever to a known outcome if asked, then run its replicates in one process. An ODE run is deterministic, so
it runs once; runs as agents give n seeds, the lower-median replicate by total infections as the result, and per-day 10th and 90th
percentile bands across replicates. The payload carries the parameters that ran."""
from __future__ import annotations

import numpy as np

from epichat.params.schema_v2 import SimParamsV2

from .builder import build_sim
from .fit import fit_lever
from .outputs import extract

BAND_KEYS = ("n_infectious", "cum_infections")


def run_replicates(params: SimParamsV2, n: int | None = None) -> dict:
    n = int(n or params.run.n_replicates)
    first = params.run.rand_seed if params.run.rand_seed is not None else 1
    params, fitted = fit_lever(params, first)
    results, seeds = [], []
    for i in range(n):
        seed = int(first) + i
        sim = build_sim(params, seed=seed)
        sim.run()
        results.append(extract(sim, params))
        seeds.append(seed)
        if sim.solver.name == "ode":
            break                       # deterministic: every replicate would be the same
    order = sorted(range(len(results)), key=lambda i: results[i]["stats"]["total_infected"])
    rep = order[(len(results) - 1) // 2]
    payload = {"stats": results[rep]["stats"], "series": results[rep]["series"], "effective_params": params.model_dump(mode="json")}
    if fitted is not None:
        payload["stats"] = {**payload["stats"], "fit": fitted}
    if len(results) > 1:
        bands = {}
        for key in BAND_KEYS:
            stack = np.array([r["series"][key] for r in results], dtype=float)
            bands[key] = {"p10": [float(v) for v in np.percentile(stack, 10, axis=0)],
                          "p90": [float(v) for v in np.percentile(stack, 90, axis=0)]}
        payload["replicates"] = {"n": len(results), "seeds": seeds, "representative": seeds[rep],
                                 "stats": [r["stats"] for r in results], "bands": bands}
    return payload
