"""Print a disease x parameter coverage grid for the parameter database.

    py -3.10 scripts/param_coverage.py

Legend:
  ok       numeric consensus the simulation can use
  review   held back pending review (status: under_review)
  cites    citations present but no usable consensus number
  -        nothing at all
"""
from __future__ import annotations

import json
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "epichat" / "data" / "disease_parameters.json"
PARAMS = ("r0", "incubation_days", "infectious_days", "fatality_rate",
          "average_contacts_daily", "immunity_duration", "asymptomatic_fraction")
WIDTH = 9


def _blocks(entry: dict) -> dict:
    """Parameter blocks for a disease, preferring the default variant."""
    blocks = dict(entry.get("parameters") or {})
    variants = entry.get("variants") or {}
    blocks.update(variants.get("shared_parameters") or {})
    default = variants.get(entry.get("default_variant", "")) or {}
    blocks.update(default.get("parameters") or {})
    return blocks


def _state(block) -> str:
    if not isinstance(block, dict):
        return "-"
    if block.get("status") == "under_review":
        return "review"
    cons = block.get("consensus") or {}
    if any(isinstance(cons.get(s), (int, float)) and not isinstance(cons.get(s), bool)
           for s in ("min", "max", "typical")):
        return "ok"
    if block.get("estimates") or block.get("url") or block.get("special_value"):
        return "cites"
    return "-"


def main() -> None:
    diseases = json.loads(DB.read_text(encoding="utf-8"))["diseases"]
    name_w = max(len(d) for d in diseases) + 2
    header = "disease".ljust(name_w) + "".join(p[:WIDTH - 1].ljust(WIDTH) for p in PARAMS)
    print(header)
    print("-" * len(header))
    tally: dict[str, int] = {}
    reviews: list[str] = []
    for disease, entry in diseases.items():
        blocks = _blocks(entry)
        row = disease.ljust(name_w)
        for param in PARAMS:
            state = _state(blocks.get(param))
            tally[state] = tally.get(state, 0) + 1
            row += state.ljust(WIDTH)
            if state == "review":
                note = (blocks[param].get("review_note") or "").split(". ")[0]
                reviews.append(f"  {disease}.{param}: {note}.")
        print(row)
    total = sum(tally.values())
    print("-" * len(header))
    print("  ".join(f"{k}: {v}" for k, v in sorted(tally.items())) + f"   (of {total})")
    if reviews:
        print("\nheld back pending review:")
        print("\n".join(reviews))


if __name__ == "__main__":
    main()
