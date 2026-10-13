"""The review-request list for the database team (Part 2, section 11)."""
import json
from pathlib import Path

from scripts.review_requests import REQUESTED_FIELDS, render, review_table

ROOT = Path(__file__).resolve().parent.parent


def test_every_disease_gets_a_row_per_existing_and_requested_field():
    db = json.loads((ROOT / "epichat" / "data" / "disease_parameters.json").read_text(encoding="utf-8"))
    rows = review_table()
    diseases = sorted(db["diseases"])
    fields = {r["field"] for r in rows}
    assert set(REQUESTED_FIELDS) <= fields and {"r0", "fatality_rate", "infectious_days"} <= fields
    assert {"vaccine_efficacy", "treatment_efficacy", "school_closure_effect", "distancing_effect", "mask_effect"} <= set(REQUESTED_FIELDS)
    for effect in ("school_closure_effect", "distancing_effect", "mask_effect"):
        assert "cited range" in REQUESTED_FIELDS[effect] and "illustrative default" in REQUESTED_FIELDS[effect], effect
    for disease in diseases:
        mine = {r["field"]: r for r in rows if r["disease"] == disease}
        assert set(mine) == fields, disease
        assert all(mine[f]["status"] == "requested" for f in REQUESTED_FIELDS)
        assert all(mine[f]["status"] in {"ok", "under_review", "estimates_only", "no_source"} for f in fields - set(REQUESTED_FIELDS))
    measles = {r["field"]: r for r in rows if r["disease"] == "measles"}
    assert measles["r0"]["status"] == "ok" and "children" in measles["fatality_rate_by_age"]["note"]


def test_the_markdown_lists_requests_first_then_the_table_and_the_bundled_checks():
    text = render(review_table())
    assert text.startswith("# Data review requests")
    assert "## Requested fields" in text and "## Coverage by disease" in text and "## Bundled tables" in text
    assert "| measles |" in text and "vaccine_efficacy" in text
