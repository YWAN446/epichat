import json
from unittest.mock import patch

from epichat.adapters.wb_data360 import (
    WorldBankData360Adapter,
    INDICATOR_MAP,
    CANDIDATE_GROUPS,
    INCIDENCE_SCALE,
)
from epichat.resolver import DataQuery


_BEDS_RESPONSE = json.dumps({
    "count": 2,
    "value": [
        {"OBS_VALUE": "2.3", "TIME_PERIOD": "2021", "REF_AREA": "KEN"},
        {"OBS_VALUE": "2.1", "TIME_PERIOD": "2020", "REF_AREA": "KEN"},
    ],
})

_PHYSICIANS_RESPONSE = json.dumps({
    "count": 1,
    "value": [
        {"OBS_VALUE": "0.2", "TIME_PERIOD": "2021", "REF_AREA": "KEN"},
    ],
})

_NURSES_RESPONSE = json.dumps({
    "count": 1,
    "value": [
        {"OBS_VALUE": "1.1", "TIME_PERIOD": "2021", "REF_AREA": "KEN"},
    ],
})

_UHC_RESPONSE = json.dumps({
    "count": 1,
    "value": [
        {"OBS_VALUE": "56.0", "TIME_PERIOD": "2022", "REF_AREA": "KEN"},
    ],
})

_TB_RESPONSE = json.dumps({
    "count": 1,
    "value": [
        {"OBS_VALUE": "245.0", "TIME_PERIOD": "2022", "REF_AREA": "KEN"},
    ],
})

_HIV_PREV_RESPONSE = json.dumps({
    "count": 1,
    "value": [
        {"OBS_VALUE": "6.3", "TIME_PERIOD": "2020", "REF_AREA": "KEN"},
    ],
})

_HIV_INC_RESPONSE = json.dumps({
    "count": 1,
    "value": [
        {"OBS_VALUE": "0.4", "TIME_PERIOD": "2020", "REF_AREA": "KEN"},
    ],
})

_EMPTY_RESPONSE = json.dumps({"count": 0, "value": []})


def _make_adapter():
    return WorldBankData360Adapter()


def _make_query(**kwargs):
    defaults = dict(
        source="wb_data360",
        database_id="WB_WDI",
        indicator_codes=["WB_WDI_SH_MED_BEDS_ZS"],
        location_code="KEN",
        start_year=2018,
        end_year=2024,
    )
    defaults.update(kwargs)
    return DataQuery(**defaults)


def _mock_fetch(responses: dict[str, str]):
    """Return side_effect that maps URL substrings to response bodies."""
    def side_effect(url):
        for key, body in responses.items():
            if key in url:
                return body
        return _EMPTY_RESPONSE
    return side_effect


# ── source_name ───────────────────────────────────────────────────────────────

def test_source_name():
    assert WorldBankData360Adapter.source_name == "wb_data360"


# ── INDICATOR_MAP ─────────────────────────────────────────────────────────────

def test_indicator_map_health_system_keys():
    assert "WB_WDI_SH_MED_BEDS_ZS" in INDICATOR_MAP
    assert "WB_WDI_SH_MED_PHYS_ZS" in INDICATOR_MAP
    assert "WB_WDI_SH_MED_NUMW_P3" in INDICATOR_MAP
    assert "WB_WDI_SH_UHC_SRVS_CV_XD" in INDICATOR_MAP


def test_indicator_map_disease_keys():
    assert "WB_WDI_SH_TBS_INCD" in INDICATOR_MAP
    assert "WB_WDI_SH_DYN_AIDS_ZS" in INDICATOR_MAP
    assert "WB_WDI_SH_HIV_INCD_TL_P3" in INDICATOR_MAP
    assert "WB_WDI_SH_MLR_INCD_P3" in INDICATOR_MAP
    assert "WB_WDI_SH_STA_DIAB_ZS" in INDICATOR_MAP
    assert "WB_WDI_SH_HEP_HBVS_ZS" in INDICATOR_MAP


def test_indicator_map_demographics_keys():
    assert "WB_WDI_SP_DYN_CBRT_IN" in INDICATOR_MAP
    assert "WB_WDI_SP_DYN_CDRT_IN" in INDICATOR_MAP
    assert "WB_WDI_SP_POP_TOTL" in INDICATOR_MAP
    assert "WB_WDI_SP_POP_0014_TO_ZS" in INDICATOR_MAP
    assert "WB_WDI_SP_POP_65UP_TO_ZS" in INDICATOR_MAP


def test_indicator_map_values_are_tuples_of_field_and_description():
    field_name, description = INDICATOR_MAP["WB_WDI_SH_MED_BEDS_ZS"]
    assert field_name == "treatment_capacity"
    assert description == "hospital beds/1,000"


# ── CANDIDATE_GROUPS ──────────────────────────────────────────────────────────

def test_candidate_groups_treatment_capacity_primary_is_beds():
    assert CANDIDATE_GROUPS["treatment_capacity"]["primary"] == "WB_WDI_SH_MED_BEDS_ZS"


def test_candidate_groups_treatment_capacity_alternatives():
    alts = CANDIDATE_GROUPS["treatment_capacity"]["alternatives"]
    assert "WB_WDI_SH_MED_PHYS_ZS" in alts
    assert "WB_WDI_SH_MED_NUMW_P3" in alts


def test_candidate_groups_hiv_prevalence_primary():
    assert CANDIDATE_GROUPS["hiv_prevalence"]["primary"] == "WB_WDI_SH_DYN_AIDS_ZS"


# ── INCIDENCE_SCALE ───────────────────────────────────────────────────────────

def test_incidence_scale_contains_all_disease_fields():
    assert "tb_incidence" in INCIDENCE_SCALE
    assert "malaria_incidence" in INCIDENCE_SCALE
    assert "hiv_prevalence" in INCIDENCE_SCALE
    assert "diabetes_prevalence" in INCIDENCE_SCALE
    assert "hepb_prevalence" in INCIDENCE_SCALE


def test_incidence_scale_tb_is_per_100k():
    assert INCIDENCE_SCALE["tb_incidence"] == 100_000


def test_incidence_scale_malaria_is_per_1k():
    assert INCIDENCE_SCALE["malaria_incidence"] == 1_000


def test_incidence_scale_prevalence_fields_are_percent():
    assert INCIDENCE_SCALE["hiv_prevalence"] == 100
    assert INCIDENCE_SCALE["diabetes_prevalence"] == 100
    assert INCIDENCE_SCALE["hepb_prevalence"] == 100


# ── fetch — basic ─────────────────────────────────────────────────────────────

def test_fetch_returns_most_recent_year():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WB_WDI_SH_MED_BEDS_ZS"])
    with patch("epichat.adapters.wb_data360._fetch_text",
               side_effect=_mock_fetch({"SH_MED_BEDS_ZS": _BEDS_RESPONSE})):
        results = adapter.fetch(query)
    assert len(results) == 1
    assert results[0].field == "treatment_capacity"
    assert results[0].value == 2.3   # 2021 wins over 2020


def test_fetch_citation_format():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WB_WDI_SH_MED_BEDS_ZS"])
    with patch("epichat.adapters.wb_data360._fetch_text",
               side_effect=_mock_fetch({"SH_MED_BEDS_ZS": _BEDS_RESPONSE})):
        results = adapter.fetch(query)
    assert results[0].citation == "WB WDI, KEN, 2021"


def test_fetch_description_populated():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WB_WDI_SH_MED_BEDS_ZS"])
    with patch("epichat.adapters.wb_data360._fetch_text",
               side_effect=_mock_fetch({"SH_MED_BEDS_ZS": _BEDS_RESPONSE})):
        results = adapter.fetch(query)
    assert results[0].description == "hospital beds/1,000"


def test_fetch_empty_response_returns_empty():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WB_WDI_SH_MED_BEDS_ZS"])
    with patch("epichat.adapters.wb_data360._fetch_text", return_value=_EMPTY_RESPONSE):
        results = adapter.fetch(query)
    assert results == []


def test_fetch_http_error_returns_empty():
    import urllib.error
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WB_WDI_SH_MED_BEDS_ZS"])
    with patch("epichat.adapters.wb_data360._fetch_text",
               side_effect=urllib.error.URLError("timeout")):
        results = adapter.fetch(query)
    assert results == []


def test_fetch_unknown_indicator_code_skipped():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WB_WDI_UNKNOWN_CODE"])
    with patch("epichat.adapters.wb_data360._fetch_text", return_value=_BEDS_RESPONSE):
        results = adapter.fetch(query)
    assert results == []


def test_fetch_obs_value_null_string_skipped():
    """API may return OBS_VALUE='null' string (not JSON null); must not crash."""
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WB_WDI_SH_MED_BEDS_ZS"])
    null_string_response = json.dumps({
        "count": 1,
        "value": [{"OBS_VALUE": "null", "TIME_PERIOD": "2021", "REF_AREA": "KEN"}],
    })
    with patch("epichat.adapters.wb_data360._fetch_text", return_value=null_string_response):
        results = adapter.fetch(query)
    assert results == []


# ── fetch — candidate grouping ────────────────────────────────────────────────

def test_fetch_candidate_grouping_returns_primary_with_alternatives():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=[
        "WB_WDI_SH_MED_BEDS_ZS",
        "WB_WDI_SH_MED_PHYS_ZS",
        "WB_WDI_SH_MED_NUMW_P3",
    ])
    with patch("epichat.adapters.wb_data360._fetch_text", side_effect=_mock_fetch({
        "SH_MED_BEDS_ZS": _BEDS_RESPONSE,
        "SH_MED_PHYS_ZS": _PHYSICIANS_RESPONSE,
        "SH_MED_NUMW_P3": _NURSES_RESPONSE,
    })):
        results = adapter.fetch(query)
    capacity = next((r for r in results if r.field == "treatment_capacity"), None)
    assert capacity is not None
    assert capacity.value == 2.3
    assert len(capacity.alternatives) == 2
    alt_values = {a.value for a in capacity.alternatives}
    assert 0.2 in alt_values
    assert 1.1 in alt_values


def test_fetch_candidate_primary_only_when_no_alternatives_fetched():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WB_WDI_SH_MED_BEDS_ZS"])
    with patch("epichat.adapters.wb_data360._fetch_text",
               side_effect=_mock_fetch({"SH_MED_BEDS_ZS": _BEDS_RESPONSE})):
        results = adapter.fetch(query)
    assert results[0].alternatives == []


def test_fetch_hiv_grouping_primary_and_alternative():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WB_WDI_SH_DYN_AIDS_ZS", "WB_WDI_SH_HIV_INCD_TL_P3"])
    with patch("epichat.adapters.wb_data360._fetch_text", side_effect=_mock_fetch({
        "SH_DYN_AIDS_ZS": _HIV_PREV_RESPONSE,
        "SH_HIV_INCD_TL_P3": _HIV_INC_RESPONSE,
    })):
        results = adapter.fetch(query)
    hiv = next((r for r in results if r.field == "hiv_prevalence"), None)
    assert hiv is not None
    assert hiv.value == 6.3
    assert len(hiv.alternatives) == 1
    assert hiv.alternatives[0].value == 0.4


def test_fetch_single_candidate_no_alternatives():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WB_WDI_SH_TBS_INCD"])
    with patch("epichat.adapters.wb_data360._fetch_text",
               side_effect=_mock_fetch({"SH_TBS_INCD": _TB_RESPONSE})):
        results = adapter.fetch(query)
    tb = next((r for r in results if r.field == "tb_incidence"), None)
    assert tb is not None
    assert tb.value == 245.0
    assert tb.alternatives == []


def test_fetch_uhc_is_single_candidate():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WB_WDI_SH_UHC_SRVS_CV_XD"])
    with patch("epichat.adapters.wb_data360._fetch_text",
               side_effect=_mock_fetch({"SH_UHC_SRVS_CV_XD": _UHC_RESPONSE})):
        results = adapter.fetch(query)
    uhc = next((r for r in results if r.field == "uhc_coverage"), None)
    assert uhc is not None
    assert uhc.value == 56.0
    assert uhc.alternatives == []
