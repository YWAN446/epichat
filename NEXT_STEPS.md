# EpiChat — Detailed Next Steps

*Updated: April 2026 | Status: Prototype scaffolded, not yet run*

This document is the hands-on execution guide. The prototype code exists; what remains is installing, verifying, debugging, validating, and polishing it into a grant-ready demo.

---

## Step 1 — Install the environment

```bash
cd EpiChat/epichat
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -r requirements.txt
```

Then copy `.env.example` to `.env` and add your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

**Verify everything installed:**

```bash
python -c "import starsim; print('starsim', starsim.__version__)"
python -c "import anthropic; print('anthropic ok')"
python -c "import streamlit; print('streamlit ok')"
```

---

## Step 2 — Audit the Starsim API (critical before running anything)

The templates in `templates/` were written against the expected Starsim API, but you must verify the exact result object structure before running the pipeline. Starsim's internal naming can differ across versions.

**Run this diagnostic script manually:**

```python
import starsim as ss
import json

pars = dict(
    n_agents=1000,
    networks=dict(type='random', n_contacts=4),
    diseases=dict(type='sir', init_prev=0.01, beta=0.05, dur_inf=10),
    dur=100,
)
sim = ss.Sim(pars)
sim.run()

# Inspect the results object
res = sim.results
print("Top-level result keys:", list(res.keys()))
print("SIR result keys:", list(res['sir'].keys()))

# Check the exact types
sir = res['sir']
for k, v in sir.items():
    print(f"  {k}: {type(v).__name__}, shape={getattr(v, 'shape', 'N/A')}")

# Check how to access values
print("\nSample n_infected:", sir['n_infected'][:5])
```

**Things to verify and potentially fix in the templates:**

| Template assumption | What to check | Fix if wrong |
|--------------------|--------------:|--------------|
| `res['sir']` | Is it `res['sir']` or `res.sir`? | Update accessor in all 3 templates |
| `sir['n_infected'].values` | Is `.values` needed, or just index directly? | Remove `.values` if it's already an array |
| `sir['cum_infections']` | Exact key name — might be `new_infections` (cumulative) | Check the key list from the diagnostic above |
| `sir.get('cum_deaths', ...)` | Key might be `cum_deaths`, `new_deaths`, or absent | Check and update all 3 templates |
| `res['t'][-1]` | Is the time axis `res['t']` or `res.timevec`? | Check top-level keys |
| `ss.normal(mean=...)` | Does Starsim accept `ss.normal(mean=X)` for durations? | May need `ss.lognormal` or just a float |
| `ss.sir_vaccine(...)` | Exact class name for vaccine intervention | Run `dir(ss)` and search for vaccine-related names |
| `ss.bernoulli(p=...)` | Exact eligibility syntax for vaccine | Check Starsim vaccine tutorial |
| `networks=dict(type='random', ...)` | Is `'random'` the correct type string? | May be `'randomnet'` or `'erdos_renyi'` |

**Once you have the correct key names, update all three templates:**
- `templates/sir.py.j2`
- `templates/seir.py.j2`
- `templates/sir_vaccine.py.j2`

Also update the stat extraction block at the bottom of each template. The stats JSON must be the **last line** of stdout for `executor.py` to parse it correctly.

---

## Step 3 — Run the first end-to-end test

Once templates are fixed, run the simplest possible query:

```bash
python cli.py "Run a default SIR model"
```

**Expected output flow:**
1. `🔬 EpiChat — Parsing query...` — Claude extracts parameters
2. `📊 Running Starsim simulation...` — subprocess runs the simulation
3. `📈 Generating plain-language summary...` — Claude narrates results
4. Results block printed to terminal
5. Plot saved to `results/sim_YYYYMMDD_HHMMSS.png`

**Common failure points and fixes:**

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `KeyError: 'ANTHROPIC_API_KEY'` | `.env` not loaded or key not set | Check `.env` file; run `export ANTHROPIC_API_KEY=...` |
| `ModuleNotFoundError: epichat` | Not in Python path | Run from `epichat/` directory, or `pip install -e .` |
| `TemplateNotFound: sir.py.j2` | Wrong working directory | The templates path is relative to `generator.py`; verify `_TEMPLATES_DIR` resolves correctly |
| `JSONDecodeError` in executor | Simulation ran but stats JSON not on last stdout line | Print `result.stdout` in executor to debug; check template's print statement |
| Starsim `KeyError` or `AttributeError` | Template uses wrong result key names | Go back to Step 2 and re-audit the result object |
| `TimeoutExpired` | Simulation taking >90s | Reduce `n_agents` to ≤10,000 for initial tests |
| `LLM returned non-JSON response` | Claude wrapped JSON in markdown | The strip-fences code in `parser.py` should handle this; add more patterns if needed |

---

## Step 4 — Fix and iterate on templates for all disease types

Test each disease type in sequence:

```bash
# SIR (basic)
python cli.py "SIR model in 5,000 people with R0=2"

# SEIR
python cli.py "SEIR epidemic with 5-day latent period, R0=3, 10,000 people"

# SIR + vaccine
python cli.py "SIR in 50,000 people with 70% vaccination at day 30, R0=3"
```

For each, inspect:
- Were the parameters extracted correctly? (Check sidebar params in Streamlit, or print `result.params`)
- Did the simulation run without error?
- Is the plot saved and readable?
- Does the narrative make sense?

Fix any template or executor issues before moving to the benchmark.

---

## Step 5 — Test the Streamlit app

```bash
streamlit run app.py
```

Open `http://localhost:8501`. Test:

1. Enter your API key in the sidebar
2. Click one of the example query buttons
3. Click "Run Simulation"
4. Verify plot displays, metrics show, and narrative appears

**Known issues to watch for:**
- `use_column_width` parameter in `st.image()` may need to be `use_container_width=True` in newer Streamlit versions — update `app.py` if you see a deprecation warning
- If the app freezes, the simulation is running in the main thread (acceptable for prototype; note it for production)

---

## Step 6 — Run the 30-query accuracy benchmark

Once the basic pipeline is stable, run the full benchmark:

```bash
EPICHAT_TEST_LIVE=1 pytest tests/test_parser.py -v 2>&1 | tee benchmark_results.txt
```

**Interpreting results:**
- Each test checks that extracted parameters are within the expected tolerance ranges
- Simple and medium queries should hit ≥80% pass rate
- Complex queries are best-effort

**If accuracy is below target, iterate on `epichat/prompts/extraction.txt`:**

Common accuracy failure patterns and prompt fixes:

| Failure pattern | Prompt fix |
|----------------|------------|
| R0 not converted to beta | Add more explicit formula examples; add a step-by-step worked example |
| Wrong `n_agents` (off by 10×) | Add explicit instruction: "Use the exact population size stated. Do not round." |
| `disease_type` defaults to `sir` when `seir` is implied | Add examples showing when SEIR should be selected (when latent/incubation period is mentioned) |
| Interventions missing from complex queries | Add a few-shot example that explicitly shows vaccine extraction |
| `sim_dur_years` wrong | Add examples with "6 months" (0.5), "18 months" (1.5), "1 semester" (0.5) |

After each prompt change, re-run a subset: `EPICHAT_TEST_LIVE=1 pytest tests/test_parser.py -k "S0 or S1 or M0 or M1" -v`

---

## Step 7 — Expert validation (10 gold-standard queries)

This step generates the pilot data for the grant proposal.

**Process:**
1. Select 10 representative queries from `tests/test_queries.json` — pick a mix of S, M, and C difficulty
2. For each, manually create the "gold standard" Starsim configuration — the parameters you as the epi expert would set
3. Run EpiChat on the same query
4. Record the comparison in a table

**Template for `tests/expert_validation.json`:**

```json
[
  {
    "query": "Simulate COVID-like spread in 50,000 people with R0 of 2.5 over 2 years",
    "expert_params": {
      "disease_type": "sir",
      "n_agents": 50000,
      "beta": 0.052,
      "dur_inf": 8.0,
      "p_death": 0.01,
      "sim_dur_years": 2.0
    },
    "epichat_params": null,
    "match_score": null,
    "notes": ""
  }
]
```

Run EpiChat on each query, fill in `epichat_params`, compute `match_score` (% of parameters within ±10% tolerance), and add qualitative `notes`.

**This table becomes Table 1 in the grant appendix.**

---

## Step 8 — Document failure modes

As you test, keep a running log of failure modes. These become the "research questions" that justify the seed grant:

Create `tests/failure_log.md` with entries like:

```
## Failure: Ambiguous disease type
Query: "Simulate the flu spreading in a small town"
Problem: Model selected SIR; expert would choose SEIR with short latency
Root cause: No latency cue in query; prompt defaults to SIR
Impact: Medium — results qualitatively similar but mechanistically incorrect
Proposed fix: Add a "disease name → model type" lookup table to the prompt
Research question: Can we use RAG over disease literature to auto-select model type?
```

Collect at least 5–10 documented failure modes. These directly support the "Innovation" section of the grant.

---

## Step 9 — Record a video walkthrough (backup for demo)

Before the grant deadline, record a 2–3 minute screen recording showing:

1. Open the Streamlit app
2. Type a medium-complexity query (e.g., "Measles in 100K, 80% vaccinated, R0=15")
3. Watch it parse, run, and generate the narrative
4. Show the epidemic curve plot
5. Show the sidebar parameters panel

Tools: OBS Studio, Loom, or QuickTime. Upload to YouTube (unlisted) or include as supplementary file.

**This is your fallback if the live demo breaks during proposal review.**

---

## Step 10 — Write the proposal appendix (1 page)

Use the outputs from Steps 7 and 8 to draft the appendix section. Structure:

```
EpiChat Prototype — Feasibility Demonstration

Architecture: [paste the 4-layer ASCII diagram from README]

Prototype results: We tested EpiChat on 30 natural language queries spanning
simple to complex epidemiological scenarios. The system achieved X% parameter
extraction accuracy on simple/medium queries (Table 1).

Table 1: Expert validation on 10 representative queries
[paste the 10-row comparison table from Step 7]

Example: [include 1 screenshot: query input → epidemic curve + narrative]

GitHub: https://github.com/YWAN446/epichat (available upon request)

Known limitations: [2–3 sentences from failure mode catalog]
These limitations define the research agenda for the proposed 12-month project.
```

---

## Step 11 — Initialize Git and push to GitHub

```bash
cd EpiChat/epichat

git init
git add .
git commit -m "EpiChat v0.1 prototype — initial implementation"

# Create repo on GitHub (private initially), then:
git remote add origin https://github.com/YWAN446/epichat.git
git branch -M main
git push -u origin main
```

Add a `.gitignore` to exclude secrets and output files:

```
.env
.venv/
results/
__pycache__/
*.pyc
.pytest_cache/
```

---

## Priority Order Summary

| Priority | Step | Blocker for |
|----------|------|-------------|
| 🔴 Now | Step 1: Install environment | Everything |
| 🔴 Now | Step 2: Audit Starsim API | All templates |
| 🔴 Now | Step 3: First end-to-end test | Validation |
| 🟠 This week | Step 4: Fix all 3 disease types | Benchmark |
| 🟠 This week | Step 5: Streamlit app | Demo |
| 🟡 Week 2 | Step 6: 30-query benchmark | Prompt iteration |
| 🟡 Week 2 | Step 7: Expert validation | Grant appendix |
| 🟡 Week 2 | Step 8: Failure mode catalog | Grant narrative |
| 🟢 Week 3 | Step 9: Video walkthrough | Backup demo |
| 🟢 Week 3 | Step 10: Proposal appendix | Grant submission |
| 🟢 Week 3 | Step 11: GitHub push | Public demo link |

**Grant deadline: June 4, 2026. Starting today (April 10) gives you ~8 weeks.**
The critical path is Steps 1–7, which should take 2–3 weeks at moderate intensity.

---

## Quick Reference: Key Files to Edit

| What you're doing | File to edit |
|------------------|-------------|
| Improving extraction accuracy | `epichat/prompts/extraction.txt` |
| Fixing Starsim result keys | `templates/sir.py.j2`, `seir.py.j2`, `sir_vaccine.py.j2` |
| Adjusting execution timeout | `epichat/executor.py` → `TIMEOUT_SECONDS` |
| Adding a new disease template | `templates/` + update `generator.py._select_template()` |
| Changing the CLI output format | `epichat/epichat.py` → `EpiChatResult.format_cli()` |
| Customizing the web UI | `app.py` |
| Adding benchmark queries | `tests/test_queries.json` |
