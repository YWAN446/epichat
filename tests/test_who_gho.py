import json
from unittest.mock import patch

from epichat.adapters.who_gho import WHOGHOAdapter, INDICATOR_MAP
from epichat.resolver import DataQuery

_COVERAGE_RESPONSE = json.dumps({
    "value": [
        {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2021", "NumericValue": 72.0},
        {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2022", "NumericValue": 76.0},
        {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2023", "NumericValue": None},
    ]
})

_CASES_RESPONSE = json.dumps({
    "value": [
        {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2023", "NumericValue": 4810.0},
    ]
})

_POP_RESPONSE = json.dumps({
    "value": [
        {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2023", "NumericValue": 54027487.0},
    ]
})

_EMPTY_RESPONSE = json.dumps({"value": []})


def _make_adapter():
    return WHOGHOAdapter()


def _make_query(**kwargs):
    defaults = dict(
        source="who_gho",
        indicator_codes=["WHS3_49"],
        location_code="KEN",
        start_year=2020,
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


def test_indicator_map_coverage_keys():
    assert INDICATOR_MAP["WHS3_49"] == "mcv1_coverage"
    assert INDICATOR_MAP["WHS3_43"] == "polio_coverage"
    assert INDICATOR_MAP["WHS3_41"] == "dtp3_coverage"


def test_indicator_map_cases_keys():
    assert INDICATOR_MAP["WHS3_62"] == "measles_cases"
    assert INDICATOR_MAP["WHS9_86"] == "total_population"


def test_fetch_returns_most_recent_non_null_year():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WHS3_49"])
    with patch("epichat.adapters.who_gho._fetch_text",
               side_effect=_mock_fetch({"WHS3_49": _COVERAGE_RESPONSE})):
        results = adapter.fetch(query)
    assert len(results) == 1
    assert results[0].field == "mcv1_coverage"
    assert results[0].value == 76.0   # 2022; 2023 has NumericValue=None


def test_fetch_citation_format():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WHS3_49"])
    with patch("epichat.adapters.who_gho._fetch_text",
               side_effect=_mock_fetch({"WHS3_49": _COVERAGE_RESPONSE})):
        results = adapter.fetch(query)
    assert results[0].citation == "WHO GHO, KEN, 2022"


def test_fetch_multiple_indicators():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WHS3_49", "WHS3_62"])
    with patch("epichat.adapters.who_gho._fetch_text",
               side_effect=_mock_fetch({"WHS3_49": _COVERAGE_RESPONSE, "WHS3_62": _CASES_RESPONSE})):
        results = adapter.fetch(query)
    fields = {r.field for r in results}
    assert "mcv1_coverage" in fields
    assert "measles_cases" in fields


def test_fetch_empty_response_returns_no_field():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WHS3_49"])
    with patch("epichat.adapters.who_gho._fetch_text", return_value=_EMPTY_RESPONSE):
        results = adapter.fetch(query)
    assert results == []


def test_fetch_unknown_indicator_code_skipped():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["UNKNOWN_CODE"])
    unknown_response = json.dumps({
        "value": [{"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2023", "NumericValue": 99.0}]
    })
    with patch("epichat.adapters.who_gho._fetch_text", return_value=unknown_response):
        results = adapter.fetch(query)
    assert results == []


def test_fetch_http_error_returns_empty():
    import urllib.error
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WHS3_49"])
    with patch("epichat.adapters.who_gho._fetch_text",
               side_effect=urllib.error.URLError("timeout")):
        results = adapter.fetch(query)
    assert results == []


def test_fetch_population_indicator():
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WHS9_86"])
    with patch("epichat.adapters.who_gho._fetch_text",
               side_effect=_mock_fetch({"WHS9_86": _POP_RESPONSE})):
        results = adapter.fetch(query)
    assert len(results) == 1
    assert results[0].field == "total_population"
    assert results[0].value == 54027487.0


def test_source_name():
    assert WHOGHOAdapter.source_name == "who_gho"


def test_fetch_handles_missing_time_dimension():
    """A row missing TimeDimensionValue should not crash — the int(... or 0) fallback handles it."""
    adapter = _make_adapter()
    query = _make_query(indicator_codes=["WHS3_49"])
    response = json.dumps({
        "value": [
            {"SpatialDimValueCode": "KEN", "NumericValue": 80.0},   # no TimeDimensionValue key
            {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2022", "NumericValue": 76.0},
        ]
    })
    with patch("epichat.adapters.who_gho._fetch_text", return_value=response):
        results = adapter.fetch(query)
    # The 2022 row should win; no crash
    assert len(results) == 1
    assert results[0].value == 76.0
    assert results[0].citation == "WHO GHO, KEN, 2022"
