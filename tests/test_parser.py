"""
Automated accuracy test for the parameter extraction pipeline.

Usage:
    pytest tests/test_parser.py -v                  # run all
    pytest tests/test_parser.py -k simple -v        # only simple queries
    pytest tests/test_parser.py --tb=short          # compact output

Requires ANTHROPIC_API_KEY in environment or .env file.
Each test makes a real API call — set EPICHAT_TEST_LIVE=1 to enable.
"""

import json
import os
from pathlib import Path

import pytest

# Skip all live tests unless explicitly enabled
LIVE = os.environ.get("EPICHAT_TEST_LIVE", "0") == "1"
pytestmark = pytest.mark.skipif(not LIVE, reason="Set EPICHAT_TEST_LIVE=1 to run live API tests")

from epichat.parser import parse_query
from epichat.schema import SimParams

QUERIES_PATH = Path(__file__).parent / "test_queries.json"
QUERIES = json.loads(QUERIES_PATH.read_text())


def _within(value: float, lo: float, hi: float) -> bool:
    return lo <= value <= hi


def _check_params(result: SimParams, expected: dict) -> list[str]:
    """Return a list of failure messages (empty = pass)."""
    failures = []

    if "disease_type" in expected and result.disease_type != expected["disease_type"]:
        failures.append(f"disease_type: got {result.disease_type!r}, want {expected['disease_type']!r}")

    if "n_agents" in expected and result.n_agents != expected["n_agents"]:
        # Allow ±5% tolerance for population size
        tol = expected["n_agents"] * 0.05
        if abs(result.n_agents - expected["n_agents"]) > tol:
            failures.append(f"n_agents: got {result.n_agents}, want {expected['n_agents']}")

    for key in ("beta_range", "init_prev_range", "dur_inf_range", "dur_exp_range", "p_death_range"):
        if key in expected:
            attr = key.replace("_range", "")
            val = getattr(result, attr, None)
            lo, hi = expected[key]
            if val is None or not _within(val, lo, hi):
                failures.append(f"{attr}: got {val}, want [{lo}, {hi}]")

    if "sim_dur_years" in expected:
        if abs(result.sim_dur_years - expected["sim_dur_years"]) > 0.1:
            failures.append(f"sim_dur_years: got {result.sim_dur_years}, want {expected['sim_dur_years']}")

    if "sim_dur_years_max" in expected:
        if result.sim_dur_years > expected["sim_dur_years_max"]:
            failures.append(f"sim_dur_years: got {result.sim_dur_years}, want ≤ {expected['sim_dur_years_max']}")

    if "sim_dur_years_range" in expected:
        lo, hi = expected["sim_dur_years_range"]
        if not _within(result.sim_dur_years, lo, hi):
            failures.append(f"sim_dur_years: got {result.sim_dur_years}, want [{lo}, {hi}]")

    if "interventions" in expected:
        for exp_interv in expected["interventions"]:
            matching = [i for i in result.interventions if i.type == exp_interv["type"]]
            if not matching:
                failures.append(f"Missing intervention of type {exp_interv['type']!r}")
                continue
            i = matching[0]
            if "coverage_range" in exp_interv:
                lo, hi = exp_interv["coverage_range"]
                if not _within(i.coverage, lo, hi):
                    failures.append(f"Intervention {i.type} coverage: got {i.coverage}, want [{lo}, {hi}]")
            if "start_day_range" in exp_interv:
                lo, hi = exp_interv["start_day_range"]
                if not _within(i.start_day, lo, hi):
                    failures.append(f"Intervention {i.type} start_day: got {i.start_day}, want [{lo}, {hi}]")

    return failures


# Parametrize over all queries
@pytest.mark.parametrize(
    "entry",
    QUERIES,
    ids=[q["id"] for q in QUERIES],
)
def test_parse_query(entry):
    query = entry["query"]
    expected = entry["expected_params"]

    result = parse_query(query)
    failures = _check_params(result, expected)

    assert not failures, (
        f"Query [{entry['id']}] '{query}'\nFailures:\n" + "\n".join(f"  - {f}" for f in failures)
    )


def test_accuracy_summary(capsys):
    """Print an accuracy summary table across all query difficulties."""
    results = {"simple": [], "medium": [], "complex": []}

    for entry in QUERIES:
        try:
            result = parse_query(entry["query"])
            failures = _check_params(result, entry["expected_params"])
            passed = len(failures) == 0
        except Exception:
            passed = False

        results[entry["difficulty"]].append(passed)

    print("\nAccuracy Summary")
    print("=" * 40)
    total_pass = total_all = 0
    for diff, scores in results.items():
        n = len(scores)
        p = sum(scores)
        total_pass += p
        total_all += n
        pct = p / n * 100 if n else 0
        print(f"  {diff.capitalize():8s}: {p}/{n}  ({pct:.0f}%)")
    overall = total_pass / total_all * 100 if total_all else 0
    print(f"  {'Overall':8s}: {total_pass}/{total_all}  ({overall:.0f}%)")
    print("=" * 40)
    print(f"Target: ≥80% on simple/medium queries")
