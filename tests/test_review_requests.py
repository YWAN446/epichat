"""The review-request list for the database team (Part 2, section 11)."""
import json
from pathlib import Path

from epichat.disease_db import _num, _rich_param, listed_estimates, load_db
from scripts.review_requests import REQUESTED_FIELDS, entries_to_check, render, review_table

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


def test_the_committed_review_list_is_what_the_script_renders_today():
    # Part 2, section 11: regenerated whenever the database or the registry changes; this test is the reminder.
    committed = (ROOT / "docs" / "data-review-requests.md").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert committed == render(review_table()), "run: .venv/Scripts/python.exe scripts/review_requests.py --write docs/data-review-requests.md"


def test_the_follow_up_round_asks_for_the_two_limits_on_spread():
    # follow-up spec 11: both mechanisms run on illustrative values until the database carries a cited range
    for field in ("susceptibility_variation", "behaviour_response_effect"):
        assert field in REQUESTED_FIELDS, field
        assert "cited range" in REQUESTED_FIELDS[field] and "illustrative" in REQUESTED_FIELDS[field], field
    assert "disease.rel_sus_cv" in REQUESTED_FIELDS["susceptibility_variation"] and "coefficient of variation" in REQUESTED_FIELDS["susceptibility_variation"]
    assert "behavior_response" in REQUESTED_FIELDS["behaviour_response_effect"]
    text = render(review_table())
    assert "**susceptibility_variation**" in text and "**behaviour_response_effect**" in text


def test_the_list_names_the_entries_a_reviewer_should_look_at_again():
    # The review of the chosen references found three slips by hand: two estimates outside their own range and a
    # consensus none of its estimates supports. An estimate outside the consensus is not a slip: the consensus leaves
    # out narrow populations and single outbreaks on purpose (parameter_summary).
    db = {"diseases": {"x": {"parameters": {
        "r0": {"consensus": {"min": 2, "max": 3}, "estimates": [
            {"value": 4, "range": [1, 2]},                                                # no title: the app does not list it
            {"title": "A paper", "year": 2020, "value": 9, "range": [10, 12]},
            {"title": "B", "value": 2.5, "range": [2, 3]}, {"title": "C", "value": 7, "range": None}]},
        "incubation_days": {"consensus": {"min": 4, "max": 8}, "estimates": [{"title": "E", "value": 1}, {"title": "F", "value": 2}]},
        "infectious_days": {"consensus": {"min": 4, "max": 8}, "estimates": [{"title": "G", "value": "N/A", "range": [1, 2]}, {"title": "H", "value": 5, "range": [5, 5]}]},
        "fatality_rate": {"unit": "percentage", "consensus": {"min": 0.005, "max": 0.005}, "estimates": [{"title": "D", "value": 0.0005}]},
        "average_contacts_daily": {"estimates": ["not an estimate"]},
        "immunity_duration": {"consensus": {"special_value": "lifelong"}, "estimates": [{"title": "I", "value": 3650}]},
        "asymptomatic_fraction": "malformed",
    }}}}
    checks = entries_to_check(db)
    assert [(c["field"], c["kind"], c["estimate"]) for c in checks] == [
        ("r0", "estimate", None), ("r0", "estimate", 1), ("incubation_days", "consensus", None), ("fatality_rate", "consensus", None)]
    text = render([], checks)
    assert "## Entries to check" in text
    # the number is the app's: the estimate without a title is not in its list, so the second estimate is the list's first (review of phase E)
    assert "- **x, r0, an estimate without a title** (not in the app's list): the value 4 lies outside its own range, 1 to 2." in text
    assert "- **x, r0, estimate 1** (A paper, 2020): the value 9 lies outside its own range, 10 to 12." in text
    assert "- **x, incubation_days**: the consensus range, 4 to 8, holds none of its 2 estimates (1, 2)." in text
    assert "- **x, fatality_rate**: the consensus range, 0.005 to 0.005 (percentage), does not hold its only estimate (0.0005)." in text
    assert "None today." in render([], [])


def test_the_reference_list_and_the_review_list_number_the_same_estimates():
    # one rule for what the app lists, shared by the export that writes the list and the script that cites its numbers
    assert listed_estimates({"estimates": [{"value": 1}, {"title": "", "value": 2}, {"title": "T", "value": 3}, "not an estimate"]}) == [{"title": "T", "value": 3}]
    assert listed_estimates({}) == [] and listed_estimates({"estimates": None}) == []
    for script in ("export_web_data.py", "review_requests.py"):
        assert "listed_estimates(" in (ROOT / "scripts" / script).read_text(encoding="utf-8"), script


def test_every_entry_to_check_in_the_database_is_what_the_list_says_it_is():
    db = load_db()
    shown = json.loads((ROOT / "web" / "data" / "disease_refs.json").read_text(encoding="utf-8"))["diseases"]
    checks = entries_to_check()
    text = render(review_table())
    assert "## Entries to check" in text and text.index("## Entries to check") < text.index("## Bundled tables")
    for check in checks:
        rich = _rich_param(db["diseases"][check["disease"]], check["field"])
        if check["kind"] == "consensus":
            values = [e["value"] for e in rich["estimates"] if _num(e.get("value")) is not None]
            low, high = rich["consensus"]["min"], rich["consensus"]["max"]
            assert values and not any(low <= v <= high for v in values), check
        elif check["estimate"] is not None:
            # the number is the place in the app's own reference list, as the export wrote it
            listed = shown[check["disease"]]["parameters"][check["field"]]["estimates"][check["estimate"] - 1]
            assert listed["title"] == check["title"] and listed["value"] == check["value"], check
            assert not min(listed["range"]) <= listed["value"] <= max(listed["range"]), check
        assert check["problem"] in text, check


def test_the_two_requests_say_what_to_find_for_every_value_they_seed():
    # review of phase E: the request names half_prevalence and memory_days, so it asks for what would set them; the
    # variation's 1 is the value the agent offers, not the registry default (0, off)
    response, variation = REQUESTED_FIELDS["behaviour_response_effect"], REQUESTED_FIELDS["susceptibility_variation"]
    assert "prevalence at which" in response and "delay" in response and "half_prevalence" in response and "memory_days" in response
    assert "the agent offers" in variation and "illustrative default" not in variation and "illustrative default" not in response
