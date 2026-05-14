# EpiChat Roadmap — Data Integration & Extended Settings

This document maps future EpiChat capabilities to the external datasets that would enable them. Each section describes what the feature is, what data it requires, where that data can be obtained, and the estimated implementation complexity.

---

## Current State (v0.2)

### Core simulation
| Feature | Status |
|---|---|
| SIR / SEIR / SIS / SIRS / SEIRS / SEIAR models | Implemented |
| Random (Erdős–Rényi) network | Implemented |
| Age-structured contacts (built-in POLYMOD matrix) | Implemented — 3-group European average |
| Vaccination (pre-existing coverage + ongoing campaign) | Implemented |
| Seasonality connector | Implemented |
| Demographics (births + deaths with user-supplied rates) | Implemented |
| Treatment intervention (capacity + coverage) | Implemented |
| Export to PDF and Word | Implemented |

### Data integration
| Feature | Status |
|---|---|
| UN WPP — population, birth/death rates, age distribution | Implemented |
| WHO GHO — disease surveillance, vaccination coverage | Implemented |
| World Bank WDI — health system capacity, UHC index, disease prevalence | Implemented |
| Data source citations in parameter summary | Implemented — citations shown for all resolved fields including intervention coverage |

### Input enrichment (v0.2)
| Feature | Status |
|---|---|
| Plain natural language query | Implemented |
| Pasted epidemiological report | Implemented — LLM extracts structured facts (OutbreakContext) |
| URL to online article or news | Implemented — page fetched client-side, facts extracted |
| Web search request | Implemented — Anthropic built-in web_search tool |
| OutbreakContext pre-fills conversation state | Implemented — disease/location/population/interventions inferred |
| Dev mode inspection card | Implemented — `EPICHAT_DEV_MODE=true` shows extracted fields |

---

## Phase 1 — Country-Specific Contact Matrices

**Feature:** Replace the built-in POLYMOD 3-group average with country- and setting-specific age contact matrices.

**Why it matters:** Contact patterns vary substantially by country (e.g., multigenerational households in South/Southeast Asia vs. nuclear families in Northern Europe) and setting (school vs. workplace vs. household). Using the right matrix can shift R0 estimates by 20–40%.

**Data required:**

| Dataset | Description | Format | License |
|---|---|---|---|
| [POLYMOD](https://doi.org/10.1371/journal.pmed.0050074) | Social contact rates for 8 European countries; 7,290 participants | CSV (age × age matrix) | Open |
| [SOCRATES](http://www.socialcontactdata.org/) | Standardized repository of 40+ country contact surveys | CSV download or R package `socialmixr` | Open |
| [CoMix](https://doi.org/10.1186/s12916-021-02139-6) | Pandemic-era contacts (UK, Belgium, Netherlands) | CSV | Open |
| [Prem et al. 2021](https://doi.org/10.1371/journal.pcbi.1009098) | Synthetic contact matrices for 177 countries | CSV per country | Open |

**What EpiChat needs:**
- A CSV library indexed by country code + setting (all/home/work/school/other)
- UI: country selector → auto-loads the appropriate matrix
- Schema: `contact_matrix_source: str` (e.g., `"prem_2021_USA"`)

**Implementation complexity:** Medium — data is open and well-structured; main work is ingesting Prem et al. CSVs and wiring the country selector.

---

## Phase 2 — Household Network (HouseholdNet)

**Feature:** Enable `ss.HouseholdNet`, which simulates within-household transmission separately from community contacts — important for diseases like COVID-19, RSV, and norovirus.

**Why it matters:** Household transmission is a distinct route; household secondary attack rates differ substantially from community rates. HouseholdNet also enables realistic household size distributions by age/sex.

**Data required:**

| Dataset | Description | Format |
|---|---|---|
| [DHS (Demographic and Health Surveys)](https://dhsprogram.com/) | Household roster data: size, age/sex composition by country | DHS `.DTA` / CSV (requires registration) |
| [IPUMS International](https://international.ipums.org/) | Census microdata with household composition | CSV (requires registration) |
| [UN Household Data](https://www.un.org/development/desa/pd/data/household-size-and-composition) | Mean household size + composition by country | CSV (open) |
| [ACS (US Census)](https://data.census.gov/) | US household size distribution | CSV (open) |

**What EpiChat needs:**
- Pre-processed household composition table per country (age distribution of household members)
- Starsim `dhs_data` argument accepts a `DataFrame` with columns `['hh_size', 'age', 'sex', ...]`
- Schema: `network_type: "household"`, `household_data_country: str`

**Implementation complexity:** High — DHS data requires registration and preprocessing; consider shipping pre-processed files for a small set of priority countries (US, Kenya, India, Brazil).

---

## Phase 3 — Age-Specific Disease Parameters

**Feature:** Allow disease severity (IFR, hospitalization rate, duration) to vary by age group, rather than using a uniform value for all agents.

**Why it matters:** COVID-19 IFR ranges from <0.01% in children to >10% in elderly. Measles complications are concentrated in infants. Using a single `p_death` misrepresents the true burden distribution.

**Data required:**

| Parameter | Dataset | URL |
|---|---|---|
| Age-specific IFR (COVID-19) | O'Driscoll et al. 2021 *Nature* | [doi:10.1038/s41586-020-2918-0](https://doi.org/10.1038/s41586-020-2918-0) |
| Age-specific IFR (influenza) | CDC FluView / Iuliano et al. 2018 | [CDC FluView](https://www.cdc.gov/flu/weekly/) |
| Age-specific hospitalization | CDC COVID-NET | [CDC COVID-NET](https://www.cdc.gov/coronavirus/2019-ncov/covid-data/covid-net/) |
| Age-specific infectious period | Literature / systematic reviews | PubMed |
| Measles severity by age | WHO / CDC | [WHO measles](https://www.who.int/news-room/fact-sheets/detail/measles) |

**What EpiChat needs:**
- `p_death` as an age-varying `ss.bernoulli` (using `ss.AgeGroup` logic)
- Pre-built severity profiles for common diseases (COVID, influenza, measles) stored as lookup tables
- Schema: `severity_profile: str` (e.g., `"covid_odriscoll_2021"`)
- LLM extraction: "elderly mortality is 10x higher than adults" → age-stratified `p_death`

**Implementation complexity:** Medium — Starsim supports age-varying distributions; main work is building the disease profile library.

---

## Phase 4 — Real-Time Demographic Parameters

**Feature:** Auto-populate `birth_rate` and `death_rate` from national statistics rather than requiring user input, and support realistic population age structures.

**Why it matters:** For long-horizon simulations (5–20 years), realistic demographic dynamics affect herd immunity buildup, cohort aging, and endemic equilibria.

**Data required:**

| Dataset | Description | URL |
|---|---|---|
| [UN World Population Prospects](https://population.un.org/wpp/) | Birth/death rates + age structure for 237 countries, 1950–2100 | CSV (open) |
| [WHO Global Health Observatory](https://www.who.int/data/gho) | Cause-specific mortality, life tables | API + CSV (open) |
| [World Bank Open Data](https://data.worldbank.org/) | Birth rate, death rate, life expectancy indicators | API (open) |

**What EpiChat needs:**
- Country → `{birth_rate, death_rate, age_distribution}` lookup
- Schema: `country: str` (ISO 3166 code) → auto-fills demographic parameters
- UI: country selector in Demographics section
- LLM extraction: "simulate in Kenya" → `country="KEN"` → auto-fills demographics

**Implementation complexity:** Low–Medium — UN WPP data is well-structured CSV; main work is the country selector UI and lookup logic.

---

## Phase 5 — Model Calibration Against Surveillance Data

**Feature:** Use `ss.Calibration` to fit `beta`, `init_prev`, or other parameters to real epidemic curves (case counts, deaths, hospitalizations).

**Why it matters:** LLM-extracted parameters are reasonable priors, but fitting to observed data produces credible estimates for real outbreaks.

**Data required:**

| Dataset | Description | URL |
|---|---|---|
| [Our World in Data (COVID)](https://ourworldindata.org/covid-cases) | Daily cases, deaths, vaccinations by country | CSV / API (open) |
| [CDC COVID Tracker](https://covid.cdc.gov/covid-data-tracker/) | US state-level hospitalization + deaths | API (open) |
| [WHO FluNet](https://www.who.int/tools/flunet) | Global influenza surveillance | CSV (open) |
| [Project Tycho](https://www.tycho.pitt.edu/) | Historical US disease incidence (1888–present) | CSV (requires registration) |
| [ECDC Surveillance Atlas](https://atlas.ecdc.europa.eu/) | European communicable disease data | API (open) |

**What EpiChat needs:**
- Data ingestion layer: URL or file upload → time-series DataFrame
- `ss.Calibration` wrapper: define `calib_pars` from `SimParams`, run Optuna optimization
- New pipeline step: "Calibrate" button in UI (after initial run) → refits beta/init_prev
- Schema: `calibration_data_url: Optional[str]`

**Implementation complexity:** High — requires integrating `ss.Calibration`, defining evaluation functions, and managing multi-trial optimization (parallelism, storage).

---

## Phase 6 — STI and Multi-Route Transmission

**Feature:** Support sexually transmitted infection (STI) models (HIV, gonorrhea, syphilis, HPV) using `ss.MFNet` and `ss.MSMNet` sexual contact networks.

**Why it matters:** STIs follow entirely different contact structures; random networks are inappropriate.

**Data required:**

| Dataset | Description | URL |
|---|---|---|
| [DHS sexual behavior module](https://dhsprogram.com/) | Age at debut, partners, condom use | DHS (registration required) |
| [NATSAL (UK)](https://www.natsal.ac.uk/) | National survey of sexual attitudes | Microdata (registration required) |
| [CDC NHBS](https://www.cdc.gov/hiv/statistics/systems/nhbs/) | HIV risk behaviors in high-risk populations | Reports + microdata |

**What EpiChat needs:**
- `MFNet` / `MSMNet` as selectable network types
- STI-specific disease modules (from `starsim_examples`)
- Schema: `network_type: "heterosexual" | "msm" | "random" | "age_structured"`
- LLM extraction: "gonorrhea in MSM population" → `network_type="msm"`, `disease_type="sis"`

**Implementation complexity:** Very high — requires additional disease modules, sexual network parameterization, and demographic data for debut/partnership rates.

---

## Phase 7 — Multilingual Support

**Feature:** Accept user queries in any language and respond in the same language, making EpiChat accessible to non-English-speaking researchers, public health practitioners, and students.

**Why it matters:** Epidemics are inherently local — the professionals closest to an outbreak often work in French, Spanish, Portuguese, Arabic, Chinese, or other languages. Requiring English creates a barrier precisely where the tool is most needed.

**How it works:**

The underlying Claude model already understands and generates text in ~100 languages, so parameter extraction from queries like "simuler la rougeole en France" or "simular sarampión en México" works without any model changes. The work is in the application layer:

| Layer | Change required |
|---|---|
| LLM extraction prompt | Already language-agnostic; Claude returns structured JSON regardless of input language |
| LLM response generation | Inject `reply_language` instruction into all system prompts (e.g., "Respond in the same language as the user's message") |
| Streamlit UI strings | Externalize hardcoded English labels into a locale dictionary; ship translations for priority languages |
| `build_summary` / `next_question` | Replace hardcoded English phrases with locale-keyed strings |
| Citation footnotes | Translate footnote text; data source names (UN WPP, WB WDI) remain as-is |

**Priority languages** (based on WHO region and disease burden):
- Spanish (PAHO, ~500M speakers)
- French (AFRO, ~300M speakers)
- Portuguese (Brazil + AFRO)
- Arabic (EMRO)
- Chinese (Simplified, WPRO)

**What EpiChat needs:**
- Language detection: pass `user_language` to all LLM calls (or instruct the model to auto-detect and mirror)
- Locale file: `epichat/locales/{lang}.json` with keys for all UI strings
- `next_question()` and `build_summary()` accept an optional `lang: str` parameter
- Streamlit UI: auto-detect from browser `Accept-Language` header, or explicit language selector in sidebar

**Implementation complexity:** Low–Medium — LLM response translation is near-zero cost (model already handles it); the main work is externalizing ~40 hardcoded UI strings and adding locale files for each language.

---

## Phase 8 — Geospatial / Metapopulation Modeling

**Feature:** Model multiple connected subpopulations (cities, districts, countries) with travel-driven transmission between them.

**Why it matters:** Epidemic spread between populations is a key question for outbreak response and travel restrictions.

**Data required:**

| Dataset | Description | URL |
|---|---|---|
| [OAG / FlightAware](https://www.oag.com/) | Air travel flows between cities | Commercial |
| [WorldPop](https://www.worldpop.org/) | Gridded population density | Open |
| [OpenStreetMap](https://www.openstreetmap.org/) | Road network / commuter flows | Open |
| [UN Comtrade / mobility data](https://comtrade.un.org/) | Human mobility proxies | Open |

**Implementation complexity:** Very high — requires metapopulation simulation framework on top of Starsim.

---

## Priority Order

| Priority | Phase | Complexity | Impact |
|---|---|---|---|
| 1 | Phase 4 — Country demographics | Low–Medium | High: improves all long-run simulations |
| 2 | Phase 7 — Multilingual support | Low–Medium | High: removes language barrier for global users |
| 3 | Phase 1 — Country contact matrices | Medium | High: improves age-structured accuracy |
| 4 | Phase 3 — Age-specific severity | Medium | High: realistic mortality distribution |
| 5 | Phase 2 — HouseholdNet | High | Medium: important for household-transmitted diseases |
| 6 | Phase 5 — Calibration | High | Very High: enables research-grade parameter estimation |
| 7 | Phase 6 — STI networks | Very High | Medium: expands disease scope |
| 8 | Phase 8 — Metapopulation | Very High | High: spatial outbreak dynamics |

---

## Data Pipeline Design (Future)

```
External source (URL / file upload)
        ↓
    Ingestion layer
  (validate, normalize, cache)
        ↓
    Parameter resolver
  (country + disease + setting → SimParams defaults)
        ↓
    LLM extraction
  (user query overrides resolver defaults)
        ↓
    Review & Edit UI
  (user sees pre-populated params with data source cited)
        ↓
    Simulation
```

The key design principle: external data should **inform defaults**, not replace user control. Every data-sourced parameter should be visible and editable in the Review step, with the data source cited (e.g., "Birth rate: 34.5/1000 — UN WPP 2024, Kenya").

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
