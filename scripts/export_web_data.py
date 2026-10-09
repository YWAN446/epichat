"""Export the disease database, pre-flattened, its literature references, and
the agent's system prompt for the web app. Python stays the source of truth; the TypeScript side reads
these files and never re-derives summaries or range text.

    py -3.10 scripts/export_web_data.py          # writes web/data/
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from epichat.agent import _SYSTEM  # noqa: E402
from epichat.disease_db import _range_of, _rich_param, load_db, parameter_summary  # noqa: E402

PARAMS = ("r0", "incubation_days", "infectious_days", "fatality_rate",
          "average_contacts_daily", "immunity_duration", "asymptomatic_fraction")
# What one literature estimate carries to the panel's reference list, when present.
ESTIMATE_KEYS = ("value", "range", "year", "country", "population", "source_type",
                 "title", "url", "doi", "notes", "special_value", "metric")


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


def flat_view(entry: dict, param: str) -> dict | None:
    data = entry.get(param)
    if not isinstance(data, dict):
        return None
    rng = _range_of(entry, param)
    return {
        "min": data.get("min"),
        "max": data.get("max"),
        "typical": data.get("typical"),
        "source": data.get("source", ""),
        "unit": data.get("unit"),
        "note": data.get("note"),
        # Python prints an int as 12 and a float as 1.0; JavaScript cannot tell
        # them apart after parsing, so the text travels pre-rendered.
        "range_text": f"{rng[0]}–{rng[1]}" if rng else None,
    }


def disease_db_payload() -> dict:
    db = load_db()
    return {"diseases": {
        key: {
            "display_name": entry.get("display_name"),
            "aliases": list(entry.get("aliases", [])),
            "summaries": {p: parameter_summary(entry, p) for p in PARAMS},
            "flat": {p: flat_view(entry, p) for p in PARAMS},
        }
        for key, entry in db["diseases"].items()
    }}


def references_payload() -> dict:
    """Every estimate behind every parameter, with its citation; the consensus
    source is the one parameter_summary reports, so the panel agrees with the tool."""
    db = load_db()
    diseases = {}
    for key, entry in db["diseases"].items():
        parameters = {}
        for p in PARAMS:
            rich = _rich_param(entry, p) or {}
            summary = parameter_summary(entry, p) or {}
            estimates = [
                {k: est[k] for k in ESTIMATE_KEYS if est.get(k) not in (None, "", "N/A")}
                for est in rich.get("estimates") or []
                if est.get("title")
            ]
            parameters[p] = {"source": summary.get("source") or None, "estimates": estimates}
        diseases[key] = {"display_name": entry.get("display_name"), "parameters": parameters}
    return {"diseases": diseases}


def main(web_dir: Path = ROOT / "web") -> None:
    write_json(web_dir / "data" / "disease_db.json", disease_db_payload())
    write_json(web_dir / "data" / "disease_refs.json", references_payload())
    write_json(web_dir / "data" / "system_prompt.json", {"system": _SYSTEM})


if __name__ == "__main__":
    main()
    print("wrote web/data/disease_db.json, web/data/disease_refs.json, and web/data/system_prompt.json")
