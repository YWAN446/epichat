"""Subprocess entry point for the simulation service (spec 8.8):

    python -m epichat.sim.run_params <params.json> <out.json>

The parent writes the parameters (v1 or v2) as JSON; this process imports
Starsim (the expensive part), validates and migrates them, runs every
replicate, and writes {"stats", "series"[, "replicates"]} to the output
path. Any failure is a traceback on stderr and a non-zero exit; the parent
keeps the stderr tail as the error."""
from __future__ import annotations

import json
import sys

from epichat.params.migrate import coerce_params

from .replicates import run_replicates


def run(params) -> dict:
    return run_replicates(coerce_params(params))


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2:
        print("usage: python -m epichat.sim.run_params <params.json> <out.json>", file=sys.stderr)
        return 2
    with open(argv[0], encoding="utf-8") as f:
        params = coerce_params(json.load(f))
    payload = run(params)
    with open(argv[1], "w", encoding="utf-8") as f:
        json.dump(payload, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
