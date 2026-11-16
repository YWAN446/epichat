"""parameter_summary: the uncertainty-aware view the agent's lookup returns."""
from __future__ import annotations

import pytest

from epichat.disease_db import lookup, parameter_summary


def test_confident_parameter_reports_ok_with_a_range():
    summary = parameter_summary(lookup("measles"), "r0")
    assert summary["status"] == "ok"
    assert summary["typical"] == 15
    assert summary["n_estimates"] >= 10
    lo, hi = summary["estimate_range"]
    assert lo < summary["typical"] < hi, "estimate spread should bracket the typical value"
    assert summary["source"]


def test_under_review_parameter_reports_status_and_note_but_no_numbers():
    summary = parameter_summary(lookup("meningococcal"), "infectious_days")
    assert summary["status"] == "under_review"
    assert summary["review_note"]
    assert "typical" not in summary and "min" not in summary


def test_a_parameter_block_with_nothing_in_it_reports_no_source():
    """no_source means the database holds nothing: no consensus, no citations."""
    summary = parameter_summary(lookup("mumps"), "average_contacts_daily")
    assert summary["status"] == "no_source"
    assert summary["n_estimates"] == 0
    assert "typical" not in summary and "estimate_range" not in summary


def test_cited_estimates_without_a_consensus_report_estimates_only():
    """Review Important 1: three citations must not be reported as 'nothing published'."""
    summary = parameter_summary(lookup("ebola"), "incubation_days")
    assert summary["status"] == "estimates_only"
    assert summary["n_estimates"] == 3
    assert summary["estimate_range"] == [9, 12.7]
    assert "typical" not in summary, "there is no consensus value to offer"


def test_a_qualitative_value_with_a_citation_is_estimates_only_not_no_source():
    summary = parameter_summary(lookup("measles"), "immunity_duration")
    assert summary["status"] == "estimates_only"
    assert summary["special_value"] == "lifelong"
    assert summary["source"].startswith("http")


def test_status_vocabulary_matches_the_coverage_script():
    """parameter_summary and scripts/param_coverage.py must not disagree."""
    import json
    from pathlib import Path

    import scripts.param_coverage as coverage
    from epichat.disease_db import load_db

    raw = json.loads(Path(coverage.DB).read_text(encoding="utf-8"))["diseases"]
    equivalent = {"ok": "ok", "review": "under_review",
                  "cites": "estimates_only", "-": "no_source"}
    for name, entry in load_db()["diseases"].items():
        blocks = coverage._blocks(raw[name])
        for param in coverage.PARAMS:
            state = coverage._state(blocks.get(param))
            summary = parameter_summary(entry, param)
            if summary is None:
                assert state == "-", f"{name}.{param}: coverage says {state}, tool says nothing"
            else:
                assert summary["status"] == equivalent[state], \
                    f"{name}.{param}: coverage says {state}, tool says {summary['status']}"


def test_estimate_extremes_carry_the_context_that_qualifies_the_bound():
    """Review Important 2: 3-350 contacts/day is only honest with provenance."""
    summary = parameter_summary(lookup("measles"), "average_contacts_daily")
    assert summary["estimate_range"] == [3, 350]
    low, high = summary["estimate_extremes"]
    assert low["value"] == 3 and high["value"] == 350
    assert "hospitalized" in high["population"].lower()
    assert high["source_type"] == "outbreak"
    assert high["title"], "the agent needs the study title to attribute the bound"


def test_estimate_extremes_collapse_when_one_estimate_is_both_bounds():
    summary = parameter_summary(lookup("rubella"), "fatality_rate")
    assert summary["n_estimates"] == 1
    assert len(summary["estimate_extremes"]) == 1, \
        "a single estimate must not be reported twice as its own low and high"


def test_unknown_parameter_returns_none():
    assert parameter_summary(lookup("measles"), "not_a_parameter") is None


def test_variant_disease_resolves_through_its_default_variant():
    summary = parameter_summary(lookup("covid19"), "r0")
    assert summary["status"] == "ok"
    assert isinstance(summary["typical"], (int, float))


def test_consensus_notes_are_surfaced():
    """Annie's notes explain why estimates disagree; the agent needs them."""
    summary = parameter_summary(lookup("hepatitis_a"), "r0")
    assert summary["status"] == "ok"
    assert summary.get("notes"), "consensus notes should reach the agent"


def test_under_review_parameter_does_not_break_configuration():
    """Review Focus 3: null consensus must not produce a bogus range check."""
    import json

    from epichat.agent import AgentState, build_tools

    state = AgentState()
    tool = next(t for t in build_tools(state) if t.name == "configure_simulation")
    out = json.loads(tool.call({"disease": "meningococcal", "disease_type": "seir",
                                "dur_inf": 14.0, "dur_exp": 3.5, "n_agents": 5000}))
    assert state.params is not None
    assert not any("infectious period" in w.lower() for w in out["warnings"]), \
        "a parameter with no consensus must not generate a range warning"
