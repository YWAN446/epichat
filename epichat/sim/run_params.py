"""Subprocess entry point for the simulation service (spec 8.8):

    python -m epichat.sim.run_params <params.json> <out.json>

The parent writes the validated parameters as JSON, this process imports
Starsim (the expensive part), builds and runs the sim, and writes
{"stats", "series"} to the output path. Any failure is a traceback on stderr
and a non-zero exit; the parent keeps the stderr tail as the error."""
from __future__ import annotations

import json
import sys

from epichat.params.migrate import coerce_params
from epichat.schema import SimParams

from .builder import build_sim
from .outputs import extract


def run(params) -> dict:
    p = coerce_params(params)
    sim = build_sim(p)
    sim.run()
    return extract(sim, p.run.n_agents)


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2:
        print("usage: python -m epichat.sim.run_params <params.json> <out.json>", file=sys.stderr)
        return 2
    with open(argv[0], encoding="utf-8") as f:
        params = SimParams(**json.load(f))
    payload = run(params)
    with open(argv[1], "w", encoding="utf-8") as f:
        json.dump(payload, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
