# Sim Parameters Part 2, Phase 2D: Docs, Evals and the Review List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Part 2: the two pending eval cases for the API harness, the generated review list committed and pinned to the database and the registry, the README's Part 2 sections, and the runbook's verification steps and timings for networks, interventions and the fit.

**Architecture:** No product code changes. The eval cases are YAML the golden runner loads and lists as pending (never runs); `docs/data-review-requests.md` is `scripts/review_requests.py`'s output, and a test keeps the committed file equal to what the script renders, so it is regenerated whenever the database or the registry changes; the README and the runbook gain sections whose phrases a test pins to the code's names (intervention types from `epichat/schema.py`, the bundled tables from `epichat/data/`), so the docs cannot name a file or a type that does not exist.

**Tech Stack:** Python 3.12 (pytest, PyYAML through `evals/golden/run.py`), Markdown.

**Spec:** `docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md`, sections 11 (the review list), 13 (the evals paragraph), 14 (phase 2D), 16 (the timings in the runbook), 10 (the sources table the README mirrors). Part 1's README section (`tests/test_readme.py`) stays as it is and is extended.

## Global Constraints

- No product code, requirement, dependency or migration changes; Starsim stays at 3.7.2; `npm --prefix web ci` only.
- Interpreters: the root `.venv/Scripts/python.exe` for `tests/` and the scripts, from the worktree root; the main checkout's `sim/.venv/Scripts/python.exe` for `sim/tests`; `npx vitest run` from `web/`.
- Files are written with LF; tests compare text after `.replace("\r\n", "\n")` so a CRLF checkout cannot fail them.
- The golden runner must keep loading every case: a pending case carries `pending: api-harness` and a `pending_note`, has no `baseline.json` entry, and is never run or scored (`evals/README.md`).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UL6ToyEthpP1X8yxArZE6g`. Never print a secret.

## Review Focus

1. **The committed review list drifts from the database or the registry** (a field added later, a note reworded): the next test run says so instead of handing the database team a stale file. Pinned by Task 2's sync test.
2. **A README phrase names a file or a type that does not exist** (a renamed CSV, a dropped intervention type): the README test derives the names from `epichat/data/` and `epichat.schema.INTERVENTION_TYPES` rather than from a hand-written list. Pinned in Task 3.
3. **The golden runner meets the two new cases without a baseline entry**: it lists them under "Pending" and runs nothing, and the regression report does not flag them as missing. Pinned in Task 1 (`split_pending`, the baseline keys).
4. **The runbook's steps name the tools' real fields** (`interventions` entries with `contact_reduction`, `fit` with `target` and `value`, `applied.beta_calibrated_by_measurement`), so the owner's verification exercises the shipped paths. Pinned in Task 4's runbook test.
5. **A CRLF checkout of the generated review list**: the sync test normalizes line endings, so a Windows checkout with `core.autocrlf` passes. Pinned in Task 2.

---

## File Structure

- Modify `evals/golden/cases/parameters.yaml` (two cases), `tests/test_golden_cases.py`.
- Create `docs/data-review-requests.md` (generated); modify `tests/test_review_requests.py`.
- Modify `README.md` (the web-agent section, the bundled-data table, the network and intervention sections, the project structure), `tests/test_readme.py`.
- Modify `web/docs/DEPLOY.md` (section 6j, the networks timing paragraph), `tests/test_readme.py` (the runbook pins).

---

### Task 1: The two pending eval cases

**Files:**
- Modify: `evals/golden/cases/parameters.yaml` (append two cases), `tests/test_golden_cases.py`

**Interfaces:**
- Consumes: `evals.golden.run.load_cases`, `split_pending`, `CASES_DIR`, `BASELINE`.
- Produces: cases `parameters-school-closure` and `parameters-why-so-many-infected`, both `pending: api-harness`, category `parameters`.

- [ ] **Step 1: Write the failing test**

Replace the body of `tests/test_golden_cases.py` with:

```python
"""The committed golden cases: the sim-parameters cases are pending until the API harness exists (Part 1 spec 17, Part 2 spec 13)."""
import json

from evals.golden.run import BASELINE, CASES_DIR, load_cases, split_pending

PENDING = {"parameters-describe", "parameters-diagnostic-rerun", "parameters-school-closure", "parameters-why-so-many-infected"}


def test_the_parameter_cases_are_pending_for_the_api_harness():
    cases = load_cases(CASES_DIR)
    by_id = {c["id"]: c for c in cases}
    describe, rerun = by_id["parameters-describe"], by_id["parameters-diagnostic-rerun"]
    for case_id in PENDING:
        case = by_id[case_id]
        assert case["pending"] == "api-harness" and case["pending_note"] and case["category"] == "parameters", case_id
        assert case["turns"] and case["checks"]["judge"], case_id
    assert "describe_parameters" in describe["checks"]["tool_called"]
    assert describe["checks"]["config"] == {"disease": "measles", "country": "KEN"}
    assert rerun["real_sim"] is True and rerun["checks"]["ran_simulation"] is True
    # The fade-out is luck unless the seed is pinned; the harness author vets the seed (review finding).
    assert "random seed" in rerun["turns"][0] and "seed" in rerun["pending_note"]
    assert "early_fadeout" in rerun["checks"]["judge"][0]
    runnable, pending = split_pending(cases)
    assert {c["id"] for c in pending} == PENDING
    assert len(runnable) == len(cases) - len(PENDING)
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    assert not (PENDING & set(baseline))


def test_the_part_2_cases_cover_the_school_closure_and_the_hybrid_option():
    by_id = {c["id"]: c for c in load_cases(CASES_DIR)}
    closure = by_id["parameters-school-closure"]
    assert closure["real_sim"] is True and closure["checks"]["ran_simulation"] is True
    assert closure["checks"]["config"] == {"disease": "influenza", "network_type": "hybrid"}
    assert {"configure_simulation", "run_simulation"} <= set(closure["checks"]["tool_called"])
    assert any("school" in c and "contact_reduction" in c for c in closure["checks"]["judge"])
    assert any("illustrative" in c for c in closure["checks"]["judge"])
    why = by_id["parameters-why-so-many-infected"]
    assert why["real_sim"] is True and why["checks"]["ran_simulation"] is True
    assert "Why were so many infected" in why["turns"][-1]
    assert any("hybrid" in c for c in why["checks"]["judge"])
    assert any("does not promise" in c or "never promises" in c for c in why["checks"]["judge"])
```

- [ ] **Step 2: Run it and watch it fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_golden_cases.py -q -p no:cacheprovider`
Expected: FAIL with `KeyError: 'parameters-school-closure'`.

- [ ] **Step 3: Append the two cases**

Append to `evals/golden/cases/parameters.yaml` (after the `parameters-diagnostic-rerun` case; keep the two-space list indentation of the file):

```yaml

# The two cases of the sim-parameters Part 2 spec (2026-10-12, section 13),
# written for the same harness: a school closure on the hybrid network, and
# "why were so many infected?" leading to the hybrid option (Part 2, 5.1).
- id: parameters-school-closure
  category: parameters
  critical: false
  real_sim: true
  pending: api-harness
  pending_note: "The hybrid network, the structured interventions field and the comparison come from the web agent and the simulation service (Part 2, 5.4 and 7.4); the Python agent has neither."
  turns:
    - "Model seasonal influenza in a town of 50,000 people with households, schools and workplaces, for six months."
    - "Yes, run it."
    - "Now close the schools from day 30 for six weeks and run it again."
  checks:
    tool_called: [configure_simulation, run_simulation]
    ran_simulation: true
    config:
      disease: influenza
      network_type: hybrid
    judge:
      - "Chooses the hybrid network for a setting with households, schools and workplaces, and says so"
      - "Represents the closure as a contact_reduction on the school layer at scale 1 from day 30 to day 72 (six weeks), not as a change to R0 or to n_contacts"
      - "Says the closure's effect size is an illustrative assumption (the database carries no school-closure effect)"
      - "After the second run, reports what changed against the first run (the peak, the total infected) before interpreting the closure's effect"

- id: parameters-why-so-many-infected
  category: parameters
  critical: false
  real_sim: true
  pending: api-harness
  pending_note: "The hybrid option is a web-agent rule (Part 2, 5.1): the random network is the default, and the agent offers the hybrid network when asked why so many were infected."
  turns:
    - "Model measles in Kenya for a year with 20,000 agents."
    - "Yes, run it."
    - "Why were so many infected?"
  checks:
    tool_called: [run_simulation]
    ran_simulation: true
    config:
      disease: measles
      country: KEN
    judge:
      - "Explains that on the random network everyone meets fresh contacts every day, so at this R0 nearly every susceptible is eventually infected"
      - "Offers the hybrid network (households, schools, workplaces, community) as an option, as the structure that school closures and distancing act on"
      - "Does not promise that switching the network alone lowers the final size (at the same R0 the final size is close on every network)"
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_golden_cases.py tests/test_golden_harness.py -q -p no:cacheprovider`
Expected: all pass. Then `.venv/Scripts/python.exe -m evals.golden.run --help` prints the usage (the module still imports); do not run the set.

- [ ] **Step 5: Commit**

```bash
git add evals/golden/cases/parameters.yaml tests/test_golden_cases.py
git commit -m "evals: the school-closure and why-so-many-infected cases, pending the API harness"
```

---

### Task 2: The review list, generated and pinned

**Files:**
- Create: `docs/data-review-requests.md` (generated)
- Modify: `tests/test_review_requests.py`

**Interfaces:**
- Consumes: `scripts.review_requests.render`, `review_table`, the `--write PATH` option.
- Produces: the committed file, equal to `render(review_table())`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_review_requests.py`:

```python
def test_the_committed_review_list_is_what_the_script_renders_today():
    # Part 2, section 11: regenerated whenever the database or the registry changes; this test is the reminder.
    committed = (ROOT / "docs" / "data-review-requests.md").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert committed == render(review_table()), "run: .venv/Scripts/python.exe scripts/review_requests.py --write docs/data-review-requests.md"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_review_requests.py -q -p no:cacheprovider`
Expected: FAIL with `FileNotFoundError` for `docs/data-review-requests.md`.

- [ ] **Step 3: Generate the file**

Run: `.venv/Scripts/python.exe scripts/review_requests.py --write docs/data-review-requests.md`
Expected: the file starts with `# Data review requests`, its "Requested fields" section lists `fatality_rate_by_age`, `vaccine_efficacy`, `treatment_efficacy`, `presymptomatic_transmission`, `school_closure_effect`, `distancing_effect`, `mask_effect`, its table has one row per disease, and its "Bundled tables" section lists the four checks. Read it once.

- [ ] **Step 4: Run the test and watch it pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_review_requests.py -q -p no:cacheprovider`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add docs/data-review-requests.md tests/test_review_requests.py
git commit -m "docs: the generated data review requests for the database team, pinned to the script"
```

---

### Task 3: The README's Part 2 sections

**Files:**
- Modify: `README.md` (the web-agent section at "## Web agent: parameters, diagnostics and options (2026)", the "Bundled / local data" table under "## Data Sources", "### Network Parameters", "## Interventions", "## Project Structure"), `tests/test_readme.py`

**Interfaces:**
- Consumes: `epichat.schema.INTERVENTION_TYPES` (or the `Intervention.type` Literal's values if the module exposes no list: read `epichat/schema.py` and use whichever exists), the CSV names in `epichat/data/`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_readme.py`:

```python
def test_the_readme_describes_part_2_from_the_codes_own_names():
    from pathlib import Path as _Path
    import typing

    from epichat.schema import Intervention

    web = README.split("## Web agent: parameters")[1].split("## Input Types")[0]
    for phrase in ("docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md", "hybrid", "Prem 2021", "UN WPP 2024",
                   "household", "measured R0", "beta_calibrated_by_measurement", "well_mixed", "r0_gap", "run.fit", "attack rate",
                   "docs/data-review-requests.md", "scripts/review_requests.py", "rel_sus_age", "p_death_age", "rel_trans_exposed"):
        assert phrase in web, phrase
    # every bundled table and every intervention type is named where the reader looks for it
    data = _Path(__file__).resolve().parent.parent / "epichat" / "data"
    for csv in sorted(p.name for p in data.glob("*.csv")):
        assert csv in README, csv
    types = typing.get_args(Intervention.model_fields["type"].annotation)
    assert {"contact_reduction", "transmission_reduction"} <= set(types)
    interventions = README.split("## Interventions")[1].split("## Natural Language Query Tips")[0]
    for kind in types:
        assert f"`{kind}`" in interventions, kind
    for field in ("efficacy", "end_day", "protection_days", "delay_days", "rel_trans_treated", "symptomatic_only", "layer", "peak_day"):
        assert f"`{field}`" in interventions, field
```

If `Intervention.model_fields["type"].annotation` is not a plain `Literal` (for example an `Annotated`), read `epichat/schema.py` and take the Literal's values the way the module defines them; the test must derive the list from the schema, never hard-code it.

- [ ] **Step 2: Run it and watch it fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_readme.py -q -p no:cacheprovider`
Expected: FAIL on the first phrase (`docs/superpowers/specs/2026-10-12-...`).

- [ ] **Step 3: Write the sections**

In `README.md`:

(a) In the web-agent section, change the sentence "Their parameters are the sim-parameters design, `docs/superpowers/specs/2026-10-09-sim-parameters-disease-design.md`; the runbook is `web/docs/DEPLOY.md`." to:

```
Their parameters are the sim-parameters design in two parts,
`docs/superpowers/specs/2026-10-09-sim-parameters-disease-design.md` (the
registry, schema v2, the exact R0, diagnostics and options) and
`docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md`
(networks, demographics, interventions and the fit); the runbook is
`web/docs/DEPLOY.md`.
```

(b) After the "**Recording.**" bullet and before "The CLI, the Streamlit app and the templates below still use the v1 flat parameters", insert:

```
- **Disease extensions (Part 2).** Susceptibility by age (`rel_sus_age`:
  children under 18, adults, the elderly), fatality by age (`p_death_age`)
  and presymptomatic transmissibility (`rel_trans_exposed`); a connector
  composes `rel_sus` and `rel_trans` from every factor (age, vaccine,
  seasonality, treatment) on every step, and the exact R0 carries the
  multipliers.
- **Networks.** `network_type` is `random` (fresh contacts daily, constant
  or Poisson, optionally lasting `contact_duration_days`), `age_structured`
  (three age groups mixing by a 3×3 contact matrix: POLYMOD's European
  defaults, or the country's Prem 2021 matrix once `fetch_demographics` has
  run) or `hybrid` (households, schools, workplaces and community as in
  Covasim, with the country's household size and the layers' sizes and
  transmissibilities as parameters). The R0 formula is exact on the first two
  and approximate on the hybrid network, so every run reports the measured
  R0 (the day-0 seeds' mean secondary infections) and on the hybrid network a
  short pilot adjusts beta to it (`applied.beta_calibrated_by_measurement`;
  `run.calibrate_r0` switches it off). At the same R0 the final size is close
  on every network: the networks differ in who meets whom and in what the
  interventions act on.
- **Demographics.** With a country, the agents' ages follow the UN WPP 2024
  pyramid (`epichat/data/un_wpp_age.csv`) and multi-year runs follow the
  projected crude birth rates (`un_wpp_cbr.csv`); the household size comes
  from the UN household database (`un_household_size.csv`) and the contact
  matrix from Prem 2021 (`contact_matrices.csv`). `scripts/fetch_un_wpp_tables.py`,
  `scripts/fetch_household_size.py` and `scripts/fetch_contact_matrices.py`
  rebuild the tables.
- **Interventions.** Five types: a vaccine (routine or a campaign over a
  window, with an efficacy, an age range and a protection duration), a
  treatment (with a delay, an efficacy and a transmissibility while waiting,
  optionally symptomatic cases only), seasonality, a contact reduction on one
  layer (a school closure is the school layer at scale 1) and a transmission
  reduction (masks). `configure_simulation` takes them as structured entries
  (`interventions`, `remove_interventions`) beside the shortcut fields; every
  effect size is an illustrative assumption unless the database carries it,
  and `fetch_vaccination_coverage` writes a day-0 campaign with the database's
  vaccine efficacy when it has one.
- **The fit.** `run.fit` (`configure_simulation`'s `fit` field) fits the run
  to one outcome the user knows: the attack rate, the peak day or the peak
  size. The service searches the transmission rate (or the network
  multiplier) in at most eight runs and reports `stats.fit`; the report shows
  the target and what the search reached.
- **Diagnostics, continued.** `well_mixed` (a random-network run that a
  hybrid scenario would describe better) and `r0_gap` (the measured R0 far
  from the configured one) join the list above.
- **The review list.** `scripts/review_requests.py` renders
  `docs/data-review-requests.md`: for every disease, the status of every
  database field the registry names, the fields the database does not have
  yet (fatality by age, vaccine and treatment efficacy, presymptomatic
  transmission, the school-closure, distancing and mask effects) with what a
  reviewer should find, and the bundled tables' checks. A test keeps the
  committed file equal to the script's output; regenerate it with
  `.venv/Scripts/python.exe scripts/review_requests.py --write docs/data-review-requests.md`
  whenever the database or the registry changes.
```

(c) In the "Bundled / local data" table, replace the row `| **Contact matrices** (Prem 2021 / POLYMOD / SOCRATES) | `epichat/data/` (add CSVs to activate) | Country-specific mean daily contacts |` with these four rows:

```
| **Contact matrices (Prem et al. 2021)** | `epichat/data/contact_matrices.csv` (177 countries, 16 age bands aggregated to under 18 / 18–64 / 65+ with each country's pyramid; `scripts/fetch_contact_matrices.py`) | The age-structured network's matrix for the scenario's country |
| **UN WPP 2024 population by single age** | `epichat/data/un_wpp_age.csv` (every country, 2024 and 2030; `scripts/fetch_un_wpp_tables.py`) | The agents' age pyramid and the three age shares |
| **UN WPP 2024 projected crude birth rates** | `epichat/data/un_wpp_cbr.csv` (2020–2050; the same script) | The birth rate after the first year of a multi-year run |
| **UN household size** | `epichat/data/un_household_size.csv` (189 countries, the 2026 household database; `scripts/fetch_household_size.py`) | The hybrid network's mean household size |
```

(d) Under "### Network Parameters", change the `network_type` row's options to `random`, `age_structured`, `hybrid` and add a third option bullet after the `age_structured` one:

```
- **`hybrid`** — Households (the country's mean size), schools, workplaces and
  community, as in Covasim: each layer has its own contacts per day and
  transmissibility (schema v2: `household_size`, `school_contacts`,
  `work_contacts`, `community_contacts`, `layer_beta.household` and so on, the
  school and working age ranges). The structure a school closure or
  distancing acts on. Schema v2 also adds `contacts_dist` (constant or
  Poisson), `contact_duration_days`, the nine `contacts.<group>_<group>` cells
  and `contacts_source` for the age-structured network.
```

and after the `network_beta` examples table add: "Schema v2 prefers a `transmission_reduction` (masks) or a `contact_reduction` (distancing, a school closure) intervention over a hand-set `network_beta`: they have a window and a layer."

(e) Under "## Interventions", change "Up to three intervention types can be combined in a single simulation." to "Five intervention types can be combined in a single simulation (the CLI and the templates know the first three; the web agent takes all five, with the schema v2 fields marked below)." Then extend the three tables and add two sections:

Vaccine table, add rows:

```
| `kind` | string | `routine` (v2 default: a yearly probability over the window) or `campaign` (reaches the coverage uniformly over the window) |
| `end_day` | integer or null | Last day of the window (v2; null = the run's end) |
| `efficacy` | float (0–1) | Protection per dose (v2; 1.0 = full). A day-0 vaccine with efficacy below 1 is a one-day campaign, not pre-existing immunity |
| `leaky` | bool | v2: `true` scales susceptibility by 1 − efficacy; `false` protects a fraction fully |
| `age_min`, `age_max` | integer or null | v2: the ages vaccinated |
| `protection_days` | integer or null | v2: days before the protection wanes (null = permanent) |
```

Treatment table, add rows:

```
| `end_day` | integer or null | v2: last day treatment is available |
| `efficacy` | float (0–1) | v2: share of treated cases cured |
| `delay_days` | integer | v2: days from infection to treatment |
| `rel_trans_treated` | float (0–1) | v2: transmissibility while waiting for treatment |
| `symptomatic_only` | bool | v2: skip asymptomatic cases (SEIAR) |
```

Seasonality table, add the row `| `peak_day` | integer | v2 alias of `shift`: the day of the year the transmission peaks |`.

Then append two sections before "## Natural Language Query Tips":

```
### Contact reduction (schema v2)

Removes a fraction of one layer's contacts over a window: `type: contact_reduction`.

| Field | Type | Description |
|-------|------|-------------|
| `layer` | string | `all`, or on the hybrid network `household`, `school`, `work`, `community` |
| `scale` | float (0–1) | The fraction of contacts removed; `1` closes the layer |
| `start_day`, `end_day` | integer | The window (`end_day` null = the run's end) |

- *"Close the schools from day 30 for six weeks"* → `{type: contact_reduction, layer: school, scale: 1, start_day: 30, end_day: 72}` on the hybrid network
- *"Physical distancing"* → the `community` layer at a fraction

### Transmission reduction (schema v2)

Lowers every contact's transmission over a window: `type: transmission_reduction` with `scale` (the fraction removed), `start_day` and `end_day`.

- *"Masks for the first three months"* → `{type: transmission_reduction, scale: 0.3, start_day: 0, end_day: 90}`

Every effect size above is an illustrative assumption unless the database
carries it (`docs/data-review-requests.md` asks for the cited ranges).
```

(f) In "## Project Structure", change the `data/` lines to:

```
│   ├── data/
│   │   ├── disease_parameters.json   # Literature-backed R₀/incubation/infectious ranges
│   │   ├── contact_matrices.csv      # Prem 2021 matrices, three age bands (web agent)
│   │   ├── un_wpp_age.csv            # UN WPP 2024 pyramids, 2024 and 2030 (web agent)
│   │   ├── un_wpp_cbr.csv            # UN WPP 2024 projected birth rates (web agent)
│   │   └── un_household_size.csv     # UN household size by country (web agent)
```

and the `docs`-adjacent lines: after `├── web/ ...` add `├── docs/data-review-requests.md  # The review list for the database team (generated)` and after `├── evals/golden/ ...` keep the line as is.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_readme.py -q -p no:cacheprovider`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add README.md tests/test_readme.py
git commit -m "docs: the README's Part 2 sections (networks, demographics, interventions, the fit, the review list)"
```

---

### Task 4: The runbook's verification steps and timings, and the full suites

**Files:**
- Modify: `web/docs/DEPLOY.md` (a new section "6j. Networks, interventions and the fit verification" after section 6i; the networks timing paragraph in section 7), `tests/test_readme.py`

**Interfaces:**
- Produces: the runbook section the owner follows after the Part 2 push.

- [ ] **Step 1: Measure a fitted run locally**

From the worktree root run (one line):

```
.venv/Scripts/python.exe -c "import time; from epichat.params.schema_v2 import SimParamsV2; from epichat.sim.replicates import run_replicates; p = SimParamsV2.model_validate({'disease': {'dur_inf': {'mean_days': 10.0, 'dist': 'gamma', 'sd_days': 4.0}, 'seed': {'mode': 'count', 'value': 50}}, 'run': {'n_agents': 10000, 'sim_dur_years': 1.0, 'rand_seed': 1, 'fit': {'target': 'attack_rate', 'value': 0.3}}}); t = time.perf_counter(); out = run_replicates(p); print(round(time.perf_counter() - t, 1), 's', out['stats']['fit'])"
```

Expected: a wall time and `{'target': 'attack_rate', ..., 'runs': N}` with N ≤ 8. Note both; the paragraph below quotes them.

- [ ] **Step 2: Write the failing test**

Append to `tests/test_readme.py`:

```python
def test_the_runbook_verifies_part_2_through_the_shipped_fields():
    runbook = (Path(__file__).resolve().parent.parent / "web" / "docs" / "DEPLOY.md").read_text(encoding="utf-8")
    section = runbook.split("## 6j.")[1].split("## 7.")[0]
    for phrase in ("hybrid", "Household size", "beta_calibrated_by_measurement", "R₀ measured", "contact_reduction", "layer", "School contacts reduced by 100%",
                   "fit", "attack_rate", "Fitted to", "Why were so many infected", "stats->'fit'"):
        assert phrase in section, phrase
    assert "fitted" in runbook.split("## 7.")[1] and "at most eight" in runbook.split("## 7.")[1]
```

- [ ] **Step 3: Run it and watch it fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_readme.py -q -p no:cacheprovider`
Expected: FAIL with `IndexError` (no "## 6j." section).

- [ ] **Step 4: Write the runbook section and the timing**

Insert before "## 7. Simulation service (`sim/`)":

```
## 6j. Networks, interventions and the fit verification

Done after the sim-parameters Part 2 phases (2A to 2D) are pushed. No
migration. One browser; a phone is enough.

1. New conversation: "Model seasonal influenza in a town of 50,000 people
   with households, schools and workplaces, for six months." The configure
   call sets `network_type: hybrid`; the panel's Parameters section shows
   "Contact network: hybrid (households, schools, workplaces, community)" and
   a "Household size" row; the reply says the hybrid network was chosen for
   the setting.
2. "Run it." The reply says in one sentence that beta was adjusted to the
   measured R0 (the run payload carries `applied.beta_calibrated_by_measurement`
   and `stats.r0_calibration`); the runs panel and the report show an
   "R₀ measured" row.
3. "Close the schools from day 30 for six weeks and run it again." The
   configure call carries `interventions: [{type: contact_reduction, layer:
   school, scale: 1, start_day: 30, end_day: 72}]`; the panel's
   Interventions section reads "School contacts reduced by 100% from day 30
   to day 72"; the reply reports what changed against the previous run before
   interpreting, and calls the closure's effect size an illustrative
   assumption.
4. "Fit it so that 30% of the town is infected." The configure call carries
   `fit: {target: attack_rate, value: 0.3}`; the panel shows a "Fitted to"
   row ("attack rate 30% by moving the transmission rate"); the run takes
   longer (the fit's search, at most eight runs before the replicates); the
   reply says beta was set so that the attack rate is 30% and labels the run
   as fitted in the limitations; the report's Parameters block shows "Fitted
   to: attack rate 30% (reached …% in N runs)".
5. New conversation on the random network: "Model measles in Kenya for a
   year." Run it, then ask "Why were so many infected?": the reply explains
   the random network (fresh contacts every day) and offers the hybrid
   network as an option without promising that the switch alone lowers the
   final size.
6. In the SQL editor:

       select id, stats->'fit' as fit, stats->'r0_calibration' as calibration, stats->'r0_measured' as measured
       from runs order by created_at desc limit 4;

   The fitted run's row carries `fit` with `target`, `wanted`, `achieved`,
   `lever`, `value` and `runs`; the hybrid runs carry `calibration`; every
   row carries `measured` (null on an age-structured run, where Starsim's
   mixing pools do not log the source).
```

In section 7, after the "Networks (sim-parameters Part 2; …)" paragraph, add:

```
A fitted run (Part 2, 7.7) costs one full run per search step before the
replicates, at most eight: locally (the same machine and settings, 2026-10-13)
fitting the attack rate to 30% on the random network at 10k agents took
<N> runs and <T> s in all. On Vercel the per-attempt timeout covers eight
runs of 10k agents (about half a minute); a fit at 100k agents is the one
case to keep to the local service. Owner: after the deploy, time a fitted
scenario once from the activity's run duration and add it here.
```

with `<N>` and `<T>` from Step 1.

- [ ] **Step 5: Run the test and watch it pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_readme.py -q -p no:cacheprovider`
Expected: 3 passed.

- [ ] **Step 6: Run everything**

`.venv/Scripts/python.exe -m pytest tests -q -p no:cacheprovider --ignore=tests/test_r0_calibration.py` (the calibration file and `sim/tests` did not change and were green at the 2C merge; run `sim/tests` anyway: `sim/.venv/Scripts/python.exe -m pytest sim/tests -q -p no:cacheprovider`), and from `web/`: `npx vitest run > ../.superpowers/vitest-final.log 2>&1 && grep -E "Tests " ../.superpowers/vitest-final.log && npm run typecheck && npm run lint`. Expected: all green; the ledger gets each count.

- [ ] **Step 7: Commit**

```bash
git add web/docs/DEPLOY.md tests/test_readme.py
git commit -m "docs: the runbook's Part 2 verification steps and the fitted-run timing"
```

---

## Self-review

**Spec coverage.** Section 11 (the generated list, committed, regenerated on change): Task 2. Section 13's evals paragraph (the two pending cases): Task 1. Section 14's phase 2D (README and runbook sections): Tasks 3 and 4. Section 16 (the timings in the runbook): Task 4. Section 10 (the sources, in one place): the README's bundled table in Task 3.

**Placeholders.** `<N>` and `<T>` in Task 4 are filled from Step 1's measurement in the same task; every other step carries its text.

**Type consistency.** The case ids in Task 1's test match the YAML; the test in Task 2 calls `render(review_table())` as `scripts/review_requests.py` exports them; Task 3's test derives the intervention types from `epichat.schema.Intervention`.

**Review Focus.** 1 → Task 2's sync test. 2 → Task 3's test (names from `epichat/data/` and the schema). 3 → Task 1's `split_pending` and baseline assertions. 4 → Task 4's runbook test. 5 → Task 2's `.replace("\r\n", "\n")`.

## After the merge (owner)

- Push `main`; follow `web/docs/DEPLOY.md` section 6j once, and add the fitted-run and hybrid timings through the binding.
- Hand `docs/data-review-requests.md` to the database team; regenerate it (the command is in the README) when the database or the registry changes.
- The two new golden cases run once the API harness exists (sub-project 5): remove their `pending` keys then.
