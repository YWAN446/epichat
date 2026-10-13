"""The committed golden cases: the sim-parameters cases are pending until the API harness exists (Part 1 spec 17, Part 2 spec 13)."""
import json

from evals.golden.run import BASELINE, CASES_DIR, load_cases, split_pending

PENDING = {"parameters-describe", "parameters-diagnostic-rerun", "parameters-school-closure", "parameters-why-so-many-infected"}


def test_the_parameter_cases_are_pending_for_the_api_harness():
    cases = load_cases(CASES_DIR)
    by_id = {c["id"]: c for c in cases}
    describe, rerun = by_id["parameters-describe"], by_id["parameters-diagnostic-rerun"]
    for case_id in PENDING:
        case = by_id[case_id]
        assert case["pending"] == "api-harness" and case["pending_note"] and case["category"] == "parameters", case_id
        assert case["turns"] and case["checks"]["judge"], case_id
    assert "describe_parameters" in describe["checks"]["tool_called"]
    assert describe["checks"]["config"] == {"disease": "measles", "country": "KEN"}
    assert rerun["real_sim"] is True and rerun["checks"]["ran_simulation"] is True
    # The fade-out is luck unless the seed is pinned; the harness author vets the seed (review finding).
    assert "random seed" in rerun["turns"][0] and "seed" in rerun["pending_note"]
    assert "early_fadeout" in rerun["checks"]["judge"][0]
    runnable, pending = split_pending(cases)
    assert {c["id"] for c in pending} == PENDING
    assert len(runnable) == len(cases) - len(PENDING)
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    assert not (PENDING & set(baseline))


def test_the_part_2_cases_cover_the_school_closure_and_the_hybrid_option():
    by_id = {c["id"]: c for c in load_cases(CASES_DIR)}
    closure = by_id["parameters-school-closure"]
    assert closure["real_sim"] is True and closure["checks"]["ran_simulation"] is True
    assert closure["checks"]["config"] == {"disease": "influenza", "network_type": "hybrid"}
    assert {"configure_simulation", "run_simulation"} <= set(closure["checks"]["tool_called"])
    assert any("school" in c and "contact_reduction" in c for c in closure["checks"]["judge"])
    assert any("illustrative" in c for c in closure["checks"]["judge"])
    why = by_id["parameters-why-so-many-infected"]
    assert why["real_sim"] is True and why["checks"]["ran_simulation"] is True
    assert "Why were so many infected" in why["turns"][-1]
    # 2D review: a country brings a fetch that switches the network to age-structured, where well_mixed never fires
    assert why["checks"]["config"] == {"disease": "measles", "network_type": "random"}
    assert not any("Kenya" in turn for turn in why["turns"])
    assert any("hybrid" in c for c in why["checks"]["judge"])
    assert any("not promise" in c.lower() for c in why["checks"]["judge"])
