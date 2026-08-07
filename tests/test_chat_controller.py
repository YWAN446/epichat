import pytest
from unittest.mock import MagicMock
from epichat.chat_controller import (
    build_summary,
    next_question,
    update_collected,
    detect_run_intent,
    detect_new_scenario,
)
from epichat.schema import SimParams, Intervention, OutbreakContext
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

def test_update_collected_disease_from_nonzero_p_death():
    # "COVID with seasonality" → disease_type=sir but p_death=0.01 (COVID default)
    params = _base_params(disease_type="sir", p_death=0.01, dur_inf=8.0, n_contacts=6)
    result = update_collected(_base_collected(), params, [], "COVID with seasonality")
    assert result["disease"] is True

def test_update_collected_disease_from_interventions():
    # Seasonality intervention alone should flag disease as collected
    from epichat.schema import Intervention
    iv = Intervention(type="seasonality", scale=0.3, shift=0.0)
    params = _base_params(disease_type="sir", interventions=[iv])
    result = update_collected(_base_collected(), params, [], "flu with seasonality")
    assert result["disease"] is True

def test_update_collected_disease_from_nondefault_dur_inf():
    params = _base_params(disease_type="sir", dur_inf=5.0, n_contacts=6)  # flu-like
    result = update_collected(_base_collected(), params, [], "simulate flu")
    assert result["disease"] is True

def test_update_collected_disease_not_set_for_pure_generic_sir():
    # "Run a default SIR model" → all defaults → disease should still need clarification
    params = _base_params(disease_type="sir", p_death=0.0, dur_inf=10.0, n_contacts=4)
    result = update_collected(_base_collected(), params, [], "run a default SIR model")
    assert result["disease"] is False

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

def test_build_summary_cases_field_shows_count_not_percent():
    params = _base_params(init_prev=0.000082)
    ds = [_make_rf("measles_cases", 227, "WHO GHO, ESP, 2023")]
    summary = build_summary(params, ds)
    assert "Cases (annual):" in summary
    assert "227" in summary
    assert "227%" not in summary
    assert "Initial prevalence" in summary

def test_build_summary_incidence_field_shows_rate_and_units():
    params = _base_params(init_prev=0.0003)
    ds = [_make_rf("tb_incidence", 14.2, "WB WDI, KEN, 2024", "per 100,000/yr")]
    summary = build_summary(params, ds)
    assert "Incidence:" in summary
    assert "per 100,000/yr" in summary
    assert "14.2%" not in summary
    assert "Initial prevalence" in summary

def test_build_summary_prevalence_field_shows_percent():
    params = _base_params(init_prev=0.03)
    ds = [_make_rf("hiv_prevalence", 3.0, "WB WDI, KEN, 2024")]
    summary = build_summary(params, ds)
    assert "Prevalence:** 3.0%" in summary
    assert "3.0%%" not in summary

def test_build_summary_ends_with_question():
    params = _base_params()
    summary = build_summary(params, [])
    assert summary.strip().endswith("?")

def test_build_summary_vaccine_cites_coverage_source():
    iv = Intervention(type="vaccine", coverage=0.76, start_day=0)
    params = _base_params(interventions=[iv])
    ds = [_make_rf("mcv1_coverage", 76.0, "WHO GHO, ZAF, 2023")]
    summary = build_summary(params, ds)
    assert "76% coverage" in summary
    assert "[WHO GHO]" in summary

def test_build_summary_vaccine_matches_coverage_value():
    """When two coverage fields exist, each vaccine line cites the matching one."""
    iv1 = Intervention(type="vaccine", coverage=0.76, start_day=0)
    iv2 = Intervention(type="vaccine", coverage=0.82, start_day=0)
    params = _base_params(interventions=[iv1, iv2])
    ds = [
        _make_rf("mcv1_coverage", 76.0, "WHO GHO, ZAF, 2023"),
        _make_rf("mcv2_coverage", 82.0, "WHO GHO, ZAF, 2023"),
    ]
    summary = build_summary(params, ds)
    assert "76% coverage [WHO GHO]" in summary
    assert "82% coverage [WHO GHO]" in summary

def test_build_summary_treatment_cites_uhc_coverage():
    iv = Intervention(type="treatment", coverage=1.0, start_day=0)
    params = _base_params(interventions=[iv])
    ds = [_make_rf("uhc_coverage", 68.0, "WB WDI, ZAF, 2023")]
    summary = build_summary(params, ds)
    assert "Treatment" in summary
    assert "[WB WDI]" in summary

def test_build_summary_vaccine_no_citation_when_no_coverage_source():
    iv = Intervention(type="vaccine", coverage=0.70, start_day=0)
    params = _base_params(interventions=[iv])
    summary = build_summary(params, [])
    assert "70% coverage" in summary
    assert "[" not in summary.split("Vaccination")[1].split("\n")[0]

def test_build_summary_age_structured_network_shows_percentages():
    params = _base_params(
        network_type="age_structured",
        age_pct_under18=40.0,
        age_pct_18_64=52.0,
        age_pct_over65=8.0,
    )
    ds = [_make_rf("age_distribution_pct", {"0-17": 40.0, "18-64": 52.0, "65+": 8.0},
                   "UN WPP 2024, Kenya (KEN), 2026")]
    summary = build_summary(params, ds)
    assert "40%" in summary
    assert "52%" in summary
    assert "8%" in summary
    assert "[UN WPP]" in summary

def test_build_summary_age_structured_network_without_data_source():
    params = _base_params(
        network_type="age_structured",
        age_pct_under18=30.0,
        age_pct_18_64=60.0,
        age_pct_over65=10.0,
    )
    summary = build_summary(params, [])
    assert "Age-structured" in summary
    assert "30%" in summary

def test_build_summary_demographics_with_citation():
    params = _base_params(use_demographics=True, birth_rate=35.2, death_rate=7.1)
    ds = [
        _make_rf("birth_rate", 35.2, "UN WPP 2024, Kenya (KEN), 2026"),
        _make_rf("death_rate", 7.1, "UN WPP 2024, Kenya (KEN), 2026"),
    ]
    summary = build_summary(params, ds)
    assert "35.2" in summary
    assert "7.1" in summary
    assert "[UN WPP]" in summary

def test_build_summary_demographics_without_citation():
    params = _base_params(use_demographics=True, birth_rate=20.0, death_rate=10.0)
    summary = build_summary(params, [])
    assert "Demographics" in summary
    assert "20.0" in summary


# ── update_collected with OutbreakContext pre-fill ────────────────────────────

def test_update_collected_prefills_disease_from_context():
    collected = {"disease": False, "location": False, "population": False, "interventions": False}
    ctx = OutbreakContext(input_type="report", disease_name="Ebola")
    result = update_collected(collected, None, [], "", outbreak_context=ctx)
    assert result["disease"] is True
    assert result["location"] is False


def test_update_collected_prefills_location_and_population_from_context():
    collected = {"disease": False, "location": False, "population": False, "interventions": False}
    ctx = OutbreakContext(input_type="url", location="Nigeria")
    result = update_collected(collected, None, [], "", outbreak_context=ctx)
    assert result["location"] is True
    assert result["population"] is True


def test_update_collected_prefills_interventions_from_context():
    collected = {"disease": False, "location": False, "population": False, "interventions": False}
    ctx = OutbreakContext(
        input_type="report",
        disease_name="Mpox",
        location="DRC",
        interventions_mentioned=["ring vaccination"],
    )
    result = update_collected(collected, None, [], "", outbreak_context=ctx)
    assert result["interventions"] is True


def test_update_collected_interventions_not_prefilled_without_prerequisites():
    """interventions_mentioned in context should not pre-fill when disease/location are absent."""
    collected = {"disease": False, "location": False, "population": False, "interventions": False}
    ctx = OutbreakContext(
        input_type="report",
        interventions_mentioned=["ring vaccination"],
        # no disease_name, no location
    )
    result = update_collected(collected, None, [], "", outbreak_context=ctx)
    assert result["interventions"] is False


def test_update_collected_all_null_context_does_not_prefill():
    """OutbreakContext with all None fields should not pre-fill anything."""
    collected = {"disease": False, "location": False, "population": False, "interventions": False}
    ctx = OutbreakContext(input_type="query")  # all fields null
    result = update_collected(collected, None, [], "", outbreak_context=ctx)
    assert result == collected


def test_update_collected_prefill_enables_interventions_gate():
    """Pre-filled disease/location/population from context unlock the interventions gate."""
    from epichat.schema import Intervention
    # Build a params with an intervention
    params = _base_params(
        beta=22.8125,
        disease_type="sir",
        interventions=[Intervention(type="vaccine", coverage=0.7, start_day=0)],
    )
    ctx = OutbreakContext(input_type="report", disease_name="Ebola", location="DRC")
    collected = {"disease": False, "location": False, "population": False, "interventions": False}
    result = update_collected(collected, params, [], "", outbreak_context=ctx)
    assert result["disease"] is True
    assert result["location"] is True
    assert result["population"] is True
    assert result["interventions"] is True


# ── Staged-pipeline formatting ────────────────────────────────────────────────

def _dq(**kw):
    from epichat.resolver import DataQuery
    return DataQuery(**{"source": "wb_data360", **kw})


def _rf(field="total_population", value=213_600_000, citation="UN WPP 2024"):
    from epichat.resolver import ResolvedField
    return ResolvedField(field=field, value=value, citation=citation)


class TestDescribeQuery:
    def test_known_sources_get_friendly_names(self):
        from epichat.chat_controller import describe_query
        assert "World Bank" in describe_query(_dq(location_code="BRA"))
        assert "UN WPP" in describe_query(_dq(source="un_wpp", location_id=76))
        assert "WHO" in describe_query(_dq(source="who_gho", location_code="BRA"))

    def test_includes_target_location(self):
        from epichat.chat_controller import describe_query
        assert "BRA" in describe_query(_dq(location_code="BRA"))

    def test_unknown_source_falls_back_to_raw_name(self):
        from epichat.chat_controller import describe_query
        assert "mystery" in describe_query(_dq(source="mystery"))


class TestUnderstandingCard:
    def test_card_lists_settings_and_fetch_plan(self):
        from epichat.chat_controller import format_understanding_card
        from epichat.schema import SimParams
        params = SimParams(beta=1.0, disease_type="seir", n_agents=100_000, dur_exp=5.0, sim_dur_years=1.0)
        card = format_understanding_card(
            params, [_dq(location_code="BRA")], disease_name="dengue",
        )
        assert "dengue" in card.lower()
        assert "SEIR" in card
        assert "100,000" in card
        assert "World Bank" in card          # fetch plan present
        assert "fetch the data" in card      # confirmation ask present

    def test_card_without_queries_omits_fetch_plan(self):
        from epichat.chat_controller import format_understanding_card
        from epichat.schema import SimParams
        card = format_understanding_card(SimParams(beta=1.0), [])
        assert "plan to fetch" not in card


class TestToolLines:
    def test_result_line_has_source_values_citation(self):
        from epichat.chat_controller import format_tool_result
        line = format_tool_result(
            _dq(source="un_wpp", location_id=76), [_rf()],
        )
        assert line.startswith("🔧")
        assert "UN WPP" in line
        assert "213,600,000" in line

    def test_empty_fields_marked_as_no_data(self):
        from epichat.chat_controller import format_tool_result
        line = format_tool_result(_dq(location_code="BRA"), [])
        assert line.startswith("⚠")

    def test_failure_line(self):
        from epichat.chat_controller import format_tool_failure
        line = format_tool_failure(_dq(location_code="BRA"), "timed out")
        assert line.startswith("⚠") and "timed out" in line


class TestFormatDataSources:
    def test_lists_each_parameter_with_value_and_citation(self):
        from epichat.chat_controller import format_data_sources
        fields = [
            _rf(field="total_population", value=213_562_666,
                citation="UN WPP 2024, Brazil (BRA), 2024"),
            _rf(field="treatment_capacity", value=2.52,
                citation="WB WDI 2021, hospital beds/1,000"),
        ]
        block = format_data_sources(fields)
        assert "Data sources used" in block
        assert "total population" in block
        assert "213,562,666" in block
        assert "UN WPP 2024, Brazil (BRA), 2024" in block
        assert "treatment capacity" in block
        assert "WB WDI 2021" in block

    def test_includes_offline_demographics_source(self):
        from epichat.chat_controller import format_data_sources
        from epichat.schema import SimParams
        params = SimParams(beta=1.0, demographics_source="UN WPP 2024 — KEN (2022)")
        block = format_data_sources([], params=params)
        assert "UN WPP 2024 — KEN (2022)" in block

    def test_includes_disease_db_r0_source(self):
        from epichat.chat_controller import format_data_sources
        block = format_data_sources([], disease_name="measles")
        assert block is not None
        assert "measles" in block
        assert "http" in block  # the R0 literature source URL

    def test_returns_none_when_nothing_to_attribute(self):
        from epichat.chat_controller import format_data_sources
        assert format_data_sources([]) is None
