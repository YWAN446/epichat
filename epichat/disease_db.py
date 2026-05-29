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


def detect_disease(user_input: str) -> str | None:
    """Return canonical disease name if any disease name/alias appears in the query."""
    db = load_db()
    text = user_input.lower()
    for canonical, entry in db["diseases"].items():
        if canonical in text:
            return canonical
        for alias in entry.get("aliases", []):
            if alias.lower() in text:
                return canonical
    return None


def check_params(
    disease_name: str,
    r0: float,
    dur_inf: float,
    dur_exp: float | None,
) -> list[str]:
    """Return warning strings for values outside the literature range.

    Returns [] if the disease is not in the database or all values are in range.
    Never raises.
    """
    try:
        entry = lookup(disease_name)
        if entry is None:
            return []

        warnings: list[str] = []

        r0_data = entry.get("r0", {})
        if r0_data and not (r0_data["min"] <= r0 <= r0_data["max"]):
            warnings.append(
                f"R₀ ≈ {r0:.1f} is outside the literature range for "
                f"{disease_name} ({r0_data['min']}–{r0_data['max']}). "
                f"Source: {r0_data['source']}"
            )

        inf_data = entry.get("infectious_days", {})
        if inf_data and not (inf_data["min"] <= dur_inf <= inf_data["max"]):
            warnings.append(
                f"Infectious period {dur_inf:.4g} days is outside the literature range for "
                f"{disease_name} ({inf_data['min']}–{inf_data['max']} days). "
                f"Source: {inf_data['source']}"
            )

        if dur_exp is not None:
            inc_data = entry.get("incubation_days", {})
            if inc_data and not (inc_data["min"] <= dur_exp <= inc_data["max"]):
                warnings.append(
                    f"Incubation period {dur_exp:.4g} days is outside the literature range for "
                    f"{disease_name} ({inc_data['min']}–{inc_data['max']} days). "
                    f"Source: {inc_data['source']}"
                )

        return warnings
    except Exception:
        return []
