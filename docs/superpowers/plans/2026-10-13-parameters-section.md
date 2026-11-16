# The Parameters Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The panel's Parameters section lists every parameter the scenario has, grouped by module and generated from the registry, with where each value came from, so it can never again fall behind the registry; the same rows feed the runs panel, the report's appendix and `describe_parameters`.

**Architecture:** A new pure module, `web/lib/client/parameters.ts`, declares one row per parameter or per natural bundle of parameters (a duration is one row; so are the seeding, the age shares, the contact matrix and the hybrid layers), each naming the registry paths it covers. `parameterGroups(params, sources)` returns five groups in the registry's module order; a row is shown by default when one of its paths is a core parameter or differs from the registry default, and "Show all" opens the rest. A test walks the registry and fails when a parameter that applies to a scenario is covered by no row or by two. The server computes the source of every value with the existing `valueSources` and sends it in the payloads that already carry the parameters.

**Tech Stack:** Next.js + TypeScript + vitest. No Python change except documents.

**Spec:** `docs/superpowers/specs/2026-10-13-limits-suggestions-parameters-design.md`, section 8 (phase C of section 14).

## Global Constraints

- No database migration, no new npm dependency, `npm --prefix web ci` only. The registry version does not change.
- Payloads stored before this phase have no `sources`: they render without tags.
- Five groups in the registry's module order: Disease, Contact network, Demographics, Interventions, Run. The Interventions group is the existing list of lines.
- A row is shown by default when it is derived (R₀, Fitted to), when one of its paths has the tier `core`, or when one of its paths differs from the registry default. "Show all (N)" opens every row that applies to the scenario's model and network; N is the group's row count.
- The tags, in the user's words: `database`, `fetched`, `default`, `assumption`, `you`. (`reference` arrives with phase D.)
- Existing row labels are kept where a row already existed, so stored expectations and the report keep their words.
- The public share page shows the same section without behaviour of its own.

## Review Focus

- A parameter added to the registry later must fail the coverage test until it has a row: the test must walk the registry, not a hand-written list.
- A scenario on each network and each model must show no row that does not apply (no hybrid layers on the random network, no latent period on SIR) and miss none that does.
- A payload stored before this phase (no `sources`), and one with `sources` naming paths the registry no longer has, must render.
- A value the run changed (a calibrated beta, a fitted coefficient) must not be tagged as if the user had typed it.
- The report's appendix must stay readable when two runs differ in network or model: a row that applies to one run only shows a dash for the other.

---

### Task 1: Rows generated from the registry

**Files:**
- Create: `web/lib/client/parameters.ts`
- Modify: `web/lib/client/format.ts` (export the small formatters the rows need; remove `parameterRows`)
- Test: `web/tests/client/parameters.test.ts` (new), `web/tests/client/format.test.ts` (the `parameterRows` tests move)

**Interfaces:**
- Produces:
  - `type SourceTag = "database" | "fetched" | "default" | "assumption" | "you" | "reference"`
  - `type ParameterRow = { label: string; value: string; paths: string[]; shown: boolean; source: SourceTag | null; grid?: { columns: string[]; rows: string[][] } }` (`shown`: in the default view)
  - `type ParameterGroup = { id: "disease" | "network" | "demographics" | "interventions" | "run"; title: string; rows: ParameterRow[]; lines?: string[] }`
  - `parameterGroups(p: SimParams, sources?: Record<string, string> | null): ParameterGroup[]`
  - `defaultRows(p: SimParams): [string, string][]` (the shown rows of every group, flattened in group order; the Interventions group contributes none)
  - `coveredPaths(p: SimParams): string[]` (every registry path the rows of `p` cover, for the coverage test)

- [ ] **Step 1: Write the failing tests** (`web/tests/client/parameters.test.ts`)

```ts
import { describe, expect, it } from "vitest";

import { coveredPaths, defaultRows, parameterGroups } from "@/lib/client/parameters";
import { approxR0 } from "@/lib/sim/params";
import { PARAM_REGISTRY, appliesOn, appliesTo } from "@/lib/sim/registry";
import { params } from "../tools/helpers";

const MODELS = ["sir", "seir", "sirs", "seirs", "seiar", "sis"] as const;
const NETWORKS = ["random", "age_structured", "hybrid"] as const;
const scenario = (model: string, network: string) => params({
  schema_version: 2,
  disease: { model, ...(["seir", "seirs", "seiar"].includes(model) ? { dur_exp: { mean_days: 5 } } : {}), ...(["sirs", "seirs"].includes(model) ? { dur_immune: { mean_days: 180 } } : {}) },
  network: { network_type: network },
});

describe("the Parameters section's rows come from the registry (follow-up spec 8.3)", () => {
  it("covers every parameter that applies to a scenario exactly once, on every model and network", () => {
    for (const model of MODELS) {
      for (const network of NETWORKS) {
        const expected = PARAM_REGISTRY.filter((s) => s.module !== "interventions" && appliesTo(s, model) && appliesOn(s, network)).map((s) => s.path).sort();
        const covered = coveredPaths(scenario(model, network));
        expect([...covered].sort(), `${model} on ${network}`).toEqual(expected);
        expect(new Set(covered).size, `${model} on ${network}: a path covered twice`).toBe(covered.length);
      }
    }
  });

  it("has five groups in the registry's module order, the interventions as lines", () => {
    const groups = parameterGroups(params({ interventions: [{ type: "seasonality", scale: 0.3 }] }));
    expect(groups.map((g) => [g.id, g.title])).toEqual([["disease", "Disease"], ["network", "Contact network"], ["demographics", "Demographics"], ["interventions", "Interventions"], ["run", "Run"]]);
    expect(groups[3].rows).toEqual([]);
    expect(groups[3].lines).toEqual(["Seasonality: amplitude 0.3, shift 0"]);
    expect(groups[0].rows[0]).toMatchObject({ label: "R₀ (approx.)", paths: [], shown: true });
  });

  it("shows the core rows and the rows that differ from the default, and keeps the rest for Show all", () => {
    const p = params({ disease_type: "seir", beta: 171.09375, n_contacts: 4, init_prev: 0.01, dur_inf: 8, dur_exp: 11, p_death: 0.001, n_agents: 10000, sim_dur_years: 1 });
    expect(defaultRows(p)).toEqual([
      ["R₀ (approx.)", approxR0(p).toFixed(1)],
      ["Model", "SEIR"],
      ["Transmission rate (β)", "171.1"],
      ["Infectious period", "8 days"],
      ["Exposed period", "11 days"],
      ["Death probability", "0.1%"],
      ["Initial infections", "1%"],
      ["Contact network", "random"],
      ["Contacts per day", "4"],
      ["Births and deaths", "not modelled"],
      ["Country", "not set"],
      ["Agents", "10,000"],
      ["Duration", "1 year"],
    ]);
    const disease = parameterGroups(p)[0];
    const hidden = disease.rows.filter((r) => !r.shown).map((r) => r.label);
    expect(hidden).toEqual(expect.arrayContaining(["Variation in susceptibility", "Susceptibility by age", "Fatality by age", "Presymptomatic transmission", "Initially immune"]));
    expect(parameterGroups(params({})).flatMap((g) => g.rows).find((r) => r.label === "Transmission rate (β)")?.shown).toBe(false);   // the default beta is not core
  });

  it("writes a bundle of parameters as one row", () => {
    const v2 = params({ schema_version: 2, disease: { dur_inf: { mean_days: 8, dist: "gamma", sd_days: 2.4 }, seed: { mode: "count", value: 20, day: 5 }, initial_immune_frac: 0.4, rel_sus_cv: 1 }, run: { n_replicates: 3, rand_seed: 42 } });
    const rows = parameterGroups(v2).flatMap((g) => g.rows);
    const row = (label: string) => rows.find((r) => r.label === label)!;
    expect(row("Infectious period")).toMatchObject({ value: "8 days, gamma (sd 2.4)", paths: ["disease.dur_inf.mean_days", "disease.dur_inf.dist", "disease.dur_inf.sd_days"], shown: true });
    expect(row("Initial infections")).toMatchObject({ value: "20 agents on day 5", paths: ["disease.seed.mode", "disease.seed.value", "disease.seed.day"] });
    expect(row("Initially immune")).toMatchObject({ value: "40%", shown: true });
    expect(row("Variation in susceptibility")).toMatchObject({ value: "CV 1", shown: true });
    expect(row("Replicates")).toMatchObject({ value: "3", shown: true });
    expect(row("Random seed")).toMatchObject({ value: "42", shown: true });
    expect(row("Fitted to")).toMatchObject({ value: "not fitted", shown: false, paths: ["run.fit.target", "run.fit.value", "run.fit.lever"] });
    const fitted = params({ schema_version: 2, run: { fit: { target: "attack_rate", value: 0.3 } } });
    expect(defaultRows(fitted)).toContainEqual(["Fitted to", "attack rate 30% by moving the transmission rate"]);
  });

  it("shows the contact matrix as a grid on the age-structured network and the layers as a table on the hybrid one", () => {
    const aged = parameterGroups(params({ schema_version: 2, network: { network_type: "age_structured" } }))[1];
    const matrix = aged.rows.find((r) => r.label === "Contact matrix")!;
    expect(matrix.value).toBe("POLYMOD default (European)");
    expect(matrix.paths).toHaveLength(10);
    expect(matrix.grid).toEqual({ columns: ["", "children", "adults", "elderly"], rows: [["children", "7", "2.5", "0.5"], ["adults", "2.5", "9", "1.5"], ["elderly", "0.5", "1.5", "3.5"]] });
    expect(matrix.shown).toBe(false);                                                        // the bundled default, kept for Show all
    expect(aged.rows.map((r) => r.label)).not.toContain("Contacts per day");
    const hybrid = parameterGroups(params({ schema_version: 2, network: { network_type: "hybrid", household_size: 4.9, school_contacts: 30 } }))[1];
    expect(hybrid.rows.find((r) => r.label === "Household size")).toMatchObject({ value: "4.9 people", shown: true });
    const layers = hybrid.rows.find((r) => r.label === "Layers")!;
    expect(layers.shown).toBe(true);                                                         // the school contacts were changed
    expect(layers.grid).toEqual({ columns: ["Layer", "Contacts per day", "Transmissibility"], rows: [["Household", "the household", "×3"], ["School", "30", "×0.6"], ["Workplace", "16", "×0.6"], ["Community", "20", "×0.3"]] });
    expect(hybrid.rows.find((r) => r.label === "School and working ages")).toMatchObject({ value: "school 6 to 22, work 22 to 65", shown: false });
    expect(hybrid.rows.map((r) => r.label)).not.toContain("Contact matrix");
  });
});
```

Move the `parameterRows` assertions of `web/tests/client/format.test.ts` to `defaultRows` (the import too): the exact list in "writes the current parameters in words with units" is replaced by the one above; the `toContainEqual` assertions keep their rows, except that a row at its default value is no longer in the default view (replace `parameterRows(x)` by a small local `allRows(x)` that flattens `parameterGroups(x)` where the assertion is about a row's text rather than its visibility).

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npx vitest run tests/client/parameters.test.ts`
Expected: FAIL (no module).

- [ ] **Step 3: Implement** `web/lib/client/parameters.ts`

The rows, in order. Each is `{ label, paths, text(p), grid?(p) }`; a row applies when at least one of its paths applies to the scenario's model and network (`appliesTo`, `appliesOn`); its covered paths are the ones that apply.

| Group | Label | Paths | Value |
|---|---|---|---|
| Disease | R₀ (approx.) | derived | `approxR0(p).toFixed(1)` |
| | Model | `disease.model` | upper case |
| | Transmission rate (β) | `disease.beta` | `fmtValue` |
| | Infectious period | `disease.dur_inf.*` | `durationText` |
| | Exposed period | `disease.dur_exp.*` | `durationText`, "not set" when null |
| | Immunity duration | `disease.dur_immune.*` | `durationText`, "not set" when null |
| | Death probability | `disease.p_death` | fraction |
| | Fatality by age | `disease.p_death_age.*` | the three probabilities, "same for every age" when all null |
| | Asymptomatic share | `disease.p_asymp` | fraction |
| | Asymptomatic transmission | `disease.rel_trans_asymp` | "50% of symptomatic" |
| | Presymptomatic transmission | `disease.rel_trans_exposed` | "x% of the infectious value" |
| | Variation in susceptibility | `disease.rel_sus_cv` | "CV 1", "none" at 0 |
| | Susceptibility by age | `disease.rel_sus_age.*` | "children ×1, adults ×1, elderly ×1" |
| | Immunity waning | `disease.sis_waning` | "x per year" |
| | Immunity boost | `disease.sis_imm_boost` | `fmtValue` |
| | Initial infections | `disease.seed.*` | `seedText` |
| | Initially immune | `disease.initial_immune_frac` | fraction |
| Contact network | Contact network | `network.network_type` | `networkLabel` |
| | Contacts per day | `network.n_contacts` | `fmtValue` |
| | Contacts distribution | `network.contacts_dist` | "constant" or "Poisson" |
| | Contact duration | `network.contact_duration_days` | days, "a fresh contact every day" at 0 |
| | Network transmission multiplier | `network.network_beta` | "×1" |
| | Contact matrix | the nine `network.contacts.*` and `network.contacts_source` | `contactsSourceLabel`, with the 3 by 3 grid |
| | Household size | `network.household_size` | "x people" |
| | Layers | the three layer contact counts and the four `network.layer_beta.*` | "school 20, work 16, community 20 contacts a day", with the table |
| | School and working ages | the four age bounds | "school 6 to 22, work 22 to 65" |
| Demographics | Births and deaths | `use_demographics`, `birth_rate`, `death_rate` | as today |
| | Age structure | the three shares | as today, "Starsim's default ages" when unset |
| | Country | `demographics.country` | `countryName`, "not set" |
| | Fill demographics from the country | `demographics.auto_demographics` | "yes" or "no" |
| | Demographics year | `demographics.demographics_year` | the year |
| | Demographics source | `demographics.demographics_source` | the text, "none" |
| | Age source | `demographics.age_source` | `AGE_SOURCE_LABELS` |
| Run | Agents | `run.n_agents` | `commaInt` |
| | Duration | `run.sim_dur_years` | years |
| | Replicates | `run.n_replicates` | `fmtValue` |
| | Random seed | `run.rand_seed` | the seed, "a new one each run" when null |
| | Calibrate beta by measurement | `run.calibrate_r0` | "yes" or "no" |
| | Fitted to | `run.fit.target`, `run.fit.value`, `run.fit.lever` | as today, "not fitted" |

`shown`: derived rows are shown (Fitted to only when a fit is set); otherwise a row is shown when one of its covered paths has the tier `core` or holds a value that is not the registry default (`near`, with null equal to null; a path whose block is absent, like `disease.dur_exp.mean_days` on a scenario without one, holds null).

`source` (Task 2 fills it; here it is null without `sources`).

`defaultRows(p)` flattens the shown rows; `coveredPaths(p)` the covered paths of every row.

Export from `format.ts` what the module needs and does not have yet (`networkLabel`, `AGE_SOURCE_LABELS`, the age-structure text, `LEVER_LABELS`), and delete `parameterRows` there.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run tests/client && npm run typecheck`
Expected: PASS. Any existing test that read `parameterRows` now reads `defaultRows` or the groups.

- [ ] **Step 5: Commit**

```bash
git add web/lib/client web/tests/client
git commit -m "feat(web): the parameter rows are generated from the registry, in five groups"
```

---

### Task 2: Where each value came from

**Files:**
- Modify: `web/lib/tools/sources.ts` (`valueSources`: the illustrative coefficient), `web/lib/tools/types.ts` (`ConfigPayload`, `DataPayload`, `RunPayload` gain `sources?: Record<string, ParamSource>`), `web/lib/tools/configureSimulation.ts`, the three `fetch*.ts` tools, `web/lib/tools/runSimulation.ts`, `web/lib/client/artifacts.ts` (`Artifacts.sources`), `web/lib/client/parameters.ts` (the tag)
- Test: `web/tests/tools/configureSimulation.test.ts`, `web/tests/tools/fetchTools.test.ts`, `web/tests/tools/runSimulation.test.ts`, `web/tests/client/artifacts.test.ts`, `web/tests/client/parameters.test.ts`

**Interfaces:**
- Consumes: `valueSources(params, scenario, disease)`.
- Produces: every payload that carries the scenario's parameters also carries `sources`, computed from the scenario's own parameters (for a run: the configured ones, not the effective ones, so a calibrated beta or a fitted coefficient keeps the source of what was configured). `Artifacts.sources: Record<string, string> | null`, from the payload that gave `Artifacts.params`. `sourceTag(paths: string[], sources): SourceTag | null`: null without sources or when none of the paths has one; `you` when any path is `user`; else the first path's tag that is not `default`; else `default`. The mapping: `user` to `you`, `database` to `database`, `fetch` to `fetched`, `illustrative` to `assumption`, `default` to `default`. `valueSources` returns `illustrative` for `disease.rel_sus_cv` at the offered value (`ILLUSTRATIVE_CV = 1`).

- [ ] **Step 1: Write the failing tests**

`web/tests/client/parameters.test.ts`, appended:

```ts
describe("where each value came from (follow-up spec 8.4)", () => {
  const p = params({ schema_version: 2, disease: { dur_inf: { mean_days: 8, dist: "gamma", sd_days: 2.4 }, rel_sus_cv: 1 } });
  const rows = (sources?: Record<string, string> | null) => Object.fromEntries(parameterGroups(p, sources).flatMap((g) => g.rows).map((r) => [r.label, r.source]));

  it("tags a row by its paths' sources, in the user's words", () => {
    const tagged = rows({ "disease.dur_inf.mean_days": "database", "disease.dur_inf.dist": "illustrative", "disease.dur_inf.sd_days": "illustrative", "disease.beta": "user",
      "disease.rel_sus_cv": "illustrative", "run.n_agents": "default", "demographics.birth_rate": "fetch", "demographics.use_demographics": "fetch", "demographics.death_rate": "fetch" });
    expect(tagged["Infectious period"]).toBe("database");                                  // the mean's source leads; the spread is an assumption beside it
    expect(tagged["Transmission rate (β)"]).toBe("you");
    expect(tagged["Variation in susceptibility"]).toBe("assumption");
    expect(tagged["Agents"]).toBe("default");
    expect(tagged["Births and deaths"]).toBe("fetched");
    expect(tagged["R₀ (approx.)"]).toBeNull();                                             // derived: no source of its own
    expect(tagged["Duration"]).toBeNull();                                                 // no source was sent for it
  });

  it("is you as soon as the user set one of a row's values", () => {
    expect(rows({ "disease.dur_inf.mean_days": "database", "disease.dur_inf.sd_days": "user" })["Infectious period"]).toBe("you");
  });

  it("renders payloads stored before the sources, and ignores paths the registry no longer has", () => {
    expect(Object.values(rows(null)).every((tag) => tag === null)).toBe(true);
    expect(Object.values(rows(undefined)).every((tag) => tag === null)).toBe(true);
    expect(rows({ "disease.gone": "user", "disease.beta": "weird" })["Transmission rate (β)"]).toBeNull();
  });
});
```

`web/tests/tools/configureSimulation.test.ts`, appended:

```ts
describe("configure_simulation sends where each value came from (follow-up spec 8.4)", () => {
  it("carries sources beside the parameters", async () => {
    const deps = makeDeps();
    const out = await run(deps, { disease: "measles", n_agents: 5000, advanced: { "disease.rel_sus_cv": 1 } });
    const payload = out.payload as { sources?: Record<string, string>; params?: unknown };
    expect(payload.params).toBeDefined();
    expect(payload.sources).toMatchObject({ "run.n_agents": "user", "disease.dur_inf.mean_days": "database", "run.sim_dur_years": "default", "disease.rel_sus_cv": "illustrative" });
    const typed = await run(deps, { advanced: { "disease.rel_sus_cv": 0.7 } });
    expect((typed.payload as { sources: Record<string, string> }).sources["disease.rel_sus_cv"]).toBe("user");   // not the offered value: the user's own
  });
});
```

`web/tests/tools/runSimulation.test.ts`: one test that a run whose effective beta was calibrated away from the scenario's still carries `sources["disease.beta"]` as the scenario's (`database` when the R0 is the database's), and that the payload has `sources`. `web/tests/tools/fetchTools.test.ts`: one assertion per fetch tool that its payload has `sources` with the fetched path tagged `fetch`. `web/tests/client/artifacts.test.ts`: `deriveArtifacts` returns the `sources` of the payload that gave `params`, and null for a payload without them and after a new scenario.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npx vitest run tests/client/parameters.test.ts tests/client/artifacts.test.ts tests/tools`
Expected: FAIL (`source` is always null; the payloads have no `sources`).

- [ ] **Step 3: Implement**

- `sources.ts`: after the durations loop, `if (near(p.disease.rel_sus_cv, ILLUSTRATIVE_CV)) out["disease.rel_sus_cv"] = "illustrative";` with the constant exported and the comment "follow-up spec 4.5: the offered coefficient is an assumption, not a value the user knows".
- A helper in `sources.ts`, `scenarioSources(scenario, contextText)`, wraps `valueSources` with the disease the tools already resolve (`scenario.disease ?? detectDisease(contextText)`), returning `{}` without parameters. Each tool that builds a payload with `params` adds `sources: scenarioSources(...)`. `runSimulation` computes them from `scenario.params`.
- `artifacts.ts`: `sources` follows `params` wherever `params` is assigned (the payload's `sources ?? null`), and is reset where `params` is.
- `parameters.ts`: `sourceTag` as specified; `parameterGroups` fills `source`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run tests/client tests/tools tests/chat && npm run typecheck`
Expected: PASS. A test that pins a payload exactly gains the `sources` key; update the pin.

- [ ] **Step 5: Commit**

```bash
git add web/lib web/tests
git commit -m "feat(web): the payloads carry where each value came from"
```

---

### Task 3: The section, the runs panel and the share page

**Files:**
- Modify: `web/components/panel/ParametersSection.tsx`, `web/components/panel/DetailsPanel.tsx`, `web/components/SharedConversation.tsx`, `web/components/panel/RunsSection.tsx`
- Test: `web/tests/client/parametersRender.test.ts` (new, rendered to static markup as `tryNextRender.test.ts` does), `web/tests/app/workspace.test.ts` (the pins of the section's source)

**Interfaces:**
- Consumes: `parameterGroups`, `Artifacts.sources`.
- Produces: `ParametersSection({ params, sources, configured })`: a heading per group, the shown rows, a "Show all (N)" button per group that has hidden rows (a `<details>` element, so it works without script on the share page), the tag after the value in a muted style, a grid under a row that has one, and the Interventions group's lines. The runs panel's "Effective parameters" lists `defaultRows(run.effective_params)`.

- [ ] **Step 1: Write the failing test** (`web/tests/client/parametersRender.test.ts`)

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ParametersSection } from "@/components/panel/ParametersSection";
import { params } from "../tools/helpers";

const render = (props: Parameters<typeof ParametersSection>[0]) => renderToStaticMarkup(createElement(ParametersSection, props));

describe("the Parameters section as it renders (follow-up spec 8)", () => {
  it("groups the rows, tags them and keeps the rest behind Show all", () => {
    const p = params({ schema_version: 2, disease: { rel_sus_cv: 1 }, network: { network_type: "hybrid" }, interventions: [{ type: "seasonality", scale: 0.3 }] });
    const html = render({ params: p, sources: { "disease.rel_sus_cv": "illustrative", "run.n_agents": "default", "network.network_type": "user" }, configured: true });
    for (const heading of ["Disease", "Contact network", "Demographics", "Interventions", "Run"]) expect(html).toContain(`>${heading}</h4>`);
    expect(html).toContain("Variation in susceptibility");
    for (const tag of ["assumption", "default", "you"]) expect(html).toContain(`>${tag}</span>`);
    expect(html).toMatch(/Show all \(\d+\)/);
    expect(html).toContain("Seasonality: amplitude 0.3, shift 0");
    expect(html).toContain("<table");                                                      // the layers, inside Show all
    expect(html).toContain("Household transmissibility".split(" ")[0]);
  });

  it("renders without tags for a payload stored before them, and says so when nothing is set up", () => {
    const html = render({ params: params({}), sources: null, configured: true });
    expect(html).not.toContain(">default</span>");
    expect(html).toContain("R₀ (approx.)");
    expect(render({ params: null, sources: null, configured: false })).toContain("Parameters appear here once a scenario is set up.");
    expect(render({ params: null, sources: null, configured: true })).toContain("were not recorded");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run tests/client/parametersRender.test.ts`
Expected: FAIL (no groups, no tags).

- [ ] **Step 3: Implement**

`ParametersSection`: for each group, an `<h4>` with the title; a `<dl>` of the shown rows (label, value, the tag in `<span className="ml-1.5 rounded bg-paper-2 px-1.5 text-[0.6875rem] text-ink-faint">`), a row's grid as a small `<table>` under it; when the group has hidden rows, `<details><summary>Show all ({group.rows.length})</summary>` with the hidden rows in the same form; the Interventions group renders its lines (or "No interventions."). Keep the two empty-state sentences and the line "The values the next run uses; after a run, the values it used." `DetailsPanel` and `SharedConversation` pass `sources={artifacts.sources}`. `RunsSection`: `defaultRows(p.effective_params)` in place of `effectiveParameterRows`.

Update the pins in `web/tests/app/workspace.test.ts` that name `parameterRows(` to `parameterGroups(`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run tests/client tests/app && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components web/tests
git commit -m "feat(web): the Parameters section in groups, with sources and Show all"
```

---

### Task 4: `describe_parameters` by network

**Files:**
- Modify: `web/lib/sim/registry.ts` (`applicableSpecs(model, network?)`), `web/lib/tools/describeParameters.ts`, `web/lib/tools/index.ts` (the tool's description)
- Test: `web/tests/tools/describeParameters.test.ts`

**Interfaces:**
- Produces: `applicableSpecs(model: string, network?: string)` filters by the network when one is given. `describe_parameters` lists the parameters of the scenario's model and network (the random network without a scenario); with `module: "interventions"` it lists the `interventions[]` fields (label, description, unit, bounds, choices, tier; `current` and `source` null), which no listing gave before; the note names the six intervention types and the `interventions` field.

- [ ] **Step 1: Write the failing tests** (`web/tests/tools/describeParameters.test.ts`, appended)

```ts
describe("describe_parameters by network (follow-up spec 8.5)", () => {
  const listed = async (deps: ReturnType<typeof makeDeps>, input: Record<string, unknown> = {}) =>
    (JSON.parse((await describeParameters(input as never, deps)).content) as { note: string; parameters: { path: string; current: unknown }[] });

  it("lists the parameters of the scenario's network only", async () => {
    const deps = makeDeps();
    await configureSimulation({ disease: "measles" } as never, deps);
    const random = (await listed(deps)).parameters.map((p) => p.path);
    expect(random).toContain("network.n_contacts");
    for (const path of ["network.household_size", "network.layer_beta.school", "network.contacts.children_children"]) expect(random).not.toContain(path);
    await configureSimulation({ network_type: "hybrid" } as never, deps);
    const hybrid = (await listed(deps)).parameters.map((p) => p.path);
    for (const path of ["network.household_size", "network.layer_beta.school", "network.network_beta"]) expect(hybrid).toContain(path);
    for (const path of ["network.n_contacts", "network.contacts.children_children"]) expect(hybrid).not.toContain(path);
  });

  it("lists the intervention fields when asked for that module, and names the six types", async () => {
    const deps = makeDeps();
    await configureSimulation({ disease: "measles" } as never, deps);
    const out = await listed(deps, { module: "interventions" });
    const paths = out.parameters.map((p) => p.path);
    for (const path of ["interventions[].type", "interventions[].half_prevalence", "interventions[].memory_days", "interventions[].layer"]) expect(paths).toContain(path);
    expect(out.parameters.every((p) => p.current === null)).toBe(true);
    for (const type of ["vaccine", "treatment", "seasonality", "contact_reduction", "transmission_reduction", "behavior_response"]) expect(out.note).toContain(type);
    expect(out.note).toContain("interventions field");
    expect((await listed(deps)).parameters.map((p) => p.path).some((path) => path.startsWith("interventions[]"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npx vitest run tests/tools/describeParameters.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as the interface block says. `INTERVENTIONS_NOTE` becomes "Interventions (vaccine, treatment, seasonality, contact_reduction, transmission_reduction, behavior_response) are entries of configure_simulation's interventions field and are listed in its config; call describe_parameters with module interventions for their fields."

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run tests/tools tests/chat && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib web/tests
git commit -m "feat(web): describe_parameters lists by network, and the intervention fields on request"
```

---

### Task 5: The report's appendix

**Files:**
- Modify: `web/lib/report/compose.ts`, `web/lib/client/format.ts` (remove `EFFECTIVE_PARAM_PATHS`, `effectiveParameterRows`, `effectiveParameterLabel`), `web/lib/client/parameters.ts` (`parameterTable`)
- Test: `web/tests/report/compose.test.ts`, `web/tests/client/parameters.test.ts`, `web/tests/client/format.test.ts` (the "effective parameter rows" tests go)

**Interfaces:**
- Produces: `parameterTable(runs: SimParams[]): { label: string; values: (string | null)[] }[]`: the shown rows of each run in group order, united by label in first-seen order within the group order; null where a row is not shown for a run. The appendix's "Effective parameters" table uses it, with a dash for null.

- [ ] **Step 1: Write the failing tests**

`web/tests/client/parameters.test.ts`, appended:

```ts
describe("the same rows in the report (follow-up spec 8.5)", () => {
  it("unites the runs' rows in group order and leaves a gap where a row does not apply", () => {
    const first = params({ schema_version: 2, disease: { rel_sus_cv: 1 } });
    const second = params({ schema_version: 2, network: { network_type: "hybrid", household_size: 4.9 } });
    const table = parameterTable([first, second]);
    const row = (label: string) => table.find((r) => r.label === label)?.values;
    expect(row("Variation in susceptibility")).toEqual(["CV 1", null]);
    expect(row("Contacts per day")).toEqual(["4", null]);
    expect(row("Household size")).toEqual([null, "4.9 people"]);
    expect(row("Contact network")).toEqual(["random", "hybrid (households, schools, workplaces, community)"]);
    expect(row("Agents")).toEqual(["10,000", "10,000"]);
    const labels = table.map((r) => r.label);
    expect(labels.indexOf("Variation in susceptibility")).toBeLessThan(labels.indexOf("Contact network"));
    expect(labels.indexOf("Household size")).toBeLessThan(labels.indexOf("Agents"));
    expect(labels).not.toContain("Contact matrix");                                          // not on either run's network
    expect(new Set(labels).size).toBe(labels.length);
  });
});
```

`web/tests/report/compose.test.ts`: the appendix's "Effective parameters" table of a report with a random run and a run with variation has the rows "Variation in susceptibility" (`["—", "CV 1"]`) and no "Household size", "Contact duration" or "Contact matrix"; the first column is "Parameter".

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npx vitest run tests/client/parameters.test.ts tests/report`
Expected: FAIL.

- [ ] **Step 3: Implement**, then delete the three exports from `format.ts` and their tests.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run && npm run typecheck && npm run lint`
Expected: PASS (`tests/db/schema.test.ts` may time out in a full run on this machine and passes alone).

- [ ] **Step 5: Commit**

```bash
git add web/lib web/tests
git commit -m "feat(web): the report's appendix lists the same parameter rows"
```

---

### Task 6: Documents

**Files:**
- Modify: `README.md` (the web agent section), `docs/superpowers/specs/2026-10-13-limits-suggestions-parameters-design.md` (status, "as shipped" in section 8)
- Test: `tests/test_readme.py`

- [ ] **Step 1: Write the failing test** (`tests/test_readme.py`, appended)

```python
def test_the_readme_describes_the_parameters_section():
    web = README.split("## Web agent: parameters")[1].split("## Input Types")[0]
    for phrase in ("Parameters section", "Show all", "web/lib/client/parameters.ts", "where each value came from"):
        assert phrase in web, phrase
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python -m pytest tests/test_readme.py -q -p no:cacheprovider`
Expected: FAIL.

- [ ] **Step 3: Write** the README bullet (what the section shows, the coverage test, the tags, `describe_parameters` by network, the appendix) and the spec's "as shipped" notes for anything ruled during the tasks.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `python -m pytest tests/test_readme.py tests/test_review_requests.py tests/test_web_exports.py -q -p no:cacheprovider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md docs tests
git commit -m "docs: the Parameters section as shipped"
```

---

## Self-review notes

- Spec 8.1 and 8.3: Task 1 (rows, groups, the coverage test) and Task 3 (the section). 8.2: shipped in phase A (the registry's `networks`); Task 1 reads it. 8.4: Task 2. 8.5: Tasks 4 and 5.
- The Review Focus lines are pinned by: the coverage test over `PARAM_REGISTRY` (Task 1); the same test's eighteen scenarios and the grid test (Task 1); "renders payloads stored before the sources" and the render test without tags (Tasks 2 and 3); the run-payload test of a calibrated beta (Task 2); the `parameterTable` test (Task 5).
- Deferred minors of earlier phases that this plan closes: the report shows the coefficient of variation and the fit's lever and value (the rows "Variation in susceptibility" and "Fitted to"); `describe_parameters` names every intervention type and can list `half_prevalence` and `memory_days`; an offered coefficient reads as an assumption, not as the user's.
