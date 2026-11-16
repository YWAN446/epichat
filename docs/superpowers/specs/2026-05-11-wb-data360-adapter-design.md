# Design: World Bank Data360 Adapter

**Date:** 2026-05-11  
**Status:** Approved

## Summary

Add a `WorldBankData360Adapter` that fetches health system capacity, disease-specific epidemiology, and demographic data from the World Bank Data360 API (World Development Indicators database). The adapter introduces a **primary + alternatives** pattern to `ResolvedField` so users can compare multiple candidate values for the same simulation parameter during the parameter-review step and choose which to use before running the simulation.

Two new post-processors (`_apply_health_system`, `_apply_wb_disease_prevalence`) translate raw WDI values into `treatment` intervention parameters and `init_prev` respectively. WHO GHO surveillance data takes precedence over WDI disease statistics when both are available. UN WPP remains primary for demographics; WDI demographics appear as alternatives for cross-source comparison.

---

## Section 1 — `ResolvedField` extension

`ResolvedField` in `epichat/resolver.py` gains two optional fields:

```python
@dataclass
class ResolvedField:
    field: str
    value: Any
    citation: str
    description: str = ""                              # e.g. "hospital beds/1,000"
    alternatives: list["ResolvedField"] = field(default_factory=list)
```

The **primary** value is always the recommended one. `alternatives` holds other candidates for the same logical field. Existing adapters (WHO GHO, UN WPP) return single-value fields and are fully backward-compatible — their `alternatives` list is empty and `description` defaults to `""`.

`DataQuery` gains one optional field:

```python
database_id: str = "WB_WDI"
```

Existing adapters ignore this field. The extraction prompt defaults it to `"WB_WDI"`.

---

## Section 2 — `WorldBankData360Adapter`

**File:** `epichat/adapters/wb_data360.py`  
**Source name:** `"wb_data360"`  
**Base URL:** `https://data360api.worldbank.org`  
**Endpoint:** `GET /data360/data?DATABASE_ID={database_id}&INDICATOR={code}&REF_AREA={iso3}&timePeriodFrom={start_year}&timePeriodTo={end_year}`  
**Authentication:** None (public API)  
**Response:** JSON `{ "count": int, "value": [ { "OBS_VALUE": str, "TIME_PERIOD": str, "REF_AREA": str, ... } ] }`

### Indicator map — health system

| WDI Code | Data360 Indicator ID | Field name | Description | Role |
|---|---|---|---|---|
| SH.MED.BEDS.ZS | WB_WDI_SH_MED_BEDS_ZS | `treatment_capacity` | hospital beds/1,000 | **primary** |
| SH.MED.PHYS.ZS | WB_WDI_SH_MED_PHYS_ZS | `treatment_capacity` | physicians/1,000 | alternative |
| SH.MED.NUMW.P3 | WB_WDI_SH_MED_NUMW_P3 | `treatment_capacity` | nurses/1,000 | alternative |
| SH.UHC.SRVS.CV.XD | WB_WDI_SH_UHC_SRVS_CV_XD | `uhc_coverage` | UHC index 0–100 | primary |

### Indicator map — disease epidemiology

| WDI Code | Data360 Indicator ID | Field name | Description | Role |
|---|---|---|---|---|
| SH.TBS.INCD | WB_WDI_SH_TBS_INCD | `tb_incidence` | per 100,000/yr | primary |
| SH.DYN.AIDS.ZS | WB_WDI_SH_DYN_AIDS_ZS | `hiv_prevalence` | % of 15–49 | **primary** |
| SH.HIV.INCD.TL.P3 | WB_WDI_SH_HIV_INCD_TL_P3 | `hiv_prevalence` | per 1,000 uninfected/yr | alternative |
| SH.MLR.INCD.P3 | WB_WDI_SH_MLR_INCD_P3 | `malaria_incidence` | per 1,000 at risk/yr | primary |
| SH.STA.DIAB.ZS | WB_WDI_SH_STA_DIAB_ZS | `diabetes_prevalence` | % of adults | primary |
| SH.HEP.HBVS.ZS | WB_WDI_SH_HEP_HBVS_ZS | `hepb_prevalence` | % of population | primary |

### Indicator map — demographics (WDI as alternative to UN WPP)

| WDI Code | Data360 Indicator ID | Field name | Note |
|---|---|---|---|
| SP.DYN.CBRT.IN | WB_WDI_SP_DYN_CBRT_IN | `birth_rate` | per 1,000/yr — same unit as UN WPP |
| SP.DYN.CDRT.IN | WB_WDI_SP_DYN_CDRT_IN | `death_rate` | per 1,000/yr — same unit as UN WPP |
| SP.POP.TOTL | WB_WDI_SP_POP_TOTL | `total_population` | absolute count |
| SP.POP.0014.TO.ZS | WB_WDI_SP_POP_0014_TO_ZS | `age_distribution_pct` | 0–14 bracket (≠ UN WPP 0–17); shown for reference only |
| SP.POP.65UP.TO.ZS | WB_WDI_SP_POP_65UP_TO_ZS | `age_distribution_pct` | 65+ matches UN WPP |

WDI demographics are **always alternatives** — UN WPP is primary for all demographic fields. WDI age distribution is shown for reference only; the age-structured post-processor does not apply it (bracket mismatch).

### Candidate grouping

```python
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
```

Fields not in `CANDIDATE_GROUPS` are returned as plain `ResolvedField` with empty `alternatives`.

`fetch()` collects all fetched results, selects the most recent year per indicator, builds the primary `ResolvedField` with `alternatives` populated, and returns the final list. HTTP errors and empty responses are silent no-ops — same pattern as existing adapters.

---

## Section 3 — Post-processors

Two new private functions in `epichat/parser.py`.

### `_apply_health_system(params, resolved)`

Runs after `_apply_surveillance`. Uses `treatment_capacity` (primary = beds/1,000) and `uhc_coverage` to create a treatment intervention if neither was already set by the LLM.

**Capacity derivation** (simple formula; see ROADMAP for future enhancement):
```
capacity = round(primary_value / 1000 * n_agents)
```
Example: 2.3 beds/1,000 × 10,000 agents → `capacity = 23`

**Coverage derivation:**
```
coverage = uhc_index / 100.0
```

Returns `params` unchanged if the LLM already set a treatment intervention (LLM wins).

### `_apply_wb_disease_prevalence(params, resolved)`

Converts disease-specific WDI indicators to `init_prev`. Skips entirely if a `*_cases` field exists in resolved (WHO GHO surveillance takes precedence).

Conversion by field name suffix:

| Suffix | Unit | Formula |
|---|---|---|
| `*_prevalence` | % of population | `init_prev = value / 100` |
| `*_incidence` (per 100k/yr) | cases/100,000/yr | `init_prev = value / 100_000 / 365 * dur_inf` |
| `*_incidence` (per 1k/yr) | cases/1,000/yr | `init_prev = value / 1_000 / 365 * dur_inf` |

Result clamped to `(0.0001, 0.5)`. Each field's population divisor is defined in a `INCIDENCE_SCALE` lookup table in the adapter (not parsed from `description`) so the post-processor does a direct dict lookup:

```python
INCIDENCE_SCALE: dict[str, float] = {
    "tb_incidence":      100_000,  # per 100k/yr
    "malaria_incidence": 1_000,    # per 1k/yr
    "hiv_prevalence":    100,      # percent → fraction (treated as prevalence, not incidence)
    "diabetes_prevalence": 100,
    "hepb_prevalence":   100,
}
```

The post-processor imports `INCIDENCE_SCALE` from `wb_data360.py` and applies the matching formula without parsing any string fields.

### Updated `parse_query()` tail

```python
params = _apply_age_distribution(params, resolved)
params = _apply_vaccination_coverage(params, resolved)
params = _apply_surveillance(params, resolved)           # WHO GHO — sets init_prev from cases
params = _apply_wb_disease_prevalence(params, resolved)  # WB Data360 — fallback init_prev
params = _apply_health_system(params, resolved)          # WB Data360 — treatment intervention
params = _apply_population_scale(params, resolved)
```

---

## Section 4 — CLI output

`format_cli()` in `epichat/epichat.py` is updated to render alternatives in the DATA SOURCES block.

**Example output:**
```
DATA SOURCES
  treatment_capacity  2.3  — WB WDI, KEN, 2022  (hospital beds/1,000) ★ used
    ↳ 0.2  — WB WDI, KEN, 2022  (physicians/1,000)
    ↳ 1.1  — WB WDI, KEN, 2022  (nurses/1,000)
  uhc_coverage        56.0  — WB WDI, KEN, 2022
  hiv_prevalence      6.3  — WB WDI, KEN, 2020  (% of 15-49) ★ used
    ↳ 0.4  — WB WDI, KEN, 2020  (per 1,000 uninfected/yr)
  birth_rate          27.1  — UN WPP 2024, Kenya (KEN), 2023  ★ used
    ↳ 26.8  — WB WDI, KEN, 2022  (crude birth rate/1,000)
  total_population    54000000  — UN WPP 2024, Kenya (KEN), 2023
```

The `★ used` marker only appears on fields that have alternatives. Single-value fields remain uncluttered. The `description` string from `ResolvedField` is shown in parentheses.

---

## Section 5 — Extraction prompt update

New `wb_data360` source block in `epichat/prompts/extraction.txt`:

```
World Bank Data360 source ("wb_data360"):
Use indicator_codes (Data360 format), location_code (ISO3), database_id defaults to "WB_WDI".

Health system — request when user mentions treatment, hospitals, or healthcare capacity:
  indicator_codes: ["WB_WDI_SH_MED_BEDS_ZS", "WB_WDI_SH_MED_PHYS_ZS",
                    "WB_WDI_SH_MED_NUMW_P3", "WB_WDI_SH_UHC_SRVS_CV_XD"]

Disease epidemiology — request the matching indicator(s) for the disease being simulated:
  TB          : ["WB_WDI_SH_TBS_INCD"]
  HIV/AIDS    : ["WB_WDI_SH_DYN_AIDS_ZS", "WB_WDI_SH_HIV_INCD_TL_P3"]
  Malaria     : ["WB_WDI_SH_MLR_INCD_P3"]
  Diabetes    : ["WB_WDI_SH_STA_DIAB_ZS"]
  Hepatitis B : ["WB_WDI_SH_HEP_HBVS_ZS"]

Demographics — always include alongside a UN WPP query for cross-source comparison:
  indicator_codes: ["WB_WDI_SP_DYN_CBRT_IN", "WB_WDI_SP_DYN_CDRT_IN",
                    "WB_WDI_SP_POP_TOTL", "WB_WDI_SP_POP_0014_TO_ZS",
                    "WB_WDI_SP_POP_65UP_TO_ZS"]

Precedence: WHO GHO (who_gho source) takes priority for vaccine-preventable diseases
(measles, polio, pertussis, etc.). Use wb_data360 disease indicators for diseases not
covered by WHO GHO (TB, HIV, malaria, diabetes, hepatitis B).

Example output for HIV in Kenya with health system context:
{
  "source": "wb_data360",
  "database_id": "WB_WDI",
  "indicator_codes": ["WB_WDI_SH_DYN_AIDS_ZS", "WB_WDI_SH_HIV_INCD_TL_P3",
                      "WB_WDI_SH_MED_BEDS_ZS", "WB_WDI_SH_MED_PHYS_ZS",
                      "WB_WDI_SH_MED_NUMW_P3", "WB_WDI_SH_UHC_SRVS_CV_XD",
                      "WB_WDI_SP_DYN_CBRT_IN", "WB_WDI_SP_DYN_CDRT_IN",
                      "WB_WDI_SP_POP_TOTL"],
  "location_code": "KEN",
  "start_year": 2018,
  "end_year": 2024
}
```

---

## Section 6 — Registration

```python
from .adapters.wb_data360 import WorldBankData360Adapter

def __init__(self, output_dir: str | Path = "results") -> None:
    self.output_dir = Path(output_dir)
    self.generator = CodeGenerator()
    self.executor = SimExecutor()
    configure_resolver(UNWPPAdapter(api_key=os.environ.get("UN_API_KEY")))
    configure_resolver(WHOGHOAdapter())
    configure_resolver(WorldBankData360Adapter())
```

`WorldBankData360Adapter` requires no API key or configuration.

---

## Files Changed

| File | Change |
|---|---|
| `epichat/resolver.py` | Add `description`, `alternatives` to `ResolvedField`; add `database_id` to `DataQuery` |
| `epichat/adapters/wb_data360.py` | New — `WorldBankData360Adapter` with full indicator map and candidate grouping |
| `epichat/parser.py` | Add `_apply_health_system`, `_apply_wb_disease_prevalence`; update `parse_query()` tail |
| `epichat/epichat.py` | Register `WorldBankData360Adapter`; update `format_cli` to render alternatives |
| `epichat/prompts/extraction.txt` | Add `wb_data360` source block including demographics |
| `ROADMAP.md` | New — deferred Data360 data types and future enhancements |

---

## Out of Scope

- WASH / sanitation indicators (see ROADMAP)
- Socioeconomic context indicators (see ROADMAP)
- Health expenditure indicators (see ROADMAP)
- Other Data360 databases beyond WB_WDI (see ROADMAP)
- Model-based capacity estimation function (see ROADMAP)
- WDI age distribution applied to simulation (0–14 bracket mismatch with 0–17)

---

## ROADMAP — Deferred Data360 Features

### WASH / Sanitation
Indicators: access to clean water (`WB_WDI_SH_H2O_BASW_ZS`), basic sanitation (`WB_WDI_SH_STA_BASS_ZS`).  
Relevance: transmission modifier for enteric diseases (cholera, typhoid). Requires new `transmission_modifier` parameter in `SimParams`.

### Socioeconomic Context
Indicators: GDP per capita (`WB_WDI_NY_GDP_PCAP_CD`), poverty headcount (`WB_WDI_SI_POV_DDAY`).  
Relevance: supplementary narrative context only; no direct simulation parameter mapping defined yet.

### Health Expenditure
Indicators: current health expenditure % of GDP (`WB_WDI_SH_XPD_CHEX_GD_ZS`), out-of-pocket % (`WB_WDI_SH_XPD_OOPC_CH_ZS`).  
Relevance: proxy for treatment-seeking behaviour; could refine `treatment.coverage` estimate.

### Other Data360 Databases
Data360 aggregates databases beyond WB_WDI (HNP, WHO-sourced datasets). Worth exploring once WDI integration is stable; may require `database_id` to be surfaced in the extraction prompt more explicitly.

### Capacity Estimation Function
Replace `beds/1,000 × n_agents` with a model-based estimator incorporating occupancy rates (~65–75% typical), disease-specific bed utilisation, and staffing ratios. Similar in spirit to how `_apply_surveillance` derives `init_prev` from raw case counts rather than using them directly.
