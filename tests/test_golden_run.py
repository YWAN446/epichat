"""The golden-set runner: loading, scoring, and the report."""
import json

import pytest

from evals.golden.run import load_cases, score_case, write_report


def _case(**kwargs):
    base = {"id": "c1", "category": "uncertainty", "critical": False,
            "turns": ["hi"], "checks": {}}
    base.update(kwargs)
    return base


def test_cases_load_from_a_directory(tmp_path):
    (tmp_path / "a.yaml").write_text(
        "- id: a\n  category: uncertainty\n  turns: ['hi']\n  checks: {}\n",
        encoding="utf-8")
    cases = load_cases(tmp_path)
    assert [c["id"] for c in cases] == ["a"]
    assert cases[0]["critical"] is False


def test_duplicate_case_ids_are_rejected(tmp_path):
    (tmp_path / "a.yaml").write_text(
        "- id: a\n  category: x\n  turns: ['hi']\n  checks: {}\n"
        "- id: a\n  category: x\n  turns: ['ho']\n  checks: {}\n",
        encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate case id"):
        load_cases(tmp_path)


def test_a_critical_case_needs_every_repeat_to_pass():
    reps = [{"passed": True, "failures": []},
            {"passed": False, "failures": ["nope"]},
            {"passed": True, "failures": []}]
    assert score_case(_case(critical=True), reps)["passed"] is False
    assert score_case(_case(critical=False), reps)["pass_rate"] == pytest.approx(2 / 3)


def test_a_non_critical_case_passes_on_a_majority():
    reps = [{"passed": True, "failures": []}, {"passed": True, "failures": []},
            {"passed": False, "failures": ["nope"]}]
    assert score_case(_case(critical=False), reps)["passed"] is True


def test_report_flags_a_regression_against_the_baseline(tmp_path):
    scored = [{"id": "c1", "category": "uncertainty", "critical": False,
               "passed": False, "pass_rate": 0.0, "failures": ["broke"]}]
    path = write_report(tmp_path, scored, baseline={"c1": True}, usage={})
    text = path.read_text(encoding="utf-8")
    assert "Regression" in text and "c1" in text


def test_report_notes_a_newly_fixed_case(tmp_path):
    scored = [{"id": "c1", "category": "uncertainty", "critical": False,
               "passed": True, "pass_rate": 1.0, "failures": []}]
    text = write_report(tmp_path, scored, baseline={"c1": False},
                        usage={}).read_text(encoding="utf-8")
    assert "Newly passing" in text
