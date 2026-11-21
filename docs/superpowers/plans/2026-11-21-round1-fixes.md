# Round-1 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct every count EpiChat shows for the population being simulated, let a user set an area smaller than a country, and stop offers the tool cannot keep.

**Architecture:**
- **People in the web app.** The scenario's parameters hold three counts in people: the seed count, a treatment's capacity and a peak-size fit target. One module (`web/lib/sim/units.ts`) converts them to agents at the simulation boundary and converts the service's results back.
- **Scaling.** The scenario gains an optional `area`, and one function picks the population that every count is scaled to.
- **Simulation service.** It adds delivered totals (doses, treatments) and two more uncertainty bands.
- **Web app, everything else.** It stores and draws the bands, lets reports pick runs by the panel's numbers, uses a one-hour prompt cache, and gets new prompt rules.

**Tech Stack:** Next.js 16 / TypeScript / zod / vitest (`web/`); Python 3.12 / FastAPI / Starsim 4.0.0rc5 / pytest (`sim/`, `epichat/sim/`); Supabase Postgres (`web/supabase/migrations`).

**Spec:** `docs/superpowers/specs/2026-11-21-round1-fixes-design.md`

## Global Constraints

- Work in the worktree `C:\Users\Yuke\stat\other-projects\EpiChat\epichat\.claude\worktrees\round1-fixes` (branch `round1-fixes`). main is protected: push the branch and open a PR; the owner merges.
- Starsim v4 defaults and meanings; `starsim==4.0.0rc5`.
- No migration of saved scenarios or runs. Existing rows stay valid. A stored agent count in an old scenario is read as people (owner's decision 2: earlier conversations were testing).
- Migration `0008_area.sql` must be applied in the Supabase SQL editor before this branch is deployed (the scenarios read selects the new column). Say so in the PR.
- The repository is public. No participant quotes or identifying details in code, tests, fixtures or commit messages.
- Python tests: `C:/Users/Yuke/stat/other-projects/EpiChat/epichat/.venv/Scripts/python.exe -m pytest <path> -q`, run from the worktree root. The full suite adds `--ignore=tests/test_r0_calibration.py`. Run one heavy suite at a time.
- Web tests: `npm test -- <path>` from `web/`, plus `npm run typecheck` and `npm run lint` before each commit that touches TypeScript.
- Registry text lives in `epichat/params/registry.py`. After editing it, run `.venv/Scripts/python.exe scripts/export_web_data.py` and commit the regenerated `web/data/param_registry.json`.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_016eXYLxC75PS9hTJQ9tQPjd`
- User-facing words: "people", "agents" (simulated people), "a new scenario". No jargon in tool results the assistant will quote.

## Review Focus

1. **A population fetched after an area is set.** `fetch_demographics` after `configure_simulation({area})` must leave the area, the scaling and `n_agents` alone (Task 6 test `fetch keeps an area`).
2. **An area set before the first run.** No run yet means there is nothing to separate: set the area without starting a new scenario (Task 6 test `area before any run stays in the scenario`). After a run, start a carried-over scenario.
3. **Very small areas.** An area of 3,000 people with the default 10,000 agents lowers `n_agents` to 3,000. A later `n_agents: 20000` is lowered the same way, not refused (Task 6 test `n_agents never exceeds the area`).
4. **A seed or capacity below one agent.** 20 people at 5,000 people per agent becomes one agent, about 5,000 people. The tool result must say so rather than silently seed 5,000 (Task 4 test `smallest seed note`).
5. **Old runs and old scenarios without `area`, `index` or band keys.** Reports, the panel and comparisons must not crash on rows written before this branch (Task 9 test `series without band keys draws no band`, Task 10 test `rows without a stored index still get panel numbers`).

---

### Task 0: Environment

**Files:** none committed.

- [ ] **Step 1: Upgrade the root Python environment to the pinned Starsim**

Run: `C:/Users/Yuke/stat/other-projects/EpiChat/epichat/.venv/Scripts/python.exe -m pip install -r requirements.txt` from the worktree root.
Expected: `python -c "import starsim; print(starsim.__version__)"` prints `4.0.0rc5`.

- [ ] **Step 2: Link the web packages**

Run (PowerShell, from the worktree): `New-Item -ItemType Junction -Path web\node_modules -Target C:\Users\Yuke\stat\other-projects\EpiChat\epichat\web\node_modules`. If main's `web/node_modules` lacks packages from `web/package.json`, run `npm ci` in the main checkout's `web/` first.

- [ ] **Step 3: Baseline**

Run: pytest full suite, `npm test`, `npm run typecheck` in `web/`.
Expected: all green on the merged main (about 711 Python passed with 42 skipped, 751 web). Record the counts in the PR description.

---

### Task 1: Units and the scaling population

**Files:**
- Create: `web/lib/sim/units.ts`
- Modify: `web/lib/tools/types.ts` (add `Area`, `Scenario.area`, `emptyScenario`)
- Test: `web/tests/sim/units.test.ts`

**Interfaces:**
- Produces, in `web/lib/tools/types.ts`:
  - `type AreaSource = { kind: "user" } | { kind: "web"; title: string; url: string }`
  - `type Area = { name: string; population: number; countryIso3: string | null; source: AreaSource }`
  - `Scenario.area: Area | null` (`emptyScenario` sets `null`)
- Produces, in `web/lib/sim/units.ts`:
  - `scalingPopulation(s: Pick<Scenario, "area" | "totalPopulation">): number | null`: `area.population`, else `totalPopulation`, else null.
  - `popScaleFor(population: number | null, nAgents: number): number`: `population / nAgents` when both are positive, else 1.
  - `seedAgents(people: number, popScale: number, nAgents: number): number`: `min(nAgents, max(1, round(people / popScale)))`.
  - `capacityAgents(peoplePerDay: number, popScale: number): number`: `max(1, round(peoplePerDay / popScale))`.
  - `toAgentUnits(p: SimParams, popScale: number): SimParams`: converts the seed when `mode === "count"`, every treatment's non-null `capacity`, and `run.fit.value` when `run.fit.target === "peak_infections"` (same rounding as `seedAgents`). Leaves every other field unchanged and returns a new object.
  - `toPeopleUnits(p: SimParams, popScale: number): SimParams`: the inverse for the service's effective parameters (`round(value × popScale)`).
  - `leverToPeople(patch: Record<string, unknown>, popScale: number): Record<string, unknown>`: multiplies, by `popScale`, the values of keys ending in `seed.value` or `.capacity`, or equal to `run.fit.value`, and rounds them.

- [ ] **Step 1: Write the failing tests** in `web/tests/sim/units.test.ts`:
  - `scalingPopulation prefers the area`: `{area: {population: 2_000_000, …}, totalPopulation: 55_000_000}` → `2_000_000`. With `area: null` → `55_000_000`. With both null → `null`.
  - `popScaleFor`: `(2_000_000, 10_000)` → `200`; `(null, 10_000)` → `1`.
  - `seedAgents rounds and never drops below one`: `(20, 200, 10_000)` → `1`; `(1_000, 200, 10_000)` → `5`; `(5_000_000, 200, 10_000)` → `10_000`.
  - `toAgentUnits converts only the three counts`: params with seed `{mode:"count", value: 1000}`, a treatment with `capacity: 300`, fit `{target:"peak_infections", value: 20_000}`, scale 200 → seed 5, capacity 2, fit value 100. A seed with `mode: "fraction"`, and a fit with target `attack_rate`, come back unchanged.
  - `toPeopleUnits inverts toAgentUnits for exact multiples`: seed 5 agents at scale 200 → 1,000.
  - `leverToPeople`: `{"disease.seed.value": 5, "run.sim_dur_years": 2}` at 200 → `{"disease.seed.value": 1000, "run.sim_dur_years": 2}`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/sim/units.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** `Area`, `AreaSource` and `Scenario.area` in `types.ts`, then the functions above in `units.ts`. Use `validateParams` on the converted body and throw if it fails (it cannot, since only integers ≥ 1 are written).

- [ ] **Step 4: Run to verify they pass**, then `npm run typecheck`. Fix every `Scenario` literal in `web/tests` that now lacks `area` (add `area: null`).

- [ ] **Step 5: Commit** `feat(web): people/agent units and the scaling population`.

---

### Task 2: Run comparison across a change of run size

**Files:**
- Modify: `web/lib/tools/runSimulation.ts:23-31` (`compareRuns`)
- Test: `web/tests/tools/runSimulation.test.ts`

**Interfaces:**
- `compareRuns(previous: PreviousRun, result: SimSuccess, popScale: number): RunCompare` keeps its signature.
- For every count key, `before = round(previous.statsAgents[key] × popScale × curN / prevN)`:
  - `prevN = previous.statsAgents.n_agents || previous.effectiveParams.run.n_agents`;
  - `curN = result.stats_agents.n_agents || result.effective_params.run.n_agents`.
- `peak_day` is unchanged.

- [ ] **Step 1: Write the failing test** `compare holds when n_agents changes`:
  - previous: `n_agents` 10,000, `statsAgents.total_infected` 8,000, popScale 5,000;
  - current: `n_agents` 50,000, `stats_agents.total_infected` 40,500, `stats.total_infected` 40,500,000, popScale 1,000;
  - expect `stats_delta.total_infected === 500_000`.
  Keep the existing test that a population fetched between runs shows no jump; it must still pass.

- [ ] **Step 2: Run** `npm test -- tests/tools/runSimulation.test.ts` → the new test FAILS (it shows 32,500,000).

- [ ] **Step 3: Implement** the formula and update the doc comment: the previous run's counts as shares of its own agents, at today's population.

- [ ] **Step 4: Run** the file → PASS.

- [ ] **Step 5: Commit** `fix(web): run comparison holds when the run size changes`.

---

### Task 3: The compute cap in the web app

**Files:**
- Modify: `web/lib/config.ts` (Settings, `loadSettings`)
- Modify: `web/lib/tools/types.ts` (`ToolDeps.limits`)
- Modify: `web/lib/chat/handleChat.ts` (pass `limits`)
- Modify: `web/lib/tools/configureSimulation.ts` (refuse above the cap)
- Modify: `web/lib/tools/index.ts` (the `n_agents`, `sim_dur_years` and `advanced` descriptions)
- Modify: `web/tests/tools/helpers.ts` (default `limits`)
- Test: `web/tests/tools/configureSimulation.test.ts`, `web/tests/lib/config.test.ts`

**Interfaces:**
- `Settings.simMaxAgentYears: number`, read from `SIM_MAX_AGENT_YEARS`, default `500000` (the same name and default as `sim/settings.py:30`).
- `ToolDeps.limits: { maxAgentYears: number }`.
- `agentYears(p: SimParams): number` in `web/lib/sim/units.ts`: `p.run.n_agents × p.run.sim_dur_years × p.run.n_replicates` (the formula in `sim/service.py:30`).

- [ ] **Step 1: Write the failing tests:**
  - `config reads SIM_MAX_AGENT_YEARS`: `loadSettings({...env, SIM_MAX_AGENT_YEARS: "200000"}).simMaxAgentYears === 200000`; unset → `500000`.
  - `configure refuses a run above the cap`: `n_agents: 1_000_000, sim_dur_years: 2` → `isError`. The message contains `"500,000 agent-years"` and the largest size that fits, `"250,000 agents"`. The scenario's params are unchanged.

- [ ] **Step 2: Run** both files → FAIL.

- [ ] **Step 3: Implement.** In `configure`, after the params validate and before they are stored, refuse when `agentYears(params) > deps.limits.maxAgentYears`. The message is:
  `CONFIG ERROR: {n_agents} agents × {years} years × {replicates} replicates = {agent-years} agent-years, above the simulation service's cap of {cap} agent-years. The largest run that fits is {floor(cap / (years × replicates))} agents. Offer that or a shorter run.`
  Format numbers with `commaInt`. Add to the `n_agents` description in `index.ts`: "n_agents × sim_dur_years × n_replicates must stay within the service's cap of 500,000 agent-years."

- [ ] **Step 4: Run** → PASS; typecheck.

- [ ] **Step 5: Commit** `feat(web): refuse configurations above the compute cap`.

---

### Task 4: Counts in people (seed, treatment capacity, peak-size fit)

**Files:**
- Modify: `web/lib/tools/runSimulation.ts` (convert at the boundary; notes; `run_size`)
- Modify: `web/lib/tools/configureSimulation.ts` (store people; drop the conversion at lines ~289-295; check the seed against the population; solver advice on agent units)
- Modify: `web/lib/tools/fetchHealthSystem.ts` (capacity from the population)
- Modify: `web/lib/sim/params.ts:295` (drop the `seed.value <= n_agents` rule from the shared schema)
- Modify: `web/lib/client/format.ts` (`seedText`, treatment text)
- Modify: `web/lib/report/compose.ts:68-70` (`runLabels`: "treatment capacity 300 people a day")
- Modify: `web/lib/tools/index.ts` (`seed_count`, `treatment_capacity` descriptions)
- Modify: `epichat/params/registry.py` (`disease.seed.value` and treatment `capacity` descriptions), then regenerate `web/data/param_registry.json`
- Test: `web/tests/tools/runSimulation.test.ts`, `web/tests/tools/configureSimulation.test.ts`, `web/tests/tools/fetchTools.test.ts`, `web/tests/client/format.test.ts`

**Interfaces:**
- Consumes `scalingPopulation`, `popScaleFor`, `toAgentUnits`, `toPeopleUnits`, `leverToPeople` and `seedAgents` (Task 1).
- `runSimulation`:
  - `popScale = popScaleFor(scalingPopulation(scenario), params.run.n_agents)`;
  - sends `toAgentUnits(params, popScale)` to `deps.sim.simulate`;
  - on success, replaces `result.effective_params` with `toPeopleUnits(…, popScale)`;
  - maps every diagnostic lever's patch through `leverToPeople`, before `onRun` and the payload.
- `runSimulation` content gains:
  - `run_size: { agents: number; people_per_agent: number; population: number }`;
  - `count_notes: string[]`.
- Both `recommendSolver` call sites (`configureSimulation.ts` ~395-397, `runSimulation.ts:41`) pass `toAgentUnits(params, popScale)`. The solver's die-out rule counts agents.

- [ ] **Step 1: Write the failing tests:**
  - `seeds are people`: population 2,000,000, `n_agents` 10,000, configure `seed_count: 1000`. The scenario stores 1,000, and the simulate stub receives seed value 5.
  - `smallest seed note`: population 50,000,000, `n_agents` 10,000 (scale 5,000), `seed_count: 20`. The stub receives 1, and `count_notes` contains `"20 initial cases is less than one agent at this run size; the run seeds 1 agent, about 5,000 people. More agents give a smaller seed."`.
  - `capacity is people a day`: scale 200, `treatment_capacity: 300`. The stub receives capacity 2, and `count_notes` contains `"Treatment capacity 300 people a day runs as 2 agents a day, about 400 people a day."`.
  - `capacity below one agent`: scale 5,000, capacity 300 → note `"…below one agent a day at this run size; it runs as 1 agent a day, about 5,000 people a day."`.
  - `peak fit stored in people`: configure `fit: {target: "peak_infections", value: 20000}` with population 2,000,000. Stored value 20,000; the stub receives 100.
  - `seed above the population is refused`: population 2,000,000, `seed_count: 3_000_000` → `CONFIG ERROR` naming both numbers.
  - `health-system capacity uses the population`: 2.0 per 1,000, population 2,000,000 → capacity 4,000. With no population known, `n_agents` stands in, as today.
  - `run_size`: content `run_size` is `{agents: 10000, people_per_agent: 200, population: 2000000}`.
  - `seedText says people`: `{mode:"count", value: 20, day: 0}` → `"20 people"`. Treatment text reads `"capacity 300 people a day"`.
  - `report label says people a day` (`web/tests/report/compose.test.ts`): a run whose treatment capacity changed to 300 → `"Run 2, treatment capacity 300 people a day"`.

- [ ] **Step 2: Run** the four test files → FAIL.

- [ ] **Step 3: Implement.**
  - `configure`: `seed_count` and `treatment_capacity` are stored as given. Delete the agent conversion of a peak-infections fit, so the value is stored as given.
  - The seed check: `seed_count` must not exceed `scalingPopulation(scenario) ?? params.run.n_agents`. The message: `CONFIG ERROR: {n} initial cases is more than the population ({pop}).`
  - Drop the `seed.value > p.run.n_agents` issue in `params.ts`. Python keeps its own check on agents, which conversion always satisfies.
  - `count_notes` texts as in the tests.
  - Descriptions:
    - `seed_count`: "Number of people infected at the start (converted to agents at the run's scale). Exclusive with seed_fraction."
    - `treatment_capacity`: "People who can be treated per day; adds/updates the treatment intervention."
  - The registry descriptions say the same.

- [ ] **Step 4: Run** the files, then the whole web suite and typecheck. Update existing tests that asserted agents or the old schema message; each such change is expected by this task.

- [ ] **Step 5: Export the registry**, run `.venv/Scripts/python.exe -m pytest tests/test_param_registry.py -q`, and commit `feat: seeds, treatment capacity and peak fits in people`.

---

### Task 5: Store the area

**Files:**
- Create: `web/supabase/migrations/0008_area.sql`
- Modify: `web/lib/db/scenarios.ts` (`ScenarioJson.area`, `COLUMNS`, `scenarioFromRow`, `scenarioToJson`)
- Test: `web/tests/db/stores.test.ts`, `web/tests/db/schema.test.ts`

**Interfaces:**
- `ScenarioJson.area: Area | null`, stored as jsonb `scenarios.area`.
- `scenarioFromRow` accepts a row without `area` (an old row) as `null`, and drops a malformed value (no positive integer population, or no name) to `null` with a `console.error`.

- [ ] **Step 1: Write the failing tests:**
  - `area round-trips`: `scenarioToJson` then `scenarioFromRow` keeps `{name: "Example County", population: 2000000, countryIso3: "KEN", source: {kind: "user"}}`.
  - `a row without area reads null`.
  - `a malformed area reads null`.
  - If `schema.test.ts` checks that migrations mention every `ScenarioJson` key, it now expects `area`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** `0008_area.sql`:
  - header comment: apply after 0007 in the SQL editor; safe to run twice;
  - `alter table scenarios add column if not exists area jsonb;`
  - `create or replace function finish_turn(...)`: copied verbatim from its latest definition in `0004_reports.sql`, with `area = nullif(s->'area', 'null'::jsonb)` added to the scenarios update and `area` added to the insert's columns and values.

- [ ] **Step 4: Run** → PASS; typecheck.

- [ ] **Step 5: Commit** `feat(db): scenarios keep an area`.

---

### Task 6: Setting the area

**Files:**
- Modify: `web/lib/tools/configureSimulation.ts` (inputs `area`, `clear_area`; the carried-over scenario; `n_agents` limit)
- Modify: `web/lib/tools/types.ts` (`carryOverScenario`, `ConfigPayload.carried_over`, `ConfigPayload.population`, `DataPayload.population`)
- Create: `web/lib/tools/population.ts`
- Modify: `web/lib/tools/fetchDemographics.ts` (keep the area and a user-set household size)
- Modify: `web/lib/tools/index.ts` (the configure schema: `area`, `clear_area`; descriptions)
- Test: `web/tests/tools/configureSimulation.test.ts`, `web/tests/tools/fetchTools.test.ts`

**Interfaces:**
- `ConfigureSimulationInput` adds:
  - `area: { name: string; population?: number | null; source_title?: string | null; source_url?: string | null } | null`;
  - `clear_area: boolean | null`.
- `carryOverScenario(s: Scenario): void` (types.ts): `id` becomes null, `seq` goes up by 1, and `hasRun`, `hasReport` and `reportCurrent` become false. Everything else is kept.
- `type PopulationView = { value: number; place: string; origin: string; url: string | null; national: boolean }`.
- `populationView(s: Scenario): PopulationView | null` (population.ts):
  - an area: `{value: area.population, place: "<area>, <country>", origin: "you set it" | <source title>, url, national: false}`;
  - otherwise the country total, with `origin` set to the dataSources label of the `total_population` field and `national: true`;
  - otherwise null.
- `ConfigPayload.carried_over?: boolean`. `ConfigPayload.population?` and `DataPayload.population?` are `PopulationView | null`.

- [ ] **Step 1: Write the failing tests:**
  - `area with a number after a run starts a carried-over scenario`:
    - setup: scenario seq 1, with a run, disease measles, country KEN, a treatment;
    - call: `area: {name: "Example County", population: 2000000}`;
    - expect: seq 2, `id` null, `hasRun` false, the same params, disease and dataSources, `area.source.kind === "user"`, `onScenarioStart` called once, payload `new_scenario: true`, `carried_over: true`;
    - the content contains `"A new scenario started for Example County with the same settings; earlier runs stay under the previous scenario."`.
  - `area before any run stays in the scenario`: the same call before any run → seq 1, `onScenarioStart` not called.
  - `area from the web keeps its source`: `source_title` and `source_url` given → `source: {kind: "web", title, url}`.
  - `area without a number is refused`: the message contains `"needs its population"`.
  - `area larger than the country is refused`: `totalPopulation` 55,000,000, area 60,000,000 → the message names both numbers.
  - `n_agents never exceeds the area`:
    - an area of 3,000 lowers `n_agents` from 10,000 to 3,000, with `applied.n_agents_lowered_to_population: 3000`;
    - a later `n_agents: 20000` is lowered the same way.
  - `clear_area after a run starts a carried-over scenario`, scaling back to the country.
  - `a change of country clears the area`: `country_iso3: "UGA"` with a KEN area clears it, and `applied.area_cleared` is set.
  - `fetch keeps an area`: `fetch_demographics(KEN)` after an area is set:
    - `area` and `n_agents` are unchanged, and `totalPopulation` is the country's;
    - the content says `"Area population kept: 2,000,000 (Example County)"`.
  - `fetch keeps a user-set household size`:
    - `household_size: 6` set in chat, then the fetch → still 6, with `applied.household_size_kept: 6`;
    - without a user value, the bundled size applies as today.
  - `populationView`: an area with user source → origin `"you set it"`, `national: false`; with no area → the country total, `national: true`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**
  - Area messages:
    - no number: `CONFIG ERROR: an area needs its population. Ask the user, or find it with web_search and pass it with source_title and source_url.`
    - too large: `CONFIG ERROR: {name}'s population ({n}) is larger than {country}'s ({total}).`
  - An area change is a different name or population from the current area, or a clear. After a run, it calls `carryOverScenario` and `deps.onScenarioStart()`; before any run, it just sets the area.
  - Apply the `n_agents` limit after all fields, whenever a scaling population exists and is below `n_agents`.
  - `fetchDemographics`: compute `valueSources(scenario.params, scenario, disease)["network.household_size"]` before the fetch, and skip the bundled household size when it is `"user"`.
  - Every config and data payload carries `population: populationView(scenario)`.
  - Tool descriptions:
    - `area`: "An area smaller than the country (a county, state or city) and its population. Give the population the user stated, or one you found with web_search together with source_title and source_url. Ages, contacts and vaccination coverage stay the country's. After a run, setting or changing the area starts a new scenario with the same settings."
    - `start_new_scenario`: add "A change of area does this by itself."

- [ ] **Step 4: Run** → PASS; full web suite; typecheck.

- [ ] **Step 5: Commit** `feat(web): an area population, set in chat or found and cited`.

---

### Task 7: Showing the area (panel and report)

**Files:**
- Modify: `web/lib/client/artifacts.ts` (`out.population`; keep data on `carried_over`)
- Modify: `web/components/panel/ScenarioSection.tsx`, `web/components/panel/DataSection.tsx`, `web/components/panel/DetailsPanel.tsx` (pass `population`)
- Modify: `web/lib/client/format.ts` (`populationRow(view: PopulationView): [string, string]`, `nationalNote(view: PopulationView, countryIso3: string): string | null`)
- Modify: `web/lib/report/compose.ts` (`scenarioTitle`, the Population row, the limitations sentence)
- Test: `web/tests/client/artifacts.test.ts`, `web/tests/client/format.test.ts`, `web/tests/report/compose.test.ts`

**Interfaces:**
- Consumes `PopulationView` and `populationView` (Task 6).
- `populationRow(view)`:
  - an area: `["Population", "2,000,000, Example County, Kenya (you set it)"]`;
  - the country: `["Population", "55,100,000, Kenya (UN World Population Prospects)"]`.
- `nationalNote(view, iso3)`: for an area, `"Ages, contact patterns and vaccination coverage are Kenya's national figures."`; null otherwise.

- [ ] **Step 1: Write the failing tests:**
  - `artifacts keep data across a carried-over scenario`: a config payload with `new_scenario: true, carried_over: true` keeps `out.data` and sets `out.population`. With `carried_over` absent, today's reset still happens.
  - `populationRow` and `nationalNote` as above.
  - `report title names the area`: an area scenario → `"Measles in Example County, Kenya, SIR model, 1 year"`.
  - `report Population row shows the area and its origin`.
  - `report limitations carry the national sentence`: the limitations section's last block is a paragraph with the `nationalNote` text when an area is set, and absent otherwise.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**
  - The Scenario section shows `populationRow` after Country. The Data section shows `nationalNote` under its heading when it is non-null.
  - In the report, `scenarioTitle` uses `"<area>, <country>"` when an area is set. `modelled` uses the area's population and origin in the Population row. `composeReport` appends the sentence to the limitations blocks.

- [ ] **Step 4: Run** → PASS; typecheck; lint.

- [ ] **Step 5: Commit** `feat(web): the panel and the report show the area`.

---

### Task 8: Doses and treatments delivered

**Files:**
- Modify: `epichat/sim/outputs.py` (`extract`: `stats["delivered"]`)
- Modify: `sim/series.py` (`scale_stats` scales `delivered`)
- Modify: `epichat/sim/diagnostics.py:~465` (campaign wording)
- Modify: `epichat/params/registry.py` (vaccine coverage description), then export
- Modify: `web/lib/sim/client.ts` (`SimStats.delivered?: Record<string, number>`)
- Modify: `web/lib/report/compose.ts` (`results`: Doses and Treatments given columns)
- Test: `tests/test_sim_outputs.py`, `sim/tests/test_series.py`, `tests/test_sim_diagnostics.py`, `web/tests/report/compose.test.ts`

**Interfaces:**
- `stats["delivered"]` maps each vaccine or treatment intervention's builder name (`f"{type}_{k}"`, the name used in `builder.py`) to the total delivered over the run. The total is `int(round(sum(sim.results[name].delivered)))`. The key is absent when the run has no such intervention.
- `scale_stats` scales each value of `delivered` by `pop_scale` and rounds it.

- [ ] **Step 1: Write the failing tests:**
  - `test_campaign_delivered_counts_doses` (`tests/test_sim_outputs.py`):
    - setup: SIR, 10,000 agents, R0 below 1 (so almost nobody is infected), a vaccine campaign of coverage 0.5 for all ages over days 0–30;
    - expect `stats["delivered"]["vaccine_0"]` between 4,500 and 5,500, both as agents and as a compartmental run.
  - `test_treatment_delivered`: a treatment run has `stats["delivered"]["treatment_0"] > 0`.
  - `test_scale_stats_scales_delivered` (`sim/tests/test_series.py`): `{"delivered": {"vaccine_0": 50}}` at 200 → `10000`.
  - `test_campaign_lever_says_everyone_eligible`: the campaign lever's text contains `"of everyone eligible, vaccinated or not"` and not `"of the susceptible"`.
  - `report shows doses`: a run with `stats.delivered = {vaccine_0: 2_500_000}` gives the results table a `"Doses"` column showing `"2,500,000"`. With no delivered, there is no column.

- [ ] **Step 2: Run** the Python files with the venv and the web file → FAIL.

- [ ] **Step 3: Implement.**
  - The registry's campaign coverage text: "A campaign's coverage is the share of everyone in the eligible ages reached over the campaign, including people already immune."
  - The lever text: `f"A campaign reaching {CAMPAIGN_COVERAGE:.0%} of everyone eligible, vaccinated or not, from the day 1% had been infected; "`.
  - If Starsim has no `delivered` result for a delivery in compartmental runs, record the key only when the result exists, and note it in the PR.

- [ ] **Step 4: Run** → PASS; the sim service suite (`sim/tests`) and `tests/test_sim_*.py`.

- [ ] **Step 5: Export the registry** and commit `feat: runs report doses and treatments delivered`.

---

### Task 9: The uncertainty band

**Files:**
- Modify: `epichat/sim/replicates.py:14` (`BAND_KEYS`)
- Create: `web/lib/sim/bands.ts`
- Modify: `web/lib/tools/runSimulation.ts` (merge bands into the stored series; `band_shown`)
- Modify: `web/lib/client/chart.ts` (`bandFor`, `bandPath`)
- Modify: `web/components/Chart.tsx` (draw the band; y-axis covers p90; legend)
- Modify: `epichat/params/registry.py` (`run.n_replicates` description), then export
- Test: `tests/test_sim_replicates.py`, `web/tests/sim/bands.test.ts`, `web/tests/client/chart.test.ts`, `web/tests/tools/runSimulation.test.ts`

**Interfaces:**
- `BAND_KEYS = ("n_infectious", "cum_infections", "new_infections", "cum_deaths")`.
- `mergeBands(series: Record<string, number[]>, bands: Record<string, { p10: number[]; p90: number[] }> | undefined): Record<string, number[]>`: adds `${key}_p10` and `${key}_p90` for every band key whose arrays match `series.day` in length, and returns a new object.
- `bandFor(view: ChartView, series: Series): { p10: number[]; p90: number[] } | null`:
  - for `infected` it reads `n_infectious_p10`/`_p90`, for `incidence` `new_infections_*`, for `cumulative` `cum_infections_*`, for `deaths` `cum_deaths_*`;
  - `compartments` gives null, and so do missing keys.
- `bandPath(days: number[], p10: number[], p90: number[], width: number, height: number, xMax: number, yMax: number): string`: a closed SVG path along p90 forward and p10 back.
- The run content gains `band_shown: boolean`, which is `replicates.n > 1`.

- [ ] **Step 1: Write the failing tests:**
  - `test_bands_cover_incidence_and_deaths`: 3 replicates → `bands` has all four keys.
  - `mergeBands adds suffixed keys`, and skips a band whose length differs from `day`.
  - `bandFor`: infected with the keys → the arrays; compartments → null; the `series without band keys draws no band` case → null.
  - `bandPath`: `days [0,1]`, p10 `[0,0]`, p90 `[10,10]`, width 100, height 50, xMax 1, yMax 10 → `"M0 0 L100 0 L100 50 L0 50 Z"`.
  - `run with replicates stores bands and says so`: the stub returns replicates with bands. The record passed to `onRun` has `n_infectious_p10` in its series, and the content has `band_shown: true`. With one replicate, `band_shown` is false.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**
  - The band fill is `var(--color-accent)` at opacity 0.15, drawn before the lines. `yTicks` uses the max of the lines and p90.
  - The legend adds `"10 to 90% of {n} runs"` when a band is drawn. Pass `n` through an optional `replicates?: number` prop; RunsSection passes `payload.replicates?.n`.
  - The registry text for `run.n_replicates`: "How many times to run as agents, each with its own random seed; the chart shows the run with the median total infected and a shaded band from the 10th to the 90th percentile of the runs. A compartmental run is deterministic and runs once." This also removes the typo "An compartmental run".
  - Update the comments in `types.ts`/`runSimulation.ts` that say the bands wait for a follow-up.

- [ ] **Step 4: Run** → PASS; typecheck; lint; Python replicates and sim suites.

- [ ] **Step 5: Export the registry** and commit `feat: draw the 10-90% band for replicate runs`.

---

### Task 10: Reports pick runs by the panel's numbers

**Files:**
- Modify: `web/lib/db/runs.ts` (`ReportRun.index`; computed in `listForReport` before the scenario filter)
- Modify: `web/lib/tools/writeReport.ts` (input `runs`; validation; filtering)
- Modify: `web/lib/report/compose.ts` (`runLabels` uses `run.index`)
- Modify: `web/lib/tools/index.ts` (write_report schema and description)
- Modify: `web/tests/report/fixture.ts` (add `index`)
- Test: `web/tests/tools/writeReport.test.ts`, `web/tests/report/compose.test.ts`, `web/tests/db/stores.test.ts`

**Interfaces:**
- `ReportRun.index: number` is the run's position, from 1, among the conversation's successful runs ordered by `created_at`. That is the number the Runs section shows (`artifacts.ts:94`).
- `WriteReportInput.runs?: number[]` (whole numbers ≥ 1, 1 to 12 entries, no duplicates).

- [ ] **Step 1: Write the failing tests:**
  - `rows without a stored index still get panel numbers`: `listForReport` over 5 conversation runs, of which the current scenario owns runs 3–5 → indexes `[3, 4, 5]`.
  - `report covers chosen runs`: `runs: [3, 5]` → the document's results table has two rows labelled `"Run 3"` and `"Run 5, …"`.
  - `report refuses a run outside the scenario`: `runs: [2]` → content starts with `"REPORT NOT WRITTEN: run 2 is not one of this scenario's runs; its runs are 3, 4 and 5."`, and nothing is inserted.
  - `labels use panel numbers`: `runLabels` on runs with indexes 4 and 6 → `"Run 4"`, then `"Run 6, …"`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** The write_report description adds: "Pass runs (the Runs section's numbers) to cover only those runs; omit it for all of this scenario's runs."

- [ ] **Step 4: Run** → PASS; typecheck.

- [ ] **Step 5: Commit** `feat(web): reports cover chosen runs, numbered as in the panel`.

---

### Task 11: Prompt rules

**Files:**
- Modify: `web/lib/chat/prompt.ts` (`ADDITIONS`)
- Test: `web/tests/chat/prompt.test.ts`

**Interfaces:** none. Text only. Each rule below is a test assertion: `SYSTEM_PROMPT` contains the phrase in quotes.

- [ ] **Step 1: Write the failing test** `prompt carries the round-1 rules`. Assert that the prompt contains each quoted phrase and no longer contains `"Population 2 million (user's choice)"`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Add the rules.**
  - **About, after "What it can do":** "EpiChat cannot run code, notebooks or other models, or hand a scenario to them; never offer to. It offers instead: runs, comparisons between runs, the charts, and the report with its downloads."
  - **About, "How a simulation works":** add "A scenario can be a country or an area within it (a county, state or city) with its own population; ages, contacts and vaccination coverage stay the country's."
  - **Areas (new bullet in The interface or a new "Areas" section):**
    - "When the user names an area with a population, set it with configure_simulation's area."
    - "When they name one without a number, find its population with web_search, give the figure and its source in one line, set it with source_title and source_url, and invite a correction."
    - "Say once that ages, contacts and vaccination coverage are the country's."
    - "Never promise an area figure without setting it."
  - **Numbers:**
    - "Quote doses and treatments from the run's stats.delivered, never from coverage arithmetic."
    - "Quote the run size (agents and people per agent) only from run_size."
    - "Initial cases, treatment capacity and a peak-size target are in people."
    - "Mention a band only when band_shown is true."
    - "Name runs by the Runs section's numbers, never letters."
  - **Run size:** "Runs are limited to 500,000 agent-years (agents × years × replicates); never offer a larger run."
  - **Recap example:** replace `Population 2 million (user's choice)` with `Example County, Kenya: population 2 million (user's figure)`.

- [ ] **Step 4: Run** `npm test -- tests/chat` → PASS.

- [ ] **Step 5: Commit** `feat(web): prompt rules from the round-1 review`.

---

### Task 12: A one-hour prompt cache

**Files:**
- Modify: `web/lib/chat/prompt.ts:122`, `web/lib/chat/runTurn.ts:128` (`ttl: "1h"`)
- Modify: `web/lib/chat/runTurn.ts:84-95` (`apiCallOf` records 1-hour writes)
- Modify: `web/lib/db/turns.ts` (`ApiCall.cache_write_1h_tokens: number`)
- Modify: `web/lib/models.ts` (`ModelProfile.cacheWrite1hPerMTok`; `UsageLike.cache_creation_1h_input_tokens`; `costUsd`)
- Modify: `web/lib/chat/handleChat.ts:350-360` (pass the 1-hour count to `costUsd`)
- Test: `web/tests/lib/models.test.ts`, `web/tests/chat/runTurn.test.ts`

**Interfaces:**
- `cacheWrite1hPerMTok`, at twice the input price: opus-5-5 `8`, opus-5 `10`, sonnet-5-5 `4`.
- `costUsd` prices `cache_creation_1h_input_tokens` at the one-hour rate and the rest of `cache_creation_input_tokens` at `cacheWritePerMTok`. The API's total includes both TTLs.

- [ ] **Step 1: Write the failing tests:**
  - `one-hour cache writes cost twice the input price`: opus-5-5, `cache_creation_input_tokens` 1,000,000, of which 1,000,000 are one-hour → `8.00`. Half one-hour → `4 + 2.5 = 6.5`.
  - `requests ask for the one-hour cache`: the stubbed client's request has `cache_control: {type: "ephemeral", ttl: "1h"}`, and the system block has the same.
  - `apiCallOf records one-hour writes`: `usage.cache_creation.ephemeral_1h_input_tokens` 1234 → `cache_write_1h_tokens` 1234.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** `ApiCall` lives in jsonb `turns.api_calls`, so no migration is needed. If the SDK's `CacheControlEphemeral` type lacks `ttl`, upgrade `@anthropic-ai/sdk` within its current major. Do not cast around it.

- [ ] **Step 4: Run** → PASS; typecheck.

- [ ] **Step 5: Commit** `feat(web): one-hour prompt cache, priced and logged`.

---

### Task 13: A false "still spreading" note

**Files:**
- Modify: `epichat/sim/diagnostics.py:36-37, 233-251` (`UNFINISHED_MIN_AGENTS = 10`)
- Test: `tests/test_sim_diagnostics.py`

**Interfaces:** `_unfinished` keeps its signature. The tail condition also needs `run.infectious[-1] >= UNFINISHED_MIN_AGENTS`. The rising condition also needs the last window's total new infections to be at least `UNFINISHED_MIN_AGENTS`.

- [ ] **Step 1: Write the failing test** `test_unfinished_ignores_a_handful_of_agents`: a series that ends with 1 infectious agent and 1 new infection in the last window, after 0 in the window before, gives no `unfinished` diagnostic. Keep `test_unfinished_fires_on_a_tail_or_a_rising_incidence_and_doubles_the_duration` passing.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** the constant and both conditions.

- [ ] **Step 4: Run** `tests/test_sim_diagnostics.py` → PASS.

- [ ] **Step 5: Commit** `fix(sim): the still-spreading note ignores a handful of agents`.

---

### Task 14: Verify and open the PR

- [ ] **Step 1: Full suites.** Run the full pytest suite, the sim service suite, `npm test`, `npm run typecheck` and `npm run lint`. Expected: all pass. Record the counts.
- [ ] **Step 2: UNICEF data.** Call `fetch_vaccination_coverage` through the web adapter test helper, or curl `https://sdmx.data.unicef.org/ws/public/sdmxapi/rest/data/UNICEF,IMMUNISATION,1.0/KEN.IM_MCV1.?format=csv` and the same for `USA`. Expected: rows with 2024 or 2025 values. Note the result in the PR.
- [ ] **Step 3: Push and open the PR.** Push `round1-fixes` and open a PR against main. The description includes:
  - the spec link and the test counts;
  - "Apply web/supabase/migrations/0008_area.sql in the SQL editor before merging";
  - the preview walkthrough checklist (the spec's acceptance checks).
- [ ] **Step 4: Preview walkthrough with the owner.** The preview is behind Vercel SSO; the owner opens it after applying 0008 to the database the preview uses. Walk the acceptance checks: a county with a number, a US state without one, 20 cases, a campaign's doses, a compare after an `n_agents` change, five replicates, 1M agents × 2 years refused, a report on chosen runs, a turn after a 10-minute pause, a turn with web search.
- [ ] **Step 5: Cache fallback check.** If any turn with web search fails with a cache-ordering error, keep `ttl: "1h"` on the system block only, remove it from the top-level breakpoint, and re-run Task 12's tests.
