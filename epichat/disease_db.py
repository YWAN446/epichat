"""Disease parameter database loader and lookup utilities."""
from __future__ import annotations

import json
from pathlib import Path

_DB_PATH = Path(__file__).parent / "data" / "disease_parameters.json"
_db: dict | None = None


def load_db() -> dict:
    """Load the disease parameters database from JSON file.

    Returns:
        dict: The loaded database with "diseases" key containing disease entries.
    """
    global _db
    if _db is None:
        _db = json.loads(_DB_PATH.read_text(encoding="utf-8"))
    return _db


def lookup(disease_name: str) -> dict | None:
    """Case-insensitive lookup of disease by canonical name or alias.

    Searches the disease database for a case-insensitive match against:
    1. Canonical disease names (keys in "diseases")
    2. Aliases listed in each disease entry's "aliases" field

    Args:
        disease_name: The disease name or alias to search for.

    Returns:
        dict: The disease entry if found, None otherwise.
    """
    db = load_db()
    name_lower = disease_name.lower().strip()
    for canonical, entry in db["diseases"].items():
        if canonical == name_lower:
            return entry
        if any(alias.lower() == name_lower for alias in entry.get("aliases", [])):
            return entry
    return None
