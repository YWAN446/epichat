"""The committed golden cases: the two sim-parameters cases are pending until the API harness exists (spec 17)."""
import json

from evals.golden.run import BASELINE, CASES_DIR, load_cases, split_pending


def test_the_parameter_cases_are_pending_for_the_api_harness():
    cases = load_cases(CASES_DIR)
    by_id = {c["id"]: c for c in cases}
    describe, rerun = by_id["parameters-describe"], by_id["parameters-diagnostic-rerun"]
    for case in (describe, rerun):
        assert case["pending"] == "api-harness" and case["pending_note"] and case["category"] == "parameters"
        assert case["turns"] and case["checks"]["judge"]
    assert "describe_parameters" in describe["checks"]["tool_called"]
    assert describe["checks"]["config"] == {"disease": "measles", "country": "KEN"}
    assert rerun["real_sim"] is True and rerun["checks"]["ran_simulation"] is True
    # The fade-out is luck unless the seed is pinned; the harness author vets the seed (review finding).
    assert "random seed" in rerun["turns"][0] and "seed" in rerun["pending_note"]
    assert "early_fadeout" in rerun["checks"]["judge"][0]
    runnable, pending = split_pending(cases)
    assert {c["id"] for c in pending} == {"parameters-describe", "parameters-diagnostic-rerun"}
    assert len(runnable) == len(cases) - 2
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    assert "parameters-describe" not in baseline and "parameters-diagnostic-rerun" not in baseline
