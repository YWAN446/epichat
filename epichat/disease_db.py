"""Disease parameter database loader and lookup utilities.

The JSON database (data/disease_parameters.json) uses a rich, citation-backed
format: each disease has a "parameters" mapping where every parameter carries
a unit, a consensus range (min/max/typical), and a list of literature
estimates with full citations (title, url, doi, country, year). covid19 is
special-cased with per-variant R0 under "variants" plus shared parameters;
"default_variant" names the variant surfaced by default.

load_db() normalizes each disease into an entry that also exposes the legacy
flat view (entry["r0"] == {"min", "max", "typical", "source", ...}) that
callers and tests rely on, while keeping the full rich detail available under
entry["parameters"] / entry["variants"].
"""
from __future__ import annotations

import json
import re
from pathlib import Path

_DB_PATH = Path(__file__).parent / "data" / "disease_parameters.json"
_db: dict | None = None

# Days per unit for immunity-duration comparisons.
_DAYS_PER_UNIT = {"days": 1.0, "weeks": 7.0, "months": 30.44, "years": 365.25}


def _num(x) -> float | None:
    """Return x if it is a real number, else None (filters 'N/A', 'lifelong', null)."""
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def _flatten_param(param: dict) -> dict | None:
    """Collapse a rich parameter block into the legacy flat view.

    Returns None when the consensus has no numeric values (qualitative
    entries such as "lifelong", or in-progress placeholders).
    """
    cons = param.get("consensus") or {}
    lo, hi, typ = _num(cons.get("min")), _num(cons.get("max")), _num(cons.get("typical"))
    if lo is None and hi is None and typ is None:
        return None

    flat: dict = {}
    if lo is not None:
        flat["min"] = lo
    if hi is not None:
        flat["max"] = hi
    if typ is not None:
        flat["typical"] = typ

    source = cons.get("source")
    if not source:
        for est in param.get("estimates", []):
            if est.get("url"):
                source = est["url"]
                break
            doi = est.get("doi")
            if doi and doi != "N/A":
                source = f"https://doi.org/{doi}"
                break
    flat["source"] = source or ""
    if cons.get("notes"):
        flat["note"] = cons["notes"]
    if param.get("unit"):
        flat["unit"] = param["unit"]
    return flat


def _normalize_disease(entry: dict) -> dict:
    """Build a disease entry exposing both the rich data and the flat view."""
    norm = dict(entry)
    for pname, pdata in (entry.get("parameters") or {}).items():
        flat = _flatten_param(pdata)
        if flat is not None:
            norm[pname] = flat

    variants = entry.get("variants")
    if variants:
        for pname, pdata in (variants.get("shared_parameters") or {}).items():
            flat = _flatten_param(pdata)
            if flat is not None:
                norm[pname] = flat
        default = variants.get(entry.get("default_variant", ""), {})
        for pname, pdata in (default.get("parameters") or {}).items():
            flat = _flatten_param(pdata)
            if flat is not None:
                norm[pname] = flat
    return norm


def load_db() -> dict:
    """Load the disease parameters database from JSON file.

    Returns:
        dict: The loaded database with "diseases" key containing normalized
        disease entries (rich data plus the legacy flat parameter view).
    """
    global _db
    if _db is None:
        raw = json.loads(_DB_PATH.read_text(encoding="utf-8"))
        _db = {
            **raw,
            "diseases": {
                name: _normalize_disease(entry)
                for name, entry in raw["diseases"].items()
            },
        }
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
    """Return canonical disease name if any disease name/alias appears in the query.

    Uses word-boundary matching to avoid false positives (e.g. "flu" in "fluid").
    """
    db = load_db()
    text = user_input.lower()
    for canonical, entry in db["diseases"].items():
        if re.search(r"\b" + re.escape(canonical) + r"\b", text):
            return canonical
        for alias in entry.get("aliases", []):
            if re.search(r"\b" + re.escape(alias.lower()) + r"\b", text):
                return canonical
    return None


def _range_of(entry: dict, param: str) -> tuple[float, float, dict] | None:
    """Return (min, max, flat_data) for a parameter, or None if unavailable."""
    data = entry.get(param)
    if not isinstance(data, dict):
        return None
    lo, hi = _num(data.get("min")), _num(data.get("max"))
    if lo is None or hi is None:
        return None
    return lo, hi, data


def check_params(
    disease_name: str,
    r0: float,
    dur_inf: float,
    dur_exp: float | None,
    p_death: float | None = None,
    n_contacts: float | None = None,
    dur_immune: float | None = None,
    p_asymp: float | None = None,
) -> list[str]:
    """Return warning strings for values outside the literature range.

    The optional parameters use simulation units (p_death and p_asymp as
    fractions of 1, dur_immune in days) and are converted to each database
    parameter's declared unit before comparison.

    Returns [] if the disease is not in the database or all values are in
    range. Never raises.
    """
    try:
        entry = lookup(disease_name)
        if entry is None:
            return []

        warnings: list[str] = []

        rng = _range_of(entry, "r0")
        if rng and not (rng[0] <= r0 <= rng[1]):
            warnings.append(
                f"R₀ ≈ {r0:.1f} is outside the literature range for "
                f"{disease_name} ({rng[0]}–{rng[1]}). "
                f"Source: {rng[2]['source']}"
            )

        rng = _range_of(entry, "infectious_days")
        if rng and not (rng[0] <= dur_inf <= rng[1]):
            warnings.append(
                f"Infectious period {dur_inf:.4g} days is outside the literature range for "
                f"{disease_name} ({rng[0]}–{rng[1]} days). "
                f"Source: {rng[2]['source']}"
            )

        if dur_exp is not None:
            rng = _range_of(entry, "incubation_days")
            if rng and not (rng[0] <= dur_exp <= rng[1]):
                warnings.append(
                    f"Incubation period {dur_exp:.4g} days is outside the literature range for "
                    f"{disease_name} ({rng[0]}–{rng[1]} days). "
                    f"Source: {rng[2]['source']}"
                )

        if p_death is not None:
            rng = _range_of(entry, "fatality_rate")
            if rng:
                value = p_death * 100.0 if rng[2].get("unit") == "percentage" else p_death
                if not (rng[0] <= value <= rng[1]):
                    unit = "%" if rng[2].get("unit") == "percentage" else ""
                    warnings.append(
                        f"Fatality rate {value:.4g}{unit} is outside the literature range for "
                        f"{disease_name} ({rng[0]}–{rng[1]}{unit}). "
                        f"Source: {rng[2]['source']}"
                    )

        if n_contacts is not None:
            rng = _range_of(entry, "average_contacts_daily")
            if rng and not (rng[0] <= n_contacts <= rng[1]):
                warnings.append(
                    f"Daily contacts {n_contacts:.4g} is outside the literature range for "
                    f"{disease_name} ({rng[0]}–{rng[1]}). "
                    f"Source: {rng[2]['source']}"
                )

        if dur_immune is not None:
            rng = _range_of(entry, "immunity_duration")
            if rng:
                factor = _DAYS_PER_UNIT.get(rng[2].get("unit", "days"), 1.0)
                lo_days, hi_days = rng[0] * factor, rng[1] * factor
                if not (lo_days <= dur_immune <= hi_days):
                    warnings.append(
                        f"Immunity duration {dur_immune:.4g} days is outside the literature range for "
                        f"{disease_name} ({lo_days:.4g}–{hi_days:.4g} days). "
                        f"Source: {rng[2]['source']}"
                    )

        if p_asymp is not None:
            rng = _range_of(entry, "asymptomatic_fraction")
            if rng:
                value = p_asymp * 100.0 if rng[2].get("unit") == "percentage" else p_asymp
                if not (rng[0] <= value <= rng[1]):
                    warnings.append(
                        f"Asymptomatic fraction {p_asymp:.4g} is outside the literature range for "
                        f"{disease_name} ({rng[0]}–{rng[1]} {rng[2].get('unit', '')}). "
                        f"Source: {rng[2]['source']}"
                    )

        return warnings
    except Exception:
        return []
