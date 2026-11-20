# Run mode choice (agents or compartmental) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user chooses whether a scenario runs as agents or as a compartmental model, with EpiChat recommending agents and
saying, from a rule in code, how much the choice matters for the scenario.

**Architecture:** A pure rule (`recommend_solver`) in Python, mirrored in TypeScript and pinned by the parity fixture, reads the
settings and returns `{recommended, required, reasons}`. A new setting `run.solver` ("abm" | "ode" | null) records the choice; the
builder passes Starsim's `solver=`; `configure_simulation` reports the advice (with `new_reasons`), `run_simulation` records the mode
of the first run, and the prompt tells EpiChat when to ask.

**Tech Stack:** Python 3.12, pydantic, Starsim 4.0.0rc5, pytest; TypeScript, zod, vitest (Next.js app in `web/`).

**Spec:** `docs/superpowers/specs/2026-11-20-run-mode-choice-design.md`

## Global Constraints

- Worktree: `C:/Users/Yuke/stat/other-projects/EpiChat/epichat/.claude/worktrees/starsim-v4`; Python is `.venv/Scripts/python`.
- The owner commits and pushes; "Checkpoint" steps stage nothing and only run the suites. Never `git commit`.
- `run.solver` values match `stats.solver`: `"abm"` (agents), `"ode"` (compartmental), or null (not chosen yet).
- Agents are recommended for every scenario (`recommended` is always `"abm"` for now; keep the field, Cliff's question 12 may change it).
- Reason texts are identical in Python and TypeScript (the parity test compares them exactly).
- "ODE" never appears in a reason text; the texts say "a compartmental model".
- Test first: each new test fails before its change. Full suites before each checkpoint:
  `.venv/Scripts/python -m pytest tests/ -q`, `.venv/Scripts/python -m pytest sim/tests -q`, `cd web && npx vitest run`.
- After any registry edit: `.venv/Scripts/python scripts/export_web_data.py`, then `git restore` the `web/data` files that changed only
  in line endings (keep `param_registry.json` and `system_prompt.json` when their content changed).

## Review Focus

- A scenario saved before this change (no `run.solver` key) must still load in both schemas and run as agents.
- `run.solver: "ode"` on a scenario that requires agents (hybrid) must run as agents, not error.
- A seed given as a fraction (the default, 0.05%) must count as `fraction × n_agents` seeds in `early_dieout`.
- R0 at or below 1 must not fire `waning`, `births` or `early_dieout` (no epidemic for a compartmental model to bring back).
- A fit (`run.fit`) runs in the scenario's mode: a fitted run with `run.solver: "ode"` stays compartmental.

---

### Task 1: The rule in Python

**Files:**
- Create: `epichat/params/solver.py`
- Modify: `epichat/params/schema_v2.py:234-239` (RunParams), `epichat/params/registry.py:285-293` (run entries)
- Test: `tests/test_solver_rule.py`

**Interfaces:**
- Produces: `well_mixed(p: SimParamsV2) -> bool` and `needs_agents(p: SimParamsV2) -> bool` (moved from `epichat/sim/builder.py:34,59`,
  unchanged behaviour); `recommend_solver(p: SimParamsV2) -> dict` returning
  `{"recommended": "abm", "required": bool, "reasons": [{"code": str, "text": str}, ...]}`; constants `REQUIRED_CODES`,
  `AGENT_CODES` (tuples, in the order below); `escape_root(r0: float) -> float`.
- Produces: `RunParams.solver: Optional[Literal["abm", "ode"]] = None`; registry entry `run.solver`.

The rule (all R0s are `r0.approx_r0(p)`; `run_days = sim_days(p.run.sim_dur_years)`):

| Code | Kind | Fires when | Text |
|---|---|---|---|
| `hybrid_network` | required | `network_type == "hybrid"` | "The hybrid network puts people in households, schools and workplaces, which only agents can represent." |
| `lasting_contacts` | required | random and `contact_duration_days > 0` | "Contacts last for days, so who meets whom has to be followed person by person." |
| `poisson_contacts` | required | random and `contacts_dist == "poisson"` | "The number of contacts varies from person to person, which only agents can represent." |
| `treatment_delay` | required | a treatment with `delay_days > 0` | "The treatment starts some days after each person becomes infectious, which needs each person's own clock." |
| `waning` | agents | R0 > 1, model in `WANING_MODELS`, `run_days > dur_immune.mean_days` | "Immunity wanes within the run, so infections fall low between waves: agents can die out there, while a compartmental model always comes back." |
| `births` | agents | R0 > 1, `use_demographics`, `sim_dur_years > 1`, and `sim_dur_years > (1/R0 − escape_root(R0)) / (birth_rate/1000)` | "Births bring back enough susceptible people within the run for infections to return: agents can die out first, while a compartmental model always comes back." |
| `temporary_measure` | agents | a `contact_reduction` or `transmission_reduction` with `end_day` not null and `< run_days`, `end_day − start_day ≥ dur_inf.mean_days`, and `R0 × (1 − scale) < 1` | "A temporary measure holds R below 1 for a while: agents can end the outbreak, while a compartmental model always rebounds when the measure ends." |
| `early_dieout` | agents | R0 > 1 and `escape_root(R0) ** seeds ≥ 0.05`, `seeds = value` (count) or `value × n_agents` (fraction) | f"With {round(seeds)} initial infections, about {round(100 × chance)} in 100 outbreaks die out early by chance, which only agents show." |
| `replicates` | agents | `n_replicates > 1` | "Several replicates are asked for, and only agents vary from run to run." |
| `same_answer` | neither | no code above fires | "Nothing here depends on chance, so both give the same epidemic: agents show it as individual people, a compartmental model as its exact average curve." |

- Required codes present → `required: True`, `reasons` = the required codes only. Otherwise `required: False`, `reasons` = the agent
  codes that fire, or `[same_answer]`. Order = table order.
- `escape_root(r0)`: the root below 1 of `s = exp(−r0 (1 − s))` (the final-size susceptible share, equal to the extinction chance of
  one chain with Poisson offspring); `1.0` when `r0 <= 1`. Iterate `s ← exp(−r0 (1 − s))` from `s = 0` until the change is below
  `1e-12` or 10,000 steps; TypeScript does the same loop so the two agree.
- `round` in the `early_dieout` text is Python's `round` (TypeScript uses `pyRound`).

- [ ] **Step 1: Write the failing tests** in `tests/test_solver_rule.py`, building params with `SimParamsV2.model_validate` from a
  default dump (helper `params(**patch)` that sets dotted paths):
  - `test_the_four_required_cases_require_agents_with_one_reason_each` (parametrized over the four codes and a patch that triggers
    each): `a["required"] is True and [r["code"] for r in a["reasons"]] == [code]`.
  - `test_waning_fires_when_the_run_outlasts_immunity`: sirs, `dur_immune.mean_days` 180, 3 years → `"waning"`; 730 days, 1 year → not;
    180 days, 3 years at R0 0.9 → not.
  - `test_births_fire_once_births_can_restore_susceptibles`: R0 15 (via `r0.calibrate_beta` or the existing helper), births 30, 5 years →
    `"births"`; R0 2.5, births 30, 2 years → not.
  - `test_a_temporary_measure_fires_when_it_holds_r_below_one`: transmission_reduction 0.7, days 0–30 → `"temporary_measure"`; scale 0.3
    → not; end_day null → not.
  - `test_early_dieout_counts_fraction_seeds_and_needs_r0_above_one`: R0 1.2, seed count 2 → fires and the text says "2 initial
    infections" and "in 100"; R0 1.2, seed fraction 0.0002 of 10,000 agents → fires with "2 initial infections"; default (R0 2.5,
    fraction 0.0005 of 10,000) → not; R0 0.9 → not.
  - `test_replicates_recommend_agents`: `n_replicates` 3 → `"replicates"`.
  - `test_nothing_depends_on_chance_in_the_default_scenario`: default → `required False`, codes `["same_answer"]`, `recommended "abm"`.
  - `test_escape_root`: `escape_root(2.5) == pytest.approx(0.1074, abs=1e-4)`, `escape_root(0.8) == 1.0`.
  - `test_run_solver_defaults_to_unset_and_takes_abm_or_ode`: `SimParamsV2().run.solver is None`; "abm"/"ode" validate; "auto" raises.

- [ ] **Step 2: Run them to verify they fail**
  Run: `.venv/Scripts/python -m pytest tests/test_solver_rule.py -q` — Expected: FAIL (`ModuleNotFoundError: epichat.params.solver`).

- [ ] **Step 3: Implement** `epichat/params/solver.py` (no Starsim import), `RunParams.solver`, and the registry entry
  `ParamSpec("run.solver", "run", "Run as", "abm: simulated individual people (agents); ode: a compartmental model, one deterministic average curve. Unset: not chosen yet, runs as agents. A scenario that needs agents runs as agents whatever is set.", "enum", None, None, None, ("abm", "ode"), (), "advanced", None, "ss.Sim(solver='abm' or 'ode')", ("stochasticity",))`.
  Add `"solver"` to `_RUN_KEYS` in `epichat/params/migrate.py:12` only if a v1 key exists (it does not: leave `_RUN_KEYS` as it is).

- [ ] **Step 4: Run them to verify they pass**, then the registry and schema suites:
  `.venv/Scripts/python -m pytest tests/test_solver_rule.py tests/test_registry*.py tests/test_schema*.py -q` — Expected: PASS.

### Task 2: The builder runs the chosen mode, and the reasons are real

**Files:**
- Modify: `epichat/sim/builder.py:34-61` (import `well_mixed`, `needs_agents` from `epichat.params.solver`; keep them in `__all__`),
  `epichat/sim/builder.py:186-197` (`build_sim`)
- Test: `tests/test_sim_builder.py`, `tests/test_solver_reasons_are_real.py`

**Interfaces:**
- Consumes: Task 1's `needs_agents`, `recommend_solver`.
- Produces: `runs_as_agents(p: SimParamsV2) -> bool` in `epichat/params/solver.py`:
  `needs_agents(p) or p.run.solver == "abm" or (p.run.solver is None and recommend_solver(p)["recommended"] == "abm")`.
  `build_sim` passes `solver="abm", n_agents=n, people=...` or `solver="ode", total_pop=n`.

- [ ] **Step 1: Write the failing tests**
  - In `tests/test_sim_builder.py`: `test_the_mode_follows_run_solver` parametrized: default + None → `sim.solver.name == "abm"`;
    default + "ode" → "ode"; default + "abm" → "abm"; age_structured + "abm" → "abm"; hybrid + "ode" → "abm" (each `build_sim(p).init()`).
  - `test_a_fit_runs_in_the_chosen_mode` (in `tests/test_sim_fit.py`): an attack-rate fit with `run.solver: "ode"` → the fitted run's
    `stats["solver"] == "ode"`.
  - In `tests/test_solver_reasons_are_real.py` (each runs both modes with `run.solver` set, 10,000 agents; infections per person =
    `results[name].infection.values.sum() / n_agents`):
    - `test_waning_differs`: SIRS, immunity 180, 3 years: ODE ≥ 2 × agents (probe: 2.68 against 0.89).
    - `test_temporary_measure_differs`: reduction 0.7 days 0–30: ODE > 0.5 and agents < 0.05 in at least 3 of 5 seeds (probe: 0.89; 0 in 5).
    - `test_births_differ`: R0 15, births 30, 5 years: ODE ≥ 1.2 × agents (seed 1).
    - `test_early_dieout_differs`: R0 1.2, 2 seeds: ODE > 0.2 and at least 2 of 10 agent seeds < 0.01.
    - `test_same_answer_agrees`: default: |ODE − agents| < 0.03 for seed 1 (probe: 0.892 against 0.887–0.900).

- [ ] **Step 2: Run them to verify they fail**
  Run: `.venv/Scripts/python -m pytest tests/test_sim_builder.py -k mode_follows tests/test_solver_reasons_are_real.py -q`
  Expected: the mode test FAILS (default runs "ode"); the reasons tests FAIL (setting `run.solver` has no effect yet).

- [ ] **Step 3: Implement** `runs_as_agents` and the `build_sim` change. If a reasons test still fails on its numbers, adjust that
  reason's threshold in Task 1's rule (and its rule test), never the margin, and note the change in the spec's "Left to the builder".

- [ ] **Step 4: Run them, then the Python suites**
  `.venv/Scripts/python -m pytest tests/ -q` and `.venv/Scripts/python -m pytest sim/tests -q` — Expected: PASS. Tests that assumed the
  default scenario runs as an ODE (grep `solver` and `"ode"` in `tests/` and `sim/tests/`) set `run.solver: "ode"` explicitly, so they
  keep testing what they meant to.

- [ ] **Step 5: Checkpoint** — run the three suites; report.

### Task 3: The rule in TypeScript, pinned by the parity fixture

**Files:**
- Create: `web/lib/sim/solver.ts`
- Modify: `web/lib/sim/params.ts:273-279` (RunSchema), `scripts/export_parity_fixtures.py:202-235,347-355`,
  `web/tests/sim/parity.test.ts`, `tests/test_web_exports.py` (only if it pins the version)
- Regenerate: `web/tests/fixtures/parity.json`, `web/data/param_registry.json`

**Interfaces:**
- Consumes: Task 1's rule and texts.
- Produces: `recommendSolver(p: SimParams): SolverAdvice`, `escapeRoot(r0: number): number`, `AGENT_CODES`, `REQUIRED_CODES`,
  `type SolverAdvice = { recommended: "abm" | "ode"; required: boolean; reasons: { code: string; text: string }[] }`;
  `RunSchema.solver: z.enum(["abm", "ode"]).nullable().default(null)`.

- [ ] **Step 1: Write the failing test.** In the exporter, bump `version` to 7, add `"solver": recommend_solver(p)` to every params case,
  and add `solver_cases()`: one params case per code of the rule table (the patches of Task 1's tests), stored under
  `payload["solver"]` as `{"input": ..., "advice": ...}`. Regenerate: `.venv/Scripts/python scripts/export_parity_fixtures.py`.
  In `parity.test.ts`: version 7; `it("recommend_solver agrees, codes and texts", ...)`: for every params case and every solver case,
  `expect(recommendSolver(must(c.input))).toEqual(c.solver ?? c.advice)`; and `expect(new Set(parity.solver.flatMap(c => c.advice.reasons.map(r => r.code))).size).toBe(10)`.
  Also `it("reads a saved scenario without run.solver as not chosen")`: a parity input with the `solver` key deleted from `run` parses
  with `run.solver === null`.
- [ ] **Step 2: Run to verify it fails:** `cd web && npx vitest run tests/sim/parity.test.ts` — FAIL (`recommendSolver` not exported).
- [ ] **Step 3: Implement** `web/lib/sim/solver.ts` and `RunSchema.solver`; use `approxR0` from `params.ts`, `simDays` (or the same
  `max(1, round(365 × years))`) and `pyRound` for the text.
- [ ] **Step 4: Run** `npx vitest run tests/sim/parity.test.ts` and `.venv/Scripts/python -m pytest tests/test_web_exports.py -q` — PASS.

### Task 4: configure_simulation reports the advice; run_simulation records the first run's mode

**Files:**
- Modify: `web/lib/tools/configureSimulation.ts:20-46` (input), `:107-140` (apply), `:384-390` (result);
  `web/lib/tools/runSimulation.ts:35-46`
- Test: `web/tests/tools/configureSimulation.test.ts`, `web/tests/tools/runSimulation.test.ts`

**Interfaces:**
- Consumes: Task 3's `recommendSolver`, `AGENT_CODES`.
- Produces: input field `solver: opt(z.enum(["abm", "ode"]))` (sets `run.solver`, `applied.solver`); result content gains
  `solver: { chosen: "abm" | "ode" | null, recommended, required, reasons, new_reasons: string[] }`, where `new_reasons` = the
  `AGENT_CODES` in the advice after the change and not in `recommendSolver(before)` (empty when there is no `before`).

- [ ] **Step 1: Write the failing tests**
  - `configureSimulation.test.ts`: `it("reports the run mode advice and sets the chosen mode")`: a first call → `solver.chosen === null`,
    `reasons[0].code === "same_answer"`, `new_reasons` `[]`; a call with `solver: "ode"` → `chosen === "ode"`, `params.run.solver === "ode"`;
    then a call setting `disease_type: "sirs"`, `dur_immune_days: 180`, `sim_dur_years: 3` → `new_reasons` equals `["waning"]`; a call
    that changes nothing relevant → `new_reasons` `[]`.
  - `runSimulation.test.ts`: `it("records the mode of the first run when none was chosen")`: params with `run.solver` null → the params
    sent to `deps.sim.simulate` and `deps.scenario.params.run.solver` are `"abm"`; with `"ode"` set → stays `"ode"`.
- [ ] **Step 2: Run to verify they fail:** `cd web && npx vitest run tests/tools/configureSimulation.test.ts tests/tools/runSimulation.test.ts`.
- [ ] **Step 3: Implement.** In `runSimulation`, before `simulate`: when `params.run.solver == null`, set
  `scenario.params = { ...params, run: { ...params.run, solver: recommendSolver(params).recommended } }` and use it for the run (a
  required scenario records "abm" too).
- [ ] **Step 4: Run them, then the web suite:** `npx vitest run` — PASS (update the `compare` expectations only where a first run now
  carries `run.solver`, and only to add that path).
- [ ] **Step 5: Checkpoint** — the three suites; report.

### Task 5: The prompt

**Files:**
- Modify: `epichat/agent.py:45-46` (the first sentence), `web/lib/chat/prompt.ts:25-26` (About EpiChat), `:52-56` (suggested replies,
  if the example list changes), `:104` (the solver paragraph)
- Regenerate: `web/data/system_prompt.json` (export script)
- Test: `web/tests/chat/prompt.test.ts`, the Python test that pins the agent prompt (grep `_SYSTEM` in `tests/`)

**Interfaces:**
- Consumes: Task 4's `solver` block and `solver` input field.

Content the prompt must carry (wording is the builder's within these rules):
- `agent.py`: "built on Starsim, which runs a scenario as simulated individual people (agents) or as a compartmental model".
- About EpiChat (line 25): no "agent-based"; EpiChat runs a scenario as simulated individuals or as a compartmental model and lets the
  user choose. Line 26 follows.
- Line 104 replaced by a paragraph that says: `configure_simulation` returns `solver` (chosen, recommended, required, reasons,
  new_reasons); before the first run of a scenario, when `chosen` is null and `required` is false, give the recommendation and its
  reasons and what the other mode trades away in two or three sentences for the participant's experience (never "ODE" for experience
  "none"), and offer "Run as agents (recommended)" and "Run as a compartmental model" as the suggested replies instead of "Run it"; when
  the user picks, call `configure_simulation` with `solver` and then `run_simulation` in the same turn; if they just say to run, run
  (the first run records the recommended mode) and say so in one sentence; when `required`, say once in one sentence why it runs as
  agents and do not ask; when `chosen` is "ode" and `new_reasons` is not empty: if the same message asks to run (every "Try next"
  lever ends "and rerun"), run as chosen, then say in one sentence that agents would now be recommended and why, and offer "Rerun as
  agents"; otherwise say why and offer the two replies again before running; on "run it as agents" (or compartmental), set `solver`
  and run; the general trade-off (agents: individual people, die-out by chance, replicates give bands, R0 formula approximate;
  compartmental: one smooth average curve, R0 formula exact, same result every time, never dies out, fractions of a person); keep
  `stats.solver` and `stats.r0_model` as they are.

- [ ] **Step 1: Write the failing test** in `prompt.test.ts`: `it("asks which mode to run, recommending agents, with the rule's reasons")`:
  contains `"Run as agents (recommended)"`, `"Run as a compartmental model"`, `"new_reasons"`, `"Rerun as agents"`, `"required"`,
  `"stats.solver"`; does not contain `"agent-based"`. Update line 18's phrases if they no longer appear (`"has no replicates"`,
  `"exact for an ODE run"`) to the new wording.
- [ ] **Step 2: Run to verify it fails:** `cd web && npx vitest run tests/chat/prompt.test.ts`.
- [ ] **Step 3: Implement** the prompt and `agent.py` changes; regenerate `system_prompt.json` with the export script.
- [ ] **Step 4: Run** `npx vitest run tests/chat/prompt.test.ts` and `.venv/Scripts/python -m pytest tests/ -q -k "prompt or agent or export"` — PASS.

### Task 6: Documentation and the review doc

**Files:**
- Modify: `epichat/params/registry.py:285-291` (`run.n_agents` mapping "ss.Sim(solver='abm', n_agents=...) or ss.Sim(solver='ode', total_pop=...)"; `run.n_replicates`: "An ODE run" → "A compartmental run"), `README.md:31,137`, `docs/docs.html:222,357,365`,
  `docs/starsim-v4-review-2026-11.md` (fixed table: a row for the run mode choice; the test line), `docs/superpowers/specs/2026-11-20-run-mode-choice-design.md` ("Left to the builder": the thresholds as built)
- Regenerate: `web/data/param_registry.json`

- [ ] **Step 1:** Edit the texts: README line 31 "Runs as agents or as a compartmental model, as the user chooses"; line 137 and
  docs.html 357/365: the choice, recommended agents, and the four cases that require agents; docs.html 222 "one compartmental run, or one
  to five replicates as agents".
- [ ] **Step 2:** Export, restore line-ending-only files, and run the three suites — PASS.
- [ ] **Step 3: Checkpoint** — report the suites and give the owner the `git add`/`commit`/`push` commands with full worktree paths.

---

## Self-review notes

- Spec coverage: the setting (T1, T3), the rule and reasons (T1), required runs as agents whatever is set (T2), `solver=` (T2), the
  reasons are real (T2), parity (T3), the configure block and `new_reasons` (T4), the first run records its mode (T4), prompt behaviour
  and wording (T5), docs and saved scenarios (T6; saved scenarios run as agents through T2's `runs_as_agents`).
- After the work, one fresh reviewer on the most capable model reviews the whole branch diff against the spec (Native execution).
