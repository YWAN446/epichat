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

🔬 EpiChat — Parsing query...
📊 Running Starsim simulation (SEIR, n=100,000, β=0.1875)...
📈 Generating plain-language summary...

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
  Beta:          0.187500
  Approx R0:     15.0
  Duration:      1 year(s)
  Interventions: vaccine

[Plot saved to: results/sim_20260415_143022.png]
```

---

## Project Structure

```
epichat/
├── requirements.txt
├── cli.py                   # Command-line interface
├── app.py                   # Streamlit web interface
├── epichat/
│   ├── schema.py            # Pydantic parameter model
│   ├── parser.py            # NL → SimParams (Claude API)
│   ├── generator.py         # SimParams → Starsim code (Jinja2)
│   ├── executor.py          # Sandboxed subprocess execution
│   ├── narrator.py          # Results → plain-language (Claude API)
│   ├── epichat.py           # Main orchestrator
│   └── prompts/
│       ├── extraction.txt   # System prompt for parameter parsing
│       └── narration.txt    # System prompt for interpretation
├── templates/
│   ├── sir.py.j2            # SIR simulation template
│   ├── seir.py.j2           # SEIR simulation template
│   └── sir_vaccine.py.j2    # SIR + vaccine template
└── tests/
    ├── test_queries.json    # 30 benchmark queries
    └── test_parser.py       # Automated accuracy tests
```

---

## Validation Benchmark

To run the live accuracy benchmark (requires API key):

```bash
EPICHAT_TEST_LIVE=1 pytest tests/test_parser.py -v
```

**Target:** ≥80% exact parameter match on simple + medium queries.

| Difficulty | Queries | Target |
|-----------|---------|--------|
| Simple    | 10      | ≥80%   |
| Medium    | 10      | ≥80%   |
| Complex   | 10      | best-effort |

---

## Supported Disease Types

| Type | Parameters |
|------|-----------|
| SIR  | beta, dur_inf, p_death |
| SEIR | beta, dur_exp, dur_inf, p_death |
| + Vaccine intervention | coverage, start_day |

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
