"""Capture the v1 parity baseline (spec section 13): each model's default
parameters at 10k agents for one year, seeds 1 to 10, run through the Jinja
templates on the Starsim version installed in the interpreter that runs this
script. Run it ONCE with the service venv while it still has Starsim 3.3.2:

    sim/.venv/Scripts/python.exe scripts/capture_sim_baseline.py

It writes tests/fixtures/sim_baseline_v1.json. Rerunning on a newer Starsim
would not be a baseline; the test pins the version."""
from __future__ import annotations

import json
import statistics
import sys
import tempfile
import uuid
from importlib.metadata import version
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
for path in (str(ROOT), str(ROOT / "sim")):
    if path not in sys.path:
        sys.path.insert(0, path)

from epichat.generator import CodeGenerator  # noqa: E402
from epichat.schema import SimParams  # noqa: E402

BASE = dict(beta=22.8125, n_agents=10000, sim_dur_years=1.0, n_contacts=4, init_prev=0.01, dur_inf=10.0, p_death=0.0)
CASES = {
    "sir": dict(disease_type="sir"),
    "sis": dict(disease_type="sis"),
    "sirs": dict(disease_type="sirs", dur_immune=180.0),
    "seir": dict(disease_type="seir", dur_exp=5.0),
    "seirs": dict(disease_type="seirs", dur_exp=5.0, dur_immune=180.0),
    "seiar": dict(disease_type="seiar", dur_exp=5.0, p_asymp=0.3, rel_trans_asymp=0.5),
}
SEEDS = list(range(1, 11))
OUT = ROOT / "tests" / "fixtures" / "sim_baseline_v1.json"


def case_params(name: str) -> dict:
    return {**BASE, **CASES[name]}


def run_one(params: SimParams) -> dict:
    from runner import run_script  # sim/runner.py: the 3.3.2 subprocess runner
    out = Path(tempfile.gettempdir()) / f"epichat-baseline-{uuid.uuid4().hex}.json"
    code = CodeGenerator().generate(params, str(out), output_mode="json")
    result = run_script(code, out, timeout=600)
    if not result.ok:
        raise RuntimeError(f"{params.disease_type} seed {params.rand_seed}: {result.error}")
    return result.stats


def main() -> None:
    cases = {}
    for name in CASES:
        per_seed = []
        for seed in SEEDS:
            stats = run_one(SimParams(**case_params(name), rand_seed=seed))
            per_seed.append({"seed": seed, "total_infected": int(stats["total_infected"]),
                             "peak_day": int(stats["peak_day"]), "peak_infections": int(stats["peak_infections"])})
            print(name, seed, per_seed[-1], flush=True)
        cases[name] = {
            "params": case_params(name),
            "per_seed": per_seed,
            "median": {key: statistics.median(r[key] for r in per_seed) for key in ("total_infected", "peak_day")},
        }
    OUT.write_text(json.dumps({
        "starsim_version": version("starsim"), "n_agents": BASE["n_agents"], "sim_dur_years": BASE["sim_dur_years"],
        "seeds": SEEDS, "cases": cases,
    }, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
