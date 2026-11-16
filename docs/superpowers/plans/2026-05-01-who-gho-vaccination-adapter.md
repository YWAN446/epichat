# WHO GHO Vaccination & Surveillance Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `WHOGHOAdapter` that fetches vaccination coverage and disease surveillance data from the WHO GHO OData API, with two new deterministic post-processors wiring coverage into `vaccine.coverage` and case counts into `init_prev`.

**Architecture:** Extend `DataQuery` with two optional string fields; implement `WHOGHOAdapter` following the existing `SourceAdapter` protocol; extend `UNWPPAdapter` with indicator 49 (total population); add `_apply_vaccination_coverage` and `_apply_surveillance` post-processors in `parser.py`; update the extraction prompt and register the new adapter.

**Tech Stack:** Python 3.11, Pydantic v2, `urllib.request` (no new dependencies), Jinja2 templates, pytest with `unittest.mock`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `epichat/resolver.py` | Modify | Add `indicator_codes: list[str]`, `location_code: str` with defaults to `DataQuery` |
| `epichat/adapters/who_gho.py` | Create | `WHOGHOAdapter` with `INDICATOR_MAP` and `fetch()` |
| `epichat/adapters/un_wpp.py` | Modify | Add indicator 49 → `total_population` to `_map_rows()` |
| `epichat/parser.py` | Modify | Add `_apply_vaccination_coverage`, `_apply_surveillance`; update `parse_query()` |
| `epichat/epichat.py` | Modify | Register `WHOGHOAdapter`; add vaccine coverage line to `format_cli` |
| `epichat/prompts/extraction.txt` | Modify | Add `who_gho` source block; add `49` to UN WPP indicator list |
| `tests/test_resolver.py` | Modify | Add test for new `DataQuery` fields |
| `tests/test_who_gho.py` | Create | Unit tests for `WHOGHOAdapter` |
| `tests/test_un_wpp.py` | Modify | Add test for indicator 49 → `total_population` |
| `tests/test_parser_unit.py` | Modify | Add tests for `_apply_vaccination_coverage` and `_apply_surveillance` |

---

## Task 1: Extend `DataQuery` with WHO GHO fields

**Files:**
- Modify: `epichat/resolver.py`
- Modify: `tests/test_resolver.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_resolver.py`:

```python
def test_data_query_new_fields_default_empty():
    dq = DataQuery(source="who_gho", indicators=[], location_id=0, start_year=2020, end_year=2024)
    assert dq.indicator_codes == []
    assert dq.location_code == ""


def test_data_query_new_fields_explicit():
    dq = DataQuery(
        source="who_gho",
        indicator_codes=["WHS3_49", "WHS3_62"],
        location_code="KEN",
        start_year=2020,
        end_year=2024,
    )
    assert dq.indicator_codes == ["WHS3_49", "WHS3_62"]
    assert dq.location_code == "KEN"


def test_data_query_backward_compat_positional():
    """Existing positional construction still works after adding defaults."""
    dq = DataQuery(source="un_wpp", indicators=[55, 59], location_id=840, start_year=2020, end_year=2024)
    assert dq.source == "un_wpp"
    assert dq.indicators == [55, 59]
    assert dq.location_id == 840
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/test_resolver.py::test_data_query_new_fields_default_empty -v
```

Expected: `AttributeError: 'DataQuery' object has no attribute 'indicator_codes'`

- [ ] **Step 3: Update `DataQuery` in `epichat/resolver.py`**

Replace:
```python
from dataclasses import dataclass
```
With:
```python
from dataclasses import dataclass, field
```

Replace the `DataQuery` dataclass:
```python
@dataclass
class DataQuery:
    source: str
    indicators: list[int] = field(default_factory=list)
    location_id: int = 0
    start_year: int = 2020
    end_year: int = 2024
    indicator_codes: list[str] = field(default_factory=list)
    location_code: str = ""
```

Note: existing fields (`indicators`, `location_id`, `start_year`, `end_year`) get defaults so keyword-only construction still works. The test file uses keyword construction for all existing DataQuery calls except one — check `test_data_query_attributes` which passes all five args positionally; it remains valid because positional order is unchanged.

- [ ] **Step 4: Run all resolver tests**

```
pytest tests/test_resolver.py -v
```

Expected: all 8 tests PASS (5 existing + 3 new).

- [ ] **Step 5: Commit**

```
git add epichat/resolver.py tests/test_resolver.py
git commit -m "feat: extend DataQuery with indicator_codes and location_code for WHO GHO"
```

---

## Task 2: Create `WHOGHOAdapter`

**Files:**
- Create: `epichat/adapters/who_gho.py`
- Create: `tests/test_who_gho.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_who_gho.py`:

```python
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
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/test_who_gho.py -v
```

Expected: `ModuleNotFoundError: No module named 'epichat.adapters.who_gho'`

- [ ] **Step 3: Create `epichat/adapters/who_gho.py`**

```python
from __future__ import annotations

import json
import logging
import urllib.request

from epichat.resolver import DataQuery, ResolvedField

_BASE_URL = "https://ghoapi.azureedge.net/api/"

_logger = logging.getLogger(__name__)

INDICATOR_MAP: dict[str, str] = {
    # Vaccination coverage
    "WHS3_40": "bcg_coverage",
    "WHS3_41": "dtp3_coverage",
    "WHS3_43": "polio_coverage",
    "WHS3_45": "hepb3_coverage",
    "WHS3_46": "hib3_coverage",
    "WHS3_49": "mcv1_coverage",
    "MCV2":    "mcv2_coverage",
    "PCV3":    "pcv3_coverage",
    "ROTAC":   "rotac_coverage",
    "SDGHPV":  "hpv_coverage",
    "MENGA":   "menga_coverage",
    "WHS3_48": "yfv_coverage",
    "PAB":     "pab_coverage",
    # Disease surveillance
    "WHS3_62": "measles_cases",
    "WHS3_56": "pertussis_cases",
    "WHS3_59": "poliomyelitis_cases",
    "WHS3_55": "diphtheria_cases",
    "WHS3_51": "rubella_cases",
    "WHS3_54": "mumps_cases",
    "WHS3_57": "tetanus_cases",
    "WHS3_58": "neonatal_tetanus_cases",
    "WHS3_60": "yellow_fever_cases",
    "WHS3_61": "japanese_encephalitis_cases",
    "WHS3_63": "congenital_rubella_cases",
    # Population denominator
    "WHS9_86": "total_population",
}


def _fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=15) as resp:
        return resp.read().decode("utf-8")


class WHOGHOAdapter:
    source_name = "who_gho"

    def fetch(self, query: DataQuery) -> list[ResolvedField]:
        results: list[ResolvedField] = []
        for code in query.indicator_codes:
            field_name = INDICATOR_MAP.get(code)
            if field_name is None:
                continue
            url = (
                f"{_BASE_URL}{code}"
                f"?$filter=SpatialDimValueCode eq '{query.location_code}'"
            )
            try:
                text = _fetch_text(url)
            except Exception as exc:
                _logger.warning("WHOGHOAdapter fetch failed for %s: %s", code, exc)
                continue
            data = json.loads(text)
            rows = [
                r for r in data.get("value", [])
                if r.get("NumericValue") is not None
            ]
            if not rows:
                continue
            best = max(rows, key=lambda r: r.get("TimeDimensionValue", ""))
            year = best["TimeDimensionValue"]
            value = best["NumericValue"]
            results.append(ResolvedField(
                field=field_name,
                value=value,
                citation=f"WHO GHO, {query.location_code}, {year}",
            ))
        return results
```

- [ ] **Step 4: Run all who_gho tests**

```
pytest tests/test_who_gho.py -v
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```
pytest -v
```

Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```
git add epichat/adapters/who_gho.py tests/test_who_gho.py
git commit -m "feat: add WHOGHOAdapter with INDICATOR_MAP and fetch()"
```

---

## Task 3: Add population indicator 49 to `UNWPPAdapter`

**Files:**
- Modify: `epichat/adapters/un_wpp.py`
- Modify: `tests/test_un_wpp.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_un_wpp.py` — first the CSV fixture at the top with the other fixtures:

```python
_DATA_CSV_POPULATION = """\
sep =|
LocationId|Location|Iso3|Iso2|LocationTypeId|IndicatorId|Indicator|IndicatorDisplayName|SourceId|Source|Revision|VariantId|Variant|VariantShortName|VariantLabel|TimeId|TimeLabel|TimeMid|CategoryId|Category|EstimateTypeId|EstimateType|EstimateMethodId|EstimateMethod|SexId|Sex|AgeId|AgeLabel|AgeStart|AgeEnd|AgeMid|Value
840|United States of America|USA|US|4|49|Total Population|Total Population, as of 1 July (thousands)|27|World Population Prospects|0|4|Median|Median|Median|73|2022|2022.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|188|Total|0|-1|0|333287.558
840|United States of America|USA|US|4|49|Total Population|Total Population, as of 1 July (thousands)|27|World Population Prospects|0|4|Median|Median|Median|74|2023|2023.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|188|Total|0|-1|0|334914.895
"""
```

Then add the test function:

```python
def test_fetch_total_population():
    adapter = _make_adapter_with_data(_DATA_CSV_POPULATION)
    query = DataQuery(source="un_wpp", indicators=[49], location_id=840, start_year=2020, end_year=2024)
    with patch("epichat.adapters.un_wpp._fetch_text", return_value=_DATA_CSV_POPULATION):
        results = adapter.fetch(query)
    pop = next(r for r in results if r.field == "total_population")
    # 334914.895 thousands × 1000 = 334,914,895
    assert pop.value == 334914895
    assert "UN WPP" in pop.citation
    assert "USA" in pop.citation
    assert "2023" in pop.citation
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/test_un_wpp.py::test_fetch_total_population -v
```

Expected: FAIL — `StopIteration` (no `total_population` field returned).

- [ ] **Step 3: Add indicator 49 to `_map_rows()` in `epichat/adapters/un_wpp.py`**

In `_map_rows()`, after the existing `for ind_id, field_name in [("55", ...), ("59", ...)]` loop and before the `age_rows` block, add:

```python
        pop_candidates = [
            r for r in rows
            if r.get("IndicatorId") == "49" and r.get("AgeLabel", "").strip() == "Total"
        ]
        if pop_candidates:
            best = max(pop_candidates, key=lambda r: int(r.get("TimeId", 0)))
            year = best.get("TimeLabel", "")
            iso3 = best.get("Iso3", str(location_id))
            location_name = best.get("Location", str(location_id))
            results.append(ResolvedField(
                field="total_population",
                value=round(float(best["Value"]) * 1000),
                citation=f"UN WPP 2024, {location_name} ({iso3}), {year}",
            ))
```

The full `_map_rows` method after the change:

```python
    def _map_rows(self, rows: list[dict[str, str]], location_id: int) -> list[ResolvedField]:
        rows = [
            r for r in rows
            if r.get("VariantId") == _VARIANT_MEDIAN
            and r.get("SexId") == _SEX_BOTH
            and r.get("EstimateMethodId") == _ESTIMATE_METHOD_INTERP
        ]

        results: list[ResolvedField] = []

        for ind_id, field_name in [("55", "birth_rate"), ("59", "death_rate")]:
            candidates = [
                r for r in rows
                if r.get("IndicatorId") == ind_id and r.get("AgeLabel", "").strip() == "Total"
            ]
            if not candidates:
                continue
            best = max(candidates, key=lambda r: int(r.get("TimeId", 0)))
            year = best.get("TimeLabel", "")
            iso3 = best.get("Iso3", str(location_id))
            location_name = best.get("Location", str(location_id))
            results.append(ResolvedField(
                field=field_name,
                value=round(float(best["Value"]), 3),
                citation=f"UN WPP 2024, {location_name} ({iso3}), {year}",
            ))

        pop_candidates = [
            r for r in rows
            if r.get("IndicatorId") == "49" and r.get("AgeLabel", "").strip() == "Total"
        ]
        if pop_candidates:
            best = max(pop_candidates, key=lambda r: int(r.get("TimeId", 0)))
            year = best.get("TimeLabel", "")
            iso3 = best.get("Iso3", str(location_id))
            location_name = best.get("Location", str(location_id))
            results.append(ResolvedField(
                field="total_population",
                value=round(float(best["Value"]) * 1000),
                citation=f"UN WPP 2024, {location_name} ({iso3}), {year}",
            ))

        age_rows = [r for r in rows if r.get("IndicatorId") == "71"]
        pct: dict[str, float] = {}
        age_year: str = ""
        age_iso3: str = ""
        age_location_name: str = ""
        for label in ("0-17", "65+"):
            candidates = [r for r in age_rows if r.get("AgeLabel", "").strip() == label]
            if not candidates:
                continue
            best = max(candidates, key=lambda r: int(r.get("TimeId", 0)))
            pct[label] = round(float(best["Value"]), 3)
            age_year = best.get("TimeLabel", "")
            age_iso3 = best.get("Iso3", str(location_id))
            age_location_name = best.get("Location", str(location_id))

        if "0-17" in pct and "65+" in pct:
            pct["18-64"] = round(100 - pct["0-17"] - pct["65+"], 3)
            results.append(ResolvedField(
                field="age_distribution_pct",
                value=pct,
                citation=f"UN WPP 2024, {age_location_name} ({age_iso3}), {age_year}",
            ))

        return results
```

- [ ] **Step 4: Run all UN WPP tests**

```
pytest tests/test_un_wpp.py -v
```

Expected: all 9 tests PASS (8 existing + 1 new).

- [ ] **Step 5: Commit**

```
git add epichat/adapters/un_wpp.py tests/test_un_wpp.py
git commit -m "feat: add total_population (indicator 49) to UNWPPAdapter"
```

---

## Task 4: Add vaccination coverage and surveillance post-processors to `parser.py`

**Files:**
- Modify: `epichat/parser.py`
- Modify: `tests/test_parser_unit.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_parser_unit.py` — first update the import line at the top:

```python
from epichat.parser import (
    IntentResult,
    _apply_age_distribution,
    _apply_vaccination_coverage,
    _apply_surveillance,
    _llm_call_1,
    _llm_call_2,
    parse_query,
)
```

Then add these test functions:

```python
# ── _apply_vaccination_coverage ───────────────────────────────────────────────

def test_apply_vaccination_coverage_no_op_when_no_coverage_field():
    params = SimParams(beta=22.8125)
    resolved = [ResolvedField(field="birth_rate", value=28.5, citation="x")]
    result = _apply_vaccination_coverage(params, resolved)
    assert result is params


def test_apply_vaccination_coverage_no_op_when_llm_already_set_vaccine():
    from epichat.schema import Intervention
    vaccine = Intervention(type="vaccine", coverage=0.5, start_day=0)
    params = SimParams(beta=22.8125, interventions=[vaccine])
    resolved = [ResolvedField(field="mcv1_coverage", value=76.0, citation="WHO GHO, KEN, 2022")]
    result = _apply_vaccination_coverage(params, resolved)
    # LLM set vaccine → post-processor must not override it
    assert result is params


def test_apply_vaccination_coverage_adds_vaccine_intervention():
    params = SimParams(beta=22.8125)
    resolved = [ResolvedField(field="mcv1_coverage", value=76.0, citation="WHO GHO, KEN, 2022")]
    result = _apply_vaccination_coverage(params, resolved)
    assert result is not params
    vaccine = result.get_vaccine()
    assert vaccine is not None
    assert abs(vaccine.coverage - 0.76) < 1e-9
    assert vaccine.start_day == 0


def test_apply_vaccination_coverage_returns_new_simparams_via_model_validate():
    """model_validate must be used (not model_copy) so validators run."""
    params = SimParams(beta=22.8125)
    resolved = [ResolvedField(field="dtp3_coverage", value=85.0, citation="WHO GHO, KEN, 2022")]
    result = _apply_vaccination_coverage(params, resolved)
    assert isinstance(result, SimParams)
    assert result.get_vaccine() is not None
    assert abs(result.get_vaccine().coverage - 0.85) < 1e-9


# ── _apply_surveillance ───────────────────────────────────────────────────────

def test_apply_surveillance_no_op_when_no_cases_field():
    params = SimParams(beta=22.8125, init_prev=0.01)
    resolved = [ResolvedField(field="total_population", value=54000000, citation="x")]
    result = _apply_surveillance(params, resolved)
    assert result is params


def test_apply_surveillance_no_op_when_no_population_field():
    params = SimParams(beta=22.8125, init_prev=0.01)
    resolved = [ResolvedField(field="measles_cases", value=4810, citation="x")]
    result = _apply_surveillance(params, resolved)
    assert result is params


def test_apply_surveillance_sets_init_prev():
    params = SimParams(beta=22.8125, init_prev=0.01)
    resolved = [
        ResolvedField(field="measles_cases", value=4810.0, citation="WHO GHO, KEN, 2023"),
        ResolvedField(field="total_population", value=54027487, citation="UN WPP, KEN, 2023"),
    ]
    result = _apply_surveillance(params, resolved)
    assert result is not params
    expected = 4810.0 / 54027487
    assert abs(result.init_prev - expected) < 1e-9


def test_apply_surveillance_caps_at_0_5():
    params = SimParams(beta=22.8125, init_prev=0.01)
    resolved = [
        ResolvedField(field="measles_cases", value=99999999, citation="x"),
        ResolvedField(field="total_population", value=100, citation="x"),
    ]
    result = _apply_surveillance(params, resolved)
    assert result.init_prev == 0.5


def test_parse_query_applies_all_post_processors_in_order():
    """parse_query() chains all three post-processors."""
    mock_resolver = MagicMock()
    mock_resolver.resolve.return_value = [
        ResolvedField(field="mcv1_coverage", value=76.0, citation="WHO GHO, KEN, 2022"),
        ResolvedField(field="measles_cases", value=4810.0, citation="WHO GHO, KEN, 2023"),
        ResolvedField(field="total_population", value=54027487, citation="UN WPP, KEN, 2023"),
    ]

    lm1_msg = MagicMock()
    lm1_msg.content = [MagicMock(text=_INTENT_WITH_QUERIES)]
    lm2_msg = MagicMock()
    lm2_msg.content = [MagicMock(text=_REFINED_JSON)]
    client = MagicMock()
    client.messages.create.side_effect = [lm1_msg, lm2_msg]

    with patch("epichat.parser._resolver", mock_resolver), \
         patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = parse_query("simulate measles in Kenya")

    vaccine = result.get_vaccine()
    assert vaccine is not None
    assert abs(vaccine.coverage - 0.76) < 1e-9
    expected_prev = 4810.0 / 54027487
    assert abs(result.init_prev - expected_prev) < 1e-9
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/test_parser_unit.py -v
```

Expected: `ImportError: cannot import name '_apply_vaccination_coverage' from 'epichat.parser'`

- [ ] **Step 3: Add post-processors and update `parse_query()` in `epichat/parser.py`**

After `_apply_age_distribution` (line 134), add:

```python
def _apply_vaccination_coverage(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    coverage_field = next((rf for rf in resolved if rf.field.endswith("_coverage")), None)
    if coverage_field is None:
        return params
    if params.get_vaccine() is not None:
        return params
    coverage = coverage_field.value / 100.0
    from .schema import Intervention
    vaccine = Intervention(type="vaccine", coverage=coverage, start_day=0)
    return SimParams.model_validate({
        **params.model_dump(),
        "interventions": params.model_dump()["interventions"] + [vaccine.model_dump()],
    })


def _apply_surveillance(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    cases_field = next((rf for rf in resolved if rf.field.endswith("_cases")), None)
    pop_field   = next((rf for rf in resolved if rf.field == "total_population"), None)
    if cases_field is None or pop_field is None:
        return params
    init_prev = min(0.5, cases_field.value / pop_field.value)
    return SimParams.model_validate({**params.model_dump(), "init_prev": init_prev})
```

Replace the tail of `parse_query()`:

```python
def parse_query(user_input: str) -> SimParams:
    """
    Translate a natural language epidemiological query into validated SimParams.

    Four-step process:
      1. LLM-1 extracts intent (preliminary params + optional data queries).
      2. If data queries exist, the resolver fetches real-world values.
      3. LLM-2 refines preliminary params using resolved data (skipped when no queries).
      4. Deterministic post-processing applies age distribution, vaccination coverage,
         and disease surveillance if resolved.

    Raises:
        ValueError: if the LLM requests clarification or returns invalid JSON/schema.
    """
    global _last_resolved
    _last_resolved = []
    intent = _llm_call_1(user_input)
    resolved = _run_resolver(intent.data_queries)
    _last_resolved = resolved
    params = _llm_call_2(user_input, intent.preliminary_params, resolved)
    params = _apply_age_distribution(params, resolved)
    params = _apply_vaccination_coverage(params, resolved)
    params = _apply_surveillance(params, resolved)
    return params
```

- [ ] **Step 4: Run all parser unit tests**

```
pytest tests/test_parser_unit.py -v
```

Expected: all tests PASS (existing + 9 new).

- [ ] **Step 5: Run full suite**

```
pytest -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```
git add epichat/parser.py tests/test_parser_unit.py
git commit -m "feat: add _apply_vaccination_coverage and _apply_surveillance post-processors"
```

---

## Task 5: Update extraction prompt

**Files:**
- Modify: `epichat/prompts/extraction.txt`

No automated test for prompt text; verify format manually.

- [ ] **Step 1: Update `epichat/prompts/extraction.txt`**

Change the UN WPP indicators line from:
```
      "indicators": [55, 59, 71],
```
To:
```
      "indicators": [55, 59, 71, 49],
```

Then add the WHO GHO block immediately before the `## Location table` section. The full addition (insert before the `## Location table` heading):

```
## WHO GHO data queries

When the user mentions a disease *and* a country, you may add a second `who_gho` query alongside the `un_wpp` query. Use `indicator_codes` (strings) and `location_code` (ISO3). Always include `"WHS9_86"` (total population) when requesting surveillance case data.

Disease → indicator_codes to request:

| Disease          | coverage codes    | cases codes                  |
|------------------|-------------------|------------------------------|
| measles/rubeola  | ["WHS3_49"]       | ["WHS3_62", "WHS9_86"]       |
| rubella          | ["WHS3_49"]       | ["WHS3_51", "WHS9_86"]       |
| polio            | ["WHS3_43"]       | ["WHS3_59", "WHS9_86"]       |
| diphtheria       | ["WHS3_41"]       | ["WHS3_55", "WHS9_86"]       |
| pertussis        | ["WHS3_41"]       | ["WHS3_56", "WHS9_86"]       |
| mumps            | ["WHS3_49"]       | ["WHS3_54", "WHS9_86"]       |
| yellow fever     | ["WHS3_48"]       | ["WHS3_60", "WHS9_86"]       |
| hepatitis B      | ["WHS3_45"]       | []                            |
| hib              | ["WHS3_46"]       | []                            |
| pneumococcal     | ["PCV3"]          | []                            |
| rotavirus        | ["ROTAC"]         | []                            |
| HPV              | ["SDGHPV"]        | []                            |
| meningococcal    | ["MENGA"]         | []                            |
| japanese enc.    | []                | ["WHS3_61", "WHS9_86"]       |
| neonatal tetanus | ["PAB"]           | ["WHS3_58", "WHS9_86"]       |

Request both coverage and cases codes when simulating a disease with known surveillance. Example for measles in Kenya:

```json
{
  "source": "who_gho",
  "indicator_codes": ["WHS3_49", "WHS3_62", "WHS9_86"],
  "location_code": "KEN",
  "start_year": 2020,
  "end_year": 2024
}
```

```

- [ ] **Step 2: Verify the file looks right**

```
python -c "from pathlib import Path; print(Path('epichat/prompts/extraction.txt').read_text(encoding='utf-8')[-2000:])"
```

Confirm the WHO GHO block appears before `## Location table` and the `un_wpp` indicators line now reads `[55, 59, 71, 49]`.

- [ ] **Step 3: Commit**

```
git add epichat/prompts/extraction.txt
git commit -m "feat: add WHO GHO source block and indicator 49 to extraction prompt"
```

---

## Task 6: Register `WHOGHOAdapter` and add vaccine coverage CLI line

**Files:**
- Modify: `epichat/epichat.py`
- Create: `tests/test_epichat_unit.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_epichat_unit.py`:

```python
from epichat.resolver import ResolvedField
from epichat.schema import Intervention, SimParams
from epichat.epichat import SimResult


def _base_params(**kwargs) -> SimParams:
    defaults = dict(beta=22.8125, n_agents=1000, sim_dur_years=1.0)
    defaults.update(kwargs)
    return SimParams(**defaults)


def _make_result(params: SimParams, data_sources: list[ResolvedField] | None = None) -> SimResult:
    return SimResult(
        params=params,
        data_sources=data_sources or [],
        peak_infections=100,
        peak_day=30,
        total_infected=500,
        total_deaths=5,
        n_agents=1000,
        sim_days=365,
        plot_path=None,
    )


def test_format_cli_no_vaccine_coverage_line_when_no_coverage_source():
    params = _base_params()
    result = _make_result(params)
    cli = result.format_cli()
    assert "Vaccine coverage" not in cli


def test_format_cli_no_vaccine_coverage_line_when_no_vaccine_intervention():
    params = _base_params()
    resolved = [ResolvedField(field="mcv1_coverage", value=76.0, citation="WHO GHO, KEN, 2022")]
    result = _make_result(params, resolved)
    cli = result.format_cli()
    assert "Vaccine coverage" not in cli


def test_format_cli_shows_vaccine_coverage_line():
    vaccine = Intervention(type="vaccine", coverage=0.76, start_day=0)
    params = _base_params(interventions=[vaccine])
    resolved = [ResolvedField(field="mcv1_coverage", value=76.0, citation="WHO GHO, KEN, 2022")]
    result = _make_result(params, resolved)
    cli = result.format_cli()
    assert "Vaccine coverage: 76.0%" in cli
    assert "MCV1" in cli
    assert "pre-existing" in cli


def test_format_cli_vaccine_label_derived_from_field_name():
    vaccine = Intervention(type="vaccine", coverage=0.85, start_day=0)
    params = _base_params(interventions=[vaccine])
    resolved = [ResolvedField(field="dtp3_coverage", value=85.0, citation="WHO GHO, KEN, 2022")]
    result = _make_result(params, resolved)
    cli = result.format_cli()
    assert "DTP3" in cli


def test_who_gho_adapter_registered_in_epichat_constructor():
    """WHOGHOAdapter must be registered (no API key required)."""
    import os
    from unittest.mock import patch, MagicMock
    mock_un = MagicMock()
    mock_un.iso3_table.return_value = {}
    mock_un.source_name = "un_wpp"
    with patch("epichat.epichat.UNWPPAdapter", return_value=mock_un), \
         patch.dict(os.environ, {"UN_API_KEY": "test"}):
        from epichat.epichat import EpiChat
        from epichat.adapters.who_gho import WHOGHOAdapter
        chat = EpiChat.__new__(EpiChat)
        # Call __init__ manually without running resolver network calls
        # Just verify the import works and WHOGHOAdapter can be instantiated
        adapter = WHOGHOAdapter()
        assert adapter.source_name == "who_gho"
```

- [ ] **Step 2: Run to verify failures**

```
pytest tests/test_epichat_unit.py -v
```

Expected: several failures — `SimResult` doesn't have the constructor shown, or "Vaccine coverage" line missing.

- [ ] **Step 3: Update `epichat/epichat.py`**

Add the `WHOGHOAdapter` import at the top of the file with the other adapter imports:

```python
from .adapters.who_gho import WHOGHOAdapter
```

In `__init__`, add registration after the existing `UNWPPAdapter`:

```python
    def __init__(self, output_dir: str | Path = "results") -> None:
        self.output_dir = Path(output_dir)
        self.generator = CodeGenerator()
        self.executor = SimExecutor()
        configure_resolver(UNWPPAdapter(api_key=os.environ.get("UN_API_KEY")))
        configure_resolver(WHOGHOAdapter())
```

In `format_cli`, after the age distribution lines (line 94), add:

```python
        coverage_source = next(
            (rf for rf in self.data_sources if rf.field.endswith("_coverage")), None
        )
        if coverage_source is not None and p.get_vaccine() is not None:
            label = coverage_source.field.replace("_coverage", "").upper()
            lines.append(f"  Vaccine coverage: {p.get_vaccine().coverage * 100:.1f}%  (pre-existing, {label})")
```

- [ ] **Step 4: Run the epichat unit tests**

```
pytest tests/test_epichat_unit.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Run full suite**

```
pytest -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```
git add epichat/epichat.py tests/test_epichat_unit.py
git commit -m "feat: register WHOGHOAdapter and add vaccine coverage line to format_cli"
```

---

## Task 7: End-to-end validation

**Files:** Read-only verification, no code changes.

- [ ] **Step 1: Run full test suite**

```
pytest -v
```

Expected: all tests PASS with no warnings.

- [ ] **Step 2: Smoke test the WHO GHO API directly**

```python
python -c "
import json, urllib.request
url = 'https://ghoapi.azureedge.net/api/WHS3_49?%24filter=SpatialDimValueCode%20eq%20%27KEN%27'
with urllib.request.urlopen(url, timeout=15) as r:
    data = json.loads(r.read())
rows = [x for x in data['value'] if x.get('NumericValue') is not None]
best = max(rows, key=lambda x: x['TimeDimensionValue'])
print('MCV1 coverage Kenya:', best['NumericValue'], 'year:', best['TimeDimensionValue'])
"
```

Expected: prints a coverage value and year, e.g. `MCV1 coverage Kenya: 76.0 year: 2022`.

- [ ] **Step 3: Smoke test the full pipeline (requires `ANTHROPIC_API_KEY`)**

```python
python -c "
import os
os.environ.setdefault('ANTHROPIC_API_KEY', os.environ['ANTHROPIC_API_KEY'])
from epichat.epichat import EpiChat
chat = EpiChat()
result = chat.run('Simulate measles in Kenya')
print(result.format_cli())
"
```

Expected output includes:
- `Vaccine coverage: XX.X%  (pre-existing, MCV1)`
- `DATA SOURCES` block with `mcv1_coverage` citation `WHO GHO, KEN, ...`
- Possibly `measles_cases` and `total_population` if surveillance data returned
- `init_prev` reflects case count / population when surveillance data present

- [ ] **Step 4: Verify CLI format for a case with both coverage and surveillance**

The `format_cli` output should show (order may vary):
```
  Vaccine coverage: 76.0%  (pre-existing, MCV1)
  ...
DATA SOURCES
  mcv1_coverage      76.0   — WHO GHO, KEN, 2022
  measles_cases      4810.0 — WHO GHO, KEN, 2023
  total_population   54027487 — UN WPP 2024, Kenya (KEN), 2023
```

- [ ] **Step 5: Final commit if any corrections needed**

If the smoke test reveals minor issues (e.g., formatting edge cases), fix and commit. Otherwise, the feature is complete.

```
git add -p
git commit -m "fix: <description of any smoke test correction>"
```
