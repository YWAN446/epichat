"""The committed golden cases: the sim-parameters cases are pending until the API harness exists (Part 1 spec 17, Part 2 spec 13)."""
import json

from evals.golden.run import BASELINE, CASES_DIR, load_cases, split_pending

PENDING = {"parameters-describe", "parameters-diagnostic-rerun", "parameters-school-closure", "parameters-why-so-many-infected",
           "parameters-known-attack-rate", "parameters-offer-intervention"}


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
    # 2D review: a country brings a fetch that switches the network to age-structured; the case pins the random network
    assert why["checks"]["config"] == {"disease": "measles", "network_type": "random"}
    assert not any("Kenya" in turn for turn in why["turns"])
    assert any("hybrid" in c for c in why["checks"]["judge"])
    assert any("not promise" in c.lower() for c in why["checks"]["judge"])
    # follow-up spec 7.6: the answer is no longer the random network; the limits on spread come first
    assert any("variation" in c and "behaviour response" in c and "illustrative" in c for c in why["checks"]["judge"])
    assert not any("on the random network everyone meets fresh contacts" in c for c in why["checks"]["judge"])


def test_the_follow_up_cases_cover_the_fit_that_keeps_r0_and_the_offer_of_an_intervention():
    by_id = {c["id"]: c for c in load_cases(CASES_DIR)}
    known = by_id["parameters-known-attack-rate"]
    assert known["real_sim"] is True and known["checks"]["ran_simulation"] is True
    assert {"configure_simulation", "run_simulation"} <= set(known["checks"]["tool_called"])
    assert any("disease.rel_sus_cv" in c and "not beta" in c for c in known["checks"]["judge"])
    assert any("R0" in c and ("stays" in c or "unchanged" in c) for c in known["checks"]["judge"])
    assert any("illustrative" in c for c in known["checks"]["judge"])
    offer = by_id["parameters-offer-intervention"]
    assert offer["real_sim"] is True and offer["checks"]["config"] == {"disease": "influenza", "network_type": "hybrid"}
    assert any("what_if" in c for c in offer["checks"]["judge"]) and any("illustrative" in c for c in offer["checks"]["judge"])
    assert "warning" in offer["pending_note"]


def test_the_readme_counts_the_pending_cases():
    readme = (CASES_DIR.parent.parent / "README.md").read_text(encoding="utf-8")
    assert "today the six\nsim-parameters cases" in readme.replace("\r\n", "\n")
