"""Schema and sanity guard for epichat/data/disease_parameters.json.

Offline: no network, no API key. A malformed edit to the parameter database
fails here rather than at runtime in front of a student.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

DB_PATH = Path(__file__).resolve().parent.parent / "epichat" / "data" / "disease_parameters.json"

PARAM_KEYS = {"unit", "consensus", "estimates", "special_value", "source_type",
              "url", "doi", "title", "year", "status", "review_note"}
CONSENSUS_KEYS = {"min", "max", "typical", "notes", "source", "special_value",
                  "scenarios"}
ESTIMATE_KEYS = {"value", "range", "population", "source_type", "title", "url",
                 "doi", "country", "year", "notes", "metric", "special_value"}
UNITS = {"dimensionless", "days", "months", "percentage", "fraction", "contacts/day"}
STATUSES = {"ok", "under_review"}


def _reject_duplicate_keys(pairs):
    seen = {}
    for key, value in pairs:
        if key in seen:
            raise AssertionError(f"duplicate JSON key {key!r} — the earlier one is lost")
        seen[key] = value
    return seen


@pytest.fixture(scope="module")
def raw():
    return json.loads(DB_PATH.read_text(encoding="utf-8"),
                      object_pairs_hook=_reject_duplicate_keys)


def _labelled_params(raw):
    """Yield ("disease.param", block) for every parameter, variants included."""
    for disease, entry in raw["diseases"].items():
        for name, block in (entry.get("parameters") or {}).items():
            yield f"{disease}.{name}", block
        variants = entry.get("variants") or {}
        for name, block in (variants.get("shared_parameters") or {}).items():
            yield f"{disease}.shared.{name}", block
        for vname, variant in variants.items():
            if vname == "shared_parameters" or not isinstance(variant, dict):
                continue
            for name, block in (variant.get("parameters") or {}).items():
                yield f"{disease}.{vname}.{name}", block


def test_every_disease_has_identity(raw):
    for disease, entry in raw["diseases"].items():
        assert entry.get("display_name"), f"{disease}: no display_name"
        assert isinstance(entry.get("aliases"), list), f"{disease}: aliases must be a list"
        assert entry.get("parameters") or entry.get("variants"), \
            f"{disease}: neither parameters nor variants"


def test_parameter_keys_are_known(raw):
    for label, block in _labelled_params(raw):
        assert isinstance(block, dict), \
            f"{label}: parameter is a {type(block).__name__}, not an object"
        extra = set(block) - PARAM_KEYS
        assert not extra, f"{label}: unknown parameter keys {sorted(extra)}"
        if isinstance(block.get("consensus"), dict):
            extra = set(block["consensus"]) - CONSENSUS_KEYS
            assert not extra, f"{label}: unknown consensus keys {sorted(extra)} — typo?"
        if block.get("unit") is not None:
            assert block["unit"] in UNITS, f"{label}: unknown unit {block['unit']!r}"
        assert block.get("status", "ok") in STATUSES, \
            f"{label}: unknown status {block.get('status')!r}"


def test_consensus_slots_are_numeric_or_null(raw):
    for label, block in _labelled_params(raw):
        cons = block.get("consensus") or {}
        for slot in ("min", "max", "typical"):
            value = cons.get(slot)
            assert value is None or (isinstance(value, (int, float))
                                     and not isinstance(value, bool)), \
                f"{label}.{slot}: {value!r} is neither a number nor null"


def test_consensus_is_ordered(raw):
    for label, block in _labelled_params(raw):
        cons = block.get("consensus") or {}
        lo, typ, hi = cons.get("min"), cons.get("typical"), cons.get("max")
        if all(isinstance(v, (int, float)) for v in (lo, typ, hi)):
            assert lo <= typ <= hi, f"{label}: min/typical/max out of order ({lo}, {typ}, {hi})"
        elif isinstance(lo, (int, float)) and isinstance(hi, (int, float)):
            assert lo <= hi, f"{label}: min > max ({lo} > {hi})"


def test_values_are_plausible_for_their_unit(raw):
    for label, block in _labelled_params(raw):
        cons = block.get("consensus") or {}
        unit = block.get("unit")
        for slot in ("min", "max", "typical"):
            value = cons.get(slot)
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                continue
            if unit == "percentage":
                assert 0 <= value <= 100, f"{label}.{slot}: {value} outside 0–100%"
            elif unit == "fraction":
                assert 0 <= value <= 1, f"{label}.{slot}: {value} outside 0–1"
            elif unit in ("days", "months"):
                assert value > 0, f"{label}.{slot}: {value} is not a positive duration"
            elif unit == "dimensionless":
                assert value >= 0, f"{label}.{slot}: {value} is negative"


def test_every_estimate_is_citable(raw):
    for label, block in _labelled_params(raw):
        for i, est in enumerate(block.get("estimates") or []):
            where = f"{label}.estimates[{i}]"
            extra = set(est) - ESTIMATE_KEYS
            assert not extra, f"{where}: unknown keys {sorted(extra)}"
            assert est.get("title"), f"{where}: no title"
            doi = est.get("doi")
            assert est.get("url") or (doi and str(doi).strip().upper() != "N/A"), \
                f"{where}: neither a url nor a usable doi"
            rng = est.get("range")
            assert rng is None or (isinstance(rng, list) and len(rng) == 2), \
                f"{where}: range must be [low, high] or null, got {rng!r}"


def test_under_review_parameters_carry_no_numbers(raw):
    for label, block in _labelled_params(raw):
        if block.get("status") != "under_review":
            continue
        assert block.get("review_note"), f"{label}: under_review without a review_note"
        cons = block.get("consensus") or {}
        assert all(cons.get(s) is None for s in ("min", "max", "typical")), \
            f"{label}: under_review but still carries consensus numbers"


def test_loader_accepts_the_file():
    from epichat import disease_db
    disease_db._db = None
    try:
        db = disease_db.load_db()
        assert db["diseases"], "loader returned no diseases"
    finally:
        disease_db._db = None


def test_duplicate_keys_are_rejected():
    """json.load silently keeps the last duplicate; the guard must not."""
    text = '{"diseases": {"ebola": {"display_name": "A"}, "ebola": {"display_name": "B"}}}'
    with pytest.raises(AssertionError, match="duplicate JSON key"):
        json.loads(text, object_pairs_hook=_reject_duplicate_keys)
