# EpiChat

**A conversational AI agent for epidemiological simulation.**

Type a natural language question about an epidemic. EpiChat translates it into a [Starsim](https://starsim.org) simulation, runs it, and returns an epidemic curve + plain-language interpretation.

> *Prototype for the Emory Disruptive Discovery Seed Program FY27*
> *PI: Dr. Yuke Wang, Emory University*

---

## Architecture

```
User input (query · report · URL · search request)
     │
     ▼
Layer 0: Input Enricher        (Claude Haiku + web_search tool)
     │  OutbreakContext — structured facts, all fields nullable
     ▼
Layer 1: LLM Parameter Parser  (Claude API + extraction prompt)
     │  Structured JSON (SimParams) — context informs defaults
     │  ├─ Resolver: pulls real-world data (UN WPP · WHO GHO · WB WDI)
     │  └─ Beta calibration: corrects β for age-structured networks
     ▼
Layer 1b: Fact-Checker         (disease_parameters.json — no LLM)
     │  Compares R₀, dur_inf, dur_exp against literature ranges
     │  Emits ⚠️ warnings shown in chat summary and CLI output
     ▼
Layer 2: Code Generator        (Jinja2 templates → Starsim Python)
     │  Python script
     ▼
Layer 3: Execution Engine      (subprocess sandbox, 90s timeout)
     │  Stats JSON + plot file
     ▼
Layer 4: Results Narrator      (Claude API + narration prompt)
     │  Plain-language summary
     ▼
User: epidemic curve + interpretation
```

---

## What's New in v0.3

### Disease Parameter Database & Fact-Checking

EpiChat now ships a literature-backed database of 8 infectious diseases (`epichat/data/disease_parameters.json`). When a named disease is detected in a query, EpiChat compares the simulation's R₀, infectious period, and incubation period against published ranges — and shows a warning if any value is out of range.

```
⚠️  Parameter notes
  • R₀ ≈ 100.0 is outside the literature range for measles (12–18).
    Source: https://pubmed.ncbi.nlm.nih.gov/28757186/
```

The database is **student-extensible**: adding a new disease requires only editing the JSON file — no Python changes needed. Covered diseases: measles, mumps, rubella, varicella, pertussis, influenza (seasonal), meningococcal, hepatitis A.

### Age-Structured Network β Calibration

When real-world demographic data (e.g. Kenya's young age distribution from UN WPP) triggers an age-structured contact network, EpiChat now back-solves β so that `approx_R₀()` matches the literature typical — not the random-network approximation. The same calibration applies when a user modifies R₀ or `dur_inf` mid-conversation.

### Multilingual Support

EpiChat now accepts queries in any language and responds in kind. Language is detected automatically; the UI, parameter summaries, and narration all follow the user's language. Priority languages: Spanish, French, Portuguese, Arabic, Chinese (Simplified).

### PDF/Word Export with CJK Support

PDF export now renders Chinese, Japanese, and Korean characters correctly via ReportLab with a CJK-capable font (STSong-Light), replacing the previous fpdf2 implementation.

---

## Input Types

EpiChat accepts four kinds of input — the enrichment layer classifies and handles each automatically.

| Input type | Example | What happens |
|-----------|---------|--------------|
| **Query** | `"Simulate Ebola in DRC"` | Fast path — LLM extracts parameters directly |
| **Report** | Paste a WHO situation report or epidemiological bulletin | Structured facts (cases, CFR, interventions) are extracted before simulation |
| **URL** | `"Read this article: https://www.nicd.ac.za/..."` | Page is fetched and parsed client-side; facts are extracted from the full text |
| **Search** | `"Search for the latest Mpox outbreak news in Africa"` | Built-in web search retrieves recent news; facts are extracted from results |

In all cases EpiChat produces an `OutbreakContext` object (disease name, location, case counts, R₀ estimate, interventions mentioned, etc.) before generating `SimParams`. Fields that cannot be determined are left null — the model never guesses.

**Dev mode** — set `EPICHAT_DEV_MODE=true` to see the extracted `OutbreakContext` as a table in the chat after each enrichment step. Off by default.

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/YWAN446/epichat.git
cd epichat
pip install -r requirements.txt

# 2. Set API key
cp .env.example .env
# edit .env and add your ANTHROPIC_API_KEY

# 3. CLI — single query
python cli.py "Simulate an SIR epidemic in 10,000 people with R0=2.5"

# 4. CLI — interactive mode
python cli.py

# 5. Streamlit web app
streamlit run app.py

# 6. Streamlit web app — dev mode (shows OutbreakContext extraction card)
EPICHAT_DEV_MODE=true streamlit run app.py

# 7. Chat engine selection — the tool-calling agent (claude-opus-5) is the
#    default; set EPICHAT_AGENT=0 to fall back to the staged pipeline
EPICHAT_AGENT=0 streamlit run app.py
```

The default chat flow is a Claude tool-calling agent that owns the whole
workflow — configure → confirm → fetch data → parameterize → confirm → run →
report — with every tool call shown in the chat and all epidemiological
values produced by deterministic tools (never by the language model). It
responds in the user's language. `EPICHAT_AGENT=0` restores the previous
staged pipeline; the CLI always uses the classic pipeline.

---

## Example

```
$ python cli.py "Measles in 100K people, 80% vaccinated, R0=15"

EpiChat — Parsing query...
Running Starsim simulation (SEIR, n=100,000)...
Generating plain-language summary...

RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Peak infections:        4,821  (day 38)
Total infected:        18,203  (18.2%)
Total deaths:             182
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Under these assumptions, the model suggests that even with 80%
vaccination coverage, measles — with its very high R0 of 15 —
can still cause a substantial outbreak among the unvaccinated 20%...

MODEL DETAILS
  Disease type:  SEIR
  Population:    100,000
  Beta:          68.437500
  Approx R0:     15.0
  Duration:      1 year(s)
  Interventions: vaccine (80% pre-existing)

[Plot saved to: results/sim_20260415_143022.png]
```

---

## Supported Disease Models

EpiChat supports six compartmental disease models. Each can be specified directly or inferred from a disease name (e.g. "COVID", "measles", "influenza").

| Model | Compartments | Key Use Case | Required Extra Parameters |
|-------|-------------|--------------|--------------------------|
| **SIR** | Susceptible → Infectious → Recovered | Standard acute infections (flu, COVID acute) | — |
| **SEIR** | Susceptible → **Exposed** → Infectious → Recovered | Diseases with a latent period (measles, SARS) | `dur_exp` |
| **SIS** | Susceptible → Infectious → **Susceptible** | No lasting immunity (gonorrhea, some STIs) | — |
| **SIRS** | Susceptible → Infectious → Recovered → **Susceptible** | Waning immunity (COVID endemic) | `dur_immune` |
| **SEIRS** | S → **Exposed** → I → R → **S** | Latent period + waning immunity (COVID full) | `dur_exp`, `dur_immune` |
| **SEIAR** | S → E → **Infectious or Asymptomatic** → R | Infections with asymptomatic transmission (flu, COVID) | `dur_exp`, `p_asymp`, `rel_trans_asymp` |

### Built-in Disease Defaults

When you name a disease without specifying all parameters, EpiChat uses these defaults:

| Disease | Model | dur_inf | dur_exp | n_contacts | p_death | Notes |
|---------|-------|---------|---------|------------|---------|-------|
| Generic SIR | SIR | 10 days | — | 4 | 0.0 | R0=2.5 default |
| COVID (acute) | SIR | 8 days | — | 6 | 0.01 | |
| COVID (endemic) | SIRS | 8 days | — | 6 | 0.005 | dur_immune=180 days |
| COVID (full endemic) | SEIRS | 8 days | 5 days | 6 | 0.005 | dur_immune=180 days |
| COVID (with asymp) | SEIAR | 8 days | 5 days | 6 | 0.01 | p_asymp=0.4 |
| Influenza | SIR | 5 days | — | 6 | 0.001 | |
| Flu (with asymp) | SEIAR | 5 days | 2 days | 6 | 0.001 | p_asymp=0.3 |
| Measles | SEIR | 8 days | 12 days | 10 | 0.001 | R0=15 typical |
| SARS-like | SEIR | 10 days | 5 days | 5 | 0.05 | |
| Ebola | SIR | 10 days | — | 3 | 0.5 | |
| Gonorrhea | SIS | 90 days | — | 2 | 0.0 | R0=2 typical |

---

## Data Sources

EpiChat grounds simulations in real data from two layers. Which sources a
query uses is shown in the chat (the understanding card lists the fetch plan,
each completed fetch gets its own 🔧 line, and the post-run results include a
"Data sources used" block that also appears in PDF/DOCX exports).

### Live API fetches (planned per query, run in parallel)

| Source | API | Parameters fetched | Used for |
|--------|-----|--------------------|----------|
| **UN World Population Prospects 2024** | UN Population Data Portal (`UN_API_KEY`) | Crude birth rate (55), crude death rate (59), total population (49), age shares 0–17/18–64/65+ (71) | Vital dynamics, result scaling to real population, age-structured contact network |
| **World Bank Data360 (WDI)** | `data360api.worldbank.org` (no key) | Hospital beds / physicians / nurses per 1,000; UHC coverage index; TB incidence; HIV, hepatitis-B, diabetes prevalence; malaria incidence; birth/death rate, population, age shares (fallback) | Treatment-intervention capacity, initial prevalence for those diseases, demographic fallback |
| **WHO Global Health Observatory** | GHO OData API (no key) | Vaccination coverage (MCV1/2, DTP3, polio, BCG, HepB3, Hib3, PCV3, rotavirus, HPV, MenA, yellow fever, PAB); reported case counts (measles, pertussis, polio, rubella, mumps, diphtheria, tetanus, yellow fever, …) | Auto-added vaccine interventions at reported coverage; surveillance-based initial prevalence |

### Bundled / local data (no API call)

| Source | Location | Provides |
|--------|----------|----------|
| **Disease parameter database** | `epichat/data/disease_parameters.json` (16 diseases, citation-backed) | R₀ used for beta calibration; literature ranges (infectious/incubation period, fatality, contacts, immunity, asymptomatic fraction) behind parameter warnings |
| **UN WPP 2024 indicators CSV** | `epichat/data/demographics/` | Offline birth/death-rate fill for any country at generation time |
| **WHO Mortality Database CSV** | `epichat/data/demographics/` | Age-specific death rates (supplement) |
| **Contact matrices** (Prem 2021 / POLYMOD / SOCRATES) | `epichat/data/` (add CSVs to activate) | Country-specific mean daily contacts |

Additional loaders included for future phases: CMU Delphi CovidCast/FluView
surveillance (`data_loaders/epidata.py`), UN/DHS/Census household size
distributions (`data_loaders/households.py`), and OWID calibration data
(`data_loaders/calibration.py`).

---

## Parameters Reference

### Core Disease Parameters

| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `disease_type` | string | sir, seir, sis, sirs, seirs, seiar | `sir` | Compartmental model |
| `n_agents` | integer | 10–1,000,000 | 10,000 | Population size |
| `beta` | float | 0–1000 | computed | Per-year transmission rate. EpiChat computes this from R0: `beta = R0 × 365 / (n_contacts × dur_inf_days)` for random networks; for age-structured networks the correct value is back-solved from the POLYMOD spectral radius so that `approx_R₀()` equals the intended R0. |
| `init_prev` | float | 0–1 | 0.01 | Initial fraction infected (seed cases) |
| `dur_inf` | float | >0 | 10.0 | Infectious period (days) |
| `dur_exp` | float or null | >0 | null | Latent/exposed period (days). **Required for SEIR, SEIRS, SEIAR** |
| `dur_immune` | float or null | >0 | null | Days of immunity before waning back to susceptible. **Required for SIRS, SEIRS** |
| `p_death` | float | 0–1 | 0.0 | Infection fatality rate |
| `p_asymp` | float | 0–1 | 0.3 | Fraction of infections that are asymptomatic. **SEIAR only** |
| `rel_trans_asymp` | float | 0–1 | 0.5 | Asymptomatic relative transmissibility (1.0 = same as symptomatic). **SEIAR only** |
| `sim_dur_years` | float | 0–20 | 1.0 | Simulation duration in years |
| `rand_seed` | integer or null | any | null | Random seed for reproducible runs |

### Network Parameters

| Parameter | Type | Options / Range | Default | Description |
|-----------|------|----------------|---------|-------------|
| `network_type` | string | `random`, `age_structured` | `random` | Contact network structure |
| `n_contacts` | integer | 1–100 | 4 | Average daily contacts per person |
| `network_beta` | float | 0–10 | 1.0 | Transmission multiplier per contact (use <1 for masks/distancing) |

**`network_type` options:**

- **`random`** — Each agent contacts `n_contacts` random others per day. Good default for most scenarios. Use higher `n_contacts` for crowded settings.
- **`age_structured`** — Uses a built-in POLYMOD-style contact matrix with three age groups (children 0–17, adults 18–64, elderly 65+). Accounts for the fact that children mix more with children, adults with adults, etc. Use when age heterogeneity matters (school outbreaks, elderly vulnerability).

**`n_contacts` guidance:**

| Setting | Typical range |
|---------|--------------|
| Household/close contacts only | 3–5 |
| Community mixing (school, work) | 8–15 |
| High-contact (crowded city, hospital) | 15–30 |

**`network_beta` examples:**

| Scenario | network_beta |
|----------|-------------|
| No intervention | 1.0 |
| 50% mask uptake, 50% efficacy | ~0.75 |
| Strict physical distancing | ~0.4–0.6 |

### Demographics Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `use_demographics` | bool | false | Enable births and deaths (useful for long-run endemic projections) |
| `birth_rate` | float | 20.0 | Births per 1,000 per year |
| `death_rate` | float | 10.0 | Deaths per 1,000 per year |

---

## Interventions

Up to three intervention types can be combined in a single simulation.

### Vaccine

Removes a fraction of agents from the susceptible pool.

| Field | Type | Description |
|-------|------|-------------|
| `coverage` | float (0–1) | Fraction of population vaccinated |
| `start_day` | integer | `0` = pre-existing immunity (applied before simulation starts); `>0` = ongoing campaign starting on that day |

**Examples in natural language:**
- *"80% of the population is vaccinated"* → `coverage=0.8, start_day=0`
- *"Vaccination campaign begins at month 3"* → `coverage=0.7, start_day=90`

### Treatment

Reduces infectious duration or mortality for a fraction of infected agents.

| Field | Type | Description |
|-------|------|-------------|
| `coverage` | float (0–1) | Fraction of eligible infected agents who receive treatment |
| `capacity` | integer or null | Maximum treatments administered per day; `null` = unlimited |
| `start_day` | integer | Day treatment becomes available |

**Examples in natural language:**
- *"Treatment available from day 30 with 60% coverage"*
- *"Hospital capacity of 100 treatments per day starting at month 2"*

### Seasonality

Modulates transmission rate sinusoidally over the year.

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `scale` | float | 0–1 | Seasonal variation strength (0.2 = ±20% around the annual mean) |
| `shift` | float | 0–1 | Phase offset (0.0 = peak in winter/Jan 1; 0.5 = peak in summer/Jul 1) |

**Examples in natural language:**
- *"Seasonal winter transmission"* → `scale=0.3, shift=0.0`
- *"Mild seasonal variation with summer peak"* → `scale=0.2, shift=0.5`

---

## Natural Language Query Tips

EpiChat's LLM parser understands a wide range of phrasing. A few patterns:

| You say | What EpiChat does |
|---------|------------------|
| `"R0 = 2.5"` | Converts to beta using `R0 × 365 / (n_contacts × dur_inf)` |
| `"COVID"`, `"flu"`, `"measles"`, etc. | Applies built-in disease defaults |
| `"80% vaccinated"` | Adds vaccine intervention, `start_day=0` |
| `"vaccination campaign starting month 3"` | Vaccine intervention, `start_day=90` |
| `"seasonal transmission"` or `"winter peak"` | Seasonality, `scale=0.3, shift=0.0` |
| `"endemic"` or `"long-run"` | Sets `use_demographics=true` |
| `"age-structured"` or `"school-age children"` | Sets `network_type=age_structured` |
| `"masks"` or `"50% mask uptake with 50% efficacy"` | Sets `network_beta≈0.75` |
| `"reproducible"` or `"set seed 42"` | Sets `rand_seed=42` |
| Paste a situation report | Enricher extracts facts; parser uses them as defaults |
| `"https://..."` URL | Page is fetched and parsed; facts inform simulation |
| `"Search for recent Mpox news"` | Web search retrieves context before simulation |

---

## Project Structure

```
epichat/
├── requirements.txt
├── cli.py                   # Command-line interface
├── app.py                   # Streamlit web interface
├── ROADMAP.md               # Planned data integrations and future features
├── epichat/
│   ├── schema.py            # Pydantic models: SimParams + OutbreakContext
│   ├── enricher.py          # Input enrichment: query/report/URL/search → OutbreakContext
│   ├── parser.py            # NL + OutbreakContext → SimParams (Claude API)
│   │                        #   incl. beta calibration for age-structured networks
│   ├── disease_db.py        # Disease parameter DB: lookup, detect, fact-check
│   ├── chat_controller.py   # Conversation state machine, summary builder
│   ├── generator.py         # SimParams → Starsim code (Jinja2)
│   ├── executor.py          # Sandboxed subprocess execution
│   ├── narrator.py          # Results → plain-language (Claude API)
│   ├── modifier.py          # Plain-text modification → updated SimParams
│   ├── epichat.py           # Main orchestrator + error recovery loop
│   ├── data/
│   │   └── disease_parameters.json   # Literature-backed R₀/incubation/infectious ranges
│   ├── prompts/
│   │   ├── enrichment.txt   # System prompt for input enrichment (Layer 0)
│   │   ├── extraction.txt   # System prompt for parameter parsing (Layer 1)
│   │   └── narration.txt    # System prompt for interpretation (Layer 4)
│   └── adapters/
│       ├── un_wpp.py        # UN World Population Prospects — demographics
│       ├── who_gho.py       # WHO Global Health Observatory — disease surveillance
│       └── wb_data360.py    # World Bank WDI — health system + disease indicators
├── assets/
│   ├── logo-source.png      # Master logo artwork (2048px, opaque background)
│   ├── build_logo_assets.py # Derives every logo variant; also writes docs/brand/
│   ├── epichat-logo{,-dark}.png   # Full mark, transparent
│   └── epichat-icon{,-dark}.png   # Simplified mark for small sizes
├── templates/
│   ├── sir.py.j2            # SIR (+ SIS) simulation template
│   ├── seir.py.j2           # SEIR simulation template
│   ├── sirs.py.j2           # SIRS (waning immunity) template
│   ├── seirs.py.j2          # SEIRS (latent + waning) template
│   ├── seiar.py.j2          # SEIAR (asymptomatic track) template
│   └── sis.py.j2            # SIS (no immunity) template
└── tests/
    ├── test_queries.json              # Benchmark queries
    ├── test_parser.py                 # Automated accuracy tests
    ├── test_disease_db.py             # Disease DB: lookup, detect, check_params
    ├── test_param_warnings.py         # EpiChatResult.param_warnings + CLI display
    ├── test_build_summary_warnings.py # build_summary() warning block
    ├── test_outbreak_context.py       # OutbreakContext schema validation
    ├── test_enricher.py               # Enricher unit tests (mocked LLM)
    ├── test_parser_unit.py            # Parser unit tests with OutbreakContext
    └── test_chat_controller.py        # Conversation state machine tests
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Invalid Starsim code | Template-based generation (not free-form LLM code) |
| Parameter hallucination | Pydantic validation; literature-range fact-checking via `disease_parameters.json`; ⚠️ warning shown when values are outside known ranges |
| Wrong R₀ on age-structured network | β back-solved from POLYMOD spectral radius after demographics are applied; recalibrated on every R₀ / `dur_inf` modification |
| Execution failure | 3-attempt error recovery loop with LLM re-parameterization |
| Timeout | 90-second subprocess limit |
| API instability | Starsim version pinned in requirements.txt |

---

## Brand

The logo is a speech bubble containing a cluster of connected nodes, in red
(`#F13A25`) and green (`#054E33`).

Every variant is derived from `assets/logo-source.png`, so edit the master and
regenerate rather than hand-editing the outputs:

```bash
python assets/build_logo_assets.py
```

This writes the app's assets into `assets/` and the website's into `docs/brand/`
(GitHub Pages serves `docs/` and has to be self-contained). Two forms exist: the full
mark for display sizes, and a simplified mark — bubble plus the major nodes only — for
favicons and avatars, where the full cluster resolves to noise. Each comes in a light
and a dark variant; the dark one re-inks the bubble outline so it survives a dark
background.

---

*EpiChat v0.3 — Prototype*
