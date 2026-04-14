# EpiChat

**A conversational AI agent for epidemiological simulation.**

Type a natural language question about an epidemic. EpiChat translates it into a [Starsim](https://starsim.org) simulation, runs it, and returns an epidemic curve + plain-language interpretation.

> *Prototype for the Emory Disruptive Discovery Seed Program FY27*
> *PI: Dr. Yuke Wang, Emory University*

---

## Architecture

```
User NL query
     │
     ▼
Layer 1: LLM Parameter Parser  (Claude API + extraction prompt)
     │  Structured JSON (SimParams)
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
```

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

## Parameters Reference

### Core Disease Parameters

| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `disease_type` | string | sir, seir, sis, sirs, seirs, seiar | `sir` | Compartmental model |
| `n_agents` | integer | 10–1,000,000 | 10,000 | Population size |
| `beta` | float | 0–1000 | computed | Per-year transmission rate. EpiChat computes this from R0: `beta = R0 × 365 / (n_contacts × dur_inf_days)` |
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
| "R0 = 2.5" | Converts to beta using `R0 × 365 / (n_contacts × dur_inf)` |
| "COVID", "flu", "measles", etc. | Applies built-in disease defaults |
| "80% vaccinated" | Adds vaccine intervention, `start_day=0` |
| "vaccination campaign starting month 3" | Vaccine intervention, `start_day=90` |
| "seasonal transmission" or "winter peak" | Seasonality, `scale=0.3, shift=0.0` |
| "endemic" or "long-run" | Sets `use_demographics=true` |
| "age-structured" or "school-age children" | Sets `network_type=age_structured` |
| "masks" or "50% mask uptake with 50% efficacy" | Sets `network_beta≈0.75` |
| "reproducible" or "set seed 42" | Sets `rand_seed=42` |

---

## Project Structure

```
epichat/
├── requirements.txt
├── cli.py                   # Command-line interface
├── app.py                   # Streamlit web interface
├── ROADMAP.md               # Planned data integrations and future features
├── epichat/
│   ├── schema.py            # Pydantic parameter model (single source of truth)
│   ├── parser.py            # NL → SimParams (Claude API)
│   ├── generator.py         # SimParams → Starsim code (Jinja2)
│   ├── executor.py          # Sandboxed subprocess execution
│   ├── narrator.py          # Results → plain-language (Claude API)
│   ├── epichat.py           # Main orchestrator + error recovery loop
│   └── prompts/
│       ├── extraction.txt   # System prompt for parameter parsing
│       └── narration.txt    # System prompt for interpretation
├── templates/
│   ├── sir.py.j2            # SIR (+ SIS) simulation template
│   ├── seir.py.j2           # SEIR simulation template
│   ├── sirs.py.j2           # SIRS (waning immunity) template
│   ├── seirs.py.j2          # SEIRS (latent + waning) template
│   ├── seiar.py.j2          # SEIAR (asymptomatic track) template
│   └── sis.py.j2            # SIS (no immunity) template
└── tests/
    ├── test_queries.json    # Benchmark queries
    └── test_parser.py       # Automated accuracy tests
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Invalid Starsim code | Template-based generation (not free-form LLM code) |
| Parameter hallucination | Pydantic validation + plausibility checks |
| Execution failure | 3-attempt error recovery loop with LLM re-parameterization |
| Timeout | 90-second subprocess limit |
| API instability | Starsim version pinned in requirements.txt |

---

*EpiChat v0.1 — Prototype*
