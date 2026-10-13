# Limits on Spread (Follow-up Phase A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the simulation two ways to end an epidemic short of the final-size equation without a dated intervention: variation between people in susceptibility, and a behaviour response that lowers transmission as infections rise and relaxes as they fall; and let a run be fitted with either while R0 stays where it was set.

**Architecture:** `disease.rel_sus_cv` adds a per-agent gamma multiplier (mean 1) to the disease's own susceptibility composition; R0's formula does not change, the pilot covers the saturation of very susceptible agents on the random network, and the diagnostics use the closed-form final size. `behavior_response` is a new entry type of the interventions list, implemented as one more factor of the `TransmissionModifiers` connector. `epichat/sim/fit.py` learns two levers that fall as they rise. The registry (version 5) also gains `networks` on every parameter, which phase C reads. The web mirrors the schema (parity fixture 6), shows the entry and the variation in the panel, and the prompt gains "Limits on spread".

**Tech Stack:** Python 3.12, Starsim 3.7.2 (`ss.gamma` as a state default, the connector), scipy (`scipy.special.gammainc`, already a dependency of Starsim), pydantic v2; Next.js with zod and vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-limits-suggestions-parameters-design.md`, sections 4, 5, 6, 10, 12 (the "Limits on spread" section), 13 and 14 (phase A). It stands on `docs/superpowers/plans/2026-10-13-pilot-measured-r0.md`, merged first: the pilot is a first-generation experiment that returns `{target, measured, se, corrections, reached}`.

## Global Constraints

- Starsim stays pinned at 3.7.2; no requirement file changes; no new npm dependency (`npm --prefix web ci` only); no database migration (`schema_version` stays 2; every new leaf has a default).
- The registry export's `version` becomes 5; the parity fixture's `version` 6; `tests/test_web_exports.py`, `tests/test_param_registry.py`, `web/tests/sim/registry.test.ts` and `web/tests/sim/parity.test.ts` pin them.
- `epichat/schema.py`'s `Intervention` is shared with the frozen Python agent: new fields are optional with defaults; the new type is additive; nothing existing is renamed.
- With `rel_sus_cv` 0 and no behaviour-response entry a run is bit-identical to today's: no state is drawn, the connector's factor is unchanged, the stats gain no key. `tests/test_sim_parity.py` (captured on Starsim 3.3.2, never re-captured) is the proof.
- `approx_r0`, `calibrate_beta`, `with_r0` and their TypeScript mirrors do not change.
- Interpreters: the root `.venv/Scripts/python.exe` for `tests/` from the worktree root; the main checkout's `sim/.venv/Scripts/python.exe` for `sim/tests`; `npx vitest run` from `web/`. Run the Python suites one at a time: the machine is short of memory when two run together.
- After `scripts/export_web_data.py` or `scripts/export_parity_fixtures.py`, restore every file whose only change is its line endings (`git checkout --` after comparing with carriage returns removed).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UL6ToyEthpP1X8yxArZE6g`. Never print a secret.

## Review Focus

1. **A stored scenario, and any scenario with neither mechanism.** It validates with the new defaults and runs exactly as before. Pinned by Task 1's defaults test, Task 3's `test_without_variation_nothing_is_drawn` and the parity suite.
2. **A population that grows.** Agents born during a run need a multiplier too, and it must come from the same distribution. Pinned in Task 3 (`test_newborns_get_a_multiplier`).
3. **A behaviour response when nobody is infectious, or with delayed seeding.** The factor is exactly 1 and nothing divides by zero; with everyone dead the factor is 1. Pinned in Task 4.
4. **A fit on a lever that cannot reach the target** (an attack rate above what no variation gives, or a response that cannot push it low enough): the search ends at the lever's bound within eight runs and reports what it reached. Pinned in Task 5.
5. **A fit lever that needs an entry the scenario lacks, or a target the lever cannot move** (`behavior_response.scale` without the entry; `peak_day` with either new lever): the validator refuses with a message that names what to do, in both languages. Pinned in Tasks 1 and 2.

---

## File Structure

- Modify `epichat/schema.py`, `epichat/params/registry.py`, `epichat/params/schema_v2.py`; regenerate `web/data/param_registry.json` and `web/tests/fixtures/parity.json`.
- Modify `web/lib/sim/registry.ts`, `web/lib/sim/params.ts`, `scripts/export_parity_fixtures.py`.
- Modify `epichat/sim/models.py`, `epichat/sim/builder.py`, `epichat/sim/calibrate.py`, `epichat/sim/diagnostics.py`.
- Modify `epichat/sim/connectors.py`, `epichat/sim/outputs.py`.
- Modify `epichat/sim/fit.py`, `epichat/sim/replicates.py`.
- Modify `web/lib/sim/client.ts`, `web/lib/tools/runSimulation.ts`, `web/lib/tools/index.ts`, `web/lib/client/format.ts`, `web/lib/report/compose.ts`, `web/lib/chat/prompt.ts`.
- Modify `README.md`, the follow-up spec (as shipped).
- Tests: `tests/test_schema_v2.py`, `tests/test_param_registry.py`, `tests/test_web_exports.py`, `tests/test_sim_variation.py` (new), `tests/test_sim_behavior.py` (new), `tests/test_sim_fit.py`, `tests/test_sim_calibrate.py`, `tests/test_sim_diagnostics.py`; `web/tests/sim/{params,parity,registry}.test.ts`, `web/tests/tools/{configureSimulation,runSimulation}.test.ts`, `web/tests/client/format.test.ts`, `web/tests/report/compose.test.ts`, `web/tests/chat/prompt.test.ts`.

---

### Task 1: The schema and the registry

**Files:**
- Modify: `epichat/schema.py` (`Intervention`), `epichat/params/registry.py`, `epichat/params/schema_v2.py` (`DiseaseParams`, `Fit`, `SimParamsV2`'s cross-field validator), `README.md` (the Interventions section: the type list and a subsection)
- Regenerate: `web/data/param_registry.json`, `web/tests/fixtures/parity.json` (its version stays 5 in this task)
- Test: `tests/test_schema_v2.py`, `tests/test_param_registry.py`, `tests/test_web_exports.py`

**Interfaces:**
- Produces: `Intervention.type` gains `"behavior_response"` (aliases `behaviour_response`, `behavior`, `behaviour`, `behavior_change`, `behaviour_change`, `awareness`); fields `half_prevalence: float = 0.01` (0.0001 to 0.5) and `memory_days: int = 7` (1 to 90); `DiseaseParams.rel_sus_cv: float = 0.0` (0 to 2); `Fit.lever` gains `"disease.rel_sus_cv"` and `"behavior_response.scale"`; registry leaves `disease.rel_sus_cv`, `interventions[].half_prevalence`, `interventions[].memory_days`; `ParamSpec.networks: tuple[str, ...]` with `applies_on(network)`; `export()["version"] == 5` and `"networks"` in every exported parameter.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_schema_v2.py` (it has the helper `v2(**kw)` and imports `pytest`, `ValidationError`):

```python
def test_the_variation_and_the_behaviour_response_have_defaults_bounds_and_aliases():
    assert v2().disease.rel_sus_cv == 0.0 and v2(disease={"rel_sus_cv": 1.0}).disease.rel_sus_cv == 1.0
    with pytest.raises(ValidationError):
        v2(disease={"rel_sus_cv": 2.5})
    e = v2(interventions=[{"type": "behaviour_response", "scale": 0.5}]).interventions[0]
    assert (e.type, e.scale, e.half_prevalence, e.memory_days, e.start_day, e.end_day, e.layer) == ("behavior_response", 0.5, 0.01, 7, 0, None, "all")
    for alias in ("behavior", "behaviour", "behavior_change", "behaviour_change", "awareness"):
        assert v2(interventions=[{"type": alias}]).interventions[0].type == "behavior_response"
    for bad in ({"half_prevalence": 0.0}, {"half_prevalence": 0.6}, {"memory_days": 0}, {"memory_days": 91}):
        with pytest.raises(ValidationError):
            v2(interventions=[{"type": "behavior_response", **bad}])
    with pytest.raises(ValidationError, match="layer"):
        v2(network={"network_type": "hybrid"}, interventions=[{"type": "behavior_response", "layer": "school"}])
    with pytest.raises(ValidationError, match="one behavior_response"):
        v2(interventions=[{"type": "behavior_response"}, {"type": "behavior_response", "scale": 0.4}])


def test_the_fit_takes_the_two_new_levers_with_their_rules():
    assert v2(disease={"rel_sus_cv": 0.5}, run={"fit": {"target": "attack_rate", "value": 0.5, "lever": "disease.rel_sus_cv"}}).run.fit.lever == "disease.rel_sus_cv"
    ok = v2(interventions=[{"type": "behavior_response", "scale": 0.5}], run={"fit": {"target": "peak_infections", "value": 300, "lever": "behavior_response.scale"}})
    assert ok.run.fit.lever == "behavior_response.scale"
    with pytest.raises(ValidationError, match="needs a behavior_response entry"):
        v2(run={"fit": {"target": "attack_rate", "value": 0.5, "lever": "behavior_response.scale"}})
    for lever in ("disease.rel_sus_cv", "behavior_response.scale"):
        with pytest.raises(ValidationError, match="peak_day"):
            v2(interventions=[{"type": "behavior_response"}], run={"fit": {"target": "peak_day", "value": 40, "lever": lever}})
```

Append to `tests/test_param_registry.py` (it imports the registry as `reg`):

```python
def test_registry_version_5_carries_the_limits_on_spread_and_where_each_parameter_applies():
    out = reg.export()
    assert out["version"] == 5
    by = {p["path"]: p for p in out["params"]}
    cv = by["disease.rel_sus_cv"]
    assert (cv["default"], cv["bounds"], cv["tier"], cv["models"]) == (0.0, [0.0, 2.0], "advanced", [])
    assert by["interventions[].half_prevalence"]["bounds"] == [0.0001, 0.5] and by["interventions[].half_prevalence"]["default"] == 0.01
    assert by["interventions[].memory_days"]["bounds"] == [1, 90] and by["interventions[].memory_days"]["default"] == 7
    assert "behavior_response" in by["interventions[].type"]["choices"]
    assert by["run.fit.lever"]["choices"] == ["disease.beta", "network.network_beta", "disease.rel_sus_cv", "behavior_response.scale"]
    assert all("networks" in p for p in out["params"])
    assert by["network.n_contacts"]["networks"] == ["random"] and by["network.contacts_dist"]["networks"] == ["random"]
    assert by["network.contact_duration_days"]["networks"] == ["random"]
    assert by["network.contacts.children_adults"]["networks"] == ["age_structured"] and by["network.contacts_source"]["networks"] == ["age_structured"]
    for path in ("network.household_size", "network.school_contacts", "network.work_contacts", "network.community_contacts",
                 "network.layer_beta.household", "network.layer_beta.work", "network.school_age_min", "network.work_age_max"):
        assert by[path]["networks"] == ["hybrid"], path
    for path in ("network.network_beta", "network.network_type", "disease.beta", "run.n_agents"):
        assert by[path]["networks"] == [], path
    assert reg.spec_for("network.household_size").applies_on("hybrid") and not reg.spec_for("network.household_size").applies_on("random")
    assert reg.spec_for("disease.beta").applies_on("random")
    assert {n for p in out["params"] for n in p["networks"]} <= {"random", "age_structured", "hybrid"}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_schema_v2.py tests/test_param_registry.py -q -p no:cacheprovider`
Expected: FAIL (`rel_sus_cv` unknown to the model; version 4).

- [ ] **Step 3: Implement**

`epichat/schema.py`, `Intervention`: the `type` Literal gains `"behavior_response"`; after `layer` add

```python
    # behaviour response (follow-up spec, 5.1): scale is the largest reduction
    half_prevalence: float = Field(default=0.01, ge=0.0001, le=0.5)
    memory_days: int = Field(default=7, ge=1, le=90)
```

`check_window_and_ages` gains `if self.type == "behavior_response" and self.layer != "all": raise ValueError("interventions[].layer must be all for a behavior_response")`; `normalize_type`'s map gains the six aliases, each to `"behavior_response"`.

`epichat/params/registry.py`:
- `ParamSpec` gains `networks: tuple[str, ...] = field(default=())` after `requires`, `as_dict` gains `"networks": list(self.networks)`, and

```python
    def applies_on(self, network: str) -> bool:
        return not self.networks or network in self.networks
```

- After the three `disease.rel_sus_age.*` entries add

```python
    ParamSpec("disease.rel_sus_cv", "disease", "Variation in susceptibility",
              "Coefficient of variation of susceptibility between people: each agent gets a personal multiplier drawn once from a gamma "
              "distribution with mean 1. The most susceptible are infected first, so the epidemic ends smaller at the same R0 (0 means "
              "everyone is alike; 1 takes R0 2.5 from 89% to 60% infected). An illustrative assumption unless the database carries it.",
              "number", "coefficient of variation", 0.0, (0.0, 2.0), None, (), "advanced", None,
              "the per-agent state rel_sus_ind, a factor of the disease's rel_sus composition", ("final_size", "peak")),
```

- `interventions[].type`: the choices gain `"behavior_response"`, and the description gains "behavior_response (transmission falls as the share infectious rises and recovers as it falls: people being careful, not a measure)". `interventions[].scale`'s description gains "behavior_response: the largest reduction". After `interventions[].symptomatic_only` add

```python
    ParamSpec("interventions[].half_prevalence", "interventions", "Half-point of the response", "behavior_response: the share of people "
              "infectious at which half of the largest reduction applies.", "number", "fraction", 0.01, (0.0001, 0.5), None, (), "advanced",
              None, "TransmissionModifiers", ("peak", "final_size", "timing")),
    ParamSpec("interventions[].memory_days", "interventions", "Memory of the response", "behavior_response: the number of days over which "
              "the share infectious is averaged.", "integer", "days", 7, (1, 90), None, (), "advanced", None, "TransmissionModifiers",
              ("peak", "timing")),
```

- `run.fit.lever`: choices `("disease.beta", "network.network_beta", "disease.rel_sus_cv", "behavior_response.scale")`; description "The parameter the fit moves within its bounds: disease.beta or network.network_beta (the outcome rises with them), or disease.rel_sus_cv or the behaviour response's scale (the attack rate and the peak fall as they rise; R0 stays)."
- After `REGISTRY = (...)` is built, set where each network parameter applies:

```python
_NETWORKS = {
    **{p: ("random",) for p in ("network.n_contacts", "network.contacts_dist", "network.contact_duration_days")},
    **{f"network.contacts.{a}_{b}": ("age_structured",) for a in CONTACT_GROUPS for b in CONTACT_GROUPS},
    "network.contacts_source": ("age_structured",),
    **{p: ("hybrid",) for p in ("network.household_size", "network.school_contacts", "network.work_contacts", "network.community_contacts",
                                "network.layer_beta.household", "network.layer_beta.school", "network.layer_beta.work",
                                "network.layer_beta.community", "network.school_age_min", "network.school_age_max",
                                "network.work_age_min", "network.work_age_max")},
}
REGISTRY = tuple(replace(s, networks=_NETWORKS.get(s.path, ())) for s in REGISTRY)
```

(`from dataclasses import dataclass, field, replace`; if `REGISTRY` is built as a list, keep its type.) A unit assertion right below it, `assert set(_NETWORKS) <= {s.path for s in REGISTRY}`, catches a renamed path at import.
- `export()` returns version 5.

`epichat/params/schema_v2.py`:
- `DiseaseParams` gains `rel_sus_cv: float = _field("disease.rel_sus_cv")` after `rel_sus_age`.
- `Fit.lever: Literal["disease.beta", "network.network_beta", "disease.rel_sus_cv", "behavior_response.scale"] = "disease.beta"`; `check_value` gains

```python
        if self.target == "peak_day" and self.lever not in ("disease.beta", "network.network_beta"):
            raise ValueError("run.fit.target peak_day can be fitted with disease.beta or network.network_beta, not with " + self.lever)
```

- `SimParamsV2.check_cross_fields` gains

```python
        responses = [i for i in self.interventions if i.type == "behavior_response"]
        if len(responses) > 1:
            raise ValueError("interventions may hold one behavior_response entry")
        if self.run.fit is not None and self.run.fit.lever == "behavior_response.scale" and not responses:
            raise ValueError("run.fit.lever behavior_response.scale needs a behavior_response entry in interventions")
```

`README.md`, the Interventions section: the intro becomes "Six intervention types can be combined in a single simulation (`vaccine`, `treatment`, `seasonality`, `contact_reduction`, `transmission_reduction`, `behavior_response`): the CLI and the templates know the first three; the web agent takes all six, with the schema v2 fields marked below." and, before the sentence "Every effect size above is an illustrative assumption", add

```
### Behaviour response (schema v2)

Transmission falls as the share of people infectious rises, and recovers as it
falls: people being careful, not a measure: `type: behavior_response`.

| Field | Type | Description |
|-------|------|-------------|
| `scale` | float (0–1) | The largest reduction in transmission |
| `half_prevalence` | float | The share infectious at which half of `scale` applies (default 0.01) |
| `memory_days` | integer | Days over which the share infectious is averaged (default 7) |
| `start_day`, `end_day` | integer | The window (`end_day` null = the run's end) |

    factor = 1 − scale × P / (half_prevalence + P)      P = the recent share infectious

- *"People become careful as cases rise"* → `{type: behavior_response, scale: 0.5}`

It flattens the peak and removes the overshoot; because it relaxes as cases
fall it cannot take the total below the herd immunity threshold `1 − 1/R0`.
```

Then regenerate: `.venv/Scripts/python.exe scripts/export_web_data.py` and `.venv/Scripts/python.exe scripts/export_parity_fixtures.py` (the fixture's version stays 5 here; its dumped inputs gain the new defaults, and a stale fixture makes `tests/test_web_exports.py` spend minutes diffing). Restore the files that changed only in line endings.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_schema_v2.py tests/test_param_registry.py tests/test_param_migrate.py tests/test_web_exports.py tests/test_readme.py tests/test_review_requests.py tests/test_sim_parity.py -q -p no:cacheprovider`
Expected: all pass after the pins that move with the registry are updated (the three `version == 4` pins, any test that lists the disease block's dump or the full set of leaves): each such move is a ledger line. The web suite is red until Task 2 (the registry version and the unknown leaves), as it was at this point in 2B and 2C.

- [ ] **Step 5: Commit**

```bash
git add epichat/schema.py epichat/params/registry.py epichat/params/schema_v2.py README.md web/data/param_registry.json web/tests/fixtures/parity.json tests/
git commit -m "feat(params): registry v5 with the variation in susceptibility, the behaviour response, two fit levers and where each parameter applies"
```

---

### Task 2: The TypeScript mirror and parity fixture 6

**Files:**
- Modify: `web/lib/sim/registry.ts`, `web/lib/sim/params.ts`, `scripts/export_parity_fixtures.py`; regenerate `web/tests/fixtures/parity.json`
- Test: `web/tests/sim/params.test.ts`, `web/tests/sim/registry.test.ts`, `web/tests/sim/parity.test.ts`, `tests/test_web_exports.py`

**Interfaces:**
- Consumes: Task 1's registry export.
- Produces: `ParamSpec.networks: string[]`, `appliesOn(spec, network)`; `INTERVENTION_TYPES` with `"behavior_response"`; `InterventionSchema` fields `half_prevalence`, `memory_days`; `DiseaseSchema.rel_sus_cv`; `FIT_LEVERS` with the two new levers; the same four validation messages as Python.

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/sim/params.test.ts` (it has the helper `must` and imports `validateParams`):

```ts
describe("the limits on spread in the schema (follow-up spec, 4 to 6)", () => {
  it("fills the variation and the behaviour response and keeps their rules", () => {
    expect(must({ schema_version: 2 }).disease.rel_sus_cv).toBe(0);
    expect(must({ schema_version: 2, disease: { rel_sus_cv: 1 } }).disease.rel_sus_cv).toBe(1);
    expect(validateParams({ schema_version: 2, disease: { rel_sus_cv: 2.5 } }).ok).toBe(false);
    const p = must({ schema_version: 2, interventions: [{ type: "behaviour_response", scale: 0.5 }] });
    expect(p.interventions[0]).toMatchObject({ type: "behavior_response", scale: 0.5, half_prevalence: 0.01, memory_days: 7, start_day: 0, end_day: null, layer: "all" });
    for (const alias of ["behavior", "behaviour", "behavior_change", "behaviour_change", "awareness"]) expect(must({ schema_version: 2, interventions: [{ type: alias }] }).interventions[0].type).toBe("behavior_response");
    for (const bad of [{ half_prevalence: 0 }, { half_prevalence: 0.6 }, { memory_days: 0 }, { memory_days: 91 }]) expect(validateParams({ schema_version: 2, interventions: [{ type: "behavior_response", ...bad }] }).ok).toBe(false);
    expect(validateParams({ schema_version: 2, network: { network_type: "hybrid" }, interventions: [{ type: "behavior_response", layer: "school" }] })).toEqual({ ok: false, error: expect.stringContaining("layer must be all for a behavior_response") });
    expect(validateParams({ schema_version: 2, interventions: [{ type: "behavior_response" }, { type: "behavior_response", scale: 0.4 }] })).toEqual({ ok: false, error: expect.stringContaining("one behavior_response entry") });
  });

  it("takes the two new fit levers with their rules", () => {
    expect(must({ schema_version: 2, disease: { rel_sus_cv: 0.5 }, run: { fit: { target: "attack_rate", value: 0.5, lever: "disease.rel_sus_cv" } } }).run.fit).toEqual({ target: "attack_rate", value: 0.5, lever: "disease.rel_sus_cv" });
    expect(must({ schema_version: 2, interventions: [{ type: "behavior_response", scale: 0.5 }], run: { fit: { target: "peak_infections", value: 300, lever: "behavior_response.scale" } } }).run.fit?.lever).toBe("behavior_response.scale");
    expect(validateParams({ schema_version: 2, run: { fit: { target: "attack_rate", value: 0.5, lever: "behavior_response.scale" } } })).toEqual({ ok: false, error: expect.stringContaining("needs a behavior_response entry") });
    for (const lever of ["disease.rel_sus_cv", "behavior_response.scale"]) {
      expect(validateParams({ schema_version: 2, interventions: [{ type: "behavior_response" }], run: { fit: { target: "peak_day", value: 40, lever } } })).toEqual({ ok: false, error: expect.stringContaining("peak_day can be fitted with disease.beta or network.network_beta") });
    }
  });
});
```

In `web/tests/sim/registry.test.ts` change the version pin to 5 and add

```ts
  it("says on which network each parameter applies", () => {
    expect(specFor("network.household_size")?.networks).toEqual(["hybrid"]);
    expect(specFor("network.n_contacts")?.networks).toEqual(["random"]);
    expect(specFor("network.contacts.children_adults")?.networks).toEqual(["age_structured"]);
    expect(specFor("disease.beta")?.networks).toEqual([]);
    expect(appliesOn(specFor("network.household_size")!, "hybrid")).toBe(true);
    expect(appliesOn(specFor("network.household_size")!, "random")).toBe(false);
    expect(appliesOn(specFor("disease.beta")!, "random")).toBe(true);
    expect(PARAM_REGISTRY.every((s) => Array.isArray(s.networks))).toBe(true);
  });
```

In `web/tests/sim/parity.test.ts` change the fixture version pin to 6; in `tests/test_web_exports.py` the parity version pin to 6.

- [ ] **Step 2: Run them and watch them fail** — `npx vitest run tests/sim` from `web/`.

- [ ] **Step 3: Implement**

`web/lib/sim/registry.ts`: `ParamSpec` gains `networks: string[];` and

```ts
export function appliesOn(spec: ParamSpec, network: string): boolean {
  return spec.networks.length === 0 || spec.networks.includes(network);
}
```

`web/lib/sim/params.ts`:
- `INTERVENTION_TYPES` gains `"behavior_response"`; `TYPE_ALIASES` gains the six aliases; `FIT_LEVERS = ["disease.beta", "network.network_beta", "disease.rel_sus_cv", "behavior_response.scale"] as const`; `export const BETA_LEVERS: readonly string[] = ["disease.beta", "network.network_beta"];`
- `InterventionSchema`'s object gains `half_prevalence: z.number().min(0.0001).max(0.5).default(0.01)` and `memory_days: z.number().int().min(1).max(90).default(7)`; its `superRefine` gains `if (i.type === "behavior_response" && i.layer !== "all") issue(ctx, "interventions[].layer must be all for a behavior_response");`
- `FitSchema`'s `superRefine` gains `if (f.target === "peak_day" && !BETA_LEVERS.includes(f.lever)) issue(ctx, \`run.fit.target peak_day can be fitted with disease.beta or network.network_beta, not with ${f.lever}\`);`
- `DiseaseSchema` gains `rel_sus_cv: withDefault("disease.rel_sus_cv"),` after `rel_sus_age`.
- `SimParamsSchema`'s `superRefine` gains

```ts
    const responses = p.interventions.filter((i) => i.type === "behavior_response");
    if (responses.length > 1) issue(ctx, "interventions may hold one behavior_response entry");
    if (p.run.fit && p.run.fit.lever === "behavior_response.scale" && responses.length === 0) issue(ctx, "run.fit.lever behavior_response.scale needs a behavior_response entry in interventions");
```

`scripts/export_parity_fixtures.py`: the version becomes 6; the disease draw gains `"rel_sus_cv": rng.choice([0.0, 0.0, 0.0, 0.5, 1.0])`; the intervention kinds gain `"behavior_response"` with `{"type": "behavior_response", "scale": round(rng.uniform(0.1, 0.9), 2), "half_prevalence": rng.choice([0.01, 0.005, 0.05]), "memory_days": rng.choice([7, 14])}`, at most one per case; where the generator draws a fit, the lever is drawn from the four, keeping only valid combinations (the generator already retries a case the schema refuses). Then regenerate and restore the line-ending-only changes.

- [ ] **Step 4: Run the suites** — `npx vitest run && npm run typecheck && npm run lint` from `web/`, and `.venv/Scripts/python.exe -m pytest tests/test_web_exports.py -q -p no:cacheprovider`. Expected: all pass after the pins that list whole shapes (the default-filled object gains `rel_sus_cv: 0`; any pinned leaf count or tool-registry list) are updated, each a ledger line.

- [ ] **Step 5: Commit**

```bash
git add web/lib/sim/registry.ts web/lib/sim/params.ts scripts/export_parity_fixtures.py web/tests/fixtures/parity.json web/tests tests/test_web_exports.py
git commit -m "feat(web): the schema mirror of the limits on spread; parity fixture 6"
```

---

### Task 3: Variation between people in the simulation

**Files:**
- Modify: `epichat/sim/models.py` (`EpiChatDisease`), `epichat/sim/builder.py` (`disease_kwargs`), `epichat/sim/calibrate.py` (`saturation_loss`, `needs_calibration`), `epichat/sim/diagnostics.py` (`final_size`, `_final_size_gap`, `_Run.r0`)
- Test: `tests/test_sim_variation.py` (new), `tests/test_sim_calibrate.py`, `tests/test_sim_diagnostics.py`

**Interfaces:**
- Consumes: `DiseaseParams.rel_sus_cv` (Task 1); the pilot of the plan this one stands on.
- Produces: the disease state `rel_sus_ind`; `EpiChatDisease(..., rel_sus_cv=...)`; `calibrate.saturation_loss(p) -> float`, `calibrate.gamma_loss(q, cv) -> float`, `SATURATION_LOSS = 0.02`; `diagnostics.final_size(r, cv=0.0)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_sim_variation.py`:

```python
"""Follow-up spec, section 4: a per-agent gamma multiplier on susceptibility, mean 1."""
import numpy as np
import pytest

from epichat.params.r0 import with_r0
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim import calibrate
from epichat.sim.builder import build_sim
from epichat.sim.diagnostics import final_size
from epichat.sim.outputs import extract

G10 = {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}


def scenario(cv: float, target: float = 2.5, n: int = 20000, years: float = 1.0, seeds: int = 100, **over) -> SimParamsV2:
    body = {"disease": {"dur_inf": G10, "p_death": 0.0, "rel_sus_cv": cv, "seed": {"mode": "count", "value": seeds}},
            "run": {"n_agents": n, "sim_dur_years": years, "rand_seed": 1}}
    for key, value in over.items():
        body.setdefault(key, {}).update(value)
    return with_r0(SimParamsV2.model_validate(body), target)


def test_each_agent_gets_a_multiplier_with_mean_one_and_the_configured_variation():
    for cv in (0.5, 1.0, 2.0):
        x = np.asarray(build_sim(scenario(cv, n=50000)).diseases[0].rel_sus_ind)
        assert abs(x.mean() - 1.0) < 0.03 and abs(x.std() / x.mean() - cv) < 0.05 * max(cv, 1.0), (cv, x.mean(), x.std())


def test_without_variation_nothing_is_drawn():
    sim = build_sim(scenario(0.0, n=2000))
    assert np.all(np.asarray(sim.diseases[0].rel_sus_ind) == 1.0)
    assert not any("rel_sus_ind" in name for name in sim.dists.dists)            # no stream is added, so no other draw can move


def test_susceptibility_is_the_product_of_its_factors():
    p = scenario(1.0, n=3000, years=10 / 365, disease={"rel_sus_age": {"children": 1.5, "adults": 1.0, "elderly": 0.7}},
                 demographics={"age_pct_under18": 40.0, "age_pct_18_64": 50.0, "age_pct_over65": 10.0})
    body = p.model_dump()
    body["interventions"] = [{"type": "vaccine", "kind": "campaign", "coverage": 0.5, "start_day": 2, "end_day": 2, "efficacy": 0.6}]
    sim = build_sim(SimParamsV2.model_validate(body))
    for _ in range(5):
        sim.run_one_step()
    d = sim.diseases[0]
    age = np.asarray(sim.people.age)
    base = np.select([age < 18, age < 65], [1.5, 1.0], default=0.7)
    assert np.allclose(np.asarray(d.rel_sus), base * np.asarray(d.rel_sus_ind) * np.asarray(d.vaccine_protection))
    assert len(np.unique(np.round(np.asarray(d.rel_sus_ind), 6))) > 1000


def test_newborns_get_a_multiplier():
    p = scenario(1.0, n=3000, years=90 / 365, demographics={"use_demographics": True, "birth_rate": 300.0, "death_rate": 5.0})
    sim = build_sim(p)
    sim.run()
    x = np.asarray(sim.diseases[0].rel_sus_ind.raw)
    born = x[3000:len(sim.people.uid.raw)]
    assert len(born) > 100 and np.all(np.isfinite(born)) and np.all(born > 0) and 0.6 < born.std() / born.mean() < 1.4


def test_the_final_size_follows_the_closed_form():
    assert final_size(2.5) == pytest.approx(0.8926, abs=1e-3) and final_size(2.5, 0.0) == final_size(2.5)
    assert final_size(2.5, 0.5) == pytest.approx(0.804, abs=2e-3) and final_size(2.5, 1.0) == pytest.approx(0.600, abs=1e-3)
    assert final_size(2.5, 2.0) == pytest.approx(0.287, abs=2e-3) and final_size(1.5, 1.0) == pytest.approx(0.333, abs=2e-3)
    assert final_size(0.9, 1.0) == 0.0 and final_size(1.0, 2.0) == 0.0
    for cv, expected in ((0.0, 0.893), (1.0, 0.600)):
        p = scenario(cv, n=50000, years=1.5)
        sim = build_sim(p)
        sim.run()
        attack = extract(sim, 50000, sim.seeds_day0, False)["stats"]["total_infected"] / 50000
        assert abs(attack - expected) < 0.03, (cv, attack)
```

Append to `tests/test_sim_calibrate.py`:

```python
def test_the_saturation_loss_and_the_pilot_it_asks_for():
    # follow-up spec 4.3: on the random network a very susceptible agent's per-contact probability cannot exceed 1
    assert calibrate.gamma_loss(0.0625, 1.0) < 1e-4 and calibrate.gamma_loss(0.2, 1.0) == pytest.approx(0.007, abs=1e-3)
    assert calibrate.gamma_loss(0.47, 1.0) == pytest.approx(0.119, abs=2e-3) and calibrate.gamma_loss(0.47, 2.0) == pytest.approx(0.390, abs=3e-3)
    assert calibrate.gamma_loss(0.47, 0.0) == 0.0 and calibrate.gamma_loss(0.0, 1.0) == 0.0

    def measles(cv, **network):
        body = _plain(12.0, {"mean_days": 8.0, "dist": "gamma", "sd_days": 3.0}, n=10000).model_dump()
        body["disease"]["rel_sus_cv"] = cv
        body["network"].update(network)
        return SimParamsV2.model_validate(body)

    assert calibrate.saturation_loss(measles(1.0)) == pytest.approx(0.119, abs=5e-3) and calibrate.needs_calibration(measles(1.0))
    assert calibrate.saturation_loss(measles(0.0)) == 0.0 and not calibrate.needs_calibration(measles(0.0))
    typical = _plain(2.5, {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}).model_dump()
    typical["disease"]["rel_sus_cv"] = 1.0
    assert not calibrate.needs_calibration(SimParamsV2.model_validate(typical))                       # a loss under 2% runs no pilot
    aged = measles(1.0, network_type="age_structured")
    assert calibrate.saturation_loss(aged) == 0.0 and not calibrate.needs_calibration(aged)            # mixing pools enter linearly
    off = measles(1.0).model_dump()
    off["run"]["calibrate_r0"] = False
    assert not calibrate.needs_calibration(SimParamsV2.model_validate(off))
    calibrated, info = calibrate.calibrate_by_measurement(measles(1.0), 1)
    assert calibrated.disease.beta > measles(1.0).disease.beta * 1.05 and info["corrections"] >= 1 and info["reached"] is True, info
    assert abs(calibrate.measure(calibrated, 2).mean - 12.0) / 12.0 < 0.10
```

Append to `tests/test_sim_diagnostics.py` (use the file's own helpers for a diagnosed run; the two assertions are):

```python
def test_final_size_gap_expects_the_size_the_variation_gives():
    # follow-up spec 4.4: a run with variation that infects what its own closed form predicts raises nothing
    ...   # with disease.rel_sus_cv 1.0, R0 2.5 and total_infected 0.60 × n: no final_size_gap; with rel_sus_cv 0 and the same total: it fires
```

Write it with the file's existing constructor of a `diagnose(...)` call for a simple random-network run (see `test_final_size_gap...` in the same file for the shape), asserting `"final_size_gap" not in ids` for the first and `in ids` for the second, with `expected_attack_rate` near 0.6 and 0.893 in the evidence.

- [ ] **Step 2: Run them and watch them fail** — `.venv/Scripts/python.exe -m pytest tests/test_sim_variation.py tests/test_sim_calibrate.py tests/test_sim_diagnostics.py -q -p no:cacheprovider -k "variation or multiplier or product or newborns or closed_form or saturation or expects_the_size or nothing_is_drawn"`.

- [ ] **Step 3: Implement**

`epichat/sim/models.py`, `EpiChatDisease`:

```python
    def __init__(self, pars=None, rel_sus_age=None, rel_sus_cv=None, **kwargs):
        super().__init__(pars=pars, **kwargs)
        self.define_pars(rel_sus_age=(1.0, 1.0, 1.0))      # children, adults, elderly (Part 2, 4.1)
        if rel_sus_age is not None:
            self.update_pars(rel_sus_age=tuple(float(v) for v in rel_sus_age))
        cv = float(rel_sus_cv or 0.0)
        # Follow-up spec 4.1: a personal multiplier drawn once per agent (births included) from a gamma with mean 1; with no variation
        # it is the constant 1 and nothing is drawn, so no random stream is added.
        personal = ss.gamma(a=1.0 / cv ** 2, scale=cv ** 2) if cv > 0 else 1.0
        self.define_states(
            ...the five existing states...,
            ss.FloatArr("rel_sus_ind", default=personal, label="Personal susceptibility multiplier"),
        )
```

and in `compose_rel_sus` the last line becomes `self.rel_sus[:] = base * np.asarray(self.rel_sus_ind) * np.asarray(self.vaccine_protection) * immunity`, with the docstring's formula updated.

`epichat/sim/builder.py`, `disease_kwargs`: the first `dict(...)` gains `rel_sus_cv=d.rel_sus_cv`.

`epichat/sim/calibrate.py`:

```python
from scipy.special import gammainc

from epichat.params.r0 import approx_r0, clamp_beta, per_contact_prob, r0_is_approximate

SATURATION_LOSS = 0.02          # the share of the configured R0 lost to saturation above which the pilot runs (follow-up spec 4.3)


def gamma_loss(q: float, cv: float) -> float:
    """1 − E[min(x, 1/q)] for x gamma with mean 1 and coefficient of variation cv: the share of R0 lost when the per-contact
    probability q × x of a very susceptible agent is capped at 1."""
    if cv <= 0 or q <= 0:
        return 0.0
    shape, scale, cap = 1.0 / cv ** 2, cv ** 2, 1.0 / q
    return float(max(0.0, 1.0 - (gammainc(shape + 1.0, cap / scale) + cap * (1.0 - gammainc(shape, cap / scale)))))


def saturation_loss(p: SimParamsV2) -> float:
    """On the random network each contact is a draw with probability q × x; the mixing pools of the age-structured network take the
    multiplier linearly while R0 is being defined, and the hybrid network is measured anyway."""
    if p.network.network_type != "random":
        return 0.0
    return gamma_loss(p.network.network_beta * per_contact_prob(p.disease.beta), p.disease.rel_sus_cv)


def needs_calibration(p: SimParamsV2) -> bool:
    return p.run.calibrate_r0 and (r0_is_approximate(p) or saturation_loss(p) > SATURATION_LOSS)
```

`epichat/sim/diagnostics.py`:

```python
def final_size(r: float, cv: float = 0.0) -> float:
    """The share of susceptibles an epidemic reaches: z = 1 − exp(−r z), or with gamma-distributed susceptibility of coefficient of
    variation cv (follow-up spec 4.4) z = 1 − (1 + cv² r z)^(−1/cv²); 0 at or below R 1."""
    if r <= 1:
        return 0.0
    v = cv * cv
    z = 0.99
    for _ in range(400):
        z = 1 - math.exp(-r * z) if v <= 0 else 1 - (1 + v * r * z) ** (-1 / v)
    return z
```

`_final_size_gap` calls `final_size(run.r_eff, run.params.disease.rel_sus_cv)`. In `_Run.__post_init__`, a calibrated run's R0 is its target, since its beta is no longer the formula's: `calibration = self.stats.get("r0_calibration"); self.r0 = float(calibration["target"]) if calibration and calibration.get("target") else approx_r0(p)`.

- [ ] **Step 4: Run the tests and watch them pass** — the three files, then `tests/test_sim_parity.py tests/test_sim_models.py tests/test_sim_builder.py tests/test_sim_interventions.py tests/test_sim_replicates.py`. A tolerance that fails on real data is examined (print the values) and ruled on in the ledger.

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/models.py epichat/sim/builder.py epichat/sim/calibrate.py epichat/sim/diagnostics.py tests/test_sim_variation.py tests/test_sim_calibrate.py tests/test_sim_diagnostics.py
git commit -m "feat(sim): variation between people in susceptibility, the saturation pilot and the closed-form final size"
```

---

### Task 4: The behaviour response in the simulation

**Files:**
- Modify: `epichat/sim/connectors.py`, `epichat/sim/builder.py` (`build_sim`), `epichat/sim/outputs.py` (`extract`), `epichat/sim/diagnostics.py` (`_r0_reference`)
- Test: `tests/test_sim_behavior.py` (new), `tests/test_sim_diagnostics.py`

**Interfaces:**
- Consumes: the `behavior_response` entry (Task 1).
- Produces: `TransmissionModifiers(..., behavior=None)` with `behavior` a dict `{scale, half_prevalence, memory_days, start_day, end_day}`; `connector.behavior_factors: list[float]`; `stats["behavior"] = {"min_factor": float, "min_day": int}` on a run with the entry, absent otherwise.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_sim_behavior.py`:

```python
"""Follow-up spec, section 5: transmission falls as the share infectious rises and recovers as it falls."""
import numpy as np
import pytest

from epichat.params.r0 import with_r0
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.builder import build_sim
from epichat.sim.calibrate import pilot_params
from epichat.sim.outputs import extract

G10 = {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}


def scenario(entry: dict | None, n: int = 10000, years: float = 1.0, target: float = 2.5, extra: list | None = None, **disease) -> SimParamsV2:
    body = {"disease": {"dur_inf": G10, "p_death": 0.0, "seed": {"mode": "count", "value": 50}, **disease},
            "interventions": ([{"type": "behavior_response", **entry}] if entry is not None else []) + (extra or []),
            "run": {"n_agents": n, "sim_dur_years": years, "rand_seed": 1}}
    return with_r0(SimParamsV2.model_validate(body), target)


def run(p: SimParamsV2):
    sim = build_sim(p)
    sim.run()
    return sim, extract(sim, p.run.n_agents, sim.seeds_day0, False)


def test_the_factor_is_the_formula_on_every_step():
    p = scenario({"scale": 0.6, "half_prevalence": 0.02, "memory_days": 5}, years=120 / 365)
    sim, out = run(p)
    factors = np.array(sim.connectors[0].behavior_factors)
    share = np.array(out["series"]["n_infectious"]) / p.run.n_agents               # nobody dies or is born here
    for t in (0, 3, 10, 30, 60, 119):
        mean = share[max(0, t - 4): t + 1].mean()
        assert factors[t] == pytest.approx(1 - 0.6 * mean / (0.02 + mean), abs=2e-3), t
    assert np.allclose(np.array(sim.connectors[0].factors), factors)             # no seasonality, no dated reduction: the factor is the response


def test_it_is_one_with_nobody_infectious_and_outside_its_window():
    late = scenario({"scale": 0.8}, years=40 / 365, seed={"mode": "count", "value": 50, "day": 10})
    sim, _ = run(late)
    assert np.all(np.array(sim.connectors[0].behavior_factors[:10]) == 1.0) and min(sim.connectors[0].behavior_factors) < 1.0
    windowed = scenario({"scale": 0.8, "start_day": 20, "end_day": 39}, years=60 / 365)
    sim, _ = run(windowed)
    f = np.array(sim.connectors[0].behavior_factors)
    assert np.all(f[:20] == 1.0) and np.all(f[40:] == 1.0) and f[20:40].max() < 1.0


def test_it_multiplies_with_seasonality_and_a_dated_reduction():
    extra = [{"type": "seasonality", "scale": 0.2}, {"type": "transmission_reduction", "scale": 0.3, "start_day": 5, "end_day": 15}]
    sim, _ = run(scenario({"scale": 0.5}, years=30 / 365, extra=extra))
    c = sim.connectors[0]
    seasonal = np.array([c.seasonal(t) for t in range(len(c.factors))])
    dated = np.array([0.7 if 5 <= t <= 15 else 1.0 for t in range(len(c.factors))])
    assert np.allclose(np.array(c.factors), seasonal * dated * np.array(c.behavior_factors))


def test_the_peak_and_the_total_fall_and_the_response_relaxes():
    _, base = run(scenario(None, years=1.5))
    sim, out = run(scenario({"scale": 0.6, "half_prevalence": 0.01}, years=1.5))
    assert out["stats"]["peak_infections"] < 0.5 * base["stats"]["peak_infections"]
    assert out["stats"]["total_infected"] < base["stats"]["total_infected"] - 0.10 * 10000
    assert out["stats"]["total_infected"] > 0.45 * 10000                           # it cannot go below the herd immunity threshold by much (5.3)
    f = sim.connectors[0].behavior_factors
    assert f[-1] > 0.99                                                            # relaxed once the infections are gone
    b = out["stats"]["behavior"]
    assert b["min_factor"] == pytest.approx(min(f), abs=1e-4) and b["min_day"] == int(np.argmin(f)) and 0.4 < b["min_factor"] < 0.9
    assert "behavior" not in base["stats"]


def test_the_pilot_runs_without_the_response_and_a_dead_population_is_no_division():
    p = scenario({"scale": 0.6})
    assert pilot_params(p, 1).interventions == []
    doomed = scenario({"scale": 0.6}, n=500, years=60 / 365, p_death=1.0, seed={"mode": "fraction", "value": 1.0, "day": 0})
    sim, out = run(doomed)
    assert all(np.isfinite(f) and 0.0 <= f <= 1.0 for f in sim.connectors[0].behavior_factors) and sim.connectors[0].behavior_factors[-1] == 1.0
```

Append to `tests/test_sim_diagnostics.py` a test that `r0_gap` is absent when a `behavior_response` with `start_day` 0 is in the scenario and the measured R0 is half the configured one, and present with the same numbers and no entry (build it with the file's existing `diagnose` helper).

- [ ] **Step 2: Run them and watch them fail** — `.venv/Scripts/python.exe -m pytest tests/test_sim_behavior.py -q -p no:cacheprovider`; expected: FAIL on `behavior_factors`.

- [ ] **Step 3: Implement**

`epichat/sim/connectors.py`: the constructor gains `behavior: dict | None = None`, stored with `self.behavior_factors: list[float] = []` and `self.shares: list[float] = []`;

```python
    def behavior_factor(self) -> float:
        """Follow-up spec 5.2: 1 − scale × P / (half_prevalence + P), P the mean share of living agents infectious over the last
        memory_days steps, today included; 1 outside the window or with nobody alive."""
        b = self.behavior
        if b is None:
            return 1.0
        disease = self.sim.diseases[self.disease_name]
        alive = len(self.sim.people.auids)
        self.shares.append(float(disease.infectious.count()) / alive if alive > 0 else 0.0)
        if self.ti < b["start_day"] or (b["end_day"] is not None and self.ti > b["end_day"]):
            return 1.0
        recent = self.shares[-int(b["memory_days"]):]
        mean = sum(recent) / len(recent)
        return 1.0 - b["scale"] * mean / (b["half_prevalence"] + mean)
```

`factor()` multiplies by it and records it: `response = self.behavior_factor(); self.behavior_factors.append(response); return f * response` (a connector without the entry appends nothing: guard the append with `if self.behavior is not None`). The module docstring gains the sentence.

`epichat/sim/builder.py`, `build_sim`: `response = next((i for i in params.interventions if i.type == "behavior_response"), None)` and pass `behavior=None if response is None else dict(scale=response.scale, half_prevalence=response.half_prevalence, memory_days=response.memory_days, start_day=response.start_day, end_day=response.end_day)`. `build_interventions` already skips types it does not build; confirm the new type falls through.

`epichat/sim/outputs.py`, `extract`: after `r0_measured`,

```python
    response = next((c for c in sim.connectors.values() if getattr(c, "behavior", None) is not None), None)
    if response is not None and response.behavior_factors:              # follow-up spec 5.2: the strongest reduction and its day
        f = np.asarray(response.behavior_factors, dtype=float)
        stats["behavior"] = {"min_factor": round(float(f.min()), 4), "min_day": int(f.argmin())}
```

`epichat/sim/diagnostics.py`, `_r0_reference`: in the loop that returns `None` for an early treatment, also `if i.type == "behavior_response" and i.start_day <= p.disease.dur_inf.mean_days: return None`.

- [ ] **Step 4: Run the tests and watch them pass** — `tests/test_sim_behavior.py tests/test_sim_diagnostics.py tests/test_sim_connectors.py tests/test_sim_parity.py tests/test_sim_interventions.py tests/test_sim_outputs.py`.

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/connectors.py epichat/sim/builder.py epichat/sim/outputs.py epichat/sim/diagnostics.py tests/test_sim_behavior.py tests/test_sim_diagnostics.py
git commit -m "feat(sim): the behaviour response, a factor of the connector that follows the share infectious"
```

---

### Task 5: Fitting with the two new levers

**Files:**
- Modify: `epichat/sim/fit.py`, `epichat/sim/replicates.py`
- Test: `tests/test_sim_fit.py`

**Interfaces:**
- Consumes: Tasks 1, 3 and 4.
- Produces: `fit.LEVERS: dict[str, Lever]` with `Lever(bounds, rising, start)`; `fit.lever_value(body, lever)`, `fit.set_lever(body, lever, value)`; `fit.BETA_LEVERS`; `run_replicates` running the pilot before a fit on a lever that is not beta.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_sim_fit.py`:

```python
def varied(target: str, value: float, lever: str, cv: float = 0.0, response: dict | None = None, **run) -> SimParamsV2:
    body = scenario(target, value, **run).model_dump()
    body["disease"]["rel_sus_cv"] = cv
    if response is not None:
        body["interventions"] = [{"type": "behavior_response", **response}]
    body["run"]["fit"]["lever"] = lever
    return SimParamsV2.model_validate(body)


def test_the_variation_is_fitted_to_an_attack_rate_and_beta_stays():
    p = varied("attack_rate", 0.6, "disease.rel_sus_cv")
    fitted, info = fit.fit_lever(p, 1)
    assert info["lever"] == "disease.rel_sus_cv" and info["runs"] <= fit.MAX_RUNS and abs(info["achieved"] - 0.6) <= 0.02, info
    assert fitted.disease.beta == p.disease.beta and fitted.disease.rel_sus_cv == info["value"] and 0.5 < info["value"] < 1.6


def test_the_behaviour_response_is_fitted_to_an_attack_rate():
    p = varied("attack_rate", 0.7, "behavior_response.scale", response={"scale": 0.2, "half_prevalence": 0.01})
    fitted, info = fit.fit_lever(p, 1)
    entry = next(i for i in fitted.interventions if i.type == "behavior_response")
    assert abs(info["achieved"] - 0.7) <= 0.02 and info["runs"] <= fit.MAX_RUNS and entry.scale == info["value"] and fitted.disease.beta == p.disease.beta, info


def test_a_falling_lever_that_cannot_reach_the_target_ends_at_its_bound():
    high = varied("attack_rate", 0.99, "disease.rel_sus_cv", cv=1.0)             # no variation at all still infects fewer than 99%
    fitted, info = fit.fit_lever(high, 1)
    assert info["runs"] <= fit.MAX_RUNS and fitted.disease.rel_sus_cv == 0.0 and info["achieved"] < 0.99
    low = varied("attack_rate", 0.05, "behavior_response.scale", response={"scale": 0.5})
    fitted, info = fit.fit_lever(low, 1)
    entry = next(i for i in fitted.interventions if i.type == "behavior_response")
    assert info["runs"] <= fit.MAX_RUNS and entry.scale == pytest.approx(0.95) and info["achieved"] > 0.05


def test_the_pilot_runs_before_a_fit_that_does_not_move_beta():
    body = varied("attack_rate", 0.5, "disease.rel_sus_cv", n_agents=5000).model_dump()
    body["network"]["network_type"] = "hybrid"
    payload = run_replicates(SimParamsV2.model_validate(body))
    assert "fit" in payload["stats"] and "r0_calibration" in payload["stats"]      # the fit keeps R0, so the pilot still sets beta
    beta_fit = scenario("attack_rate", 0.5, n_agents=5000).model_dump()
    beta_fit["network"]["network_type"] = "hybrid"
    payload = run_replicates(SimParamsV2.model_validate(beta_fit))
    assert "fit" in payload["stats"] and "r0_calibration" not in payload["stats"]  # a fit on beta still replaces the pilot
```

- [ ] **Step 2: Run them and watch them fail** — `.venv/Scripts/python.exe -m pytest tests/test_sim_fit.py -q -p no:cacheprovider`; expected: FAIL with `KeyError: 'disease.rel_sus_cv'` from the registry-bounds lookup, or on the lever's direction.

- [ ] **Step 3: Implement**

`epichat/sim/fit.py`: replace `RISING` and the registry-bounds lookup with a table of levers and two accessors:

```python
BETA_LEVERS = ("disease.beta", "network.network_beta")
RESPONSE_SCALE_MAX = 0.95
MIN_STEP = 0.02                 # a falling lever halved below this goes to its lower bound


@dataclass(frozen=True)
class Lever:
    bounds: tuple[float, float]
    rising: bool                # the attack rate and the peak rise with the lever
    start: float | None         # where a lever at 0 starts


LEVERS = {
    "disease.beta": Lever(REGISTRY_BY_PATH["disease.beta"].bounds, True, None),
    "network.network_beta": Lever(REGISTRY_BY_PATH["network.network_beta"].bounds, True, None),
    "disease.rel_sus_cv": Lever(REGISTRY_BY_PATH["disease.rel_sus_cv"].bounds, False, 0.5),
    "behavior_response.scale": Lever((0.0, RESPONSE_SCALE_MAX), False, 0.5),
}
OUTCOME_RISES = {"attack_rate": True, "peak_infections": True, "peak_day": False}       # with a rising lever


def _response(body: dict) -> dict:
    return next(i for i in body["interventions"] if i["type"] == "behavior_response")


def lever_value(body: dict, lever: str) -> float:
    return float(_response(body)["scale"] if lever == "behavior_response.scale" else get_path(body, lever))


def set_lever(body: dict, lever: str, value: float) -> None:
    if lever == "behavior_response.scale":
        _response(body)["scale"] = value
    else:
        set_path(body, lever, value)
```

`_with_lever` uses `set_lever`. In `fit_lever`: `spec = LEVERS[f.lever]`; `lo_bound, hi_bound = spec.bounds` (for the beta levers `hi_bound = _effective_hi(...)` as today; the two new levers do not touch the joint rule); `value = lever_value(p.model_dump(), f.lever)` and `if value <= 0 and spec.start is not None: value = spec.start`. The direction: `rises = OUTCOME_RISES[f.target] == spec.rising` (the outcome rises with this lever); `too_low = (not faded and achieved < f.value) if rises else (faded or achieved > f.value)`... written out:

```python
        if spec.rising:
            must_rise = faded or (achieved < f.value if OUTCOME_RISES[f.target] else achieved > f.value)
        else:                                   # a falling lever: a faded run means the lever is too high; too many infected means too low
            must_rise = (not faded) and achieved > f.value
```

and the rest of the bracket uses `must_rise` where it used `too_low`. When stepping down without a bracket: `nxt = value / STEP`, and for a falling lever `if nxt < MIN_STEP: nxt = lo_bound`; the existing bound checks (`value <= lo_bound × (1 + 1e-9)` with an absolute epsilon for a bound of 0: `value <= lo_bound + 1e-12`) end the search at the bound. The returned info reads the lever with `lever_value`.

`epichat/sim/replicates.py`:

```python
    fit_spec = params.run.fit
    if fit_spec is not None and fit_spec.lever not in BETA_LEVERS:          # follow-up spec 6: this fit keeps R0, so the pilot still sets beta
        params, calibration = calibrate_by_measurement(params, seeds[0])
        params, fitted = fit_lever(params, seeds[0])
    else:
        params, fitted = fit_lever(params, seeds[0])
        params, calibration = (params, None) if fitted is not None else calibrate_by_measurement(params, seeds[0])
```

(the pilot drops the fit from its own run block already, so calibrating first cannot recurse.)

- [ ] **Step 4: Run the tests and watch them pass** — `tests/test_sim_fit.py tests/test_sim_replicates.py tests/test_sim_calibrate.py`; then `sim/tests/test_real_run.py` with the service interpreter. If a target is unreachable in a scenario as written (as the peak day was in 2C), examine the values, move the target to one the lever reaches, and ledger the ruling.

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/fit.py epichat/sim/replicates.py tests/test_sim_fit.py
git commit -m "feat(sim): fit the variation or the behaviour response to a known outcome, with R0 left where it was set"
```

---

### Task 6: The web: the tool descriptions, the panel, the report, the prompt

**Files:**
- Modify: `web/lib/sim/client.ts`, `web/lib/tools/runSimulation.ts`, `web/lib/tools/index.ts`, `web/lib/client/format.ts`, `web/lib/report/compose.ts`, `web/lib/chat/prompt.ts`
- Test: `web/tests/tools/runSimulation.test.ts`, `web/tests/tools/configureSimulation.test.ts`, `web/tests/client/format.test.ts`, `web/tests/report/compose.test.ts`, `web/tests/chat/prompt.test.ts`

**Interfaces:**
- Consumes: Task 2's schema; the service's `stats.behavior` and `stats.fit` with the new levers.
- Produces: `SimStats.behavior?: { min_factor: number; min_day: number } | null`; the applied notes `rel_sus_cv_fitted_to_<target>` and `behavior_response_fitted_to_<target>`, and `behavior_response_min_factor` when the run had a response; the panel line and row; the run label; the prompt's "## Limits on spread".

- [ ] **Step 1: Write the failing tests**

`web/tests/client/format.test.ts`, append:

```ts
describe("the limits on spread in the panel (follow-up spec 4.5, 5.5, 6)", () => {
  it("writes the behaviour response as a line and the variation as a row", () => {
    const p = params({ schema_version: 2, disease: { rel_sus_cv: 1 }, interventions: [{ type: "behavior_response", scale: 0.5 }, { type: "seasonality", scale: 0.2 }] });
    expect(interventionLines(p)).toContain("Behaviour response: transmission falls by up to 50% as infections rise (half of that at 1% infectious, 7-day memory)");
    expect(parameterRows(p)).toContainEqual(["Variation in susceptibility", "CV 1"]);
    expect(parameterRows(params({})).map(([label]) => label)).not.toContain("Variation in susceptibility");
    const windowed = params({ schema_version: 2, interventions: [{ type: "behavior_response", scale: 0.6, half_prevalence: 0.005, memory_days: 14, start_day: 20, end_day: 80 }] });
    expect(interventionLines(windowed)).toEqual(["Behaviour response: transmission falls by up to 60% as infections rise (half of that at 0.5% infectious, 14-day memory), days 20–80"]);
  });

  it("names the new fit levers and the applied notes", () => {
    expect(parameterRows(params({ schema_version: 2, disease: { rel_sus_cv: 0.5 }, run: { fit: { target: "attack_rate", value: 0.3, lever: "disease.rel_sus_cv" } } }))).toContainEqual(["Fitted to", "attack rate 30% by moving the variation in susceptibility"]);
    expect(parameterRows(params({ schema_version: 2, interventions: [{ type: "behavior_response" }], run: { fit: { target: "attack_rate", value: 0.3, lever: "behavior_response.scale" } } }))).toContainEqual(["Fitted to", "attack rate 30% by moving the behaviour response"]);
    expect(describeField("rel_sus_cv_fitted_to_attack_rate", 0.92)).toEqual({ label: "Variation in susceptibility fitted to attack rate", value: "0.92" });
    expect(describeField("behavior_response_fitted_to_attack_rate", 0.61)).toEqual({ label: "Behaviour response fitted to attack rate", value: "61%" });
    expect(describeField("behavior_response_min_factor", 0.53)).toEqual({ label: "Strongest reduction by the behaviour response", value: "47%" });
  });
});
```

`web/tests/tools/runSimulation.test.ts`, append a test in the style of "notes a fitted beta": a result whose `stats.fit` is `{ target: "attack_rate", wanted: 0.3, achieved: 0.31, lever: "disease.rel_sus_cv", value: 0.92, runs: 5 }` gives `applied` `{ rel_sus_cv_fitted_to_attack_rate: 0.92 }`; with lever `behavior_response.scale`, value 0.61 and `stats.behavior` `{ min_factor: 0.53, min_day: 55 }` it gives `{ behavior_response_fitted_to_attack_rate: 0.61, behavior_response_min_factor: 0.53 }`; a run with `stats.behavior` and no fit gives `{ behavior_response_min_factor: 0.53 }`.

`web/tests/tools/configureSimulation.test.ts`, append: the `interventions` field upserts a `behavior_response` entry and `remove_interventions: ["behavior_response"]` drops it; `advanced: { "disease.rel_sus_cv": 1 }` sets the variation and the R0 is unchanged (`approxR0` before and after equal); a `fit` with lever `behavior_response.scale` and no entry is a CONFIG ERROR containing "needs a behavior_response entry".

`web/tests/report/compose.test.ts`: `runLabels` names a run that gained the response ("Run 2, behaviour response") and one that changed the variation ("Run 2, variation CV 1").

`web/tests/chat/prompt.test.ts`: the headings gain `"## Limits on spread"`, the phrases gain `"rel_sus_cv"`, `"behavior_response"`, `"herd immunity threshold"`, `"off by default"`, and the section sits before `"## Interventions"`.

- [ ] **Step 2: Run them and watch them fail** — `npx vitest run tests/client tests/tools tests/report tests/chat` from `web/`.

- [ ] **Step 3: Implement**

- `client.ts`: `SimStats` gains `behavior?: { min_factor: number; min_day: number } | null`.
- `runSimulation.ts`: the note's key is `${lever === "behavior_response.scale" ? "behavior_response" : lever.split(".").pop()}_fitted_to_${target}`; and `if (result.stats.behavior) notes.behavior_response_min_factor = result.stats.behavior.min_factor;`.
- `format.ts`: `interventionLines` gains, before the seasonality fallback, the behaviour-response line: `Behaviour response: transmission falls by up to ${pct(scale)} as infections rise (half of that at ${pct(half_prevalence)} infectious, ${memory_days}-day memory)` plus the window suffix the other types use when `start_day > 0` or `end_day` is set; `parameterRows` gains `...(d.rel_sus_cv > 0 ? row("Variation in susceptibility", `CV ${fmtValue(d.rel_sus_cv)}`) : [])` after the "Susceptibility by age" row; `LEVER_LABELS` gains `"disease.rel_sus_cv": "the variation in susceptibility"` and `"behavior_response.scale": "the behaviour response"`; `LEVER_NAMES` gains `rel_sus_cv: "Variation in susceptibility"` and `behavior_response: "Behaviour response"`; the fitted-key branch of `describeField` formats the value as a percentage when the lever is `behavior_response`; `FIELDS` gains `behavior_response_min_factor: { label: "Strongest reduction by the behaviour response", kind: "reduction" }`, rendered as `${plain((1 − value) × 100)}%`.
- `index.ts`: the `interventions` description lists `behavior_response` with `scale` (the largest reduction), `half_prevalence`, `memory_days`; the `fit` description lists the four levers and says the two new ones keep R0.
- `compose.ts`, `runLabels`: `variation CV ${cv}` when `disease.rel_sus_cv` differs from the previous run's (and "no variation" when it returns to 0); "behaviour response" when the entry appears, "no behaviour response" when it goes.
- `prompt.ts`: insert before `## Interventions`

```
## Limits on spread

- Without an intervention an epidemic reaches the share the final-size equation gives for its R0 (89% at R0 2.5, nearly everyone above 4), on every network: the only brake is the depletion of susceptibles. Two mechanisms limit it without a dated measure. Both are off by default and both are illustrative assumptions: never switch one on without saying so, and name it in the limitations.
- Variation between people: disease.rel_sus_cv (advanced patch), the coefficient of variation of a personal susceptibility multiplier with mean 1. The most susceptible are infected first, so the epidemic ends smaller at the same R0 (1 takes R0 2.5 from 89% to 60% infected). R0 does not change. Offer 1 unless the database carries a value.
- Behaviour response: an interventions entry {type: behavior_response, scale: 0.5} (people being careful as cases rise; not a measure anyone imposed): transmission falls by up to scale as the share infectious rises (half of that at half_prevalence, 1% by default, averaged over memory_days) and recovers as it falls. It flattens the peak and removes the overshoot; because it relaxes it cannot take the total below the herd immunity threshold, 1 − 1/R0. Say so in one sentence when you report such a run, and give the strongest reduction (applied.behavior_response_min_factor).
- Offer them when a lever carries one, when the user asks why so many were infected, or when the user knows the real attack rate and it is far below what R0 predicts.
- When the user gives a known attack rate or peak size and the R0 came from the database or from the user, fit the variation, not beta: fit {target, value, lever: disease.rel_sus_cv}, and say "the variation between people was set so that 30% are infected; R0 stays 2.5". The lever behavior_response.scale does the same with a response already in the scenario. Beta stays the lever when the user says the R0 itself is unknown. A peak day can only be fitted with beta.
```

and in `## Interventions` extend the list of types and the translations with "people become careful as cases rise" → `{type: behavior_response, scale: 0.5}`.

- [ ] **Step 4: Run the web suites** — `npx vitest run && npm run typecheck && npm run lint` from `web/`.

- [ ] **Step 5: Commit**

```bash
git add web/lib web/tests
git commit -m "feat(web): the limits on spread in the tools, the panel, the report's run labels and the prompt"
```

---

### Task 7: The documents as shipped, and the full suites

**Files:**
- Modify: `README.md` (the web-agent section), `docs/superpowers/specs/2026-10-13-limits-suggestions-parameters-design.md`
- Test: `tests/test_readme.py`

- [ ] **Step 1: Write the failing test** — in `tests/test_readme.py`, a test that the web-agent section contains `"Limits on spread"`, `"rel_sus_cv"`, `"behavior_response"`, `"herd immunity threshold"` and `"off by default"`.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Write** the README bullet "**Limits on spread.**" after "**Interventions.**" (what section 3 of the spec measured, the two mechanisms in two sentences each, off by default, the two fit levers), and amend the spec where the code differs from it: every ruling of the ledger that touches sections 4 to 6, and section 10's note that `networks` shipped in this phase.
- [ ] **Step 4: Run everything**, one Python suite at a time: `tests` without the calibration file, then `tests/test_r0_calibration.py`, then `sim/tests`; from `web/`: `npx vitest run`, `npm run typecheck`, `npm run lint`. The ledger gets each count.
- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-10-13-limits-suggestions-parameters-design.md tests/test_readme.py
git commit -m "docs: the limits on spread in the README; the spec as shipped"
```

---

## Self-review

**Spec coverage.** 4.1, 4.2 (the parameter, the composition): Tasks 1, 3. 4.3 (R0 and saturation): Task 3. 4.4 (the closed form, `final_size_gap`): Task 3. 4.5 (the agent rule, the panel row): Task 6. 5.1 (the entry): Tasks 1, 2. 5.2 (mechanics, `stats.behavior`): Task 4. 5.3 (what it cannot do): the test's lower bound in Task 4 and the prompt sentence in Task 6. 5.4 (the pilot, `r0_gap`, `final_size_gap`): Task 4; `final_size_gap` already stands down with any intervention. 5.5: Task 6. 6 (the levers, the direction, the pilot before the fit, the notes, the agent rule): Tasks 1, 2, 5, 6. 10 (registry 5, fixture 6, no migration): Tasks 1, 2. 12 ("Limits on spread", the Interventions translation): Task 6. 13's tests for sections 4 to 6: Tasks 3, 4, 5. Left to later phases, as the spec's section 14 says: `what_if` and `well_mixed` (B), the Parameters section and `describe_parameters` by network (C), references (D), the review list's two fields and the eval cases (E).

**Placeholders.** Two tests in `tests/test_sim_diagnostics.py` (Tasks 3 and 4) are specified by their assertions and built with that file's existing helper, which the executor reads first; every other step carries its code.

**Type consistency.** `rel_sus_cv` (Task 1) ↔ `DiseaseSchema.rel_sus_cv` (Task 2) ↔ `EpiChatDisease(rel_sus_cv=)` (Task 3). The entry's fields (Task 1) ↔ the zod fields (Task 2) ↔ the connector's `behavior` dict (Task 4) ↔ the panel line (Task 6). The four fit levers (Task 1) ↔ `FIT_LEVERS` (Task 2) ↔ `fit.LEVERS` (Task 5) ↔ `LEVER_LABELS` and the applied notes (Task 6). `stats.behavior` (Task 4) ↔ `SimStats.behavior` (Task 6).

**Review Focus.** 1 → Task 1's defaults, `test_without_variation_nothing_is_drawn`, the parity suite. 2 → `test_newborns_get_a_multiplier`. 3 → `test_it_is_one_with_nobody_infectious_and_outside_its_window` and the dead-population case. 4 → `test_a_falling_lever_that_cannot_reach_the_target_ends_at_its_bound`. 5 → Task 1's and Task 2's fit-rule tests.

## After the merge (owner)

- No migration. Push `main`.
- Nothing changes for a scenario that uses neither mechanism. To see them: after a baseline run say "assume people differ in how susceptible they are" or "people become careful as cases rise", or "30% were infected in reality; keep the R0".
