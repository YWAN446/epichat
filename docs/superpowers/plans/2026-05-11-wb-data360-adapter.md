# World Bank Data360 Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `WorldBankData360Adapter` that fetches health system capacity, disease epidemiology, and demographics from the World Bank WDI via the Data360 API, surfaces multiple candidate values per parameter for user comparison, and wires two new post-processors that translate raw WDI values into `treatment` intervention parameters and `init_prev`.

**Architecture:** Extend `ResolvedField` with `description` and `alternatives` fields (backward-compatible); build a new `WorldBankData360Adapter` that groups indicators into primary + alternatives using `CANDIDATE_GROUPS`; add two new deterministic post-processors (`_apply_wb_disease_prevalence`, `_apply_health_system`) that run after existing WHO GHO processors in `parse_query()`; update `format_cli()` to render candidate alternatives with a `★ used` marker.

**Tech Stack:** Python stdlib (`urllib.request`, `json`), `pydantic`, `unittest.mock.patch` for tests, `pytest`.

**Spec:** `docs/superpowers/specs/2026-05-11-wb-data360-adapter-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `epichat/resolver.py` | Modify | Add `description`, `alternatives` to `ResolvedField`; add `database_id` to `DataQuery` |
| `epichat/adapters/wb_data360.py` | Create | `WorldBankData360Adapter` with indicator map, candidate grouping, fetch logic |
| `epichat/parser.py` | Modify | Add `_apply_wb_disease_prevalence`, `_apply_health_system`; update `parse_query()` tail |
| `epichat/epichat.py` | Modify | Register adapter; update `format_cli()` to render alternatives |
| `epichat/prompts/extraction.txt` | Modify | Add `wb_data360` source block |
| `ROADMAP.md` | Modify | Append Data360 deferred features section |
| `tests/test_resolver.py` | Modify | Tests for new `ResolvedField` / `DataQuery` fields |
| `tests/test_wb_data360.py` | Create | All adapter tests |
| `tests/test_parser_unit.py` | Modify | Tests for two new post-processors |
| `tests/test_epichat_unit.py` | Modify | Tests for alternatives rendering in `format_cli()` |

---

## Task 1: Extend `ResolvedField` and `DataQuery`

**Files:**
- Modify: `epichat/resolver.py`
- Modify: `tests/test_resolver.py`

- [ ] **Step 1.1: Write failing tests**

Append to `tests/test_resolver.py`:

```python
def test_resolved_field_description_defaults_to_empty():
    rf = ResolvedField(field="birth_rate", value=10.5, citation="x")
    assert rf.description == ""


def test_resolved_field_alternatives_defaults_to_empty_list():
    rf = ResolvedField(field="birth_rate", value=10.5, citation="x")
    assert rf.alternatives == []


def test_resolved_field_with_alternatives():
    alt = ResolvedField(field="treatment_capacity", value=0.2, citation="WB WDI, KEN, 2022",
                        description="physicians/1,000")
    primary = ResolvedField(field="treatment_capacity", value=2.3, citation="WB WDI, KEN, 2022",
                            description="hospital beds/1,000", alternatives=[alt])
    assert len(primary.alternatives) == 1
    assert primary.alternatives[0].value == 0.2
    assert primary.alternatives[0].description == "physicians/1,000"


def test_data_query_database_id_defaults_to_wdi():
    dq = DataQuery(source="wb_data360", indicator_codes=["WB_WDI_SH_TBS_INCD"], location_code="KEN")
    assert dq.database_id == "WB_WDI"


def test_data_query_database_id_explicit():
    dq = DataQuery(source="wb_data360", database_id="WB_HNP", indicator_codes=[], location_code="KEN")
    assert dq.database_id == "WB_HNP"


def test_resolved_field_backward_compat_no_description_or_alternatives():
    """Existing construction (field, value, citation only) must still work."""
    rf = ResolvedField(field="birth_rate", value=28.5, citation="UN WPP 2024, KEN, 2023")
    assert rf.description == ""
    assert rf.alternatives == []
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```
pytest tests/test_resolver.py::test_resolved_field_description_defaults_to_empty tests/test_resolver.py::test_resolved_field_alternatives_defaults_to_empty_list tests/test_resolver.py::test_resolved_field_with_alternatives tests/test_resolver.py::test_data_query_database_id_defaults_to_wdi -v
```

Expected: `AttributeError: 'ResolvedField' object has no attribute 'description'` (or similar)

- [ ] **Step 1.3: Update `epichat/resolver.py`**

Replace the `ResolvedField` and `DataQuery` dataclasses with:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass
class DataQuery:
    source: str
    indicators: list[int] = field(default_factory=list)
    location_id: int = 0
    start_year: int = 2020
    end_year: int = 2025
    indicator_codes: list[str] = field(default_factory=list)
    location_code: str = ""
    database_id: str = "WB_WDI"


@dataclass
class ResolvedField:
    field: str
    value: Any
    citation: str
    description: str = ""
    alternatives: list["ResolvedField"] = field(default_factory=list)


@runtime_checkable
class SourceAdapter(Protocol):
    source_name: str

    def fetch(self, query: DataQuery) -> list[ResolvedField]: ...


class Resolver:
    def __init__(self) -> None:
        self._adapters: dict[str, SourceAdapter] = {}

    def register(self, adapter: SourceAdapter) -> None:
        self._adapters[adapter.source_name] = adapter

    def resolve(self, queries: list[DataQuery]) -> list[ResolvedField]:
        results: list[ResolvedField] = []
        for query in queries:
            adapter = self._adapters.get(query.source)
            if adapter is None:
                continue
            results.extend(adapter.fetch(query))
        return results
```

- [ ] **Step 1.4: Run all resolver tests**

```
pytest tests/test_resolver.py -v
```

Expected: all pass

- [ ] **Step 1.5: Commit**

```
git add epichat/resolver.py tests/test_resolver.py
git commit -m "feat: add description, alternatives to ResolvedField; database_id to DataQuery"
```

---

## Task 2: Create `WorldBankData360Adapter`

**Files:**
- Create: `epichat/adapters/wb_data360.py`
- Create: `tests/test_wb_data360.py`

- [ ] **Step 2.1: Write failing tests**

Create `tests/test_wb_data360.py`:

```python
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
    # One grouped ResolvedField
    capacity = next((r for r in results if r.field == "treatment_capacity"), None)
    assert capacity is not None
    assert capacity.value == 2.3                    # beds — primary
    assert len(capacity.alternatives) == 2
    alt_values = {a.value for a in capacity.alternatives}
    assert 0.2 in alt_values                        # physicians
    assert 1.1 in alt_values                        # nurses


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
    assert hiv.value == 6.3                         # prevalence % — primary
    assert len(hiv.alternatives) == 1
    assert hiv.alternatives[0].value == 0.4         # incidence per 1k


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
```

- [ ] **Step 2.2: Run tests to confirm they fail**

```
pytest tests/test_wb_data360.py -v
```

Expected: `ModuleNotFoundError: No module named 'epichat.adapters.wb_data360'`

- [ ] **Step 2.3: Create `epichat/adapters/wb_data360.py`**

```python
from __future__ import annotations

import json
import logging
import urllib.request

from epichat.resolver import DataQuery, ResolvedField

_BASE_URL = "https://data360api.worldbank.org"

_logger = logging.getLogger(__name__)

# Maps Data360 indicator ID → (field_name, description)
INDICATOR_MAP: dict[str, tuple[str, str]] = {
    # Health system — capacity
    "WB_WDI_SH_MED_BEDS_ZS":    ("treatment_capacity", "hospital beds/1,000"),
    "WB_WDI_SH_MED_PHYS_ZS":    ("treatment_capacity", "physicians/1,000"),
    "WB_WDI_SH_MED_NUMW_P3":    ("treatment_capacity", "nurses/1,000"),
    # Health system — coverage
    "WB_WDI_SH_UHC_SRVS_CV_XD": ("uhc_coverage",       "UHC service coverage index 0–100"),
    # Disease — TB
    "WB_WDI_SH_TBS_INCD":        ("tb_incidence",        "per 100,000/yr"),
    # Disease — HIV
    "WB_WDI_SH_DYN_AIDS_ZS":    ("hiv_prevalence",      "% of population ages 15–49"),
    "WB_WDI_SH_HIV_INCD_TL_P3": ("hiv_prevalence",      "per 1,000 uninfected/yr"),
    # Disease — malaria
    "WB_WDI_SH_MLR_INCD_P3":    ("malaria_incidence",   "per 1,000 population at risk/yr"),
    # Disease — diabetes
    "WB_WDI_SH_STA_DIAB_ZS":    ("diabetes_prevalence", "% of adults ages 20–79"),
    # Disease — hepatitis B
    "WB_WDI_SH_HEP_HBVS_ZS":    ("hepb_prevalence",     "% of population"),
    # Demographics (WDI alternatives to UN WPP)
    "WB_WDI_SP_DYN_CBRT_IN":    ("birth_rate",           "crude birth rate/1,000/yr"),
    "WB_WDI_SP_DYN_CDRT_IN":    ("death_rate",           "crude death rate/1,000/yr"),
    "WB_WDI_SP_POP_TOTL":       ("total_population",     "total population"),
    "WB_WDI_SP_POP_0014_TO_ZS": ("age_distribution_pct", "population ages 0–14 (%)"),
    "WB_WDI_SP_POP_65UP_TO_ZS": ("age_distribution_pct", "population ages 65+ (%)"),
}

# Which indicators share a logical field and which is primary
CANDIDATE_GROUPS: dict[str, dict] = {
    "treatment_capacity": {
        "primary": "WB_WDI_SH_MED_BEDS_ZS",
        "alternatives": ["WB_WDI_SH_MED_PHYS_ZS", "WB_WDI_SH_MED_NUMW_P3"],
    },
    "hiv_prevalence": {
        "primary": "WB_WDI_SH_DYN_AIDS_ZS",
        "alternatives": ["WB_WDI_SH_HIV_INCD_TL_P3"],
    },
}

# Population divisor for converting raw indicator values to init_prev fractions.
# Prevalence fields (suffix _prevalence): init_prev = value / scale
# Incidence fields (suffix _incidence): init_prev = value / scale / 365 * dur_inf
INCIDENCE_SCALE: dict[str, float] = {
    "tb_incidence":        100_000,   # per 100k/yr
    "malaria_incidence":   1_000,     # per 1k/yr
    "hiv_prevalence":      100,       # percent
    "diabetes_prevalence": 100,       # percent
    "hepb_prevalence":     100,       # percent
}


def _fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=15) as resp:
        return resp.read().decode("utf-8")


class WorldBankData360Adapter:
    source_name = "wb_data360"

    def fetch(self, query: DataQuery) -> list[ResolvedField]:
        # Fetch each requested indicator, keep only valid rows
        raw: dict[str, tuple[float, str]] = {}   # code → (value, year)
        for code in query.indicator_codes:
            if code not in INDICATOR_MAP:
                continue
            url = (
                f"{_BASE_URL}/data360/data"
                f"?DATABASE_ID={query.database_id}"
                f"&INDICATOR={code}"
                f"&REF_AREA={query.location_code}"
                f"&timePeriodFrom={query.start_year}"
                f"&timePeriodTo={query.end_year}"
            )
            try:
                text = _fetch_text(url)
                data = json.loads(text)
            except Exception as exc:
                _logger.warning("WorldBankData360Adapter fetch failed for %s: %s", code, exc)
                continue
            rows = [r for r in data.get("value", []) if r.get("OBS_VALUE") is not None]
            if not rows:
                continue
            best = max(rows, key=lambda r: r.get("TIME_PERIOD", "") or "")
            raw[code] = (float(best["OBS_VALUE"]), best.get("TIME_PERIOD", "unknown"))

        if not raw:
            return []

        results: list[ResolvedField] = []
        consumed: set[str] = set()

        # Grouped candidates
        for field_name, group in CANDIDATE_GROUPS.items():
            primary_code = group["primary"]
            if primary_code not in raw:
                continue
            primary_value, primary_year = raw[primary_code]
            _, primary_desc = INDICATOR_MAP[primary_code]
            consumed.add(primary_code)

            alternatives: list[ResolvedField] = []
            for alt_code in group["alternatives"]:
                if alt_code not in raw:
                    continue
                alt_value, alt_year = raw[alt_code]
                _, alt_desc = INDICATOR_MAP[alt_code]
                alternatives.append(ResolvedField(
                    field=field_name,
                    value=alt_value,
                    citation=f"WB WDI, {query.location_code}, {alt_year}",
                    description=alt_desc,
                ))
                consumed.add(alt_code)

            results.append(ResolvedField(
                field=field_name,
                value=primary_value,
                citation=f"WB WDI, {query.location_code}, {primary_year}",
                description=primary_desc,
                alternatives=alternatives,
            ))

        # Single-candidate fields
        for code, (value, year) in raw.items():
            if code in consumed:
                continue
            field_name, description = INDICATOR_MAP[code]
            results.append(ResolvedField(
                field=field_name,
                value=value,
                citation=f"WB WDI, {query.location_code}, {year}",
                description=description,
            ))

        return results
```

- [ ] **Step 2.4: Run all adapter tests**

```
pytest tests/test_wb_data360.py -v
```

Expected: all pass

- [ ] **Step 2.5: Run full test suite to check for regressions**

```
pytest tests/ -v
```

Expected: all pass

- [ ] **Step 2.6: Commit**

```
git add epichat/adapters/wb_data360.py tests/test_wb_data360.py
git commit -m "feat: add WorldBankData360Adapter with indicator map and candidate grouping"
```

---

## Task 3: Add `_apply_wb_disease_prevalence` post-processor

**Files:**
- Modify: `epichat/parser.py`
- Modify: `tests/test_parser_unit.py`

- [ ] **Step 3.1: Write failing tests**

Append to `tests/test_parser_unit.py`:

```python
from epichat.parser import _apply_wb_disease_prevalence, _apply_health_system


# ── _apply_wb_disease_prevalence ──────────────────────────────────────────────

def test_apply_wb_disease_prevalence_no_op_when_cases_field_present():
    """WHO GHO cases field takes precedence — WB disease prevalence must be skipped."""
    params = SimParams(beta=22.8125, init_prev=0.01, dur_inf=10.0)
    resolved = [
        ResolvedField(field="measles_cases", value=5000, citation="WHO GHO, KEN, 2023"),
        ResolvedField(field="total_population", value=54_000_000, citation="x"),
        ResolvedField(field="tb_incidence", value=245.0, citation="WB WDI, KEN, 2022",
                      description="per 100,000/yr"),
    ]
    result = _apply_wb_disease_prevalence(params, resolved)
    assert result is params   # unchanged


def test_apply_wb_disease_prevalence_no_op_when_no_disease_field():
    params = SimParams(beta=22.8125, init_prev=0.01)
    resolved = [ResolvedField(field="birth_rate", value=28.5, citation="x")]
    result = _apply_wb_disease_prevalence(params, resolved)
    assert result is params


def test_apply_wb_disease_prevalence_uses_prevalence_percent():
    """HIV prevalence: 6.3% → init_prev = 0.063"""
    params = SimParams(beta=22.8125, init_prev=0.01, dur_inf=10.0)
    resolved = [ResolvedField(field="hiv_prevalence", value=6.3, citation="WB WDI, KEN, 2020",
                              description="% of population ages 15–49")]
    result = _apply_wb_disease_prevalence(params, resolved)
    assert result is not params
    assert abs(result.init_prev - 0.063) < 1e-9


def test_apply_wb_disease_prevalence_uses_incidence_per_100k():
    """TB: 245/100k/yr, dur_inf=10 days → init_prev = 245/100000/365*10"""
    params = SimParams(beta=22.8125, init_prev=0.01, dur_inf=10.0)
    resolved = [ResolvedField(field="tb_incidence", value=245.0, citation="WB WDI, KEN, 2022",
                              description="per 100,000/yr")]
    result = _apply_wb_disease_prevalence(params, resolved)
    assert result is not params
    expected = 245.0 / 100_000 / 365 * 10.0
    assert abs(result.init_prev - expected) < 1e-12


def test_apply_wb_disease_prevalence_uses_incidence_per_1k():
    """Malaria: 120/1k/yr, dur_inf=7 days → init_prev = 120/1000/365*7"""
    params = SimParams(beta=22.8125, init_prev=0.01, dur_inf=7.0)
    resolved = [ResolvedField(field="malaria_incidence", value=120.0, citation="WB WDI, KEN, 2022",
                              description="per 1,000 population at risk/yr")]
    result = _apply_wb_disease_prevalence(params, resolved)
    assert result is not params
    expected = 120.0 / 1_000 / 365 * 7.0
    assert abs(result.init_prev - expected) < 1e-12


def test_apply_wb_disease_prevalence_caps_at_0_5():
    params = SimParams(beta=22.8125, init_prev=0.01, dur_inf=10.0)
    resolved = [ResolvedField(field="hiv_prevalence", value=99.0, citation="x",
                              description="% of population ages 15–49")]
    result = _apply_wb_disease_prevalence(params, resolved)
    assert result.init_prev == 0.5


def test_apply_wb_disease_prevalence_enforces_minimum():
    params = SimParams(beta=22.8125, init_prev=0.01, dur_inf=10.0)
    resolved = [ResolvedField(field="tb_incidence", value=0.001, citation="x",
                              description="per 100,000/yr")]
    result = _apply_wb_disease_prevalence(params, resolved)
    assert result.init_prev == 0.0001
```

- [ ] **Step 3.2: Run tests to confirm they fail**

```
pytest tests/test_parser_unit.py::test_apply_wb_disease_prevalence_no_op_when_no_disease_field tests/test_parser_unit.py::test_apply_wb_disease_prevalence_uses_prevalence_percent -v
```

Expected: `ImportError: cannot import name '_apply_wb_disease_prevalence'`

- [ ] **Step 3.3: Add `_apply_wb_disease_prevalence` to `epichat/parser.py`**

Add this function after `_apply_surveillance`:

```python
def _apply_wb_disease_prevalence(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    # WHO GHO surveillance takes precedence
    if any(rf.field.endswith("_cases") for rf in resolved):
        return params
    disease_field = next(
        (rf for rf in resolved if rf.field.endswith(("_prevalence", "_incidence"))),
        None,
    )
    if disease_field is None:
        return params
    from .adapters.wb_data360 import INCIDENCE_SCALE
    scale = INCIDENCE_SCALE.get(disease_field.field)
    if scale is None:
        return params
    if disease_field.field.endswith("_prevalence"):
        init_prev = disease_field.value / scale
    else:
        init_prev = disease_field.value / scale / 365 * params.dur_inf
    init_prev = max(0.0001, min(0.5, init_prev))
    return SimParams.model_validate({**params.model_dump(), "init_prev": init_prev})
```

Also update the `parse_query()` tail to add the new call (add it after `_apply_surveillance`):

```python
    params = _apply_age_distribution(params, resolved)
    params = _apply_vaccination_coverage(params, resolved)
    params = _apply_surveillance(params, resolved)
    params = _apply_wb_disease_prevalence(params, resolved)
    params = _apply_health_system(params, resolved)
    params = _apply_population_scale(params, resolved)
    return params
```

Note: `_apply_health_system` does not exist yet — add a stub so the module loads:

```python
def _apply_health_system(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    return params  # implemented in Task 4
```

- [ ] **Step 3.4: Run disease prevalence tests**

```
pytest tests/test_parser_unit.py -k "wb_disease_prevalence" -v
```

Expected: all pass

- [ ] **Step 3.5: Run full test suite**

```
pytest tests/ -v
```

Expected: all pass

- [ ] **Step 3.6: Commit**

```
git add epichat/parser.py tests/test_parser_unit.py
git commit -m "feat: add _apply_wb_disease_prevalence post-processor with WHO GHO precedence"
```

---

## Task 4: Add `_apply_health_system` post-processor

**Files:**
- Modify: `epichat/parser.py`
- Modify: `tests/test_parser_unit.py`

- [ ] **Step 4.1: Write failing tests**

Append to `tests/test_parser_unit.py`:

```python
# ── _apply_health_system ──────────────────────────────────────────────────────

def test_apply_health_system_no_op_when_llm_set_treatment():
    from epichat.schema import Intervention
    treatment = Intervention(type="treatment", coverage=0.8, capacity=50, start_day=0)
    params = SimParams(beta=22.8125, interventions=[treatment], n_agents=10000)
    resolved = [ResolvedField(field="treatment_capacity", value=2.3, citation="x")]
    result = _apply_health_system(params, resolved)
    assert result is params   # LLM wins


def test_apply_health_system_no_op_when_no_health_fields():
    params = SimParams(beta=22.8125, n_agents=10000)
    resolved = [ResolvedField(field="birth_rate", value=28.5, citation="x")]
    result = _apply_health_system(params, resolved)
    assert result is params


def test_apply_health_system_uses_beds_for_capacity():
    """2.3 beds/1,000 × 10,000 agents → capacity = 23"""
    params = SimParams(beta=22.8125, n_agents=10000)
    resolved = [ResolvedField(field="treatment_capacity", value=2.3, citation="WB WDI, KEN, 2021",
                              description="hospital beds/1,000")]
    result = _apply_health_system(params, resolved)
    assert result is not params
    treatment = result.get_treatment()
    assert treatment is not None
    assert treatment.capacity == 23


def test_apply_health_system_uses_uhc_for_coverage():
    """UHC index 56 → treatment coverage = 0.56"""
    params = SimParams(beta=22.8125, n_agents=10000)
    resolved = [ResolvedField(field="uhc_coverage", value=56.0, citation="WB WDI, KEN, 2022")]
    result = _apply_health_system(params, resolved)
    treatment = result.get_treatment()
    assert treatment is not None
    assert abs(treatment.coverage - 0.56) < 1e-9


def test_apply_health_system_creates_treatment_with_both_fields():
    params = SimParams(beta=22.8125, n_agents=10000)
    resolved = [
        ResolvedField(field="treatment_capacity", value=2.3, citation="WB WDI, KEN, 2021",
                      description="hospital beds/1,000"),
        ResolvedField(field="uhc_coverage", value=56.0, citation="WB WDI, KEN, 2022"),
    ]
    result = _apply_health_system(params, resolved)
    treatment = result.get_treatment()
    assert treatment is not None
    assert treatment.capacity == 23
    assert abs(treatment.coverage - 0.56) < 1e-9
    assert treatment.start_day == 0


def test_apply_health_system_capacity_minimum_one():
    """Very small bed count must not produce capacity=0 (Pydantic constraint: ge=1)."""
    params = SimParams(beta=22.8125, n_agents=100)
    resolved = [ResolvedField(field="treatment_capacity", value=0.001, citation="x",
                              description="hospital beds/1,000")]
    result = _apply_health_system(params, resolved)
    treatment = result.get_treatment()
    assert treatment is not None
    assert treatment.capacity >= 1


def test_apply_health_system_returns_new_simparams_via_model_validate():
    params = SimParams(beta=22.8125, n_agents=10000)
    resolved = [ResolvedField(field="treatment_capacity", value=2.3, citation="x",
                              description="hospital beds/1,000")]
    result = _apply_health_system(params, resolved)
    assert isinstance(result, SimParams)
    assert result is not params
    assert params.get_treatment() is None   # original unchanged
```

- [ ] **Step 4.2: Run tests to confirm they fail**

```
pytest tests/test_parser_unit.py -k "health_system" -v
```

Expected: all fail (stub returns `params` unchanged)

- [ ] **Step 4.3: Replace the stub `_apply_health_system` in `epichat/parser.py`**

```python
def _apply_health_system(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    if params.get_treatment() is not None:
        return params
    capacity_field = next((rf for rf in resolved if rf.field == "treatment_capacity"), None)
    uhc_field = next((rf for rf in resolved if rf.field == "uhc_coverage"), None)
    if capacity_field is None and uhc_field is None:
        return params
    from .schema import Intervention
    capacity = max(1, round(capacity_field.value / 1000 * params.n_agents)) if capacity_field else None
    coverage = uhc_field.value / 100.0 if uhc_field else 1.0
    treatment = Intervention(type="treatment", capacity=capacity, coverage=coverage, start_day=0)
    return SimParams.model_validate({
        **params.model_dump(),
        "interventions": params.model_dump()["interventions"] + [treatment.model_dump()],
    })
```

- [ ] **Step 4.4: Run health system tests**

```
pytest tests/test_parser_unit.py -k "health_system" -v
```

Expected: all pass

- [ ] **Step 4.5: Run full test suite**

```
pytest tests/ -v
```

Expected: all pass

- [ ] **Step 4.6: Commit**

```
git add epichat/parser.py tests/test_parser_unit.py
git commit -m "feat: add _apply_health_system post-processor for treatment capacity and coverage"
```

---

## Task 5: Update `format_cli()` to render alternatives

**Files:**
- Modify: `epichat/epichat.py`
- Modify: `tests/test_epichat_unit.py`

- [ ] **Step 5.1: Write failing tests**

Append to `tests/test_epichat_unit.py`:

```python
# ── alternatives rendering ────────────────────────────────────────────────────

def test_format_cli_single_value_no_star_marker():
    result = _base_result(data_sources=[
        ResolvedField(field="birth_rate", value=28.5, citation="UN WPP, KEN, 2023"),
    ])
    cli = result.format_cli()
    assert "★" not in cli


def test_format_cli_field_with_alternatives_shows_star_used():
    alt = ResolvedField(field="treatment_capacity", value=0.2, citation="WB WDI, KEN, 2021",
                        description="physicians/1,000")
    primary = ResolvedField(field="treatment_capacity", value=2.3, citation="WB WDI, KEN, 2021",
                            description="hospital beds/1,000", alternatives=[alt])
    result = _base_result(data_sources=[primary])
    cli = result.format_cli()
    assert "★ used" in cli


def test_format_cli_alternatives_shown_with_arrow():
    alt = ResolvedField(field="treatment_capacity", value=0.2, citation="WB WDI, KEN, 2021",
                        description="physicians/1,000")
    primary = ResolvedField(field="treatment_capacity", value=2.3, citation="WB WDI, KEN, 2021",
                            description="hospital beds/1,000", alternatives=[alt])
    result = _base_result(data_sources=[primary])
    cli = result.format_cli()
    assert "↳" in cli
    assert "0.2" in cli
    assert "physicians/1,000" in cli


def test_format_cli_description_shown_in_parentheses():
    primary = ResolvedField(field="uhc_coverage", value=56.0, citation="WB WDI, KEN, 2022",
                            description="UHC service coverage index 0–100")
    result = _base_result(data_sources=[primary])
    cli = result.format_cli()
    assert "(UHC service coverage index 0–100)" in cli


def test_format_cli_no_description_no_parentheses():
    primary = ResolvedField(field="birth_rate", value=28.5, citation="UN WPP, KEN, 2023")
    result = _base_result(data_sources=[primary])
    cli = result.format_cli()
    # No empty parentheses
    assert "()" not in cli
```

- [ ] **Step 5.2: Run tests to confirm they fail**

```
pytest tests/test_epichat_unit.py -k "alternatives or star or description or arrow" -v
```

Expected: all fail

- [ ] **Step 5.3: Update the DATA SOURCES block in `format_cli()` in `epichat/epichat.py`**

Replace the existing DATA SOURCES rendering block (lines starting with `if self.data_sources:`) with:

```python
        if self.data_sources:
            lines.append("")
            lines.append("DATA SOURCES")
            max_field_len = max(len(rf.field) for rf in self.data_sources)
            for rf in self.data_sources:
                if isinstance(rf.value, dict):
                    val_str = ", ".join(f"{k}: {v}%" for k, v in rf.value.items())
                else:
                    val_str = str(rf.value)
                desc = f"  ({rf.description})" if rf.description else ""
                used_marker = "  ★ used" if rf.alternatives else ""
                lines.append(
                    f"  {rf.field:<{max_field_len}}  {val_str}  — {rf.citation}{desc}{used_marker}"
                )
                for alt in rf.alternatives:
                    if isinstance(alt.value, dict):
                        alt_val = ", ".join(f"{k}: {v}%" for k, v in alt.value.items())
                    else:
                        alt_val = str(alt.value)
                    alt_desc = f"  ({alt.description})" if alt.description else ""
                    lines.append(f"    ↳ {alt_val}  — {alt.citation}{alt_desc}")
```

- [ ] **Step 5.4: Run all CLI tests**

```
pytest tests/test_epichat_unit.py -v
```

Expected: all pass

- [ ] **Step 5.5: Run full test suite**

```
pytest tests/ -v
```

Expected: all pass

- [ ] **Step 5.6: Commit**

```
git add epichat/epichat.py tests/test_epichat_unit.py
git commit -m "feat: render ResolvedField alternatives with ★ used marker in format_cli"
```

---

## Task 6: Register adapter and update extraction prompt

**Files:**
- Modify: `epichat/epichat.py`
- Modify: `epichat/prompts/extraction.txt`

- [ ] **Step 6.1: Register `WorldBankData360Adapter` in `epichat/epichat.py`**

Add the import at the top of `epichat/epichat.py` with the existing adapter imports:

```python
from .adapters.wb_data360 import WorldBankData360Adapter
```

Update `EpiChat.__init__` to register the new adapter:

```python
    def __init__(self, output_dir: str | Path = "results") -> None:
        self.output_dir = Path(output_dir)
        self.generator = CodeGenerator()
        self.executor = SimExecutor()
        configure_resolver(UNWPPAdapter(api_key=os.environ.get("UN_API_KEY")))
        configure_resolver(WHOGHOAdapter())
        configure_resolver(WorldBankData360Adapter())
```

- [ ] **Step 6.2: Verify adapter instantiation is clean**

```
pytest tests/test_epichat_unit.py::test_epichat_run_handles_validation_error_gracefully -v
```

Expected: pass (this test instantiates `EpiChat` and checks the run handles bad params gracefully)

- [ ] **Step 6.3: Update `epichat/prompts/extraction.txt`**

Append this block after the `## WHO GHO data queries` section (before `## Location table`):

```
## World Bank Data360 data queries

When the user mentions a country *and* a disease not covered by WHO GHO (TB, HIV/AIDS,
malaria, diabetes, hepatitis B), or when the user asks about hospital capacity or
healthcare system strength, add a "wb_data360" query alongside the "un_wpp" query.

Use `indicator_codes` (Data360 format), `location_code` (ISO3), `database_id` defaults
to "WB_WDI". Always include both the demographic WDI codes for cross-source comparison.

Health system — request whenever the user mentions treatment, hospitals, or healthcare:
  indicator_codes: ["WB_WDI_SH_MED_BEDS_ZS", "WB_WDI_SH_MED_PHYS_ZS",
                    "WB_WDI_SH_MED_NUMW_P3", "WB_WDI_SH_UHC_SRVS_CV_XD"]

Disease epidemiology — request the matching indicator(s) for the disease being simulated:

| Disease    | indicator_codes                                                    |
|------------|--------------------------------------------------------------------|
| TB         | ["WB_WDI_SH_TBS_INCD"]                                            |
| HIV/AIDS   | ["WB_WDI_SH_DYN_AIDS_ZS", "WB_WDI_SH_HIV_INCD_TL_P3"]            |
| Malaria    | ["WB_WDI_SH_MLR_INCD_P3"]                                         |
| Diabetes   | ["WB_WDI_SH_STA_DIAB_ZS"]                                         |
| Hepatitis B| ["WB_WDI_SH_HEP_HBVS_ZS"]                                         |

Demographics — always include alongside a UN WPP query for cross-source comparison:
  indicator_codes: ["WB_WDI_SP_DYN_CBRT_IN", "WB_WDI_SP_DYN_CDRT_IN",
                    "WB_WDI_SP_POP_TOTL"]

Precedence: WHO GHO (who_gho source) takes priority for vaccine-preventable diseases
(measles, polio, pertussis, etc.). Use wb_data360 disease indicators only for diseases
not covered by WHO GHO.

Example output for HIV in Kenya with health system context:

```json
{
  "source": "wb_data360",
  "database_id": "WB_WDI",
  "indicator_codes": [
    "WB_WDI_SH_DYN_AIDS_ZS", "WB_WDI_SH_HIV_INCD_TL_P3",
    "WB_WDI_SH_MED_BEDS_ZS", "WB_WDI_SH_MED_PHYS_ZS",
    "WB_WDI_SH_MED_NUMW_P3", "WB_WDI_SH_UHC_SRVS_CV_XD",
    "WB_WDI_SP_DYN_CBRT_IN", "WB_WDI_SP_DYN_CDRT_IN", "WB_WDI_SP_POP_TOTL"
  ],
  "location_code": "KEN",
  "start_year": 2018,
  "end_year": 2024
}
```
```

- [ ] **Step 6.4: Run full test suite**

```
pytest tests/ -v
```

Expected: all pass

- [ ] **Step 6.5: Commit**

```
git add epichat/epichat.py epichat/prompts/extraction.txt
git commit -m "feat: register WorldBankData360Adapter; add wb_data360 block to extraction prompt"
```

---

## Task 7: Append Data360 section to `ROADMAP.md`

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 7.1: Append Data360 deferred features section to `ROADMAP.md`**

Append to the end of `ROADMAP.md`:

```markdown
---

## Data360 Adapter — Deferred Features

These items were explicitly scoped out of the initial Data360 adapter
(`epichat/adapters/wb_data360.py`) and should be considered for future phases.

### WASH / Sanitation Indicators

Indicators: access to clean water (`WB_WDI_SH_H2O_BASW_ZS`), basic sanitation
(`WB_WDI_SH_STA_BASS_ZS`).

Relevance: transmission modifier for enteric diseases (cholera, typhoid). Would
require a new `transmission_modifier` parameter in `SimParams` and a corresponding
post-processor.

### Socioeconomic Context

Indicators: GDP per capita (`WB_WDI_NY_GDP_PCAP_CD`), poverty headcount
(`WB_WDI_SI_POV_DDAY`).

Relevance: supplementary narrative context only. No direct simulation parameter
mapping is defined — would require extending the narration step.

### Health Expenditure

Indicators: current health expenditure % of GDP (`WB_WDI_SH_XPD_CHEX_GD_ZS`),
out-of-pocket expenditure % (`WB_WDI_SH_XPD_OOPC_CH_ZS`).

Relevance: proxy for treatment-seeking behaviour; could refine `treatment.coverage`
estimate. High out-of-pocket share → lower effective coverage.

### Other Data360 Databases

Data360 aggregates multiple databases beyond WB_WDI (HNP, WHO-sourced datasets).
Accessing them requires surfacing `database_id` more explicitly in the LLM extraction
prompt. Worth exploring once WDI integration proves stable.

### Capacity Estimation Function

The current formula — `capacity = round(beds_per_1000 / 1000 * n_agents)` — is a
rough linear approximation. A more accurate estimator would incorporate:

- Typical bed occupancy rates (~65–75% for acute care beds)
- Disease-specific bed utilisation (e.g., ICU beds for severe COVID vs. general
  wards for TB)
- Staffing ratios (physicians and nurses per bed as constraints)

This estimation function is analogous to how `_apply_surveillance` derives `init_prev`
from raw case counts rather than using them directly.
```

- [ ] **Step 7.2: Verify the file renders correctly (no syntax errors)**

```
python -c "open('ROADMAP.md').read(); print('OK')"
```

Expected: `OK`

- [ ] **Step 7.3: Run full test suite one final time**

```
pytest tests/ -v
```

Expected: all pass

- [ ] **Step 7.4: Commit**

```
git add ROADMAP.md
git commit -m "docs: add Data360 deferred features section to ROADMAP"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Section 1 (ResolvedField + DataQuery) → Task 1
- [x] Section 2 (WorldBankData360Adapter, INDICATOR_MAP, CANDIDATE_GROUPS, INCIDENCE_SCALE) → Task 2
- [x] Section 3 (_apply_wb_disease_prevalence, _apply_health_system, parse_query tail) → Tasks 3–4
- [x] Section 4 (format_cli alternatives rendering) → Task 5
- [x] Section 5 (extraction prompt wb_data360 block) → Task 6
- [x] Section 6 (registration in EpiChat constructor) → Task 6
- [x] ROADMAP section → Task 7

**Type consistency:** `INCIDENCE_SCALE` imported inside `_apply_wb_disease_prevalence` (lazy import to avoid any circular import risk, following existing pattern of `from .schema import Intervention` inside `_apply_vaccination_coverage`). All method signatures and field names consistent across tasks.

**Placeholder scan:** No TBD, no "implement later", no "add appropriate error handling" — all steps include full code.
