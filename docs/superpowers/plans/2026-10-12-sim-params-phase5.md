# Sim Parameters, Phase 5: Evals and Docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the two golden cases of the spec's section 1 as pending YAML the current harness lists but does not run, cover both flows with vitest against the web handler, give the parameter-list call a card payload, and bring the README and the runbook up to date with the registry, schema v2, the advanced patch, the diagnostics and their tuning.

**Architecture:** The golden runner (`evals/golden/run.py`) learns a `pending: <harness>` key: such a case loads, appears under "Pending" in the report, and is never run or scored (spec 17: the harness drives the frozen Python agent, which has neither `describe_parameters` nor diagnostics). The two cases live in `evals/golden/cases/parameters.yaml`. Their behaviour is pinned today by two scripted-model flows in the web handler's test file. `describe_parameters` returns a small `parameters` payload so its chat line and activity summary read like the other tools'. The README gets a section on the web agent's parameters, diagnostics and options and a note that its flat parameter table is the v1 shape; the runbook gets the diagnostics-tuning paragraph.

**Tech Stack:** Python 3.12 (PyYAML in `evals/requirements.txt`, pytest) for the runner; TypeScript (vitest) for the flows and the payload; Markdown for the docs. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-09-sim-parameters-disease-design.md`, section 1 (the two golden cases), section 12 phase 5, section 13 "Evals", and section 17's "Evals" ruling, which this plan follows: the existing cases keep their flat `config` checks; the two new cases are YAML with a `pending: api-harness` marker, covered by vitest tests of `describe_parameters` and of the diagnostic-to-rerun flow.

## Global Constraints

- Interpreters: root `.venv/Scripts/python.exe -m pytest …` (run from the repository root or the worktree root so the local package is imported); web `npx vitest run …`, `npm run typecheck`, `npm run lint` from `web/`.
- `npm --prefix web ci` only, never `npm install`; no new npm or Python dependencies.
- The golden runner's existing cases keep their flat `config` checks (spec 17); nothing in `cases/*.yaml` other than the new file changes. `baseline.json` is not edited: a pending case has no baseline entry.
- Every golden run costs money; the plan's tests exercise `load_cases`, `split_pending` and `write_report` on temporary directories and never call the agent or the judge.
- The README's existing v1 parameter tables stay as they are (the CLI and the Streamlit app still use that shape); the new section describes the web agent and points to the registry export, the spec and the runbook.
- The runbook is `web/docs/DEPLOY.md`; `web/tests/app/deploy.test.ts` pins its phrases, so every new phrase a test names must appear verbatim.
- Never print `SIM_SHARED_SECRET`, the Supabase secret, the Resend key or the UN API key.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UL6ToyEthpP1X8yxArZE6g`.

## Review Focus

1. **Selecting only a pending case.** `py -3.12 -m evals.golden.run --case parameters-describe` must say the case is pending and write a report with the Pending section, not stop with "no cases matched" and not try to run it. Test added to Task 1.
2. **A pending case marked critical.** It never counts as a failure, never appears under Regression even with a `true` baseline entry, and never changes the pass count. Test added to Task 1.
3. **The option taken through a core field.** The early fade-out lever's patch is a seed count; the model applies it through `configure_simulation`'s `seed_count` field rather than `advanced`, and the option must still be recorded and the rerun compared. Test added to Task 4.
4. **A parameter-list result stored before this phase.** A conversation replayed from before the `parameters` payload existed carries the tool result with the runner's stand-in payload (`kind: "tool_error"`, `ok: true`): the activity summary and the chat line must still render it without an error style. Test added to Task 3.
5. **The README contradicting the runbook.** Field names (`dur_inf_days`, `seed_count`, `advanced`), the migration number (`0007`) and the tool name must match what the code has. Test added to Task 5.

## File Structure

- Modify `evals/golden/run.py` — `split_pending`, the `main` filter, the report's Pending section.
- Modify `evals/README.md` — the `pending` key.
- Create `evals/golden/cases/parameters.yaml` — the two cases.
- Create `tests/test_golden_cases.py`; modify `tests/test_golden_run.py`.
- Modify `web/lib/tools/types.ts` (`ParametersPayload`), `web/lib/enums.ts` (`CARD_KINDS`), `web/lib/tools/describeParameters.ts` (the payload), `web/lib/client/activity.ts` (the summary branch).
- Modify `web/tests/tools/describeParameters.test.ts`, `web/tests/client/activity.test.ts`, `web/tests/client/toolLine.test.ts`, `web/tests/chat/handleChat.test.ts` (the golden flows).
- Modify `README.md`; create `tests/test_readme.py`.
- Modify `web/docs/DEPLOY.md`, `web/tests/app/deploy.test.ts`.

---

### Task 1: The golden runner lists pending cases and never runs them

**Files:**
- Modify: `evals/golden/run.py` (after `load_cases`; `write_report`; `main`)
- Modify: `evals/README.md` ("Adding a case")
- Test: `tests/test_golden_run.py`

**Interfaces:**
- Consumes: `load_cases(directory) -> list[dict]` (keeps every YAML key, so `pending` and `pending_note` travel with the case).
- Produces: `split_pending(cases: list[dict]) -> tuple[list[dict], list[dict]]` (runnable, pending); `write_report(out_dir, scored, baseline, usage, declined=None, pending=None)` with a "## Pending" section; `main` prints `[pending] <id> (<reason>)` per pending case and runs only the runnable ones. Task 2's test imports `split_pending`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_golden_run.py` (and extend its import line to `from evals.golden.run import load_cases, score_case, split_pending, write_report`):

```python
def test_a_pending_case_loads_with_its_marker_and_is_left_out_of_the_run(tmp_path):
    (tmp_path / "a.yaml").write_text(
        "- id: a\n  category: x\n  turns: ['hi']\n  checks: {}\n"
        "- id: p\n  category: parameters\n  critical: true\n  pending: api-harness\n"
        "  pending_note: needs the web agent\n  turns: ['hi']\n  checks: {}\n",
        encoding="utf-8")
    cases = load_cases(tmp_path)
    assert [c["id"] for c in cases] == ["a", "p"] and cases[1]["pending"] == "api-harness"
    runnable, pending = split_pending(cases)
    assert [c["id"] for c in runnable] == ["a"] and [c["id"] for c in pending] == ["p"]
    # Selecting only a pending case (--case) runs nothing and is not "no cases matched".
    assert split_pending([cases[1]]) == ([], [cases[1]])


def test_report_lists_pending_cases_without_scoring_them(tmp_path):
    scored = [{"id": "a", "category": "x", "critical": False, "passed": True, "pass_rate": 1.0, "failures": []}]
    pending = [{"id": "p", "category": "parameters", "critical": True, "pending": "api-harness", "pending_note": "needs the web agent"}]
    text = write_report(tmp_path, scored, baseline={"p": True}, usage={}, pending=pending).read_text(encoding="utf-8")
    assert "## Pending" in text and "**p** (api-harness) — needs the web agent" in text
    assert "Regression" not in text and "1/1 cases passing" in text
    bare = write_report(tmp_path, scored, baseline={}, usage={}, pending=[{"id": "q", "pending": "api-harness"}]).read_text(encoding="utf-8")
    assert "**q** (api-harness)\n" in bare
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_golden_run.py -q -p no:cacheprovider`
Expected: `ImportError: cannot import name 'split_pending'`.

- [ ] **Step 3: The runner**

In `evals/golden/run.py`, add after `load_cases`:

```python
def split_pending(cases: list[dict]) -> tuple[list[dict], list[dict]]:
    """Cases marked `pending: <harness>` are written for a harness this runner is not
    (spec 2026-10-09, section 17): loaded and listed in the report, never run or scored."""
    runnable = [c for c in cases if not c.get("pending")]
    pending = [c for c in cases if c.get("pending")]
    return runnable, pending
```

Change `write_report`'s signature to `def write_report(out_dir: Path, scored: list[dict], baseline: dict, usage: dict, declined: dict | None = None, pending: list[dict] | None = None) -> Path:` and add, after the "By category" table:

```python
    if pending:
        lines += ["", "## Pending", "",
                  "Written for a harness this runner is not (the `pending` key names it); "
                  "loaded and listed, not run and not scored:", ""]
        for case in pending:
            note = case.get("pending_note")
            lines.append(f"- **{case['id']}** ({case['pending']})" + (f" — {note}" if note else ""))
```

In `main`, replace

```python
    if not cases:
        raise SystemExit("no cases matched")
```

with

```python
    cases, pending = split_pending(cases)
    for case in pending:
        print(f"[pending] {case['id']} ({case['pending']})", flush=True)
    if not cases and not pending:
        raise SystemExit("no cases matched")
```

and pass the list to the report: `report = write_report(out_dir, scored, baseline, usage, declined_by_case, pending)`.

- [ ] **Step 4: Run the runner tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_golden_run.py -q -p no:cacheprovider`
Expected: all pass.

- [ ] **Step 5: Document the key**

In `evals/README.md`, after the paragraph that begins `Set \`critical: true\` when every repeat must pass.`, add:

```
A case written for a harness this runner is not — today the two
sim-parameters cases in `cases/parameters.yaml`, which need the deployed web
agent's `describe_parameters` and its run diagnostics (sub-project 5) —
carries `pending: <harness>` and a `pending_note`. The runner loads it, lists
it under "Pending" in the report, and never runs or scores it; it has no
`baseline.json` entry. Remove the key when the named harness exists.
```

- [ ] **Step 6: Commit**

```bash
git add evals/golden/run.py evals/README.md tests/test_golden_run.py
git commit -m "feat(evals): the golden runner lists pending cases and never runs them"
```

---

### Task 2: The two golden cases of section 1, pending the API harness

**Files:**
- Create: `evals/golden/cases/parameters.yaml`
- Create: `tests/test_golden_cases.py`

**Interfaces:**
- Consumes: `load_cases`, `split_pending`, `CASES_DIR`, `BASELINE` (`evals/golden/run.py`); the check names `tool_called`, `config`, `ran_simulation`, `judge` (`evals/golden/checks.py`).
- Produces: the case ids `parameters-describe` and `parameters-diagnostic-rerun`, category `parameters`, both `pending: api-harness`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_golden_cases.py`:

```python
"""The committed golden cases: the two sim-parameters cases are pending until the API harness exists (spec 17)."""
import json

from evals.golden.run import BASELINE, CASES_DIR, load_cases, split_pending


def test_the_parameter_cases_are_pending_for_the_api_harness():
    cases = load_cases(CASES_DIR)
    by_id = {c["id"]: c for c in cases}
    describe, rerun = by_id["parameters-describe"], by_id["parameters-diagnostic-rerun"]
    for case in (describe, rerun):
        assert case["pending"] == "api-harness" and case["pending_note"] and case["category"] == "parameters"
        assert case["turns"] and case["checks"]["judge"]
    assert "describe_parameters" in describe["checks"]["tool_called"]
    assert describe["checks"]["config"] == {"disease": "measles", "country": "KEN"}
    assert rerun["real_sim"] is True and rerun["checks"]["ran_simulation"] is True
    runnable, pending = split_pending(cases)
    assert {c["id"] for c in pending} == {"parameters-describe", "parameters-diagnostic-rerun"}
    assert len(runnable) == len(cases) - 2
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    assert "parameters-describe" not in baseline and "parameters-diagnostic-rerun" not in baseline
```

- [ ] **Step 2: Run it and watch it fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_golden_cases.py -q -p no:cacheprovider`
Expected: `KeyError: 'parameters-describe'`.

- [ ] **Step 3: Write the cases**

Create `evals/golden/cases/parameters.yaml`:

```yaml
# The two cases of the sim-parameters spec (2026-10-09, section 1), written
# for the harness that will drive the deployed web agent (sub-project 5).
# The Python agent this harness drives has neither describe_parameters nor
# run diagnostics, so both are pending (section 17): loaded, listed in the
# report, never run. Until then web/tests/chat/handleChat.test.ts ("golden
# flows") plays both scripts against the web handler with a scripted model.
- id: parameters-describe
  category: parameters
  critical: false
  pending: api-harness
  pending_note: "describe_parameters is a web tool (spec 9.2); the Python agent has none."
  turns:
    - "Model measles in Kenya."
    - "What can I change?"
  checks:
    tool_called: [configure_simulation, describe_parameters]
    config:
      disease: measles
      country: KEN
    judge:
      - "Lists disease parameters of the active model with their current values"
      - "Says where at least one value came from: the database, a default, a fetch, or the user"
      - "Does not say that any listed parameter cannot be changed"

- id: parameters-diagnostic-rerun
  category: parameters
  critical: false
  real_sim: true
  pending: api-harness
  pending_note: "The diagnostics and the comparison come from the simulation service (spec 10, 11), which the Python agent does not call."
  turns:
    - "Model measles in Kenya with 20000 agents, one initial infection, R0 1.2 and no deaths."
    - "Yes."
    - "Yes, run it."
    - "Take the first option and rerun."
  checks:
    tool_called: [run_simulation]
    ran_simulation: true
    judge:
      - "After the first run, says the outbreak died out early (or names the diagnostic) rather than interpreting a non-epidemic as a result"
      - "Offers at most three options, one of them keeping the configuration as it is"
      - "After the second run, reports what changed against the previous run before interpreting it"
```

- [ ] **Step 4: Run the golden tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_golden_cases.py tests/test_golden_run.py tests/test_golden_harness.py -q -p no:cacheprovider`
Expected: all pass (the harness tests build an agent with a patched client and never call the network).

- [ ] **Step 5: Commit**

```bash
git add evals/golden/cases/parameters.yaml tests/test_golden_cases.py
git commit -m "feat(evals): the two sim-parameters golden cases, pending the API harness"
```

---

### Task 3: `describe_parameters` answers a `parameters` card payload

**Files:**
- Modify: `web/lib/tools/types.ts` (a `ParametersPayload` in the `CardPayload` union)
- Modify: `web/lib/enums.ts:110` (`CARD_KINDS`)
- Modify: `web/lib/tools/describeParameters.ts` (return the payload)
- Modify: `web/lib/client/activity.ts:46` (the summary branch)
- Test: `web/tests/tools/describeParameters.test.ts`, `web/tests/client/activity.test.ts`, `web/tests/client/toolLine.test.ts`

**Interfaces:**
- Produces: `type ParametersPayload = { kind: "parameters"; model: string; disease: string | null; count: number }`; `CARD_KINDS` gains `"parameters"` (so `card_expanded` accepts it); `describeParameters` returns `{ content, payload }`; `summarizeActivity` says `Listed N parameters`.

- [ ] **Step 1: Write the failing tests**

Append to the describe block in `web/tests/tools/describeParameters.test.ts`:

```ts
  it("carries a small parameters payload for the card and the activity line", async () => {
    const deps = makeDeps();
    await configure(deps, { disease: "measles", model: "seir", dur_exp_days: 11 });
    const out = await describeParameters({} as never, deps);
    const body = JSON.parse(out.content) as Body;
    expect(out.payload).toEqual({ kind: "parameters", model: "seir", disease: "measles", count: body.parameters.length });
    expect((await describeParameters({ tier: "expert" } as never, makeDeps())).payload).toMatchObject({ kind: "parameters", model: "sir", disease: null, count: 4 });
  });
```

In `web/tests/client/activity.test.ts`, inside `describe("summarizeActivity")`, add:

```ts
  it("names a parameter list by its count, and a stored result without the payload by its label", () => {
    expect(summarizeActivity([tool("describe_parameters", { kind: "parameters", model: "seir", disease: "measles", count: 31 })])).toBe("Listed 31 parameters");
    expect(summarizeActivity([tool("describe_parameters", { kind: "tool_error", message: "{}" })])).toBe("Parameter list");
  });
```

(`tool(name, payload)` is the file's existing helper that builds an ok tool_result block; if its payload type is narrower than `CardPayload`, widen it to `CardPayload`.) In `web/tests/client/toolLine.test.ts`, inside the first describe, add:

```ts
  it("reads the parameters payload like the other cards", () => {
    expect(toolLine("describe_parameters", { kind: "parameters", model: "seir", disease: "measles", count: 31 }, true)).toEqual({ label: "📋 Parameter list", detail: "model: seir; disease: measles; count: 31", warn: false });
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run (from `web/`): `npx vitest run tests/tools/describeParameters.test.ts tests/client/activity.test.ts tests/client/toolLine.test.ts`
Expected: the payload is `undefined`; the activity summary says `Parameter list` for both; the typecheck would reject the `parameters` kind.

- [ ] **Step 3: The payload**

In `web/lib/tools/types.ts`, after `MemoryPayload`:

```ts
/** A describe_parameters call (sim-parameters spec 9.2): the list itself is the tool's content for the model. */
export type ParametersPayload = { kind: "parameters"; model: string; disease: string | null; count: number };
```

and add `| ParametersPayload` to the `CardPayload` union. In `web/lib/enums.ts`, add `"parameters"` to `CARD_KINDS` after `"memory"`. In `web/lib/tools/describeParameters.ts`, change the return to:

```ts
  return {
    content: JSON.stringify({ note, model, disease, interventions, parameters }),
    payload: { kind: "parameters", model, disease, count: parameters.length },
  };
```

In `web/lib/client/activity.ts`, before the final `else pieces.push({ text: plainLabel(block.name) });`, add:

```ts
      else if (block.name === "describe_parameters" && payload.kind === "parameters") pieces.push({ text: `Listed ${payload.count} parameters` });
```

- [ ] **Step 4: Run the tests, the typecheck and the lint**

Run (from `web/`): `npx vitest run tests/tools tests/client tests/chat && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/lib/tools/types.ts web/lib/enums.ts web/lib/tools/describeParameters.ts web/lib/client/activity.ts web/tests/tools/describeParameters.test.ts web/tests/client/activity.test.ts web/tests/client/toolLine.test.ts
git commit -m "feat(web): describe_parameters carries a parameters card payload"
```

---

### Task 4: The two golden flows against the web handler

**Files:**
- Modify: `web/tests/chat/handleChat.test.ts` (a new top-level describe after the main one; two imports)

**Interfaces:**
- Consumes: the file's `setup`, `configured`, `message`, `textBlock`, `toolUse`, `RUN`, `SUCCESS`, `STATS`, `HISTORY`, `CONVERSATION`, `params`; `scenarioFromRow` (`@/lib/db/scenarios`); `PreviousRun`; `RunPayload` (`@/lib/tools/types`).
- Produces: two tests named after the YAML case ids, pinning what the pending cases will check once the API harness exists.

- [ ] **Step 1: Write the flows and watch them pass or fail for the right reason**

Extend the imports: `import { scenarioFromRow } from "@/lib/db/scenarios";` (beside the existing `ScenarioStore` type import) and `import { emptyScenario, type RunPayload, type Scenario } from "@/lib/tools/types";`. Append at the end of the file:

```ts
describe("golden flows: the sim-parameters cases of spec section 1 (evals/golden/cases/parameters.yaml, pending the API harness)", () => {
  it("parameters-describe: 'What can I change?' lists the active model's parameters with their values and sources", async () => {
    const scenario: Scenario = { ...configured(), params: params({ disease_type: "seir", dur_exp: 11, dur_inf: 8, beta: 253.1 }) };
    const { run, emitted, requests, finished } = setup(
      [{ message: message([toolUse("tu_d", "describe_parameters", {})], "tool_use") }, { message: message([textBlock("You can change…")]), text: ["You can change…"] }],
      { history: HISTORY, scenario },
    );
    await run({ conversationId: CONVERSATION, text: "What can I change?" });
    expect(emitted.map((e) => e.type)).toEqual(["tool_use", "tool_result", "text", "done"]);
    expect(emitted[1]).toMatchObject({ type: "tool_result", ok: true, payload: { kind: "parameters", model: "seir", disease: "measles" } });
    const toolResult = (requests[1].messages as { content: { content: string }[] }[]).at(-1)!.content[0];
    const listed = JSON.parse(toolResult.content) as { model: string; parameters: { path: string; current: unknown; source: string }[] };
    const byPath = Object.fromEntries(listed.parameters.map((p) => [p.path, p]));
    expect(byPath["disease.dur_inf.mean_days"]).toMatchObject({ current: 8, source: "database" });
    expect(byPath["disease.dur_exp.mean_days"]).toMatchObject({ current: 11, source: "user" });
    expect(byPath["run.n_agents"]).toMatchObject({ current: 10000, source: "default" });
    expect(byPath["disease.p_asymp"]).toBeUndefined(); // not a seir parameter
    expect(finished[0].step_events.map((e) => [e.kind, e.tool])).toContainEqual(["tool_called", "describe_parameters"]);
    expect(finished[0].scenario).toMatchObject({ stage: "configure" });
  });

  it("parameters-diagnostic-rerun: an early fade-out returns a diagnostic, the chosen option is recorded, and the rerun compares with the previous run", async () => {
    const seeds = { patch: { "disease.seed.mode": "count", "disease.seed.value": 50 }, current: { "disease.seed.mode": "fraction", "disease.seed.value": 0.01 }, direction: "increase" as const, rationale: "More seeds make an early fade-out less likely: 50 instead of 10.", basis: "rule" as const };
    const replicates = { patch: { "run.n_replicates": 5 }, current: { "run.n_replicates": 1 }, direction: "increase" as const, rationale: "Several replicates show how often the outbreak takes off at all.", basis: "rule" as const };
    const diagnostics = [{ id: "early_fadeout", severity: "warning" as const, title: "The outbreak died out early", evidence: { r_eff: 1.2, seeds: 10, total_infected: 15, last_infectious: 0 }, levers: [seeds, replicates] }];
    const fadedStats = { ...STATS, total_infected: 15, peak_infections: 10, peak_day: 0 };
    const faded: SimResult = { ...SUCCESS, stats: fadedStats, stats_agents: fadedStats, diagnostics };

    // Turn 1: the run comes back with the diagnostic.
    const first = setup([{ message: RUN }, { message: message([textBlock("It died out early. Options: …")]), text: ["It died out early. Options: …"] }], { history: HISTORY, scenario: configured(), simulate: faded });
    await first.run({ conversationId: CONVERSATION, text: "Yes, run it." });
    expect(first.emitted[2]).toMatchObject({ type: "tool_result", payload: { kind: "run", diagnostics, compare: null } });
    expect(first.finished[0].step_events.find((e) => e.kind === "diagnostic_shown")).toMatchObject({ meta: { run_id: "run-1", ids: "early_fadeout" } });
    const previous: PreviousRun = { id: "run-1", effectiveParams: params({ n_agents: 10000 }), stats: fadedStats, statsAgents: fadedStats, popScale: 1, diagnostics };

    // Turn 2: the user takes the first option; the model applies the lever's patch through the seed field, not through advanced.
    const after1 = scenarioFromRow(first.finished[0].scenario);
    const second = setup([{ message: message([toolUse("tu_c", "configure_simulation", { seed_count: 50 })], "tool_use") }, { message: message([textBlock("Set to 50 seeds.")]) }], { history: HISTORY, scenario: after1, previous });
    await second.run({ conversationId: CONVERSATION, text: "Take the first option and rerun." });
    expect(second.finished[0].step_events.find((e) => e.kind === "option_chosen")).toMatchObject({ meta: { run_id: "run-1", diagnostic_id: "early_fadeout", patch: JSON.stringify(seeds.patch) } });
    expect(second.finished[0].scenario).toMatchObject({ params: { disease: { seed: { mode: "count", value: 50 } } } });

    // Turn 3: the rerun compares with the previous run.
    const after2 = scenarioFromRow(second.finished[0].scenario);
    const rerun: SimResult = { ...SUCCESS, effective_params: params({ schema_version: 2, disease: { seed: { mode: "count", value: 50 } } }) };
    const third = setup([{ message: RUN }, { message: message([textBlock("Compared with the previous run…")]) }], { history: HISTORY, scenario: after2, previous, simulate: rerun });
    await third.run({ conversationId: CONVERSATION, text: "Run it" });
    const payload = (third.emitted[2] as { payload: RunPayload }).payload;
    expect(payload.compare).toMatchObject({ previous_run_id: "run-1", pop_scale: { from: 1, to: 1 } });
    expect(payload.compare?.changed).toEqual(expect.arrayContaining([{ path: "disease.seed.mode", from: "fraction", to: "count" }, { path: "disease.seed.value", from: 0.01, to: 50 }]));
    expect(payload.compare?.stats_delta.total_infected).toBe(STATS.total_infected - 15);
  });
});
```

Run (from `web/`): `npx vitest run tests/chat/handleChat.test.ts`
Expected: both pass. These flows pin behaviour that Tasks 3 to 8 of the phase 3–4 plan built; they are regression tests, so a first-run pass is the expected outcome. If either fails, the failure is a finding about the phase 3–4 code, not about the test: read the assertion before touching anything, and ledger the ruling.

- [ ] **Step 2: Commit**

```bash
git add web/tests/chat/handleChat.test.ts
git commit -m "test(web): the two sim-parameters golden flows against the handler"
```

---

### Task 5: README — the web agent's parameters, diagnostics and options

**Files:**
- Modify: `README.md` (a new section before `## Input Types`; a note at the top of `## Parameters Reference`; the project tree)
- Create: `tests/test_readme.py`

**Interfaces:**
- Produces: the README section `## Web agent: parameters, diagnostics and options (2026)` and the test that pins its names against the code's.

- [ ] **Step 1: Write the failing test**

Create `tests/test_readme.py`:

```python
"""The README's web-agent section names what the code has (sim-parameters spec, phase 5)."""
from pathlib import Path

README = (Path(__file__).resolve().parent.parent / "README.md").read_text(encoding="utf-8")


def test_the_readme_describes_the_web_agents_parameters_and_diagnostics():
    assert "## Web agent: parameters, diagnostics and options (2026)" in README
    for phrase in ("epichat/params/registry.py", "web/data/param_registry.json", "schema v2", "describe_parameters", "advanced",
                   "dur_inf_days", "seed_count", "epichat/sim/diagnostics.py", "early_fadeout", "cfr_out_of_range",
                   "diagnostic_shown", "option_chosen", "0007_run_diagnostics.sql", "web/docs/DEPLOY.md",
                   "docs/superpowers/specs/2026-10-09-sim-parameters-disease-design.md"):
        assert phrase in README, phrase
    assert README.index("## Web agent: parameters") < README.index("## Input Types")
    assert "the v1 flat shape" in README.split("## Parameters Reference")[1]
```

- [ ] **Step 2: Run it and watch it fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_readme.py -q -p no:cacheprovider`
Expected: FAIL on the heading.

- [ ] **Step 3: Write the section**

In `README.md`, insert before `## Input Types`:

```markdown
## Web agent: parameters, diagnostics and options (2026)

The web app (`web/`, Next.js on Vercel) and its simulation service (`sim/`,
FastAPI running Starsim 3.7 through `epichat/sim/`) replace the templates
above for the usability study. Their parameters are the sim-parameters
design, `docs/superpowers/specs/2026-10-09-sim-parameters-disease-design.md`;
the runbook is `web/docs/DEPLOY.md`.

- **One registry.** Every parameter is described once in
  `epichat/params/registry.py` (path, label, unit, bounds, default, the
  models it applies to, the database field it comes from). The pydantic
  schema v2 (`epichat/params/schema_v2.py`) and the zod schema
  (`web/lib/sim/params.ts`) take their bounds and defaults from it, and
  `scripts/export_web_data.py` writes it to `web/data/param_registry.json`.
- **Schema v2** nests the parameters by module: `disease` (model, beta,
  durations as mean, distribution and sd, case fatality ratio, seeding,
  initial immunity), `network`, `demographics`, `interventions`, `run`
  (agents, years, replicates, seed). Stored v1 rows migrate on read.
- **The agent's tools.** `configure_simulation` takes the common fields
  (`model`, `r0`, `dur_inf_days`, `dur_exp_days`, `dur_immune_days`,
  `p_death`, `seed_fraction` or `seed_count`, the interventions) and an
  `advanced` patch keyed by registry path for everything else, applied
  together and validated once; a failure names the path. `describe_parameters`
  lists the registry for the current model with each value's source: the
  user, the database, a fetch, a default, or an illustrative assumption.
- **Diagnostics.** After every run the service runs `epichat/sim/diagnostics.py`
  on the full series: `early_fadeout`, `instant_peak`, `unfinished`,
  `final_size_gap`, `sharp_curve`, `cfr_out_of_range`,
  `fatality_on_all_infections`, `no_reinfection`, `high_variance`. Each
  carries levers (a patch of paths with suggested values, clamped to the
  registry and the literature range). The agent offers at most three as
  suggested replies, applies the chosen one, reruns, and reports what changed
  against the previous run.
- **Recording.** Runs keep their diagnostics (`runs.diagnostics`, migration
  `web/supabase/migrations/0007_run_diagnostics.sql`); the step events
  `diagnostic_shown` and `option_chosen` say which fired and which were taken,
  so the thresholds (named constants at the top of the diagnostics module)
  can be tuned from the pilot.

The CLI, the Streamlit app and the templates below still use the v1 flat
parameters; the web app accepts both shapes and writes v2.

---
```

At the top of `## Parameters Reference`, right after the heading, add:

```markdown
The tables below are the v1 flat shape, as the CLI and the Streamlit app read
it and as `/simulate` still accepts it. The web agent's parameters are schema
v2, generated from the registry (`web/data/param_registry.json` lists every
path with its label, unit, bounds and default); see the web-agent section
above.
```

In `## Project Structure`, add these lines to the tree in the right places (after `schema.py`, after `data/`, and at the top level after `tests/`):

```
│   ├── params/              # Registry, schema v2, migration, exact R0 (web agent)
│   ├── sim/                 # Starsim 3.7 models, builder, outputs, diagnostics (web agent)
```

```
├── sim/                     # The simulation service (FastAPI) the web app calls
├── web/                     # The web app (Next.js); web/docs/DEPLOY.md is its runbook
├── evals/golden/            # The golden set; cases/parameters.yaml is pending the API harness
```

- [ ] **Step 4: Run the test**

Run: `.venv/Scripts/python.exe -m pytest tests/test_readme.py -q -p no:cacheprovider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md tests/test_readme.py
git commit -m "docs: the README describes the web agent's registry, schema v2, tools, diagnostics and recording"
```

---

### Task 6: Runbook — tuning the diagnostics from the recorded events

**Files:**
- Modify: `web/docs/DEPLOY.md` (section 7, after the **Parameters** paragraph; section 6 "Routine work")
- Test: `web/tests/app/deploy.test.ts`

- [ ] **Step 1: Write the failing pins**

In `web/tests/app/deploy.test.ts`, beside the `0007_run_diagnostics.sql` pin, add:

```ts
    expect(doc).toContain("**Diagnostics.**");
    expect(doc).toContain("epichat/sim/diagnostics.py");
    expect(doc).toContain("jsonb_array_elements_text");
```

- [ ] **Step 2: Run it and watch it fail**

Run (from `web/`): `npx vitest run tests/app/deploy.test.ts`
Expected: FAIL on `**Diagnostics.**`.

- [ ] **Step 3: Write the paragraph and the routine line**

In `web/docs/DEPLOY.md` section 7, after the **Parameters** paragraph, add:

```
**Diagnostics.** The rules and their thresholds are the named constants at
the top of `epichat/sim/diagnostics.py` (spec section 10; the values are
starting points). They run on the child's full series in agent units, so the
evidence they report is in agents, not people. Tune them from what the pilot
recorded:

    -- how often each rule fired
    select id, count(*) from step_events, jsonb_array_elements_text(
      to_jsonb(string_to_array(meta->>'ids', ','))) as id
    where kind = 'diagnostic_shown' group by id order by 2 desc;
    -- how often each rule's option was taken
    select meta->>'diagnostic_id' as id, count(*) from step_events
    where kind = 'option_chosen' group by 1 order by 2 desc;

A rule that fires on most runs and is rarely taken is too eager; one that
never fires is too strict or its trigger regime is narrow (`instant_peak`
needs the peak within three days). Change the constant, add the case to
`tests/test_sim_diagnostics.py`, and note the change in the spec's section 19.
```

In section 6 ("Routine work"), add a bullet (at the end of its list):

```
- After the pilot's first weeks, run the two diagnostics queries of section 7
  and tune the thresholds.
```

- [ ] **Step 4: Run the deploy test**

Run (from `web/`): `npx vitest run tests/app/deploy.test.ts`
Expected: PASS.

- [ ] **Step 5: Run everything once more**

Run (from `web/`): `npx vitest run && npm run typecheck && npm run lint`; then from the root `.venv/Scripts/python.exe -m pytest tests/test_golden_run.py tests/test_golden_cases.py tests/test_golden_harness.py tests/test_readme.py tests/test_web_exports.py -q -p no:cacheprovider`.
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add web/docs/DEPLOY.md web/tests/app/deploy.test.ts
git commit -m "docs(runbook): tuning the diagnostics from the recorded events"
```

---

## Self-review

**Spec coverage.** Section 12 phase 5: golden cases (Task 2, pending per section 17 rather than migrated), the two section 1 cases (Task 2) covered by vitest (Task 4, plus the describe tests that already exist), README (Task 5), runbook (Task 6). Section 17's "Evals" ruling: the existing cases are untouched, the new ones carry `pending: api-harness`, and the runner understands the marker (Task 1). Task 3 is the one piece outside the letter of phase 5: the parameter-list card looked like a payload-less tool result in the chat line and the activity summary, which the 6i walkthrough's first step shows the owner; it is small, tested, and belongs with the flows that pin it.

**Placeholders.** None.

**Type consistency.** `split_pending` is defined in Task 1 and imported by Task 2's test; `ParametersPayload` (Task 3) is what Task 4's first flow asserts on the tool result; `PreviousRun`'s `statsAgents`/`popScale` (phase 3–4) are what Task 4's fixtures carry; the README names (Task 5) are the field names of `web/lib/tools/configureSimulation.ts` and the rule ids of `epichat/sim/diagnostics.py`.

**Review Focus.** 1 and 2 → Task 1's tests. 3 → Task 4's second flow (`seed_count`). 4 → Task 3's activity test with a `tool_error` payload. 5 → Task 5's test.

## After the merge (owner)

- No migration. Push `main`.
- The golden set is unchanged for the Python agent; `py -3.12 -m evals.golden.run` now prints the two pending cases and lists them in the report.
