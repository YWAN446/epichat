"""One-off port of Annie's Sep-2026 parameter work into main's schema.

Reads epichat/data/disease_parameters.json as it stands on
origin/feature/pipelines, repairs the five mechanical JSON defects that have
kept it unparseable, cleans the blocks listed in PORT_DISEASES /
PORT_PARAMS, and writes them into main's file. Main's file is the schema of
record: nothing else in it is touched.

Three values are deliberately imported without numbers, marked
status="under_review" with a note, because they would mislead a student if
simulated. See docs/annie-param-review-2026-09.md.

Run once:  py -3.10 scripts/port_annie_parameters.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _param_normalize import is_num, normalize_param  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "epichat" / "data" / "disease_parameters.json"
SOURCE_REF = "origin/feature/pipelines"
SOURCE_PATH = "epichat/data/disease_parameters.json"

PORT_DISEASES = ("influenza", "meningococcal", "hepatitis_a", "ebola")
PORT_PARAMS = {
    "pertussis": ("fatality_rate", "average_contacts_daily",
                  "immunity_duration", "asymptomatic_fraction"),
}

UNDER_REVIEW = {
    ("meningococcal", "infectious_days"):
        "Consensus of 1/1/1 day encodes the public-health rule that a case is "
        "non-infectious ~24 h after effective antibiotics - not the untreated "
        "infectious period or the carriage duration that drives transmission. "
        "Simulating 1 day would badly understate spread. Needs a "
        "transmission-relevant value with a citation.",
    ("influenza", "fatality_rate"):
        "Maximum of 13.5% is far above any population-level influenza CFR and "
        "looks like a hospitalized-cohort or pandemic-subtype figure. Needs "
        "the population denominator confirmed, or the estimate scoped to the "
        "population it describes.",
    ("hepatitis_a", "immunity_duration"):
        "Consensus mixes a numeric string ('7300') with qualitative text "
        "('lifelong', and a sentence contrasting natural with vaccine-induced "
        "immunity). Needs a numeric representation, with the qualitative part "
        "moved to special_value.",
}

_TOP_LEVEL_KEY = re.compile(r'^  "([a-z_0-9]+)"\s*:\s*\{')


def _read_source() -> str:
    return subprocess.run(
        ["git", "show", f"{SOURCE_REF}:{SOURCE_PATH}"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout


def repair(text: str) -> str:
    """Apply the five mechanical repairs that make Annie's file parseable."""
    text = re.sub(r'("(?:min|max|typical)"\s*:\s*),', r"\1null,", text)
    text = re.sub(r'("(?:min|max|typical)"\s*:\s*)(\n\s*[}\]])', r"\1null\2", text)
    text = re.sub(r'"concensus"(\s*:)', r'"consensus"\1', text)
    text = re.sub(r"(?m)^\s*#+.*$", "", text)
    lines = text.split("\n")
    diseases_at = next(
        (i for i, line in enumerate(lines) if line.startswith('  "diseases"')), None)
    if diseases_at is None:
        raise SystemExit('no top-level "diseases" key found in the source')
    cuts = [i for i, line in enumerate(lines)
            if i > diseases_at
            and (m := _TOP_LEVEL_KEY.match(line)) and m.group(1) != "diseases"]
    if not cuts:
        raise SystemExit("expected legacy flat entries after the diseases block; found none")
    return "\n".join(lines[:cuts[0]]).rstrip().rstrip(",") + "}}"


def _clean(block: dict, disease: str, param: str) -> dict:
    """Clean one of Annie's parameter blocks into main's schema."""
    block = json.loads(json.dumps(block))  # deep copy

    # Annie nested an estimates list inside consensus on one parameter.
    cons = block.get("consensus")
    if isinstance(cons, dict) and isinstance(cons.get("estimates"), list):
        block.setdefault("estimates", []).extend(cons.pop("estimates"))

    # Drop in-progress placeholders only. An estimate with a citation and a
    # qualitative value ("lifelong") is real data - the schema supports it via
    # special_value, and a later task quotes these back to the student.
    block["estimates"] = [
        est for est in (block.get("estimates") or [])
        if est.get("title") and (is_num(est.get("value")) or est.get("special_value"))
    ]
    if not block["estimates"]:
        block.pop("estimates")

    normalize_param(block)

    note = UNDER_REVIEW.get((disease, param))
    if note:
        block.setdefault("consensus", {})
        for slot in ("min", "max", "typical"):
            block["consensus"][slot] = None
        block["status"] = "under_review"
        block["review_note"] = note
    return block


def main() -> None:
    source = json.loads(repair(_read_source()))["diseases"]
    target = json.loads(DB.read_text(encoding="utf-8"))
    diseases = target["diseases"]
    summary: list[str] = []

    for disease in PORT_DISEASES:
        entry = json.loads(json.dumps(source[disease]))
        entry["parameters"] = {
            name: _clean(block, disease, name)
            for name, block in entry.get("parameters", {}).items()
        }
        existing = diseases.get(disease, {})
        # Keep main's display_name and aliases: detect_disease matches on them.
        for key in ("display_name", "aliases"):
            if existing.get(key):
                entry[key] = existing[key]
        diseases[disease] = entry
        summary.append(f"{disease}: {len(entry['parameters'])} parameters")

    for disease, params in PORT_PARAMS.items():
        target_params = diseases[disease].setdefault("parameters", {})
        for name in params:
            block = source[disease].get("parameters", {}).get(name)
            if block is None:
                summary.append(f"{disease}.{name}: not in source, skipped")
                continue
            target_params[name] = _clean(block, disease, name)
            summary.append(f"{disease}.{name}: ported")

    # newline="\n" avoids Path.write_text's default universal-newline
    # translation, which would otherwise emit CRLF on Windows.
    DB.write_text(json.dumps(target, ensure_ascii=False, indent=2) + "\n",
                  encoding="utf-8", newline="\n")
    print("\n".join(summary))
    print(f"wrote {DB}")


if __name__ == "__main__":
    main()
