# Design: WHO GHO Vaccination & Surveillance Adapter

**Date:** 2026-05-01  
**Status:** Approved

## Summary

Add a `WHOGHOAdapter` that fetches vaccination coverage and disease surveillance data from the WHO Global Health Observatory (GHO) OData API. Coverage data informs the `vaccine.coverage` parameter; surveillance case counts combined with population data inform `init_prev`. The UN WPP adapter is extended with a population indicator so both sources can supply `total_population` as a fallback. All data flows through the existing resolver pattern with two new deterministic post-processors in `parser.py`.

## Approach

Option A: extend `DataQuery` with two optional string fields (`indicator_codes`, `location_code`) for WHO GHO; implement a single `WHOGHOAdapter`; add two post-processors analogous to `_apply_age_distribution()`. The UN WPP adapter and Resolver are otherwise unchanged.

---

## Section 1 — Data Model (`DataQuery` + field naming)

`DataQuery` in `epichat/resolver.py` gets two new optional fields:

```python
@dataclass
class DataQuery:
    source: str
    indicators: list[int] = field(default_factory=list)       # UN WPP integer codes (unchanged)
    location_id: int = 0                                        # UN WPP location ID (unchanged)
    start_year: int = 2020
    end_year: int = 2024
    indicator_codes: list[str] = field(default_factory=list)   # WHO GHO string codes (new)
    location_code: str = ""                                     # ISO3 for WHO GHO (new)
```

The UN WPP adapter ignores `indicator_codes` and `location_code`. Backward-compatible.

**Resolved field naming conventions:**

| Category | Pattern | Examples |
|---|---|---|
| Vaccination coverage | `{antigen}_coverage` | `mcv1_coverage`, `dtp3_coverage`, `polio_coverage` |
| Disease surveillance | `{disease}_cases` | `measles_cases`, `polio_cases`, `pertussis_cases` |
| Population denominator | `total_population` | `total_population` |

Coverage values are percentages (0–100) in the resolved field; post-processors convert to fractions (0–1) before setting `vaccine.coverage`. Case counts are raw integers.

---

## Section 2 — `WHOGHOAdapter`

**File:** `epichat/adapters/who_gho.py`  
**Source name:** `"who_gho"`  
**API base URL:** `https://ghoapi.azureedge.net/api/`  
**Authentication:** None required (public OData endpoint)

### Indicator mapping table

```python
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
```

### `fetch(query: DataQuery) -> list[ResolvedField]`

For each code in `query.indicator_codes`:
1. GET `https://ghoapi.azureedge.net/api/{code}?$filter=SpatialDimValueCode eq '{query.location_code}'`
2. Filter response rows to those where `NumericValue` is not `None`
3. Select the row with the most recent `TimeDimensionValue` year
4. Look up field name from `INDICATOR_MAP`; skip unknown codes
5. Build citation: `"WHO GHO, {location_code}, {year}"`
6. Return one `ResolvedField` per indicator; silently skip indicators that return no data

HTTP errors and empty responses are silent no-ops (same pattern as UN WPP adapter).

### UN WPP population extension

Add indicator `49` (Total Population, both sexes, in thousands) to `_map_rows()` in `un_wpp.py`:

```python
"49": "total_population"   # value * 1000 → absolute count
```

Both adapters can return `ResolvedField(field="total_population", ...)` in the same pass. The post-processor uses the first available value. UN WPP appears first in the resolved list (registered before WHO GHO), so it is preferred.

The UN WPP extraction prompt is updated to include `49` in the default indicator set: `[55, 59, 71, 49]`.

---

## Section 3 — Parser post-processing

Two new private functions in `epichat/parser.py`, called at the end of `parse_query()`:

### `_apply_vaccination_coverage(params, resolved)`

```python
def _apply_vaccination_coverage(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    coverage_field = next((rf for rf in resolved if rf.field.endswith("_coverage")), None)
    if coverage_field is None:
        return params
    if params.get_vaccine() is not None:
        return params  # LLM already set a vaccine intervention
    coverage = coverage_field.value / 100.0
    vaccine = Intervention(type="vaccine", coverage=coverage, start_day=0)
    return SimParams.model_validate({
        **params.model_dump(),
        "interventions": params.model_dump()["interventions"] + [vaccine.model_dump()],
    })
```

- Returns `params` unchanged if no `*_coverage` field is resolved
- Returns `params` unchanged if the LLM already set a vaccine intervention (LLM wins)
- Otherwise adds a pre-existing vaccination intervention (`start_day=0`) via `model_validate` so all validators run

### `_apply_surveillance(params, resolved)`

```python
def _apply_surveillance(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    cases_field = next((rf for rf in resolved if rf.field.endswith("_cases")), None)
    pop_field   = next((rf for rf in resolved if rf.field == "total_population"), None)
    if cases_field is None or pop_field is None:
        return params
    init_prev = min(0.5, cases_field.value / pop_field.value)
    return SimParams.model_validate({**params.model_dump(), "init_prev": init_prev})
```

- Requires both a `*_cases` field and `total_population`; returns unchanged if either is missing
- Caps `init_prev` at 0.5 (50% active prevalence is already extreme)
- Always overrides the LLM's `init_prev` estimate when real surveillance data is available

### Updated `parse_query()` tail

```python
params = _llm_call_2(user_input, intent.preliminary_params, resolved)
params = _apply_age_distribution(params, resolved)
params = _apply_vaccination_coverage(params, resolved)
params = _apply_surveillance(params, resolved)
return params
```

The three post-processors are independent and do not interfere with each other.

---

## Section 4 — Extraction prompt update

New block added to `epichat/prompts/extraction.txt` describing the `who_gho` source:

```
WHO GHO source ("who_gho"):
Use indicator_codes (strings) and location_code (ISO3). Always include "WHS9_86"
(total population) when requesting surveillance data.

Disease → indicator_codes to request:
  measles/rubeola  : coverage=["WHS3_49"], cases=["WHS3_62", "WHS9_86"]
  rubella          : coverage=["WHS3_49"], cases=["WHS3_51", "WHS9_86"]
  polio            : coverage=["WHS3_43"], cases=["WHS3_59", "WHS9_86"]
  diphtheria       : coverage=["WHS3_41"], cases=["WHS3_55", "WHS9_86"]
  pertussis        : coverage=["WHS3_41"], cases=["WHS3_56", "WHS9_86"]
  mumps            : coverage=["WHS3_49"], cases=["WHS3_54", "WHS9_86"]
  yellow fever     : coverage=["WHS3_48"], cases=["WHS3_60", "WHS9_86"]
  hepatitis B      : coverage=["WHS3_45"], cases=[]
  hib              : coverage=["WHS3_46"], cases=[]
  pneumococcal     : coverage=["PCV3"],    cases=[]
  rotavirus        : coverage=["ROTAC"],   cases=[]
  HPV              : coverage=["SDGHPV"],  cases=[]
  meningococcal    : coverage=["MENGA"],   cases=[]
  japanese enc.    : coverage=[],          cases=["WHS3_61", "WHS9_86"]
  neonatal tetanus : coverage=["PAB"],     cases=["WHS3_58", "WHS9_86"]

Request both coverage and cases when simulating a disease with known surveillance.

Example output for measles in Kenya:
{
  "source": "who_gho",
  "indicator_codes": ["WHS3_49", "WHS3_62", "WHS9_86"],
  "location_code": "KEN",
  "start_year": 2020,
  "end_year": 2024
}
```

The UN WPP query block is updated to include indicator `49` in the default set: `[55, 59, 71, 49]`.

---

## Section 5 — Registration & CLI output

### EpiChat constructor

```python
def __init__(self, output_dir: str | Path = "results") -> None:
    self.output_dir = Path(output_dir)
    self.generator = CodeGenerator()
    self.executor = SimExecutor()
    configure_resolver(UNWPPAdapter(api_key=os.environ.get("UN_API_KEY")))
    configure_resolver(WHOGHOAdapter())
```

`WHOGHOAdapter` requires no API key.

### CLI output (`format_cli`)

One new line in MODEL DETAILS, shown when a vaccine intervention is present and a `*_coverage` field appears in `data_sources`. The antigen label is derived from the resolved field name by stripping the `_coverage` suffix and uppercasing:

```python
coverage_source = next((rf for rf in self.data_sources if rf.field.endswith("_coverage")), None)
if coverage_source and p.get_vaccine() is not None:
    label = coverage_source.field.replace("_coverage", "").upper()
    lines.append(f"  Vaccine coverage: {p.get_vaccine().coverage * 100:.1f}%  (pre-existing, {label})")
```

Example output:
```
  Vaccine coverage: 76.0%  (pre-existing, MCV1)
```

The DATA SOURCES block already renders all resolved fields with citations automatically — no additional changes needed there.

---

## Files Changed

| File | Change |
|---|---|
| `epichat/resolver.py` | Add `indicator_codes: list[str]`, `location_code: str` to `DataQuery` |
| `epichat/adapters/who_gho.py` | New file — `WHOGHOAdapter` with `INDICATOR_MAP` and `fetch()` |
| `epichat/adapters/un_wpp.py` | Add indicator `49` → `total_population` to `_map_rows()` |
| `epichat/parser.py` | Add `_apply_vaccination_coverage`, `_apply_surveillance`; update `parse_query()` |
| `epichat/epichat.py` | Register `WHOGHOAdapter`; add vaccine coverage line to `format_cli` |
| `epichat/prompts/extraction.txt` | Add `who_gho` source block; add `49` to UN WPP indicators |

## Out of Scope

- Age-specific vaccination coverage (e.g., coverage by age group — requires additional GHO indicators)
- Time-series vaccination campaigns (start_day > 0 based on historical rollout data)
- CDC or OWID adapters
- Waning immunity from vaccination (separate model complexity)
