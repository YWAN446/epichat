# Data-Informed Resolver Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resolver layer that fetches real UN WPP demographic data and uses it to inform `SimParams` defaults for country-specific queries via a two-step LLM pipeline.

**Architecture:** LLM Call 1 extracts preliminary params and a `DataQuery` spec; the `UNWPPAdapter` fetches birth rate, death rate, and age distribution from the UN Population Data Portal API; LLM Call 2 refines the preliminary params using the resolved data. If no geography is mentioned, the pipeline is identical to today.

**Tech Stack:** Python 3.10+, Pydantic v2, Anthropic SDK, stdlib `urllib.request` (no new dependencies), pytest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `epichat/resolver.py` | Create | `DataQuery`, `ResolvedField`, `SourceAdapter` Protocol, `Resolver` |
| `epichat/adapters/__init__.py` | Create | Package init |
| `epichat/adapters/un_wpp.py` | Create | `UNWPPAdapter` — location cache + data fetch + field mapping |
| `epichat/parser.py` | Modify | `IntentResult`, `_llm_call_1`, `_run_resolver`, `_llm_call_2`, updated `parse_query()`, `configure_resolver()` |
| `epichat/prompts/extraction.txt` | Modify | Add `## Data resolver` section with location table placeholder |
| `epichat/prompts/refinement.txt` | Create | LLM-2 refinement prompt |
| `epichat/epichat.py` | Modify | `EpiChatResult.data_sources`, `format_cli()` DATA SOURCES block |
| `.env.example` | Modify | Add `UN_API_KEY=` |
| `tests/test_resolver.py` | Create | Unit tests for resolver core types |
| `tests/test_un_wpp.py` | Create | Unit tests for `UNWPPAdapter` |
| `tests/test_parser_unit.py` | Create | Offline unit tests for two-step parser |

---

## Task 1: Core Resolver Types

**Files:**
- Create: `epichat/resolver.py`
- Create: `tests/test_resolver.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_resolver.py`:

```python
from dataclasses import dataclass
from epichat.resolver import DataQuery, ResolvedField, Resolver


@dataclass
class _EchoAdapter:
    source_name: str = "echo"

    def fetch(self, query: DataQuery) -> list[ResolvedField]:
        return [ResolvedField(field="birth_rate", value=20.0, citation="echo")]


def test_resolved_field_attributes():
    rf = ResolvedField(field="birth_rate", value=10.5, citation="UN WPP 2024, USA, 2023")
    assert rf.field == "birth_rate"
    assert rf.value == 10.5
    assert rf.citation == "UN WPP 2024, USA, 2023"


def test_data_query_attributes():
    dq = DataQuery(source="un_wpp", indicators=[55, 59], location_id=840, start_year=2020, end_year=2024)
    assert dq.source == "un_wpp"
    assert dq.indicators == [55, 59]
    assert dq.location_id == 840


def test_resolver_empty_queries_returns_empty():
    r = Resolver()
    assert r.resolve([]) == []


def test_resolver_routes_to_registered_adapter():
    r = Resolver()
    r.register(_EchoAdapter())
    results = r.resolve([DataQuery(source="echo", indicators=[], location_id=1, start_year=2023, end_year=2023)])
    assert len(results) == 1
    assert results[0].field == "birth_rate"


def test_resolver_unknown_source_skips():
    r = Resolver()
    results = r.resolve([DataQuery(source="unknown", indicators=[], location_id=1, start_year=2023, end_year=2023)])
    assert results == []


def test_resolver_multiple_adapters():
    @dataclass
    class _OtherAdapter:
        source_name: str = "other"
        def fetch(self, query: DataQuery) -> list[ResolvedField]:
            return [ResolvedField(field="death_rate", value=8.0, citation="other")]

    r = Resolver()
    r.register(_EchoAdapter())
    r.register(_OtherAdapter())
    queries = [
        DataQuery(source="echo", indicators=[], location_id=1, start_year=2023, end_year=2023),
        DataQuery(source="other", indicators=[], location_id=1, start_year=2023, end_year=2023),
    ]
    results = r.resolve(queries)
    fields = {rf.field for rf in results}
    assert fields == {"birth_rate", "death_rate"}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd epichat && pytest tests/test_resolver.py -v
```

Expected: `ModuleNotFoundError: No module named 'epichat.resolver'`

- [ ] **Step 3: Implement `epichat/resolver.py`**

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass
class DataQuery:
    source: str
    indicators: list[int]
    location_id: int
    start_year: int
    end_year: int


@dataclass
class ResolvedField:
    field: str
    value: Any
    citation: str


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

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_resolver.py -v
```

Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add epichat/resolver.py tests/test_resolver.py
git commit -m "feat: add core resolver types (DataQuery, ResolvedField, Resolver)"
```

---

## Task 2: UNWPPAdapter — Location Cache

**Files:**
- Create: `epichat/adapters/__init__.py`
- Create: `epichat/adapters/un_wpp.py` (location cache portion)
- Create: `tests/test_un_wpp.py`

- [ ] **Step 1: Write failing tests for location cache**

Create `tests/test_un_wpp.py`:

```python
import io
from unittest.mock import MagicMock, patch

from epichat.adapters.un_wpp import UNWPPAdapter

_LOCATIONS_CSV = """\
sep =|
id|name|iso3|iso2|longitude|latitude
840|United States of America|USA|US|-95.71|37.09
404|Kenya|KEN|KE|37.91|-0.02
356|India|IND|IN|78.96|20.59
"""

_DATA_CSV_BIRTH_DEATH = """\
sep =|
LocationId|Location|Iso3|Iso2|LocationTypeId|IndicatorId|Indicator|IndicatorDisplayName|SourceId|Source|Revision|VariantId|Variant|VariantShortName|VariantLabel|TimeId|TimeLabel|TimeMid|CategoryId|Category|EstimateTypeId|EstimateType|EstimateMethodId|EstimateMethod|SexId|Sex|AgeId|AgeLabel|AgeStart|AgeEnd|AgeMid|Value
840|United States of America|USA|US|4|55|Crude birth rate|Crude birth rate (births per 1,000 population)|27|World Population Prospects|0|4|Median|Median|Median|73|2022|2022.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|188|Total|0|-1|0|10.981
840|United States of America|USA|US|4|55|Crude birth rate|Crude birth rate (births per 1,000 population)|27|World Population Prospects|0|4|Median|Median|Median|74|2023|2023.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|188|Total|0|-1|0|10.648
840|United States of America|USA|US|4|59|Crude death rate|Crude death rate (deaths per 1,000 population)|27|World Population Prospects|0|4|Median|Median|Median|74|2023|2023.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|188|Total|0|-1|0|8.663
"""

_DATA_CSV_AGE = """\
sep =|
LocationId|Location|Iso3|Iso2|LocationTypeId|IndicatorId|Indicator|IndicatorDisplayName|SourceId|Source|Revision|VariantId|Variant|VariantShortName|VariantLabel|TimeId|TimeLabel|TimeMid|CategoryId|Category|EstimateTypeId|EstimateType|EstimateMethodId|EstimateMethod|SexId|Sex|AgeId|AgeLabel|AgeStart|AgeEnd|AgeMid|Value
840|United States of America|USA|US|4|71|Percentage|Percentage of total population by broad age group|27|World Population Prospects|0|4|Median|Median|Median|74|2023|2023.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|188|Total|0|-1|0|100
840|United States of America|USA|US|4|71|Percentage|Percentage of total population by broad age group|27|World Population Prospects|0|4|Median|Median|Median|74|2023|2023.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|901|0-17|0|17|8.5|21.577
840|United States of America|USA|US|4|71|Percentage|Percentage of total population by broad age group|27|World Population Prospects|0|4|Median|Median|Median|74|2023|2023.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|902|65+|65||82.5|17.432
"""


def _make_adapter(locations_csv=_LOCATIONS_CSV):
    with patch("epichat.adapters.un_wpp._fetch_text", return_value=locations_csv):
        return UNWPPAdapter(api_key="test-token")


def test_location_lookup_by_iso3():
    adapter = _make_adapter()
    assert adapter.location_id("USA") == 840
    assert adapter.location_id("KEN") == 404


def test_location_lookup_by_iso2():
    adapter = _make_adapter()
    assert adapter.location_id("US") == 840
    assert adapter.location_id("KE") == 404


def test_location_lookup_by_name():
    adapter = _make_adapter()
    assert adapter.location_id("Kenya") == 404
    assert adapter.location_id("United States of America") == 840


def test_location_lookup_unknown_returns_none():
    adapter = _make_adapter()
    assert adapter.location_id("ZZZ") is None


def test_iso3_table_contains_all_entries():
    adapter = _make_adapter()
    table = adapter.iso3_table()
    assert table["USA"] == 840
    assert table["KEN"] == 404
    assert table["IND"] == 356
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_un_wpp.py -v
```

Expected: `ModuleNotFoundError: No module named 'epichat.adapters'`

- [ ] **Step 3: Create package init**

Create `epichat/adapters/__init__.py` (empty):

```python
```

- [ ] **Step 4: Implement location cache in `epichat/adapters/un_wpp.py`**

```python
from __future__ import annotations

import csv
import io
import urllib.error
import urllib.request
from dataclasses import dataclass

from epichat.resolver import DataQuery, ResolvedField

_BASE_URL = "https://population.un.org/dataportalapi/api/v1"


def _fetch_text(url: str, api_key: str | None = None) -> str:
    req = urllib.request.Request(url)
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8")


def _parse_csv(text: str) -> list[dict[str, str]]:
    lines = text.splitlines()
    if lines and lines[0].startswith("sep"):
        lines = lines[1:]
    reader = csv.DictReader(lines, delimiter="|")
    return list(reader)


class UNWPPAdapter:
    source_name = "un_wpp"

    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = api_key
        self._loc_cache: dict[str, int] = {}
        self._load_locations()

    def _load_locations(self) -> None:
        url = f"{_BASE_URL}/locations?format=csv"
        try:
            text = _fetch_text(url)
        except Exception:
            return
        for row in _parse_csv(text):
            loc_id = int(row["id"])
            for key in ("iso3", "iso2", "name"):
                val = row.get(key, "").strip()
                if val:
                    self._loc_cache[val] = loc_id

    def location_id(self, key: str) -> int | None:
        return self._loc_cache.get(key)

    def iso3_table(self) -> dict[str, int]:
        return {k: v for k, v in self._loc_cache.items() if len(k) == 3 and k.isupper()}

    def fetch(self, query: DataQuery) -> list[ResolvedField]:
        return []  # data fetch implemented in Task 3
```

- [ ] **Step 5: Run location cache tests**

```bash
pytest tests/test_un_wpp.py::test_location_lookup_by_iso3 tests/test_un_wpp.py::test_location_lookup_by_iso2 tests/test_un_wpp.py::test_location_lookup_by_name tests/test_un_wpp.py::test_location_lookup_unknown_returns_none tests/test_un_wpp.py::test_iso3_table_contains_all_entries -v
```

Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add epichat/adapters/__init__.py epichat/adapters/un_wpp.py tests/test_un_wpp.py
git commit -m "feat: UNWPPAdapter location cache with iso2/iso3/name lookup"
```

---

## Task 3: UNWPPAdapter — Data Fetch & Field Mapping

**Files:**
- Modify: `epichat/adapters/un_wpp.py`

- [ ] **Step 1: Write failing tests for data fetch**

Append to `tests/test_un_wpp.py`:

```python
from epichat.resolver import DataQuery


def _make_adapter_with_data(data_csv):
    """Adapter whose fetch() returns mock data CSV."""
    def _side_effect(url, api_key=None):
        if "locations" in url:
            return _LOCATIONS_CSV
        return data_csv
    with patch("epichat.adapters.un_wpp._fetch_text", side_effect=_side_effect):
        return UNWPPAdapter(api_key="test-token")


def test_fetch_birth_and_death_rate():
    adapter = _make_adapter_with_data(_DATA_CSV_BIRTH_DEATH)
    query = DataQuery(source="un_wpp", indicators=[55, 59], location_id=840, start_year=2020, end_year=2024)
    with patch("epichat.adapters.un_wpp._fetch_text", return_value=_DATA_CSV_BIRTH_DEATH):
        results = adapter.fetch(query)
    fields = {r.field: r for r in results}
    assert "birth_rate" in fields
    assert abs(fields["birth_rate"].value - 10.648) < 0.001
    assert "death_rate" in fields
    assert abs(fields["death_rate"].value - 8.663) < 0.001


def test_fetch_uses_most_recent_estimate_year():
    # CSV has 2022 and 2023 for birth rate; should pick 2023
    adapter = _make_adapter_with_data(_DATA_CSV_BIRTH_DEATH)
    query = DataQuery(source="un_wpp", indicators=[55], location_id=840, start_year=2020, end_year=2024)
    with patch("epichat.adapters.un_wpp._fetch_text", return_value=_DATA_CSV_BIRTH_DEATH):
        results = adapter.fetch(query)
    birth = next(r for r in results if r.field == "birth_rate")
    assert abs(birth.value - 10.648) < 0.001  # 2023 value, not 2022


def test_fetch_age_distribution():
    adapter = _make_adapter_with_data(_DATA_CSV_AGE)
    query = DataQuery(source="un_wpp", indicators=[71], location_id=840, start_year=2020, end_year=2024)
    with patch("epichat.adapters.un_wpp._fetch_text", return_value=_DATA_CSV_AGE):
        results = adapter.fetch(query)
    age = next(r for r in results if r.field == "age_distribution_pct")
    assert abs(age.value["0-17"] - 21.577) < 0.01
    assert abs(age.value["65+"] - 17.432) < 0.01
    assert abs(age.value["18-64"] - (100 - 21.577 - 17.432)) < 0.1


def test_fetch_citation_format():
    adapter = _make_adapter_with_data(_DATA_CSV_BIRTH_DEATH)
    query = DataQuery(source="un_wpp", indicators=[55], location_id=840, start_year=2020, end_year=2024)
    with patch("epichat.adapters.un_wpp._fetch_text", return_value=_DATA_CSV_BIRTH_DEATH):
        results = adapter.fetch(query)
    birth = next(r for r in results if r.field == "birth_rate")
    assert "UN WPP" in birth.citation
    assert "USA" in birth.citation
    assert "2023" in birth.citation


def test_fetch_returns_empty_on_http_error():
    adapter = _make_adapter_with_data(_DATA_CSV_BIRTH_DEATH)
    query = DataQuery(source="un_wpp", indicators=[55, 59], location_id=840, start_year=2020, end_year=2024)
    with patch("epichat.adapters.un_wpp._fetch_text", side_effect=urllib.error.URLError("connection refused")):
        results = adapter.fetch(query)
    assert results == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_un_wpp.py::test_fetch_birth_and_death_rate tests/test_un_wpp.py::test_fetch_age_distribution -v
```

Expected: FAIL — `fetch()` returns `[]`

- [ ] **Step 3: Implement `fetch()` in `epichat/adapters/un_wpp.py`**

Replace the stub `fetch()` method with:

```python
import datetime

_INDICATOR_IDS = "55,59,71"
_VARIANT_MEDIAN = "4"
_SEX_BOTH = "3"
_ESTIMATE_METHOD_INTERP = "2"  # actual estimate (not projection)


def fetch(self, query: DataQuery) -> list[ResolvedField]:
    current_year = datetime.date.today().year
    ids = ",".join(str(i) for i in query.indicators)
    url = (
        f"{_BASE_URL}/data/indicators/{ids}"
        f"/locations/{query.location_id}"
        f"/start/{query.start_year}/end/{current_year}/?format=csv"
    )
    try:
        text = _fetch_text(url, self._api_key)
    except Exception:
        return []

    rows = _parse_csv(text)
    return self._map_rows(rows, query.location_id)


def _map_rows(self, rows: list[dict[str, str]], location_id: int) -> list[ResolvedField]:
    # Filter: median variant, both sexes, actual estimates only
    rows = [
        r for r in rows
        if r.get("VariantId") == _VARIANT_MEDIAN
        and r.get("SexId") == _SEX_BOTH
        and r.get("EstimateMethodId") == _ESTIMATE_METHOD_INTERP
    ]

    results: list[ResolvedField] = []

    # Birth rate (indicator 55) and death rate (indicator 59)
    for ind_id, field_name in [("55", "birth_rate"), ("59", "death_rate")]:
        candidates = [
            r for r in rows
            if r.get("IndicatorId") == ind_id and r.get("AgeLabel") == "Total"
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

    # Age distribution (indicator 71)
    age_rows = [r for r in rows if r.get("IndicatorId") == "71"]
    pct: dict[str, float] = {}
    best_year: str = ""
    iso3 = ""
    location_name = ""
    for label in ("0-17", "65+"):
        candidates = [r for r in age_rows if r.get("AgeLabel") == label]
        if not candidates:
            continue
        best = max(candidates, key=lambda r: int(r.get("TimeId", 0)))
        pct[label] = round(float(best["Value"]), 3)
        best_year = best.get("TimeLabel", "")
        iso3 = best.get("Iso3", str(location_id))
        location_name = best.get("Location", str(location_id))

    if "0-17" in pct and "65+" in pct:
        pct["18-64"] = round(100 - pct["0-17"] - pct["65+"], 3)
        results.append(ResolvedField(
            field="age_distribution_pct",
            value=pct,
            citation=f"UN WPP 2024, {location_name} ({iso3}), {best_year}",
        ))

    return results
```

Add `import datetime` at the top of the file and add `fetch` and `_map_rows` as methods of `UNWPPAdapter`.

- [ ] **Step 4: Run all UN adapter tests**

```bash
pytest tests/test_un_wpp.py -v
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add epichat/adapters/un_wpp.py tests/test_un_wpp.py
git commit -m "feat: UNWPPAdapter data fetch with birth/death rate and age distribution mapping"
```

---

## Task 4: `IntentResult` + `_llm_call_1` + Extraction Prompt Update

**Files:**
- Modify: `epichat/parser.py`
- Modify: `epichat/prompts/extraction.txt`
- Create: `tests/test_parser_unit.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_parser_unit.py`:

```python
import json
from unittest.mock import MagicMock, patch

from epichat.parser import IntentResult, _llm_call_1
from epichat.resolver import DataQuery
from epichat.schema import SimParams


def _mock_llm(response_text: str):
    """Return a mock anthropic client whose messages.create() returns response_text."""
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=response_text)]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_msg
    return mock_client


_PRELIM_JSON = json.dumps({
    "disease_type": "sir",
    "n_agents": 10000,
    "n_contacts": 4,
    "network_type": "random",
    "network_beta": 1.0,
    "beta": 22.8125,
    "init_prev": 0.01,
    "dur_inf": 10.0,
    "p_death": 0.0,
    "sim_dur_years": 1.0,
    "interventions": [],
})

_INTENT_WITH_QUERIES = json.dumps({
    "preliminary_params": json.loads(_PRELIM_JSON),
    "data_queries": [
        {
            "source": "un_wpp",
            "indicators": [55, 59, 71],
            "location_id": 404,
            "start_year": 2020,
            "end_year": 2024,
        }
    ],
})

_INTENT_NO_QUERIES = json.dumps({
    "preliminary_params": json.loads(_PRELIM_JSON),
    "data_queries": [],
})


def test_llm_call_1_parses_intent_with_queries():
    client = _mock_llm(_INTENT_WITH_QUERIES)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = _llm_call_1("simulate measles in Kenya")
    assert isinstance(result, IntentResult)
    assert isinstance(result.preliminary_params, SimParams)
    assert len(result.data_queries) == 1
    assert result.data_queries[0].source == "un_wpp"
    assert result.data_queries[0].location_id == 404


def test_llm_call_1_parses_intent_no_queries():
    client = _mock_llm(_INTENT_NO_QUERIES)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = _llm_call_1("run a default SIR model")
    assert isinstance(result, IntentResult)
    assert result.data_queries == []


def test_llm_call_1_handles_legacy_format():
    """LLM returns raw SimParams JSON (old format) — should still parse."""
    client = _mock_llm(_PRELIM_JSON)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = _llm_call_1("run a default SIR model")
    assert isinstance(result, IntentResult)
    assert result.data_queries == []
    assert isinstance(result.preliminary_params, SimParams)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_parser_unit.py::test_llm_call_1_parses_intent_with_queries tests/test_parser_unit.py::test_llm_call_1_parses_intent_no_queries -v
```

Expected: `ImportError: cannot import name 'IntentResult'`

- [ ] **Step 3: Add `IntentResult` and `_llm_call_1` to `epichat/parser.py`**

Add these imports at the top of `parser.py`:

```python
from dataclasses import dataclass
from .resolver import DataQuery, ResolvedField, Resolver, SourceAdapter
```

Add these definitions after the existing imports and before `parse_query()`:

```python
@dataclass
class IntentResult:
    preliminary_params: SimParams
    data_queries: list[DataQuery]


_resolver: Resolver = Resolver()


def configure_resolver(adapter: SourceAdapter) -> None:
    _resolver.register(adapter)


def _parse_json(raw: str) -> dict:
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    brace = raw.find("{")
    if brace > 0:
        raw = raw[brace:]
    return json.loads(raw)


def _llm_call_1(user_input: str) -> IntentResult:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    message = client.messages.create(
        model=_MODEL,
        max_tokens=1500,
        system=_load_system_prompt(),
        messages=[{"role": "user", "content": user_input}],
    )
    raw = message.content[0].text.strip()
    data = _parse_json(raw)

    if "clarification_needed" in data:
        raise ValueError(f"Query needs clarification: {data['clarification_needed']}")

    # New format: {preliminary_params, data_queries}
    if "preliminary_params" in data:
        prelim = data["preliminary_params"]
        prelim = {k: v for k, v in prelim.items() if v is not None or k in ("dur_exp", "dur_immune", "rand_seed", "capacity")}
        params = SimParams(**prelim)
        queries = [DataQuery(**q) for q in data.get("data_queries", [])]
        return IntentResult(preliminary_params=params, data_queries=queries)

    # Legacy format: raw SimParams JSON
    data = {k: v for k, v in data.items() if v is not None or k in ("dur_exp", "dur_immune", "rand_seed", "capacity")}
    return IntentResult(preliminary_params=SimParams(**data), data_queries=[])
```

- [ ] **Step 4: Update `epichat/prompts/extraction.txt`**

Append the following section to the end of `extraction.txt`:

```
## Output format

When the user mentions a country, region, or geography, wrap your response in this envelope:

{
  "preliminary_params": { ...the SimParams fields as before... },
  "data_queries": [
    {
      "source": "un_wpp",
      "indicators": [55, 59, 71],
      "location_id": <integer from the table below>,
      "start_year": 2020,
      "end_year": 2024
    }
  ]
}

When no geography is mentioned, you may still use this envelope with "data_queries": [],
or return the SimParams object directly as before.

## Location table (ISO3 → UN location_id)

{location_table}
```

- [ ] **Step 5: Update `_load_system_prompt()` to inject the location table**

In `epichat/parser.py`, replace:

```python
def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")
```

with:

```python
_LOCATION_TABLE: str = ""  # populated by configure_resolver when UNWPPAdapter is registered


def _load_system_prompt() -> str:
    text = _PROMPT_PATH.read_text(encoding="utf-8")
    return text.replace("{location_table}", _LOCATION_TABLE or "{}")
```

And update `configure_resolver()` to also populate `_LOCATION_TABLE`:

```python
import json as _json

def configure_resolver(adapter: SourceAdapter) -> None:
    global _LOCATION_TABLE
    _resolver.register(adapter)
    from .adapters.un_wpp import UNWPPAdapter
    if isinstance(adapter, UNWPPAdapter):
        _LOCATION_TABLE = _json.dumps(adapter.iso3_table(), separators=(",", ":"))
```

- [ ] **Step 6: Run all parser unit tests**

```bash
pytest tests/test_parser_unit.py -v
```

Expected: 3 passed

- [ ] **Step 7: Commit**

```bash
git add epichat/parser.py epichat/prompts/extraction.txt tests/test_parser_unit.py
git commit -m "feat: IntentResult + _llm_call_1 + extraction prompt data resolver section"
```

---

## Task 5: `refinement.txt` + `_llm_call_2`

**Files:**
- Create: `epichat/prompts/refinement.txt`
- Modify: `epichat/parser.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_parser_unit.py`:

```python
from epichat.parser import _llm_call_2
from epichat.resolver import ResolvedField


_REFINED_JSON = json.dumps({
    "disease_type": "sir",
    "n_agents": 10000,
    "n_contacts": 4,
    "network_type": "random",
    "network_beta": 1.0,
    "beta": 22.8125,
    "init_prev": 0.01,
    "dur_inf": 10.0,
    "p_death": 0.0,
    "sim_dur_years": 1.0,
    "use_demographics": True,
    "birth_rate": 28.5,
    "death_rate": 6.2,
    "interventions": [],
})


def test_llm_call_2_passthrough_when_no_resolved():
    prelim = SimParams(beta=22.8125, birth_rate=20.0, death_rate=10.0)
    result = _llm_call_2("query", prelim, [])
    assert result is prelim  # exact same object — no LLM call made


def test_llm_call_2_calls_llm_when_resolved_present():
    prelim = SimParams(beta=22.8125, birth_rate=20.0, death_rate=10.0)
    resolved = [
        ResolvedField(field="birth_rate", value=28.5, citation="UN WPP 2024, KEN, 2023"),
        ResolvedField(field="death_rate", value=6.2, citation="UN WPP 2024, KEN, 2023"),
    ]
    client = _mock_llm(_REFINED_JSON)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = _llm_call_2("simulate in Kenya", prelim, resolved)
    assert isinstance(result, SimParams)
    assert abs(result.birth_rate - 28.5) < 0.01
    assert abs(result.death_rate - 6.2) < 0.01


def test_llm_call_2_formats_resolved_fields_in_prompt():
    prelim = SimParams(beta=22.8125)
    resolved = [ResolvedField(field="birth_rate", value=28.5, citation="UN WPP 2024, KEN, 2023")]
    client = _mock_llm(_REFINED_JSON)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        _llm_call_2("simulate in Kenya", prelim, resolved)
    call_args = client.messages.create.call_args
    user_content = call_args[1]["messages"][0]["content"]
    assert "birth_rate: 28.5" in user_content
    assert "UN WPP 2024, KEN, 2023" in user_content
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_parser_unit.py::test_llm_call_2_passthrough_when_no_resolved tests/test_parser_unit.py::test_llm_call_2_calls_llm_when_resolved_present -v
```

Expected: `ImportError: cannot import name '_llm_call_2'`

- [ ] **Step 3: Create `epichat/prompts/refinement.txt`**

```
You are refining epidemic simulation parameters with real-world demographic data.
User-stated values take precedence over resolved data.
Return ONLY the final SimParams JSON — no prose, no markdown fences.

Original query: {user_input}

Preliminary parameters:
{preliminary_params}

Resolved data (use these to replace or improve the preliminary values):
{resolved_fields}
```

- [ ] **Step 4: Add `_llm_call_2` to `epichat/parser.py`**

Add this constant near the top of the file:

```python
_REFINEMENT_PROMPT_PATH = Path(__file__).parent / "prompts" / "refinement.txt"
```

Add this function:

```python
def _llm_call_2(user_input: str, prelim: SimParams, resolved: list[ResolvedField]) -> SimParams:
    if not resolved:
        return prelim

    resolved_text = "\n".join(
        f"- {rf.field}: {rf.value} — {rf.citation}" for rf in resolved
    )
    user_message = (
        _REFINEMENT_PROMPT_PATH.read_text(encoding="utf-8")
        .replace("{user_input}", user_input)
        .replace("{preliminary_params}", json.dumps(prelim.model_dump(), indent=2))
        .replace("{resolved_fields}", resolved_text)
    )

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    message = client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        system="You are an epidemiological parameter assistant. Return only valid JSON.",
        messages=[{"role": "user", "content": user_message}],
    )
    raw = message.content[0].text.strip()
    data = _parse_json(raw)
    data = {k: v for k, v in data.items() if v is not None or k in ("dur_exp", "dur_immune", "rand_seed", "capacity")}
    return SimParams(**data)
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_parser_unit.py -v
```

Expected: all tests pass (6 total)

- [ ] **Step 6: Commit**

```bash
git add epichat/prompts/refinement.txt epichat/parser.py tests/test_parser_unit.py
git commit -m "feat: _llm_call_2 with refinement prompt; passthrough when no resolved data"
```

---

## Task 6: `_run_resolver` + Two-Step `parse_query()`

**Files:**
- Modify: `epichat/parser.py`

- [ ] **Step 1: Write failing test**

Append to `tests/test_parser_unit.py`:

```python
from epichat.parser import parse_query, configure_resolver
from epichat.resolver import Resolver, ResolvedField, DataQuery


def test_parse_query_skips_resolver_when_no_queries():
    """End-to-end: no geography → single LLM call, no resolver."""
    client = _mock_llm(_INTENT_NO_QUERIES)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = parse_query("run a default SIR model")
    assert isinstance(result, SimParams)
    # Only one LLM call was made (LLM-1 only)
    assert client.messages.create.call_count == 1


def test_parse_query_uses_resolver_when_queries_present():
    """End-to-end: geography present → resolver runs → LLM-2 refines."""
    from dataclasses import dataclass

    @dataclass
    class _FixedAdapter:
        source_name: str = "un_wpp"
        def fetch(self, query: DataQuery) -> list[ResolvedField]:
            return [
                ResolvedField(field="birth_rate", value=28.5, citation="UN WPP 2024, KEN, 2023"),
                ResolvedField(field="death_rate", value=6.2, citation="UN WPP 2024, KEN, 2023"),
            ]

    configure_resolver(_FixedAdapter())

    lm1_response = _mock_llm(_INTENT_WITH_QUERIES)
    lm2_response = _mock_llm(_REFINED_JSON)

    call_count = [0]
    def _side_effect(*args, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            return lm1_response.messages.create(*args, **kwargs)
        return lm2_response.messages.create(*args, **kwargs)

    combined_client = MagicMock()
    combined_client.messages.create.side_effect = _side_effect

    with patch("epichat.parser.anthropic.Anthropic", return_value=combined_client):
        result = parse_query("simulate measles in Kenya")

    assert isinstance(result, SimParams)
    assert combined_client.messages.create.call_count == 2
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_parser_unit.py::test_parse_query_skips_resolver_when_no_queries -v
```

Expected: FAIL — `parse_query` still uses old single-call path

- [ ] **Step 3: Rewrite `parse_query()` in `epichat/parser.py`**

Replace the existing `parse_query()` with:

```python
def _run_resolver(queries: list[DataQuery]) -> list[ResolvedField]:
    if not queries:
        return []
    return _resolver.resolve(queries)


def parse_query(user_input: str) -> SimParams:
    intent = _llm_call_1(user_input)
    resolved = _run_resolver(intent.data_queries)
    return _llm_call_2(user_input, intent.preliminary_params, resolved)
```

- [ ] **Step 4: Run all parser unit tests**

```bash
pytest tests/test_parser_unit.py -v
```

Expected: all 8 tests pass

- [ ] **Step 5: Run existing live parser tests (optional — requires API keys)**

```bash
EPICHAT_TEST_LIVE=1 pytest tests/test_parser.py -v --tb=short
```

Expected: same pass rate as before (no regressions)

- [ ] **Step 6: Commit**

```bash
git add epichat/parser.py tests/test_parser_unit.py
git commit -m "feat: two-step parse_query() with _run_resolver orchestration"
```

---

## Task 7: `EpiChatResult.data_sources` + CLI Citation Block

**Files:**
- Modify: `epichat/epichat.py`
- Create: `tests/test_epichat_unit.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_epichat_unit.py`:

```python
from epichat.epichat import EpiChatResult
from epichat.resolver import ResolvedField
from epichat.schema import SimParams


def _base_result(**kwargs) -> EpiChatResult:
    defaults = dict(
        user_input="test",
        params=SimParams(beta=22.8125),
        stats={"n_agents": 10000, "peak_infections": 3000, "peak_day": 45, "total_infected": 6000, "total_deaths": 0},
        plot_path=None,
        narration={"summary": "A test.", "key_findings": []},
        data_sources=[],
    )
    defaults.update(kwargs)
    return EpiChatResult(**defaults)


def test_format_cli_no_data_sources_omits_section():
    result = _base_result()
    output = result.format_cli()
    assert "DATA SOURCES" not in output


def test_format_cli_with_data_sources_shows_section():
    result = _base_result(data_sources=[
        ResolvedField(field="birth_rate", value=28.5, citation="UN WPP 2024, Kenya (KEN), 2023"),
        ResolvedField(field="death_rate", value=6.2, citation="UN WPP 2024, Kenya (KEN), 2023"),
    ])
    output = result.format_cli()
    assert "DATA SOURCES" in output
    assert "birth_rate" in output
    assert "28.5" in output
    assert "UN WPP 2024, Kenya (KEN), 2023" in output


def test_format_cli_data_sources_includes_all_fields():
    result = _base_result(data_sources=[
        ResolvedField(field="birth_rate", value=10.5, citation="src A"),
        ResolvedField(field="death_rate", value=8.1, citation="src B"),
        ResolvedField(
            field="age_distribution_pct",
            value={"0-17": 21.6, "18-64": 61.0, "65+": 17.4},
            citation="src C",
        ),
    ])
    output = result.format_cli()
    assert "death_rate" in output
    assert "age_distribution_pct" in output
    assert "src C" in output
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_epichat_unit.py -v
```

Expected: `TypeError: EpiChatResult.__init__() got an unexpected keyword argument 'data_sources'`

- [ ] **Step 3: Update `EpiChatResult` in `epichat/epichat.py`**

Add the import at the top:

```python
from .resolver import ResolvedField
```

Add `data_sources` field to the dataclass (after `error`):

```python
data_sources: list[ResolvedField] = field(default_factory=list)
```

Add `from dataclasses import dataclass, field` if `field` is not already imported (currently it uses `@dataclass` but check the import).

- [ ] **Step 4: Add DATA SOURCES block to `format_cli()`**

In `format_cli()`, after the `MODEL DETAILS` section and before the plot path line, insert:

```python
if self.data_sources:
    lines.append("")
    lines.append("DATA SOURCES")
    for rf in self.data_sources:
        if isinstance(rf.value, dict):
            val_str = ", ".join(f"{k}: {v}%" for k, v in rf.value.items())
        else:
            val_str = str(rf.value)
        lines.append(f"  {rf.field}: {val_str} — {rf.citation}")
```

- [ ] **Step 5: Pass `data_sources` through the `EpiChat.run()` pipeline**

In `epichat/epichat.py`, update the `run()` method to capture resolved fields from `parse_query()`. Since `parse_query()` returns a `SimParams`, not the resolved fields directly, the resolved fields need to be surfaced.

The cleanest approach for the MVP: add a module-level list in `parser.py` that stores the most recent resolved fields:

In `epichat/parser.py`, add:

```python
_last_resolved: list[ResolvedField] = []


def get_last_resolved() -> list[ResolvedField]:
    return list(_last_resolved)
```

Update `parse_query()` to populate it:

```python
def parse_query(user_input: str) -> SimParams:
    global _last_resolved
    intent = _llm_call_1(user_input)
    resolved = _run_resolver(intent.data_queries)
    _last_resolved = resolved
    return _llm_call_2(user_input, intent.preliminary_params, resolved)
```

In `epichat/epichat.py`, update the `run()` method to call `get_last_resolved()` after `parse_query()`:

```python
from .parser import fix_params, get_last_resolved, parse_query

# In run():
params = parse_query(user_input)
# ... existing error handling ...
# When building final EpiChatResult:
return EpiChatResult(
    user_input=user_input,
    params=params,
    stats=exec_result["stats"],
    plot_path=exec_result["plot_path"],
    narration=narration,
    data_sources=get_last_resolved(),
)
```

- [ ] **Step 6: Run tests**

```bash
pytest tests/test_epichat_unit.py tests/test_parser_unit.py tests/test_resolver.py tests/test_un_wpp.py -v
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add epichat/epichat.py epichat/parser.py tests/test_epichat_unit.py
git commit -m "feat: EpiChatResult.data_sources and DATA SOURCES citation block in CLI output"
```

---

## Task 8: Wire `UNWPPAdapter` into `EpiChat` + `.env.example`

**Files:**
- Modify: `epichat/epichat.py`
- Modify: `.env.example`

- [ ] **Step 1: Register `UNWPPAdapter` in `EpiChat.__init__()`**

In `epichat/epichat.py`, add:

```python
import os
from .adapters.un_wpp import UNWPPAdapter
from .parser import configure_resolver
```

Update `EpiChat.__init__()`:

```python
def __init__(self, output_dir: str | Path = "results") -> None:
    self.output_dir = Path(output_dir)
    self.generator = CodeGenerator()
    self.executor = SimExecutor()
    configure_resolver(UNWPPAdapter(api_key=os.environ.get("UN_API_KEY")))
```

- [ ] **Step 2: Update `.env.example`**

Replace the contents of `.env.example` with:

```
ANTHROPIC_API_KEY=sk-ant-...
UN_API_KEY=
```

- [ ] **Step 3: Run the full test suite**

```bash
pytest tests/ -v --ignore=tests/test_parser.py
```

Expected: all tests pass

- [ ] **Step 4: Smoke test with a country query**

Add `UN_API_KEY=<your token>` to `.env`, then run:

```bash
cd epichat && python cli.py "Simulate COVID in Kenya over 5 years with demographics"
```

Expected output includes:
```
DATA SOURCES
  birth_rate: ...  — UN WPP 2024, Kenya (KEN), 2023
  death_rate: ...  — UN WPP 2024, Kenya (KEN), 2023
```

- [ ] **Step 5: Commit**

```bash
git add epichat/epichat.py .env.example
git commit -m "feat: wire UNWPPAdapter into EpiChat; add UN_API_KEY to .env.example"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| `DataQuery`, `ResolvedField`, `SourceAdapter`, `Resolver` | Task 1 |
| `UNWPPAdapter` location cache (iso2/iso3/name → id) | Task 2 |
| `UNWPPAdapter` data fetch (indicators 55, 59, 71) | Task 3 |
| Dynamic year selection (most recent EstimateMethodId=2) | Task 3 (`fetch()`) |
| Fallback to `[]` on API error | Task 3 (`test_fetch_returns_empty_on_http_error`) |
| `IntentResult` dataclass | Task 4 |
| `_llm_call_1` with legacy format support | Task 4 |
| `extraction.txt` `## Data resolver` section + `{location_table}` | Task 4 |
| Location table injected at runtime | Task 4 (`configure_resolver`) |
| `refinement.txt` prompt | Task 5 |
| `_llm_call_2` passthrough when `resolved` is empty | Task 5 |
| Two-step `parse_query()` | Task 6 |
| `EpiChatResult.data_sources` | Task 7 |
| `format_cli()` DATA SOURCES section with citations | Task 7 |
| `UN_API_KEY` env var wired into adapter | Task 8 |
| `.env.example` updated | Task 8 |

All spec requirements covered. No gaps found.
