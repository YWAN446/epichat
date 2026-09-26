"""One-off normalization of epichat/data/disease_parameters.json.

Makes main's own file satisfy tests/test_disease_parameters.py without
changing any cited value, and fixes one latent bug: COVID-19's ancestral R0
estimates sit beside "r0" inside "parameters" instead of inside it, so
_flatten_param would be handed a list and raise as soon as default_variant
named that variant.

Run once:  py -3.10 scripts/normalize_parameters.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _param_normalize import normalize_param  # noqa: E402

DB = Path(__file__).resolve().parent.parent / "epichat" / "data" / "disease_parameters.json"


def _walk(params) -> None:
    if not isinstance(params, dict):
        return
    for block in params.values():
        if isinstance(block, dict):
            normalize_param(block)


def _rehome_orphaned_estimates(entry: dict) -> int:
    """Move an estimates list that sits beside a parameter into that parameter."""
    moved = 0
    for variant in (entry.get("variants") or {}).values():
        if not isinstance(variant, dict):
            continue
        params = variant.get("parameters")
        if isinstance(params, dict) and isinstance(params.get("estimates"), list):
            orphaned = params.pop("estimates")
            target = params.get("r0")
            if isinstance(target, dict):
                target.setdefault("estimates", []).extend(orphaned)
                moved += len(orphaned)
    return moved


def main() -> None:
    raw = json.loads(DB.read_text(encoding="utf-8"))
    moved = 0
    for entry in raw["diseases"].values():
        moved += _rehome_orphaned_estimates(entry)
        _walk(entry.get("parameters"))
        variants = entry.get("variants") or {}
        _walk(variants.get("shared_parameters"))
        for name, variant in variants.items():
            if name != "shared_parameters" and isinstance(variant, dict):
                _walk(variant.get("parameters"))
    DB.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"normalized {DB} ({moved} orphaned estimates rehomed)")


if __name__ == "__main__":
    main()
