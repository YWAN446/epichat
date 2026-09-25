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


def test_absent_parameter_reports_no_source_rather_than_vanishing():
    summary = parameter_summary(lookup("dengue"), "asymptomatic_fraction")
    assert summary is None or summary["status"] == "no_source"


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
