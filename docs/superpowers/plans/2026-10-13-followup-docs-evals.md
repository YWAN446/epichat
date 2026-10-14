# Follow-up Docs, Evals and Review List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the follow-up round: the database team gets the two new requests, the eval set gets its two pending cases, the runbook gets a verification section with the owner's prompts for the four changes, and the documentation minors deferred from 2C and 2D are settled.

**Architecture:** Documents and their tests only. Every claim a document makes about the product is pinned the way the earlier phases pinned theirs: a test reads the quoted string out of the file that produces it, the review list is compared with what its script renders, and the eval cases are loaded by the runner.

**Tech Stack:** Python (pytest), Markdown, YAML.

**Spec:** `docs/superpowers/specs/2026-10-13-limits-suggestions-parameters-design.md`, sections 11, 13 (evals) and 14 (phase E).

## Global Constraints

- No product code changes. No migration, no dependency.
- A runbook step quotes only strings the product produces; a test proves each one is in the file that produces it.
- The two eval cases are `pending: api-harness` with a `pending_note`, like the four that exist; nothing runs or scores them, and `baseline.json` has no entry for them.
- `docs/data-review-requests.md` is whatever `scripts/review_requests.py` renders; it is never edited by hand.

## Review Focus

- A runbook step must be something the owner can do in a browser and see: it must not name a string the product no longer shows after phases A to D (the old `well_mixed` text, the tag "you", "Diagnostics and options").
- The earlier sections 6i and 6j must still be true after this round; a step that is not gets corrected in place.
- The two requests must say what a reviewer should find and in what form, as the existing seven do.
- An eval case's judge lines must describe what the shipped prompt asks of the agent, not the draft spec's wording.

---

### Task 1: The review list

**Files:**
- Modify: `scripts/review_requests.py` (`REQUESTED_FIELDS`), `docs/data-review-requests.md` (regenerated), `README.md` (the review-list bullet)
- Test: `tests/test_review_requests.py`

- [ ] **Step 1: Write the failing test** (appended)

```python
def test_the_follow_up_round_asks_for_the_two_limits_on_spread():
    # follow-up spec 11: both mechanisms run on illustrative values until the database carries a cited range
    for field in ("susceptibility_variation", "behaviour_response_effect"):
        assert field in REQUESTED_FIELDS, field
        assert "cited range" in REQUESTED_FIELDS[field] and "illustrative" in REQUESTED_FIELDS[field], field
    assert "disease.rel_sus_cv" in REQUESTED_FIELDS["susceptibility_variation"] and "coefficient of variation" in REQUESTED_FIELDS["susceptibility_variation"]
    assert "behavior_response" in REQUESTED_FIELDS["behaviour_response_effect"]
    text = render(review_table())
    assert "**susceptibility_variation**" in text and "**behaviour_response_effect**" in text
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python -m pytest tests/test_review_requests.py -q -p no:cacheprovider`
Expected: FAIL.

- [ ] **Step 3: Implement**

Also a generated section, "Estimates outside their consensus range": every literature estimate whose single value lies outside its parameter's consensus minimum and maximum, by disease and parameter with its index in the list, so the database team sees them without a reviewer finding them by hand (the review of phase D found three). A test asserts the section is rendered and that each listed estimate is in fact outside its range.

Two entries in `REQUESTED_FIELDS`:

- `susceptibility_variation`: "The coefficient of variation of susceptibility or exposure between people, as a cited range with the population and the method (a household study, a serosurvey, a fitted model), seeding the illustrative default of 1; the registry's disease.rel_sus_cv."
- `behaviour_response_effect`: "The reduction in contacts or transmission observed as prevalence or deaths rose, without or before formal measures, as a cited range (mobility data, contact surveys), seeding the illustrative default of a response of up to 50%; the registry's interventions[].scale, half_prevalence and memory_days of a behavior_response entry."

Then `python scripts/review_requests.py --write docs/data-review-requests.md`, and the README's review-list bullet names the two.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `python -m pytest tests/test_review_requests.py tests/test_readme.py -q -p no:cacheprovider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/review_requests.py docs/data-review-requests.md README.md tests/test_review_requests.py
git commit -m "docs: the review list asks for the variation in susceptibility and the behaviour response"
```

---

### Task 2: The two pending eval cases

**Files:**
- Modify: `evals/golden/cases/parameters.yaml`, `evals/README.md`
- Test: `tests/test_golden_cases.py`

- [ ] **Step 1: Write the failing test**

`PENDING` gains `"parameters-known-attack-rate"` and `"parameters-offer-intervention"`, and a new test:

```python
def test_the_follow_up_cases_cover_the_fit_that_keeps_r0_and_the_offer_of_an_intervention():
    by_id = {c["id"]: c for c in load_cases(CASES_DIR)}
    known = by_id["parameters-known-attack-rate"]
    assert known["real_sim"] is True and known["checks"]["ran_simulation"] is True
    assert {"configure_simulation", "run_simulation"} <= set(known["checks"]["tool_called"])
    assert any("disease.rel_sus_cv" in c and "not beta" in c for c in known["checks"]["judge"])
    assert any("R0" in c and ("stays" in c or "unchanged" in c) for c in known["checks"]["judge"])
    assert any("illustrative" in c for c in known["checks"]["judge"])
    offer = by_id["parameters-offer-intervention"]
    assert offer["real_sim"] is True and offer["checks"]["config"] == {"disease": "influenza", "network_type": "hybrid"}
    assert any("what_if" in c for c in offer["checks"]["judge"]) and any("illustrative" in c for c in offer["checks"]["judge"])
    assert "warning" in offer["pending_note"]
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python -m pytest tests/test_golden_cases.py -q -p no:cacheprovider`
Expected: FAIL.

- [ ] **Step 3: Write the cases** (appended to `parameters.yaml`)

```yaml
- id: parameters-known-attack-rate
  category: parameters
  critical: false
  real_sim: true
  pending: api-harness
  pending_note: "A web-agent rule (follow-up spec 6): when the user knows the attack rate and the R0 comes from the database, the fit moves the variation between people, not beta. Needs the deployed agent's configure_simulation with fit.lever and the service's fit."
  turns:
    - "Model measles in a city of 20,000 people for a year, with the database's R0."
    - "In the real outbreak 60% of the city was infected. Fit the model to that and run it."
  checks:
    tool_called: [configure_simulation, run_simulation]
    ran_simulation: true
    config:
      disease: measles
    judge:
      - "Fits the variation between people (fit lever disease.rel_sus_cv), not beta"
      - "Says the R0 stays at the database's value (it is unchanged by the fit)"
      - "Says the variation in susceptibility is an illustrative assumption, and labels the run as fitted in the limitations"
      - "Reports the attack rate the fit reached, and says so plainly if the largest variation could not reach 60%"

- id: parameters-offer-intervention
  category: parameters
  critical: false
  real_sim: true
  pending: api-harness
  pending_note: "A web-agent rule (follow-up spec 7.3): after a baseline run without a warning diagnostic, the agent offers up to two levers of the what_if diagnostic by their labels. If the run raises a warning (an unfinished run, say) the agent must offer that diagnostic's options and no intervention; the harness author picks a duration that lets the epidemic finish."
  turns:
    - "Model seasonal influenza in a town of 20,000 people with households, schools and workplaces, for a year."
    - "Yes, run it."
  checks:
    tool_called: [run_simulation]
    ran_simulation: true
    config:
      disease: influenza
      network_type: hybrid
    judge:
      - "After reporting the run, offers at least one intervention from the run's what_if diagnostic (a school closure, distancing, masks or a behaviour response) as a next step, naming when it starts"
      - "Says the effect sizes of the offered interventions are illustrative assumptions"
      - "Does not state the effect of an intervention before it has been run"
```

`evals/README.md`: "today the two sim-parameters cases" becomes "today the six sim-parameters cases".

- [ ] **Step 4: Run the tests and watch them pass**

Run: `python -m pytest tests/test_golden_cases.py -q -p no:cacheprovider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add evals tests/test_golden_cases.py
git commit -m "evals: two pending cases for the fit that keeps R0 and the offer of an intervention"
```

---

### Task 3: The runbook's section 6k, and 6i and 6j brought up to date

**Files:**
- Modify: `web/docs/DEPLOY.md`
- Test: `tests/test_readme.py`

- [ ] **Step 1: Write the failing test** (appended; `source` is the helper the 6j test uses)

```python
def test_the_runbook_verifies_the_follow_up_through_the_shipped_strings():
    runbook = source("web", "docs", "DEPLOY.md")
    section = runbook.split("## 6k.")[1].split("## 7.")[0]
    quoted = {
        "Try next": ("web", "components", "RunSummary.tsx"),
        "Interventions to try": ("epichat", "sim", "diagnostics.py"),
        "Let people become careful as cases rise and rerun": ("epichat", "sim", "diagnostics.py"),
        "Add variation between people (CV": ("epichat", "sim", "diagnostics.py"),
        "Variation in susceptibility": ("web", "lib", "client", "parameters.ts"),
        "Behaviour response: transmission falls by up to": ("web", "lib", "client", "format.ts"),
        "by moving": ("web", "lib", "client", "parameters.ts"),
        "the variation in susceptibility": ("web", "lib", "client", "format.ts"),
        "ended the fit": ("web", "lib", "tools", "configureSimulation.ts"),
        "Show all (": ("web", "components", "panel", "ParametersSection.tsx"),
        "set in chat": ("web", "lib", "client", "parameters.ts"),
        "set by the run": ("web", "lib", "client", "parameters.ts"),
        "assumption": ("web", "lib", "client", "parameters.ts"),
        "Use this value": ("web", "components", "panel", "ReferenceList.tsx"),
        "R0 moved from": ("web", "lib", "tools", "configureSimulation.ts"),
        "use_reference": ("web", "lib", "tools", "configureSimulation.ts"),
        "Literature": ("web", "lib", "report", "compose.ts"),
        "what_if": ("epichat", "sim", "diagnostics.py"),
        "suggestion_used": ("web", "lib", "enums.ts"),
    }
    for phrase, path in quoted.items():
        assert phrase in section, phrase
        assert phrase in source(*path), (phrase, path)
    # the earlier sections say nothing the round made untrue
    earlier = runbook.split("## 6i.")[1].split("## 6k.")[0]
    for stale in ("explains the random network (fresh contacts every day)", "offers the\n   hybrid network as an option"):
        assert stale not in earlier, stale
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python -m pytest tests/test_readme.py -q -p no:cacheprovider`
Expected: FAIL (no section 6k).

- [ ] **Step 3: Write the section**, between 6j and 7, in the form of 6j: when it is done, then numbered steps, each a prompt to type or a button to press and what to see, ending with one SQL check. The steps: (1) a baseline at R0 2.5 that infects about 89%, with the "Try next" buttons under the run; (2) "Why were so many infected?" and the two limits on spread offered as illustrative; (3) the variation at CV 1, its row and its tag, about 60% infected, R0 unchanged; (4) a "Try next" button pressed (the behaviour response), its line in the Interventions group and the strongest reduction in the reply; (5) a known attack rate fitted with the variation, the "Fitted to" row; (6) an intervention added to the fitted scenario, the warning that the fit ended, and an attack rate that moves; (7) the Parameters section: the groups, "Show all", the tags, a hybrid scenario's Layers table; (8) a reference chosen with "Use this value", the message, the tag "reference" with the title, the report's "Literature" row; (9) the SQL for `option_chosen` with its `interventions` and `suggestion_used` with the sources `option` and `reference`. Correct 6j step 5 (the answer to "Why were so many infected?" is now the limits on spread, with the hybrid network as an option on the random one) and anything in 6i that names a string that changed.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `python -m pytest tests/test_readme.py -q -p no:cacheprovider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/docs/DEPLOY.md tests/test_readme.py
git commit -m "docs: the runbook's verification of the follow-up round (6k); 6j brought up to date"
```

---

### Task 4: The documentation minors deferred from 2C and 2D, and the spec's status

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md` (section 13), `README.md`, `docs/superpowers/specs/2026-10-13-limits-suggestions-parameters-design.md` (status)
- Test: `tests/test_readme.py`

- [ ] **Step 1: Write the failing test** (appended)

```python
def test_the_deferred_documentation_minors_are_settled():
    part2 = source("docs", "superpowers", "specs", "2026-10-12-sim-parameters-modules-design.md")
    testing = part2.split("## 13.")[1].split("## 14.")[0]
    assert "layer at scale 0" not in testing and "layer at scale 1 removes" in testing          # a full closure is scale 1 (7.1)
    assert "peak day to day 60" not in testing                                                  # 7.7's test fits an earlier day
    assert "a connector\n  composes `rel_sus` and `rel_trans`" not in README
    assert "composes `rel_trans`" in README and "composes its own `rel_sus`" in README
    interventions = README.split("## Interventions")[1].split("## Natural Language Query Tips")[0]
    assert "\n---\n" not in interventions.split("### Seasonality")[1].split("### Contact reduction")[0]
    assert "they have a window and a layer" not in README
    assert "for the age-structured network.\n" not in README.split("Schema v2 also adds")[1].split("\n\n")[0] or "random network" in README.split("Schema v2 also adds")[1].split("\n\n")[0]
    follow_up = source("docs", "superpowers", "specs", "2026-10-13-limits-suggestions-parameters-design.md")
    assert "phases A to E shipped" in follow_up.split("## 1. Purpose")[0]
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python -m pytest tests/test_readme.py -q -p no:cacheprovider`
Expected: FAIL.

- [ ] **Step 3: Fix the documents.** Part 2 section 13: "a `contact_reduction` on the school layer at scale 1 removes its transmission for the window", and the fit bullet as 7.7 has it (read 7.7 for the day the test fits). README: the disease composes its own `rel_sus` and the connector composes `rel_trans`; the stray rule between Seasonality and Contact reduction goes; `contacts_dist` and `contact_duration_days` are named as options of the random network and the matrix cells as the age-structured network's; "they have a window and a layer" becomes what is true of each; the legacy contact-matrix loader that `generator.py` and `params/resolve.py` still call gets its one sentence. The follow-up spec's status line: phases A to E shipped.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `python -m pytest tests/test_readme.py tests/test_review_requests.py tests/test_golden_cases.py tests/test_web_exports.py -q -p no:cacheprovider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md docs tests/test_readme.py
git commit -m "docs: the deferred documentation minors of 2C and 2D; the follow-up spec's status"
```

---

## Self-review notes

- Spec 11: Task 1. Spec 13's evals paragraph: Task 2. Section 14's phase E: the runbook (Task 3), the two fields and the regenerated list (Task 1), the two cases (Task 2), the deferred minors (Task 4). The README sections were written with each phase; Task 4 reads the web-agent section once more for anything the later phases made untrue.
- The Review Focus lines are pinned by: the runbook test's `quoted` table and its `stale` list (Task 3); the request test's "cited range" and "illustrative" (Task 1); the case test's judge assertions (Task 2).
