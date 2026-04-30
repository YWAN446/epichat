# Data-Informed Resolver Layer — Design Spec

**Date:** 2026-04-30  
**Status:** Approved  
**Scope:** MVP — UN WPP demographics adapter; US flu (Delphi) deferred to future adapter

---

## Problem

EpiChat currently extracts all simulation parameters from the LLM using hardcoded defaults in `extraction.txt`. For country-specific queries (e.g. "simulate COVID in Kenya"), demographic parameters (`birth_rate`, `death_rate`, age distribution) default to generic European averages. Real UN World Population Prospects data exists for 237 countries and maps directly to `SimParams` fields, but is never consulted.

---

## Goal

Insert a **resolver layer** between LLM parameter extraction and simulation that:

1. Lets the LLM identify *what* real-world data is needed (geography, indicators).
2. Fetches that data from pluggable source adapters.
3. Feeds the resolved values back to a second LLM call to produce final `SimParams`.
4. Surfaces data provenance as citations in the CLI output.

The resolver **informs defaults**, not replaces user control — explicitly stated user values always win.

---

## Architecture

```
User NL query
      │
      ▼
┌─────────────────────────────────────────┐
│  LLM Call 1  — intent + query spec      │
│  prompt: extraction.txt (extended)      │
│  output: IntentResult                   │
│    ├── preliminary_params: SimParams    │
│    └── data_queries: DataQuery[]        │
└──────────────────┬──────────────────────┘
                   │  (skipped if data_queries is empty)
                   ▼
┌─────────────────────────────────────────┐
│  Resolver                               │
│  routes each DataQuery to its adapter   │
│  output: ResolvedField[]                │
│    each: {field, value, citation}       │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  LLM Call 2  — refinement               │
│  prompt: refinement.txt                 │
│  input: user query + prelim params      │
│         + ResolvedField[]               │
│  output: final SimParams                │
└──────────────────┬──────────────────────┘
                   │
                   ▼
        existing pipeline unchanged
   (CodeGenerator → SimExecutor → narrate)
```

If `data_queries` is empty (no geography mentioned), LLM Call 2 is skipped and LLM Call 1's preliminary params are used directly — identical to today's behaviour.

---

## Core Data Types

### `DataQuery`

```python
@dataclass
class DataQuery:
    source: str            # "un_wpp", "delphi", "who_gho", …
    indicators: list[int]  # source-specific indicator IDs
    location_id: int       # UN numeric location ID
    start_year: int
    end_year: int
```

### `ResolvedField`

```python
@dataclass
class ResolvedField:
    field: str             # SimParams field name, e.g. "birth_rate"
    value: Any
    citation: str          # e.g. "UN WPP 2024, United States (USA), 2023"
```

### `SourceAdapter` (Protocol)

```python
class SourceAdapter(Protocol):
    source_name: str
    def fetch(self, query: DataQuery) -> list[ResolvedField]: ...
```

### `Resolver`

```python
class Resolver:
    def register(self, adapter: SourceAdapter) -> None: ...
    def resolve(self, queries: list[DataQuery]) -> list[ResolvedField]: ...
```

---

## UNWPPAdapter

### API

- **Base URL:** `https://population.un.org/dataportalapi/api/v1`
- **Auth:** `Authorization: Bearer {UN_API_KEY}` (env var `UN_API_KEY`)
- **Data endpoint:** `/data/indicators/{ids}/locations/{loc_id}/start/{y}/end/{y}/?format=csv`
- **Response:** pipe-delimited CSV; first line is `sep =|` (skip)

### Indicators fetched (MVP)

| UN Indicator ID | Name | Maps to |
|---|---|---|
| 55 | Crude birth rate (per 1,000/yr) | `birth_rate` |
| 59 | Crude death rate (per 1,000/yr) | `death_rate` |
| 71 | Population % by broad age group | age distribution weights |

### Row filtering

- `VariantId = 4` (Median)
- `SexId = 3` (Both sexes)
- `AgeLabel = "Total"` for indicators 55 and 59
- `AgeLabel in {"0-17", "65+"}` for indicator 71; derive `18-64% = 100 - pct["0-17"] - pct["65+"]`

### Age distribution output

The three-group breakdown (children 0–17, adults 18–64, elderly 65+) matches EpiChat's existing age-structured POLYMOD matrix groups. This is delivered as a single `ResolvedField`:

```python
ResolvedField(
    field="age_distribution_pct",
    value={"0-17": 21.58, "18-64": 60.99, "65+": 17.43},
    citation="UN WPP 2024, United States (USA), 2023"
)
```

LLM-2 uses this to adjust contact matrix weights when `network_type = "age_structured"`.

### Location resolution

At adapter initialisation, fetch `/locations?format=csv` (no auth required) and build a lookup dict:

```python
{
  "USA": 840, "US": 840, "United States": 840,
  "KEN": 404, "KE": 404, "Kenya": 404,
  ...
}
```

This dict is injected as a compact JSON table into the LLM-1 extraction prompt so the LLM can emit the correct `location_id`.

### Fallback

If the live API call fails (network error, expired token, unknown location), `UNWPPAdapter.fetch()` returns `[]`. The resolver passes an empty list to LLM-2, which behaves identically to the current single-call flow.

---

## Prompt Changes

### `extraction.txt` additions

A new `## Data resolver` section is appended to the existing prompt:

```
## Data resolver

If the query references a country, region, or geography, add a "data_queries" key
alongside "preliminary_params" in your output:

{
  "preliminary_params": { ...SimParams fields... },
  "data_queries": [
    {
      "source": "un_wpp",
      "indicators": [55, 59, 71],
      "location_id": <integer from location table below>,
      "start_year": 2023,
      "end_year": 2023
    }
  ]
}

If no geography is mentioned, set "data_queries": [].

Location table (name/ISO → UN location_id):
{location_table_json}
```

The `{location_table_json}` placeholder is filled at runtime from the cached location lookup.

### New `refinement.txt`

```
You are refining simulation parameters with real-world demographic data.
User-stated values take precedence over resolved data.
Return ONLY the final SimParams JSON — no prose, no fences.

Original query: {user_input}

Preliminary parameters:
{preliminary_params_json}

Resolved data (use these to replace/improve the preliminary values):
{resolved_fields_text}
```

`resolved_fields_text` is formatted as:

```
- birth_rate: 10.648 — UN WPP 2024, United States (USA), 2023
- death_rate: 8.663  — UN WPP 2024, United States (USA), 2023
- age_distribution_pct: {"0-17": 21.58, "18-64": 60.99, "65+": 17.43} — UN WPP 2024, United States (USA), 2023
```

---

## `parser.py` changes

`parse_query()` is restructured into three private helpers:

```python
def parse_query(user_input: str) -> SimParams:
    intent = _llm_call_1(user_input)            # → IntentResult
    resolved = _run_resolver(intent.data_queries)  # → list[ResolvedField]
    return _llm_call_2(user_input, intent.preliminary_params, resolved)
```

`_llm_call_2` is a no-op passthrough when `resolved` is empty, returning `intent.preliminary_params` directly (no extra API call).

---

## `EpiChatResult` changes

`EpiChatResult` gains a new field:

```python
data_sources: list[ResolvedField] = field(default_factory=list)
```

`format_cli()` gains a `DATA SOURCES` section when `data_sources` is non-empty:

```
DATA SOURCES
  birth_rate:       10.648  — UN WPP 2024, United States (USA), 2023
  death_rate:        8.663  — UN WPP 2024, United States (USA), 2023
  age_distribution:  0-17: 21.6%, 18-64: 61.0%, 65+: 17.4%  — UN WPP 2024, United States (USA), 2023
```

---

## Files Changed / Added

| File | Type | Description |
|---|---|---|
| `epichat/resolver.py` | New | `DataQuery`, `ResolvedField`, `SourceAdapter` protocol, `Resolver` class |
| `epichat/adapters/__init__.py` | New | Empty package init |
| `epichat/adapters/un_wpp.py` | New | `UNWPPAdapter` — live API with empty-list fallback |
| `epichat/parser.py` | Modified | Two-step `parse_query()`; `IntentResult` dataclass; `_llm_call_1`, `_run_resolver`, `_llm_call_2` |
| `epichat/prompts/extraction.txt` | Modified | Add `## Data resolver` section + location table placeholder |
| `epichat/prompts/refinement.txt` | New | LLM-2 refinement prompt |
| `epichat/epichat.py` | Modified | `EpiChatResult.data_sources`; `format_cli()` citation block |
| `.env.example` | Modified | Add `UN_API_KEY=` |

---

## Out of Scope (MVP)

- Delphi EpiPortal adapter (deferred — future adapter)
- WHO GHO, World Bank, OWID adapters (deferred)
- Disease-profile defaults from curated literature (deferred)
- `init_prev` from surveillance data (deferred to Delphi adapter)
- UI / Review-step citation display (deferred to frontend phase)
- Caching resolved values across runs (deferred)

---

## Open Questions

None — all design decisions resolved.
