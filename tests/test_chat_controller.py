import pytest
from unittest.mock import MagicMock
from epichat.chat_controller import (
    build_summary,
    next_question,
    update_collected,
    detect_run_intent,
    detect_new_scenario,
)
from epichat.schema import SimParams, Intervention
from epichat.resolver import ResolvedField


def _make_rf(field, value, citation, description="", alternatives=None):
    return ResolvedField(
        field=field,
        value=value,
        citation=citation,
        description=description,
        alternatives=alternatives or [],
    )


# ── detect_run_intent ─────────────────────────────────────────────────────────

def test_detect_run_intent_yes():
    assert detect_run_intent("yes") is True

def test_detect_run_intent_run_it():
    assert detect_run_intent("run it") is True

def test_detect_run_intent_looks_good():
    assert detect_run_intent("looks good") is True

def test_detect_run_intent_go_ahead():
    assert detect_run_intent("go ahead") is True

def test_detect_run_intent_you_can_run():
    assert detect_run_intent("you can run") is True

def test_detect_run_intent_sounds_good():
    assert detect_run_intent("sounds good") is True

def test_detect_run_intent_go_for_it():
    assert detect_run_intent("go for it") is True

def test_detect_run_intent_please_run():
    assert detect_run_intent("please run") is True

def test_detect_run_intent_modification_not_run():
    assert detect_run_intent("change duration to 5 years") is False

def test_detect_run_intent_question_not_run():
    assert detect_run_intent("what is R0?") is False

def test_detect_run_intent_negation_not_run():
    assert detect_run_intent("don't run yet") is False


# ── detect_new_scenario ───────────────────────────────────────────────────────

def test_detect_new_scenario_now_simulate():
    assert detect_new_scenario("now simulate measles in Brazil") is True

def test_detect_new_scenario_now_model():
    assert detect_new_scenario("now model TB in India") is True

def test_detect_new_scenario_modification_not_new():
    assert detect_new_scenario("change duration to 5 years") is False

def test_detect_new_scenario_run_not_new():
    assert detect_new_scenario("yes, run it") is False


# ── update_collected ──────────────────────────────────────────────────────────

def _base_collected():
    return {"disease": False, "location": False, "population": False, "interventions": False}

def _base_params(**kwargs):
    defaults = dict(disease_type="sir", n_agents=10000, beta=0.5, dur_inf=10.0, p_death=0.0, sim_dur_years=1.0)
    defaults.update(kwargs)
    return SimParams(**defaults)


def test_update_collected_disease_from_nondefault_type():
    params = _base_params(disease_type="sis")
    result = update_collected(_base_collected(), params, [], "HIV in Kenya")
    assert result["disease"] is True

def test_update_collected_disease_from_indicator_field():
    params = _base_params(disease_type="sir")
    ds = [_make_rf("hiv_prevalence", 3.0, "WB WDI, KEN, 2024")]
    result = update_collected(_base_collected(), params, ds, "some message")
    assert result["disease"] is True

def test_update_collected_location_from_population_field():
    params = _base_params()
    ds = [_make_rf("total_population", 58_636_412, "UN WPP 2024, Kenya (KEN), 2026")]
    result = update_collected(_base_collected(), params, ds, "Kenya")
    assert result["location"] is True

def test_update_collected_population_from_location():
    params = _base_params()
    ds = [_make_rf("total_population", 58_636_412, "UN WPP 2024, Kenya (KEN), 2026")]
    collected = _base_collected()
    collected["location"] = True
    result = update_collected(collected, params, ds, "Kenya")
    assert result["population"] is True

def test_update_collected_population_from_explicit_number():
    params = _base_params()
    result = update_collected(_base_collected(), params, [], "100000 people")
    assert result["population"] is True

def test_update_collected_interventions_from_skip_word():
    params = _base_params()
    collected = _base_collected()
    collected.update({"disease": True, "location": True, "population": True})
    result = update_collected(collected, params, [], "none")
    assert result["interventions"] is True

def test_update_collected_interventions_from_params():
    iv = Intervention(type="vaccine", coverage=0.7, start_day=0)
    params = _base_params(interventions=[iv])
    collected = _base_collected()
    collected.update({"disease": True, "location": True, "population": True})
    result = update_collected(collected, params, [], "70% vaccination")
    assert result["interventions"] is True

def test_update_collected_interventions_not_set_prematurely():
    params = _base_params()
    result = update_collected(_base_collected(), params, [], "none")
    assert result["interventions"] is False

def test_update_collected_interventions_not_set_from_params_when_prereqs_missing():
    # Even if params has interventions, don't set flag until disease/location/population are True
    iv = Intervention(type="vaccine", coverage=0.7, start_day=0)
    params = _base_params(interventions=[iv])
    # Only disease is collected, not location or population
    collected = _base_collected()
    collected["disease"] = True
    result = update_collected(collected, params, [], "some message")
    assert result["interventions"] is False

def test_update_collected_returns_unchanged_when_params_none():
    collected = _base_collected()
    result = update_collected(collected, None, [], "HIV in Kenya")
    assert result == collected


# ── next_question ─────────────────────────────────────────────────────────────

def test_next_question_asks_disease_first():
    params = _base_params()
    q = next_question(_base_collected(), params, [])
    assert "disease" in q.lower() or "pathogen" in q.lower()

def test_next_question_asks_location_after_disease():
    params = _base_params()
    collected = _base_collected()
    collected["disease"] = True
    q = next_question(collected, params, [])
    assert "country" in q.lower() or "region" in q.lower()

def test_next_question_asks_population_after_location():
    params = _base_params()
    collected = _base_collected()
    collected.update({"disease": True, "location": True})
    q = next_question(collected, params, [])
    assert "population" in q.lower()

def test_next_question_mentions_real_population_when_known():
    params = _base_params()
    collected = _base_collected()
    collected.update({"disease": True, "location": True})
    ds = [_make_rf("total_population", 58_636_412, "UN WPP 2024, Kenya (KEN), 2026")]
    q = next_question(collected, params, ds)
    assert "58.6" in q

def test_next_question_asks_interventions_last():
    params = _base_params()
    collected = _base_collected()
    collected.update({"disease": True, "location": True, "population": True})
    q = next_question(collected, params, [])
    assert "intervention" in q.lower()

def test_next_question_returns_none_when_all_collected():
    params = _base_params()
    collected = {k: True for k in _base_collected()}
    assert next_question(collected, params, []) is None


# ── build_summary ─────────────────────────────────────────────────────────────

def test_build_summary_contains_disease_and_duration():
    params = _base_params(disease_type="sis", sim_dur_years=10.0)
    summary = build_summary(params, [])
    assert "SIS" in summary
    assert "10-year" in summary

def test_build_summary_contains_r0_and_mortality():
    params = _base_params(disease_type="sir", n_contacts=4, beta=0.5, dur_inf=10.0)
    summary = build_summary(params, [])
    assert "R₀" in summary
    assert "Mortality" in summary

def test_build_summary_contains_footnote_for_un_wpp():
    params = _base_params()
    ds = [_make_rf("total_population", 58_636_412, "UN WPP 2024, Kenya (KEN), 2026")]
    summary = build_summary(params, ds)
    assert "UN WPP" in summary
    assert "data.un.org" in summary

def test_build_summary_contains_footnote_for_wb_wdi():
    params = _base_params()
    ds = [_make_rf("hiv_prevalence", 3.0, "WB WDI, KEN, 2024")]
    summary = build_summary(params, ds)
    assert "WB WDI" in summary
    assert "datatopics.worldbank.org" in summary

def test_build_summary_star_marker_and_alternatives():
    params = _base_params()
    alt = _make_rf("hiv_prevalence", 0.37, "WB WDI, KEN, 2024", "per 1,000 uninfected/yr")
    ds = [_make_rf("hiv_prevalence", 3.0, "WB WDI, KEN, 2024", alternatives=[alt])]
    summary = build_summary(params, ds)
    assert "★" in summary
    assert "↳" in summary

def test_build_summary_ends_with_question():
    params = _base_params()
    summary = build_summary(params, [])
    assert summary.strip().endswith("?")
