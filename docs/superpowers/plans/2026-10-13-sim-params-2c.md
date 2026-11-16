# Sim Parameters Part 2, Phase 2C: Interventions, Products and the Fit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the intervention entries real (campaign and routine vaccines with efficacy, age targeting and waning; treatment with a delay, an efficacy and a transmissibility while waiting; contact and transmission reductions over a window), let the agent set them as a structured field, and let a run be fitted to one outcome the participant knows.

**Architecture:** The `Intervention` entry (shared with the frozen Python agent) gains optional fields with defaults and two new types; the registry (version 4) and the TypeScript mirror (parity fixture version 5) carry them. The builder maps entries onto Starsim deliveries with two EpiChat products (`Vaccine` gains waning; a new `Treatment` product), two EpiChat interventions (`ContactReduction` scales network betas over a window; the connector carries transmission reductions), and keeps the v1 `SimpleTreatment` for a v1-shaped treatment entry so the parity baseline holds. `epichat/sim/fit.py` bisects a lever on a log scale against one outcome before the replicates run. The web tools gain `interventions`, `remove_interventions` and `fit`; the panel, the report and the prompt describe the new entries.

**Tech Stack:** Python 3.12, Starsim 3.7.2 (`ss.routine_vx`, `ss.Vx`, `ss.Product`, `ss.Intervention`, per-edge network betas, `MixingPool.pars.beta`), pydantic v2; Next.js with zod and vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md`, section 7 (7.1 to 7.7), 11 (review requests), 12, 13 (the intervention and fit tests), 14 (phase 2C). Part 1's section 18 rulings (a day-0 vaccine is initial immunity) stay where 7.1 does not override them.

## Global Constraints

- Starsim stays pinned at 3.7.2; no requirement file changes; no new npm dependency (`npm --prefix web ci` only); no database migration (every new leaf has a default; `schema_version` stays 2).
- The registry export's `version` becomes 4; the parity fixture's `version` 5; `tests/test_web_exports.py`, `web/tests/sim/registry.test.ts` and `web/tests/sim/parity.test.ts` pin them.
- `epichat/schema.py`'s `Intervention` is shared with the frozen Python agent: new fields are optional with defaults; nothing existing is renamed.
- The parity baseline (`tests/test_sim_parity.py`, captured on Starsim 3.3.2, never re-captured) includes a treatment entry `{coverage 0.5, capacity 20, start_day 3}` and a routine vaccine: a v1-shaped treatment entry (delay 0, efficacy 1, rel_trans_treated 1, symptomatic_only false, no end_day) keeps running through `SimpleTreatment`, and a v1-shaped vaccine entry through `ss.routine_vx` with the same product call, so the baseline's draws do not move.
- Interpreters: the root `.venv/Scripts/python.exe` for `tests/` from the worktree root; the main checkout's `sim/.venv/Scripts/python.exe` for `sim/tests` from the worktree root; `npx vitest run` from `web/`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UL6ToyEthpP1X8yxArZE6g`. Never print a secret.

## Review Focus

1. **A stored scenario with a routine vaccine and a v1 treatment.** It validates with the new defaults, runs through the same Starsim objects as before (the parity suite) and shows the same panel lines. Pinned by Task 1's defaults test, Task 3's parity run and Task 7's `interventionLines` test.
2. **A day-0 vaccine with efficacy below 1.** It is no longer folded into `initial_immune_frac` (which has no efficacy); it becomes a one-day campaign at day 0 that leaves every recipient a fraction of their susceptibility. Pinned in Tasks 1, 2 and 3.
3. **A contact reduction on a layer the network does not have** (school on the random network): the validator refuses it with a message naming the layer and the hybrid network; nothing crashes in the builder. Pinned in Task 1 (Python), Task 2 (TypeScript) and Task 3 (the builder never sees one).
4. **A fit that cannot be reached** (an attack rate of 0.9 with one contact a day): the bisection stops at the lever's registry bound after at most eight runs, reports the achieved value, and the run proceeds with the bound. Pinned in Task 4.
5. **A fit together with `calibrate_r0` on the hybrid network.** The fit sets beta directly, so the pilot calibration must not run afterwards and undo it. Pinned in Task 4.

---

## File Structure

- Modify `epichat/schema.py` (`Intervention` fields and types), `epichat/params/registry.py` (new leaves, version 4), `epichat/params/schema_v2.py` (`Fit`, `RunParams.fit`, the day-0 folding rule, the layer validator), `epichat/params/migrate.py` (unchanged behaviour, a test).
- Modify `web/lib/sim/params.ts` (the mirror), `scripts/export_parity_fixtures.py` (version 5), regenerate `web/tests/fixtures/parity.json` and `web/data/param_registry.json`.
- Modify `epichat/sim/products.py` (`Vaccine` waning, new `Treatment`), `epichat/sim/interventions.py` (`TreatmentDelivery`, `ContactReduction`), `epichat/sim/connectors.py` (transmission reductions and the treatment factor), `epichat/sim/models.py` (two states), `epichat/sim/builder.py` (`build_interventions`, `build_sim`).
- Create `epichat/sim/fit.py`; modify `epichat/sim/replicates.py`, `epichat/sim/diagnostics.py`.
- Modify `web/lib/tools/configureSimulation.ts`, `index.ts`, `types.ts`, `advanced.ts`, `fetchVaccinationCoverage.ts`, `runSimulation.ts`, `web/lib/sim/client.ts`, `web/lib/client/format.ts`, `web/lib/chat/prompt.ts`.
- Modify `scripts/review_requests.py`; the spec (7.1 and 7.7 as shipped).
- Tests: `tests/test_schema_v2.py`, `tests/test_param_registry.py`, `tests/test_web_exports.py`, `tests/test_param_migrate.py`, `tests/test_sim_interventions.py`, `tests/test_sim_builder.py`, `tests/test_sim_fit.py` (new), `tests/test_sim_replicates.py`, `tests/test_sim_diagnostics.py`, `tests/test_review_requests.py`, `sim/tests/test_real_run.py`; `web/tests/sim/{params,parity,registry}.test.ts`, `web/tests/tools/{configureSimulation,fetchTools,runSimulation,registry,advanced}.test.ts`, `web/tests/client/format.test.ts`, `web/tests/chat/prompt.test.ts`.

---

### Task 1: The intervention entries and the fit in the Python schema and the registry

**Files:**
- Modify: `epichat/schema.py` (`Intervention`, lines 9–34), `epichat/params/registry.py` (the `interventions[]` block at lines 160–174, the `run.*` block, `export()`), `epichat/params/schema_v2.py` (`RunParams`, `SimParamsV2`'s intervention validator at lines 186–196)
- Test: `tests/test_schema_v2.py`, `tests/test_param_registry.py`, `tests/test_param_migrate.py`, `tests/test_web_exports.py`

**Interfaces:**
- Consumes: `_field(path)`, `REGISTRY_BY_PATH`, `ParamSpec`.
- Produces: `Intervention` fields `kind: Literal["routine", "campaign"] = "routine"`, `end_day: Optional[int] = None`, `efficacy: float = 1.0`, `leaky: bool = True`, `age_min: Optional[int] = None`, `age_max: Optional[int] = None`, `protection_days: Optional[int] = None`, `delay_days: int = 0`, `rel_trans_treated: float = 1.0`, `symptomatic_only: bool = False`, `layer: Literal["all", "household", "school", "work", "community"] = "all"`, `peak_day` accepted as an input alias of `shift` (`shift = (peak_day / 365) % 1`); `Intervention.type` gains `contact_reduction` and `transmission_reduction`; `Intervention.is_v1_treatment()` and `Intervention.is_day0_immunity()` helpers; `schema_v2.Fit(target: Literal["attack_rate", "peak_day", "peak_infections"], value: float, lever: Literal["disease.beta", "network.network_beta"] = "disease.beta")`; `RunParams.fit: Optional[Fit] = None`; registry leaves `interventions[].kind`, `end_day`, `efficacy`, `leaky`, `age_min`, `age_max`, `protection_days`, `delay_days`, `rel_trans_treated`, `symptomatic_only`, `layer`, `run.fit.target`, `run.fit.value`, `run.fit.lever`; `export()["version"] == 4`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_schema_v2.py`:

```python
def test_intervention_entries_gain_their_fields_with_defaults():
    p = v2(interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 30}, {"type": "treatment", "coverage": 0.8, "capacity": 20},
                          {"type": "contact_reduction", "layer": "school", "scale": 0.0, "start_day": 30, "end_day": 72},
                          {"type": "transmission_reduction", "scale": 0.3, "start_day": 0, "end_day": 90},
                          {"type": "seasonality", "scale": 0.2, "peak_day": 365 // 4}],
           network={"network_type": "hybrid"})
    vaccine, treatment, closure, masks, season = p.interventions
    assert (vaccine.kind, vaccine.end_day, vaccine.efficacy, vaccine.leaky, vaccine.age_min, vaccine.age_max, vaccine.protection_days) == ("routine", None, 1.0, True, None, None, None)
    assert (treatment.delay_days, treatment.rel_trans_treated, treatment.symptomatic_only, treatment.efficacy) == (0, 1.0, False, 1.0)
    assert treatment.is_v1_treatment() and not v2(interventions=[{"type": "treatment", "delay_days": 2}]).interventions[0].is_v1_treatment()
    assert (closure.layer, closure.scale, closure.start_day, closure.end_day) == ("school", 0.0, 30, 72)
    assert (masks.scale, masks.end_day) == (0.3, 90)
    assert season.shift == pytest.approx((365 // 4) / 365)
    assert p.run.fit is None


def test_a_day_zero_vaccine_folds_into_initial_immunity_only_at_full_efficacy():
    folded = v2(interventions=[{"type": "vaccine", "coverage": 0.4, "start_day": 0}])
    assert folded.disease.initial_immune_frac == 0.4 and folded.interventions == []
    leaky = v2(interventions=[{"type": "vaccine", "coverage": 0.4, "start_day": 0, "efficacy": 0.6}])
    assert leaky.disease.initial_immune_frac == 0.0 and leaky.interventions[0].efficacy == 0.6 and leaky.interventions[0].start_day == 0
    assert not leaky.interventions[0].is_day0_immunity()


def test_layers_belong_to_the_hybrid_network_and_windows_are_ordered():
    with pytest.raises(ValidationError, match="layer"):
        v2(interventions=[{"type": "contact_reduction", "layer": "school", "scale": 0.5}])          # random network has no school layer
    v2(interventions=[{"type": "contact_reduction", "layer": "all", "scale": 0.5}])
    with pytest.raises(ValidationError, match="end_day"):
        v2(interventions=[{"type": "transmission_reduction", "scale": 0.5, "start_day": 40, "end_day": 10}])
    with pytest.raises(ValidationError):
        v2(interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 1, "efficacy": 1.5}])
    with pytest.raises(ValidationError):
        v2(interventions=[{"type": "contact_reduction", "layer": "roads", "scale": 0.5}], network={"network_type": "hybrid"})


def test_the_fit_validates_its_target_value_and_lever():
    from epichat.params.schema_v2 import Fit
    p = v2(run={"fit": {"target": "attack_rate", "value": 0.3}})
    assert p.run.fit == Fit(target="attack_rate", value=0.3, lever="disease.beta")
    assert v2(run={"fit": {"target": "peak_day", "value": 60, "lever": "network.network_beta"}}).run.fit.lever == "network.network_beta"
    with pytest.raises(ValidationError):
        v2(run={"fit": {"target": "deaths", "value": 10}})
    with pytest.raises(ValidationError):
        v2(run={"fit": {"target": "attack_rate", "value": 1.5}})
    with pytest.raises(ValidationError):
        v2(run={"fit": {"target": "peak_day", "value": 0}})
```

Append to `tests/test_param_registry.py`:

```python
def test_phase_2c_adds_the_intervention_and_fit_leaves():
    paths = {s.path for s in reg.REGISTRY}
    for p in ("interventions[].kind", "interventions[].end_day", "interventions[].efficacy", "interventions[].leaky", "interventions[].age_min",
              "interventions[].age_max", "interventions[].protection_days", "interventions[].delay_days", "interventions[].rel_trans_treated",
              "interventions[].symptomatic_only", "interventions[].layer", "run.fit.target", "run.fit.value", "run.fit.lever"):
        assert p in paths, p
    assert reg.spec_for("interventions[].type").choices == ("vaccine", "treatment", "seasonality", "contact_reduction", "transmission_reduction")
    assert reg.spec_for("interventions[].layer").choices == ("all", "household", "school", "work", "community")
    assert reg.spec_for("interventions[].efficacy").bounds == (0.0, 1.0) and reg.spec_for("interventions[].efficacy").default == 1.0
    assert reg.spec_for("run.fit.target").choices == ("attack_rate", "peak_day", "peak_infections") and reg.spec_for("run.fit.lever").default == "disease.beta"
    assert "contact_reduction" in reg.spec_for("interventions[].scale").description
    assert reg.export()["version"] == 4
```

Move the registry version pins in `tests/test_param_registry.py` (two places) and `tests/test_web_exports.py` (the registry pin) to 4. In `tests/test_param_migrate.py` add:

```python
def test_v1_day_zero_vaccine_still_folds_into_initial_immunity():
    p = coerce_params({"disease_type": "sir", "beta": 1.0, "interventions": [{"type": "vaccine", "coverage": 0.4, "start_day": 0}]})
    assert p.disease.initial_immune_frac == 0.4 and p.interventions == []
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_schema_v2.py tests/test_param_registry.py tests/test_param_migrate.py tests/test_web_exports.py -q -p no:cacheprovider`
Expected: the new tests fail (`kind` unknown, `contact_reduction` not a valid type, `fit` unknown); the version pins fail with 3.

- [ ] **Step 3: The shared entry model**

In `epichat/schema.py` replace the `Intervention` class body (keep the two validators) with:

```python
class Intervention(BaseModel):
    type: Literal["vaccine", "treatment", "seasonality", "contact_reduction", "transmission_reduction"]
    # vaccine / treatment
    coverage: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    start_day: int = Field(default=0, ge=0)
    end_day: Optional[int] = Field(default=None, ge=0)           # null: the run's end (Part 2, 7.1)
    efficacy: float = Field(default=1.0, ge=0.0, le=1.0)
    # vaccine
    kind: Literal["routine", "campaign"] = "routine"
    leaky: bool = True
    age_min: Optional[int] = Field(default=None, ge=0, le=120)
    age_max: Optional[int] = Field(default=None, ge=0, le=120)
    protection_days: Optional[int] = Field(default=None, ge=1)
    # treatment
    capacity: Optional[int] = Field(default=None, ge=1)
    delay_days: int = Field(default=0, ge=0)
    rel_trans_treated: float = Field(default=1.0, ge=0.0, le=1.0)
    symptomatic_only: bool = False
    # seasonality and the reductions
    scale: float = Field(default=0.2, ge=0.0, le=1.0)
    shift: float = Field(default=0.0, ge=0.0, le=1.0)
    # contact reduction
    layer: Literal["all", "household", "school", "work", "community"] = "all"

    @model_validator(mode="before")
    @classmethod
    def peak_day_is_an_alias_of_shift(cls, data):
        if isinstance(data, dict) and "peak_day" in data:
            data = dict(data)
            peak = data.pop("peak_day")
            if peak is not None and "shift" not in data:
                data["shift"] = (float(peak) / 365.0) % 1.0
        return data

    @model_validator(mode="after")
    def check_window_and_ages(self) -> "Intervention":
        if self.end_day is not None and self.end_day < self.start_day:
            raise ValueError("interventions[].end_day must not be before start_day")
        if self.age_min is not None and self.age_max is not None and self.age_min >= self.age_max:
            raise ValueError("interventions[].age_min must be below age_max")
        return self

    def is_day0_immunity(self) -> bool:
        """Part 1 section 18 and Part 2 7.1: a day-0 vaccine at full efficacy is disease.initial_immune_frac."""
        return self.type == "vaccine" and self.start_day <= 0 and self.efficacy >= 1.0

    def is_v1_treatment(self) -> bool:
        """A treatment entry the v1 SimpleTreatment can run (the parity baseline depends on it)."""
        return (self.type == "treatment" and self.delay_days == 0 and self.efficacy >= 1.0 and self.rel_trans_treated >= 1.0
                and not self.symptomatic_only and self.end_day is None)
```

(`model_validator` must be imported from pydantic in `epichat/schema.py`; check the file's import line.) Extend `normalize_type`'s aliases with `"school_closure": "contact_reduction", "distancing": "contact_reduction", "contact-reduction": "contact_reduction", "masks": "transmission_reduction", "transmission-reduction": "transmission_reduction"`.

- [ ] **Step 4: The registry**

In `epichat/params/registry.py` replace the `interventions[].type` and `interventions[].scale` entries and add the new leaves after `interventions[].shift`:

```python
    ParamSpec("interventions[].type", "interventions", "Intervention type", "vaccine (routine or campaign, with efficacy, age range and "
              "waning), treatment (capacity-limited, with a delay and an efficacy), seasonality (a yearly cycle in transmission), "
              "contact_reduction (a layer's contacts scaled over a window: school closure, distancing), transmission_reduction (every "
              "contact's transmissibility scaled over a window: masks).", "enum", None, None, None,
              ("vaccine", "treatment", "seasonality", "contact_reduction", "transmission_reduction"), (), "core", None,
              "ss.routine_vx, TreatmentDelivery, TransmissionModifiers, ContactReduction", ("peak", "final_size", "timing")),
    ...
    ParamSpec("interventions[].scale", "interventions", "Scale", "Seasonality: size of the yearly cycle (0.2 means transmission moves "
              "between 80% and 120% of beta); contact_reduction and transmission_reduction: the fraction removed over the window (0.3 "
              "keeps 70%; 1 removes everything).", "number", None, 0.2, (0.0, 1.0), None, (), "core", None,
              "TransmissionModifiers or ContactReduction", ("timing", "peak", "final_size")),
    ParamSpec("interventions[].end_day", "interventions", "End day", "Day the intervention ends; unset means the run's end.", "integer",
              "days", None, (0, 7300), None, (), "core", None, "ss.routine_vx(end_year=...), the window of a reduction", ("timing",)),
    ParamSpec("interventions[].kind", "interventions", "Vaccine delivery", "routine: coverage is the yearly probability each eligible "
              "person is vaccinated; campaign: the coverage is reached uniformly over the window.", "enum", None, "routine", None,
              ("routine", "campaign"), (), "advanced", None, "ss.routine_vx(prob=..., annual_prob=...)", ("timing", "final_size")),
    ParamSpec("interventions[].efficacy", "interventions", "Efficacy", "Vaccine: protection against infection, 1 means full; treatment: "
              "the share of treated cases cured. Illustrative unless the database carries it.", "number", "fraction", 1.0, (0.0, 1.0),
              None, (), "advanced", "vaccine_efficacy", "Vaccine(efficacy=...) or Treatment(efficacy=...)", ("final_size", "peak")),
    ParamSpec("interventions[].leaky", "interventions", "Leaky protection", "true: every recipient keeps 1 − efficacy of their "
              "susceptibility; false: a share efficacy of recipients is fully protected.", "bool", None, True, None, None, (), "expert",
              None, "Vaccine(leaky=...)", ("final_size",)),
    ParamSpec("interventions[].age_min", "interventions", "Vaccine age, from", "Youngest age vaccinated; unset means everyone.", "integer",
              "years", None, (0, 120), None, (), "advanced", None, "ss.routine_vx(eligibility=...)", ("final_size",)),
    ParamSpec("interventions[].age_max", "interventions", "Vaccine age, to", "Age at which vaccination stops (excluded); unset means "
              "everyone.", "integer", "years", None, (0, 120), None, (), "advanced", None, "ss.routine_vx(eligibility=...)", ("final_size",)),
    ParamSpec("interventions[].protection_days", "interventions", "Protection duration", "Days the vaccine's protection lasts; unset means "
              "permanent.", "integer", "days", None, (1, 36500), None, (), "advanced", None, "Vaccine(protection_days=...)", ("final_size",)),
    ParamSpec("interventions[].delay_days", "interventions", "Treatment delay", "Days after becoming infectious before treatment can "
              "start.", "integer", "days", 0, (0, 365), None, (), "advanced", None, "TreatmentDelivery(delay=...)", ("peak", "final_size")),
    ParamSpec("interventions[].rel_trans_treated", "interventions", "Transmissibility while waiting", "Relative transmissibility of an "
              "agent waiting for treatment (0.5 halves it).", "number", "multiplier", 1.0, (0.0, 1.0), None, (), "advanced", None,
              "Treatment(rel_trans_treated=...)", ("peak", "final_size")),
    ParamSpec("interventions[].symptomatic_only", "interventions", "Treat symptomatic only", "seiar: leave asymptomatic agents untreated.",
              "bool", None, False, None, None, ("seiar",), "advanced", None, "TreatmentDelivery(symptomatic_only=...)", ("final_size",)),
    ParamSpec("interventions[].layer", "interventions", "Layer", "Which hybrid layer a contact reduction scales: household, school, work, "
              "community, or all; the random and age-structured networks take all only.", "enum", None, "all", None,
              ("all", "household", "school", "work", "community"), (), "core", None, "ContactReduction(layer=...)", ("peak", "final_size")),
```

and after `run.calibrate_r0`:

```python
    ParamSpec("run.fit.target", "run", "Fit target", "The outcome the run is fitted to: attack_rate (share infected), peak_day or "
              "peak_infections (in agents).", "enum", None, None, None, ("attack_rate", "peak_day", "peak_infections"), (), "advanced",
              None, "epichat.sim.fit", ("peak", "final_size", "timing")),
    ParamSpec("run.fit.value", "run", "Fit value", "The value to reach: a fraction for attack_rate, a day for peak_day, agents for "
              "peak_infections.", "number", None, None, (0.0, 1_000_000.0), None, (), "advanced", None, "epichat.sim.fit", ("peak", "final_size", "timing")),
    ParamSpec("run.fit.lever", "run", "Fit lever", "The parameter the fit moves within its bounds: disease.beta or network.network_beta.",
              "enum", None, "disease.beta", None, ("disease.beta", "network.network_beta"), (), "advanced", None, "epichat.sim.fit", ("peak",)),
```

`export()` returns version 4. (`interventions[].efficacy` names the requested database field `vaccine_efficacy`; `scripts/review_requests.py` already lists it.)

- [ ] **Step 5: The schema v2 pieces**

In `epichat/params/schema_v2.py` add before `RunParams`:

```python
class Fit(BaseModel):
    """Part 2, 7.7: one outcome the participant knows, reached by moving one lever."""
    target: Literal["attack_rate", "peak_day", "peak_infections"]
    value: float = Field(gt=0.0)
    lever: Literal["disease.beta", "network.network_beta"] = "disease.beta"

    @model_validator(mode="after")
    def check_value(self) -> "Fit":
        if self.target == "attack_rate" and self.value > 1.0:
            raise ValueError("run.fit.value is a fraction for attack_rate")
        if self.target == "peak_day" and self.value < 1:
            raise ValueError("run.fit.value is a day for peak_day")
        return self
```

add `fit: Optional[Fit] = None` to `RunParams`, change the day-0 folding in `SimParamsV2`'s validator to use `i.is_day0_immunity()` (both the selection and the removal), and add to the same validator:

```python
        if self.network.network_type != "hybrid":
            for i in self.interventions:
                if i.type == "contact_reduction" and i.layer != "all":
                    raise ValueError(f"interventions[].layer {i.layer} needs the hybrid network; the {self.network.network_type} network has "
                                     "no layers, use all")
```

- [ ] **Step 6: Run the tests, regenerate the registry export, commit**

Run: `.venv/Scripts/python.exe -m pytest tests/test_schema_v2.py tests/test_param_registry.py tests/test_param_migrate.py -q -p no:cacheprovider` → all pass. Then `.venv/Scripts/python.exe scripts/export_web_data.py && .venv/Scripts/python.exe scripts/export_parity_fixtures.py` (the fixture's dumped inputs now carry the new defaults; its version stays 4 until Task 2), restore end-of-line-only rewrites (`git checkout -- web/tests/fixtures/adapters/ web/data/disease_db.json web/data/disease_refs.json web/data/system_prompt.json` after checking `git diff --stat` shows no content change in them), then `.venv/Scripts/python.exe -m pytest tests/test_web_exports.py -q -p no:cacheprovider` → all pass.

```bash
git add epichat/schema.py epichat/params/registry.py epichat/params/schema_v2.py tests/test_schema_v2.py tests/test_param_registry.py tests/test_param_migrate.py tests/test_web_exports.py web/data/param_registry.json web/tests/fixtures/parity.json
git commit -m "feat(params): the intervention entries' fields, the two reductions and the fit (registry v4)"
```

---

### Task 2: The TypeScript mirror and the parity fixture (version 5)

**Files:**
- Modify: `web/lib/sim/params.ts` (`INTERVENTION_TYPES`, `TYPE_ALIASES`, `InterventionSchema`, the day-0 folding, `RunSchema`), `web/lib/tools/advanced.ts` (unchanged refusal of `interventions[]`; `run.fit.*` allowed), `scripts/export_parity_fixtures.py`, `web/tests/fixtures/parity.json`
- Test: `web/tests/sim/params.test.ts`, `web/tests/sim/parity.test.ts`, `web/tests/sim/registry.test.ts`, `tests/test_web_exports.py`

**Interfaces:**
- Consumes: the registry export (Task 1).
- Produces: `INTERVENTION_TYPES` with the two reductions, `LAYERS`, `FIT_TARGETS`, `FIT_LEVERS`, `FitSchema`, `InterventionSchema` with every new field, `isDay0Immunity(i)`, `isV1Treatment(i)`; fixture version 5 with intervention and fit cases; `REGISTRY_VERSION` 4.

- [ ] **Step 1: Write the failing tests**

In `web/tests/sim/params.test.ts` add a describe block:

```ts
describe("interventions and the fit (Part 2, section 7)", () => {
  it("fills the entry defaults, keeps the day-0 fold at full efficacy only and checks the layer and the window", () => {
    const p = must({ schema_version: 2, network: { network_type: "hybrid" }, interventions: [
      { type: "vaccine", coverage: 0.5, start_day: 30 }, { type: "treatment", coverage: 0.8, capacity: 20 },
      { type: "contact_reduction", layer: "school", scale: 0, start_day: 30, end_day: 72 }, { type: "transmission_reduction", scale: 0.3, end_day: 90 },
      { type: "seasonality", scale: 0.2, peak_day: 91 }] });
    expect(p.interventions[0]).toMatchObject({ kind: "routine", end_day: null, efficacy: 1, leaky: true, age_min: null, age_max: null, protection_days: null });
    expect(p.interventions[1]).toMatchObject({ delay_days: 0, rel_trans_treated: 1, symptomatic_only: false, efficacy: 1 });
    expect(p.interventions[2]).toMatchObject({ layer: "school", scale: 0, start_day: 30, end_day: 72 });
    expect(p.interventions[4].shift).toBeCloseTo(91 / 365, 9);
    expect(isV1Treatment(p.interventions[1])).toBe(true);
    expect(must({ schema_version: 2, interventions: [{ type: "vaccine", coverage: 0.4, start_day: 0 }] })).toMatchObject({ disease: { initial_immune_frac: 0.4 }, interventions: [] });
    const leaky = must({ schema_version: 2, interventions: [{ type: "vaccine", coverage: 0.4, start_day: 0, efficacy: 0.6 }] });
    expect(leaky.disease.initial_immune_frac).toBe(0);
    expect(leaky.interventions[0]).toMatchObject({ efficacy: 0.6, start_day: 0 });
    expect(validateParams({ schema_version: 2, interventions: [{ type: "contact_reduction", layer: "school", scale: 0.5 }] })).toEqual({ ok: false, error: expect.stringContaining("layer school needs the hybrid network") });
    expect(validateParams({ schema_version: 2, interventions: [{ type: "transmission_reduction", scale: 0.5, start_day: 40, end_day: 10 }] })).toEqual({ ok: false, error: expect.stringContaining("end_day") });
    expect(must({ schema_version: 2, run: { fit: { target: "attack_rate", value: 0.3 } } }).run.fit).toEqual({ target: "attack_rate", value: 0.3, lever: "disease.beta" });
    expect(validateParams({ schema_version: 2, run: { fit: { target: "attack_rate", value: 1.5 } } })).toEqual({ ok: false, error: expect.stringContaining("fraction") });
    expect(must({ schema_version: 2 }).run.fit).toBeNull();
    expect(must({ schema_version: 2, interventions: [{ type: "school_closure", layer: "school", scale: 0 }], network: { network_type: "hybrid" } }).interventions[0].type).toBe("contact_reduction");
  });
});
```

(import `isV1Treatment` from `@/lib/sim/params`.) Set the registry version pin to 4 and the parity pin to 5; in the parity loop keep the existing checks (`approxR0`, `maxR0`, `weightedCfr`, `calibrate`, `recalibrate`, `approximate`) and add, for `c.input.interventions`, `expect(must(c.input).interventions.length).toBe((c as { n_interventions: number }).n_interventions)` (the Python side records how many entries survive validation, so the day-0 fold agrees).

- [ ] **Step 2: Run them and watch them fail**

Run (from `web/`): `npx vitest run tests/sim`
Expected: the new block fails on unknown types and fields; the pins fail.

- [ ] **Step 3: The mirror**

In `web/lib/sim/params.ts`: `export const INTERVENTION_TYPES = ["vaccine", "treatment", "seasonality", "contact_reduction", "transmission_reduction"] as const;`, `export const LAYERS = ["all", "household", "school", "work", "community"] as const;`, `export const FIT_TARGETS = ["attack_rate", "peak_day", "peak_infections"] as const;`, `export const FIT_LEVERS = ["disease.beta", "network.network_beta"] as const;`; extend `TYPE_ALIASES` with the five aliases of Task 1. Replace `InterventionSchema` with:

```ts
export const InterventionSchema = z
  .preprocess((v) => {
    // peak_day is an input alias of shift (a day of the year)
    if (typeof v === "object" && v !== null && "peak_day" in v) {
      const { peak_day, ...rest } = v as Record<string, unknown>;
      return peak_day === null || peak_day === undefined || "shift" in rest ? rest : { ...rest, shift: (Number(peak_day) / 365) % 1 };
    }
    return v;
  }, z.object({
    type: z.preprocess((v) => (typeof v === "string" ? (TYPE_ALIASES[v.toLowerCase()] ?? v) : v), z.enum(INTERVENTION_TYPES)),
    coverage: nullable(z.number().min(0).max(1)),
    start_day: z.number().int().min(0).default(0),
    end_day: nullable(z.number().int().min(0)),
    efficacy: z.number().min(0).max(1).default(1),
    kind: z.enum(["routine", "campaign"]).default("routine"),
    leaky: z.boolean().default(true),
    age_min: nullable(z.number().int().min(0).max(120)),
    age_max: nullable(z.number().int().min(0).max(120)),
    protection_days: nullable(z.number().int().min(1)),
    capacity: nullable(z.preprocess((v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v) : v), z.number().int().min(1))),
    delay_days: z.number().int().min(0).max(365).default(0),
    rel_trans_treated: z.number().min(0).max(1).default(1),
    symptomatic_only: z.boolean().default(false),
    scale: z.number().min(0).max(1).default(0.2),
    shift: z.number().min(0).max(1).default(0),
    layer: z.enum(LAYERS).default("all"),
  }).superRefine((i, ctx) => {
    if (i.end_day !== null && i.end_day < i.start_day) issue(ctx, "interventions[].end_day must not be before start_day");
    if (i.age_min !== null && i.age_max !== null && i.age_min >= i.age_max) issue(ctx, "interventions[].age_min must be below age_max");
  }));
export type Intervention = z.infer<typeof InterventionSchema>;
export const isDay0Immunity = (i: Intervention): boolean => i.type === "vaccine" && i.start_day <= 0 && i.efficacy >= 1;
export const isV1Treatment = (i: Intervention): boolean => i.type === "treatment" && i.delay_days === 0 && i.efficacy >= 1 && i.rel_trans_treated >= 1 && !i.symptomatic_only && i.end_day === null;
export const FitSchema = z.object({
  target: z.enum(FIT_TARGETS),
  value: z.number().gt(0),
  lever: z.enum(FIT_LEVERS).default("disease.beta"),
}).superRefine((f, ctx) => {
  if (f.target === "attack_rate" && f.value > 1) issue(ctx, "run.fit.value is a fraction for attack_rate");
  if (f.target === "peak_day" && f.value < 1) issue(ctx, "run.fit.value is a day for peak_day");
});
```

(Keep the existing `capacity` preprocess exactly as the file has it; the line above copies the current one.) Add `fit: nullable(FitSchema),` to `RunSchema`. In `SimParamsSchema`'s day-0 folding (read it where `initial_immune_frac` is set from a day-0 vaccine, around lines 140–160) use `isDay0Immunity` for both the selection and the removal, and add the layer rule: in the same refinement, `if (p.network.network_type !== "hybrid") for (const i of p.interventions) if (i.type === "contact_reduction" && i.layer !== "all") issue(ctx, \`interventions[].layer ${i.layer} needs the hybrid network; the ${p.network.network_type} network has no layers, use all\`);` (match the Python message exactly: the parity fixture's `warnings` cases do not cover it, but the executor's tool tests compare messages). In `web/lib/tools/advanced.ts`, leave the `interventions[]` refusal; `run.fit.target` and friends are ordinary paths.

- [ ] **Step 4: The fixture**

In `scripts/export_parity_fixtures.py`'s `random_params`, draw interventions: with probability 0.6 a list of one to three entries among `{"type": "vaccine", "coverage": r, "start_day": rng.choice([0, 0, 30, 120]), "efficacy": rng.choice([1.0, 1.0, 0.6, 0.9]), "kind": rng.choice(["routine", "campaign"]), "protection_days": rng.choice([None, None, 180])}`, `{"type": "treatment", "coverage": r, "capacity": rng.choice([None, 20, 200]), "delay_days": rng.choice([0, 0, 2]), "efficacy": rng.choice([1.0, 0.7]), "rel_trans_treated": rng.choice([1.0, 0.5])}`, `{"type": "seasonality", "scale": round(rng.uniform(0, 0.5), 2)}`, `{"type": "contact_reduction", "layer": rng.choice(["all", "school", "community"]) if network_type == "hybrid" else "all", "scale": round(rng.uniform(0, 1), 2), "start_day": 30, "end_day": rng.choice([None, 72])}`, `{"type": "transmission_reduction", "scale": round(rng.uniform(0, 0.8), 2), "start_day": rng.choice([0, 14]), "end_day": rng.choice([None, 90])}`; with probability 0.3 `run["fit"] = {"target": rng.choice(["attack_rate", "peak_day", "peak_infections"]), "value": …valid for the target…, "lever": rng.choice(["disease.beta", "network.network_beta"])}`. Each case adds `"n_interventions": len(p.interventions)`. Version 5. Regenerate, restore end-of-line rewrites, move the Python parity pin to 5.

- [ ] **Step 5: Run everything that reads the fixture**

Run (from `web/`): `npx vitest run && npm run typecheck && npm run lint`; from the root `.venv/Scripts/python.exe -m pytest tests/test_web_exports.py -q -p no:cacheprovider`. Expected: all pass (older TypeScript tests that pin whole intervention objects, for example the default-filling test's `interventions: []` and `configureSimulation.test.ts`'s `toMatchObject` on entries, keep passing; a test that pins a whole entry with `toEqual` gains the new defaults).

- [ ] **Step 6: Commit**

```bash
git add web/lib/sim/params.ts web/lib/tools/advanced.ts scripts/export_parity_fixtures.py web/tests/fixtures/parity.json web/tests/sim/params.test.ts web/tests/sim/parity.test.ts web/tests/sim/registry.test.ts tests/test_web_exports.py
git commit -m "feat(web): the intervention entries' fields, the reductions and the fit in TypeScript; parity fixture v5"
```

---

### Task 3: Products, deliveries and reductions in the simulation

**Files:**
- Modify: `epichat/sim/products.py`, `epichat/sim/interventions.py`, `epichat/sim/connectors.py`, `epichat/sim/models.py`, `epichat/sim/builder.py`
- Test: `tests/test_sim_interventions.py`, `tests/test_sim_builder.py`, `tests/test_sim_parity.py` (unchanged, must stay green)

**Interfaces:**
- Consumes: `Intervention` (Task 1), `TransmissionModifiers`, `Vaccine`, `EpiChatDisease`.
- Produces: `Vaccine(efficacy, leaky, protection_days=None)` writing `vaccine_protection` and `vaccine_expires` (a new `FloatArr` state, default inf, on every EpiChat disease; `compose_rel_sus` restores protection 1 when `ti >= vaccine_expires`); `treatment_factor` (new `FloatArr` state, default 1) multiplied into `rel_trans` by the connector; `Treatment(efficacy)` product with `administer(uids) -> dict(successful, unsuccessful)` (cured agents recover on the next step; every treated agent's `treatment_factor` returns to 1); `TreatmentDelivery(product, prob, max_capacity, start_day, end_day, delay_days, rel_trans_treated, symptomatic_only)` with `.queue`, `.treated` (a `ss.BoolArr`); `ContactReduction(layer, scale, start_day, end_day)` scaling the targeted networks' edge betas (and `pars.beta`, and each `MixingPool.pars.beta`) over the window and restoring them after; `TransmissionModifiers(disease, seasonality_scale, seasonality_shift, reductions=())` where `reductions` is a tuple of `(start_day, end_day | None, scale)` and the factor is `seasonal × Π(1 − scale)` over the active windows, times `treatment_factor` per agent; `builder.vaccine_delivery(entry, run_days)`, `builder.age_eligibility(age_min, age_max)`, `build_interventions` handling every type, `build_sim` passing the reductions to the connector.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_sim_interventions.py` (the file's `build(name, interventions, days, n_agents, init_prev, beta, **pars)` helper builds a bare sim with `ss.RandomNet(n_contacts=4)`; the tests below go through `build_sim` where a product or connector is needed):

```python
def test_a_campaign_reaches_its_coverage_within_its_window():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001}, "interventions": [{"type": "vaccine", "kind": "campaign", "coverage": 0.6, "start_day": 10, "end_day": 19}],
                                    "run": {"n_agents": 4000, "sim_dur_years": 40 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    vaccinated = np.asarray(sim.diseases[0].vaccine_protection) < 1.0
    assert abs(vaccinated.mean() - 0.6) < 0.03                                               # the whole window, 10 days, reaches 60%
    vx = next(i for i in sim.interventions.values() if isinstance(i, ss.routine_vx))
    ti = np.asarray(vx.ti_vaccinated)
    assert np.nanmin(ti) >= 10 and np.nanmax(ti) <= 19


def test_a_leaky_vaccine_halves_rel_sus_and_waning_restores_it():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001}, "interventions": [{"type": "vaccine", "kind": "campaign", "coverage": 1.0, "start_day": 5, "end_day": 5,
                                                                                    "efficacy": 0.5, "protection_days": 10}],
                                    "run": {"n_agents": 1000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.init()
    disease = sim.diseases[0]
    for _ in range(8):
        sim.run_one_step()
    susceptible = np.asarray(disease.susceptible)
    assert np.allclose(np.asarray(disease.rel_sus)[susceptible], 0.5)                         # day 7: everyone vaccinated on day 5 keeps half
    for _ in range(10):
        sim.run_one_step()
    assert np.allclose(np.asarray(disease.rel_sus)[np.asarray(disease.susceptible)], 1.0)     # day 17: the 10-day protection has worn off
    allornothing = SimParamsV2.model_validate({"disease": {"beta": 0.001}, "interventions": [{"type": "vaccine", "kind": "campaign", "coverage": 1.0, "start_day": 5, "end_day": 5, "efficacy": 0.5, "leaky": False}],
                                               "run": {"n_agents": 2000, "sim_dur_years": 10 / 365, "rand_seed": 1}})
    sim = build_sim(allornothing)
    sim.run()
    protection = np.asarray(sim.diseases[0].vaccine_protection)
    assert set(np.unique(protection)) <= {0.0, 1.0} and 0.4 < (protection == 0.0).mean() < 0.6


def test_a_day_zero_vaccine_with_efficacy_below_one_is_a_one_day_campaign():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001}, "interventions": [{"type": "vaccine", "coverage": 1.0, "start_day": 0, "efficacy": 0.3}],
                                    "run": {"n_agents": 500, "sim_dur_years": 5 / 365, "rand_seed": 1}})
    assert p.disease.initial_immune_frac == 0.0 and len(p.interventions) == 1
    sim = build_sim(p)
    sim.run()
    assert np.allclose(np.asarray(sim.diseases[0].vaccine_protection), 0.7)


def test_vaccination_by_age_reaches_only_the_range():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001}, "interventions": [{"type": "vaccine", "kind": "campaign", "coverage": 1.0, "start_day": 1, "end_day": 1, "age_min": 5, "age_max": 18}],
                                    "demographics": {"age_pct_under18": 40.0, "age_pct_18_64": 50.0, "age_pct_over65": 10.0},
                                    "run": {"n_agents": 3000, "sim_dur_years": 5 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    age = np.asarray(sim.people.age)
    sim.run()
    protected = np.asarray(sim.diseases[0].vaccine_protection) == 0.0
    assert protected[(age >= 5) & (age < 18)].mean() > 0.99 and not protected[(age < 5) | (age >= 18)].any()


def test_treatment_with_a_delay_waits_and_halves_transmissibility_while_waiting():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001, "dur_inf": {"mean_days": 30}, "seed": {"mode": "count", "value": 100}},
                                    "interventions": [{"type": "treatment", "coverage": 1.0, "capacity": 10, "delay_days": 3, "efficacy": 1.0, "rel_trans_treated": 0.5}],
                                    "run": {"n_agents": 1000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.init()
    disease = sim.diseases[0]
    recovered_by_day = []
    for day in range(8):
        sim.run_one_step()
        recovered_by_day.append(int(disease.recovered.count()))
    assert recovered_by_day[2] == 0 and recovered_by_day[4] >= 10                             # nobody before the 3-day delay; 10 a day after it
    waiting = np.asarray(disease.infectious) & (np.asarray(disease.treatment_factor) < 1.0)
    assert waiting.sum() > 50 and np.allclose(np.asarray(disease.rel_trans)[waiting], 0.5 * np.asarray(disease.rel_trans_base)[waiting])


def test_treatment_efficacy_cures_a_share_and_symptomatic_only_skips_the_asymptomatic():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001, "dur_inf": {"mean_days": 30}, "seed": {"mode": "count", "value": 400}},
                                    "interventions": [{"type": "treatment", "coverage": 1.0, "efficacy": 0.5}],
                                    "run": {"n_agents": 1000, "sim_dur_years": 3 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    assert 150 < int(sim.diseases[0].recovered.count()) < 250                                   # half of 400 cured on the first treated day
    seiar = SimParamsV2.model_validate({"disease": {"model": "seiar", "beta": 0.001, "dur_exp": {"mean_days": 1}, "dur_inf": {"mean_days": 30}, "p_asymp": 0.5, "seed": {"mode": "count", "value": 400}},
                                        "interventions": [{"type": "treatment", "coverage": 1.0, "symptomatic_only": True}],
                                        "run": {"n_agents": 1000, "sim_dur_years": 6 / 365, "rand_seed": 1}})
    sim = build_sim(seiar)
    sim.run()
    d = sim.diseases[0]
    assert int(d.asymptomatic.count()) > 100 and int(d.recovered.count()) > 100
    assert not np.any(np.asarray(d.recovered) & np.asarray(sim.interventions[-1].treated) & np.asarray(d.asymptomatic))  # no asymptomatic agent was treated


def test_a_school_closure_removes_the_school_layers_transmission_for_its_window():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    base = {"disease": {"beta": 300.0, "dur_inf": {"mean_days": 3}, "seed": {"mode": "count", "value": 30}}, "network": {"network_type": "hybrid", "community_contacts": 0, "work_contacts": 0, "household_size": 1.0},
            "demographics": {"age_pct_under18": 50.0, "age_pct_18_64": 45.0, "age_pct_over65": 5.0}, "run": {"n_agents": 3000, "sim_dur_years": 20 / 365, "rand_seed": 1}}
    open_ = build_sim(SimParamsV2.model_validate(base))
    open_.run()
    closed = SimParamsV2.model_validate({**base, "interventions": [{"type": "contact_reduction", "layer": "school", "scale": 0.0, "start_day": 0, "end_day": 9}]})
    sim = build_sim(closed)
    sim.run()
    new = np.asarray(sim.results.sir.new_infections.values)
    assert new[1:10].sum() == 0 and new[11:].sum() > 0                                           # nothing while closed, infections once it reopens
    assert open_.results.sir.new_infections.values[1:10].sum() > 0
    s = sim.networks["s"]
    assert np.allclose(np.asarray(s.edges.beta), s.pars.beta) and s.pars.beta > 0                # betas restored after the window


def test_a_transmission_reduction_scales_the_connectors_factor_over_its_window():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"interventions": [{"type": "transmission_reduction", "scale": 0.3, "start_day": 5, "end_day": 10}, {"type": "seasonality", "scale": 0.2}],
                                    "run": {"n_agents": 500, "sim_dur_years": 15 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    factors = np.array(sim.connectors[0].factors)
    seasonal = np.array([sim.connectors[0].seasonal(ti) for ti in range(len(factors))])
    assert np.allclose(factors[:5], seasonal[:5]) and np.allclose(factors[5:11], 0.7 * seasonal[5:11]) and np.allclose(factors[11:], seasonal[11:])


def test_a_v1_shaped_treatment_still_runs_through_simple_treatment():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"interventions": [{"type": "treatment", "coverage": 0.5, "capacity": 20, "start_day": 3}], "run": {"n_agents": 500, "sim_dur_years": 5 / 365}})
    assert any(isinstance(i, SimpleTreatment) for i in build_sim(p).interventions.values())
    rich = SimParamsV2.model_validate({"interventions": [{"type": "treatment", "coverage": 0.5, "capacity": 20, "start_day": 3, "delay_days": 1}], "run": {"n_agents": 500, "sim_dur_years": 5 / 365}})
    assert not any(isinstance(i, SimpleTreatment) for i in build_sim(rich).interventions.values())
```

(`sim.run_one_step()` is Starsim's single-step method; if 3.7.2 names it `sim.step()`, use that.) Add to `tests/test_sim_builder.py`:

```python
def test_routine_vaccines_end_on_their_end_day_and_campaigns_use_a_per_day_probability():
    from epichat.sim.builder import vaccine_delivery
    from epichat.schema import Intervention
    routine = vaccine_delivery(Intervention(type="vaccine", coverage=0.5, start_day=30, end_day=120), run_days=365)
    assert isinstance(routine, ss.routine_vx) and routine.annual_prob and float(routine.prob[0]) == 0.5
    assert routine.start_year == pytest.approx(30 / 365) and routine.end_year == pytest.approx(120 / 365)
    campaign = vaccine_delivery(Intervention(type="vaccine", kind="campaign", coverage=0.6, start_day=10, end_day=19), run_days=365)
    assert not campaign.annual_prob and float(campaign.prob[0]) == pytest.approx(1 - (1 - 0.6) ** (1 / 10))
    whole_run = vaccine_delivery(Intervention(type="vaccine", kind="campaign", coverage=0.6, start_day=0), run_days=100)
    assert float(whole_run.prob[0]) == pytest.approx(1 - (1 - 0.6) ** (1 / 101))
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_interventions.py tests/test_sim_builder.py -q -p no:cacheprovider -k "campaign or leaky or day_zero_vaccine or by_age or delay or efficacy_cures or school_closure or transmission_reduction or v1_shaped or end_on_their"`
Expected: failures on missing names (`vaccine_delivery`, `treatment_factor`, `vaccine_expires`) and on `ValueError` from the builder for unknown types.

- [ ] **Step 3: The states and the connector**

In `epichat/sim/models.py` add two states to `EpiChatDisease.__init__`'s `define_states`: `ss.FloatArr("vaccine_expires", default=np.inf, label="Step the vaccine's protection ends")` and `ss.FloatArr("treatment_factor", default=1.0, label="Transmissibility while waiting for treatment")`; in `compose_rel_sus`, before composing: `expired = np.asarray(self.vaccine_expires.raw) <= self.ti; if expired.any(): self.vaccine_protection.raw[expired] = 1.0; self.vaccine_expires.raw[expired] = np.inf`. In `epichat/sim/connectors.py`:

```python
class TransmissionModifiers(ss.Connector):
    def __init__(self, disease: str, seasonality_scale: float = 0.0, seasonality_shift: float = 0.0, reductions=()):
        super().__init__()
        self.disease_name = disease
        self.scale = float(seasonality_scale)
        self.shift = float(seasonality_shift)
        self.reductions = [(int(start), None if end is None else int(end), float(scale)) for start, end, scale in reductions]
        self.factors: list[float] = []

    def seasonal(self, ti: int) -> float:
        if self.scale == 0.0:
            return 1.0
        frac_year = (ti / 365.0) % 1.0
        return max(0.0, 1.0 + self.scale * math.cos(2 * math.pi * (frac_year - self.shift)))

    def factor(self) -> float:
        f = self.seasonal(self.ti)
        for start, end, scale in self.reductions:           # Part 2, 7.1: transmission reductions over their windows
            if start <= self.ti and (end is None or self.ti <= end):
                f *= 1.0 - scale
        return f

    def step(self):
        disease = self.sim.diseases[self.disease_name]
        factor = self.factor()
        disease.rel_trans[:] = np.asarray(disease.rel_trans_base) * np.asarray(disease.treatment_factor) * factor
        self.factors.append(factor)
```

(Keep `TransmissibilityModifiers = TransmissionModifiers`; the existing seasonality tests compare `factors` with the formula and keep passing.)

- [ ] **Step 4: The products and the interventions**

`epichat/sim/products.py`:

```python
class Vaccine(ss.Vx):
    """Part 2, 4.2 and 7.2: writes vaccine_protection (leaky: 1 − efficacy for every recipient; all-or-nothing: 0 for a share efficacy)
    and, with protection_days, the step the protection ends; the disease composes rel_sus from it each step."""

    def __init__(self, efficacy: float = 1.0, leaky: bool = True, protection_days: int | None = None):
        super().__init__()
        self.efficacy = float(efficacy)
        self.leaky = bool(leaky)
        self.protection_days = None if protection_days is None else int(protection_days)
        self.takes = ss.bernoulli(p=self.efficacy)

    def administer(self, people, uids):
        protected = uids if self.leaky else self.takes.filter(uids)
        left = 1.0 - self.efficacy if self.leaky else 0.0
        for disease in self.sim.diseases.values():
            if hasattr(disease, "vaccine_protection"):
                disease.vaccine_protection[protected] = left
                disease.rel_sus[protected] = disease.rel_sus[protected] * left
                if self.protection_days is not None:
                    disease.vaccine_expires[protected] = self.sim.ti + self.protection_days
        return protected


class Treatment(ss.Product):
    """Part 2, 7.2: cures a treated agent with probability efficacy (it recovers on the next step) and ends its waiting factor."""

    def __init__(self, efficacy: float = 1.0):
        super().__init__()
        self.efficacy = float(efficacy)
        self.cures = ss.bernoulli(p=self.efficacy)

    def administer(self, uids):
        disease = self.sim.diseases[0]
        cured = self.cures.filter(uids)
        if len(cured):
            disease.ti_recovered[cured] = self.sim.ti + 1
        disease.treatment_factor[uids] = 1.0
        return {"successful": cured, "unsuccessful": np.setdiff1d(np.asarray(uids), np.asarray(cured))}
```

(`import numpy as np`; check `ss.Product.__init__` takes no required arguments and that `ss.Product` has `init_pre(sim)` setting `self.sim`, as `Intervention.init_pre` calls `product.init_pre(self.sim)`.) `epichat/sim/interventions.py` adds:

```python
class TreatmentDelivery(ss.Intervention):
    """Part 2, 7.1: from start_day to end_day, infectious agents (symptomatic ones only when asked) that became infectious at least
    delay_days ago accept treatment with probability prob each day and queue; while queued their transmissibility is rel_trans_treated;
    up to max_capacity a day leave the queue and get the product. Each agent is treated at most once."""

    def __init__(self, product, prob: float = 1.0, max_capacity: int | None = None, start_day: int = 0, end_day: int | None = None,
                 delay_days: int = 0, rel_trans_treated: float = 1.0, symptomatic_only: bool = False):
        super().__init__()
        self.product = product
        self.accepts = ss.bernoulli(p=float(prob))
        self.max_capacity = max_capacity
        self.start_day, self.end_day, self.delay_days = int(start_day), end_day, int(delay_days)
        self.rel_trans_treated = float(rel_trans_treated)
        self.symptomatic_only = bool(symptomatic_only)
        self.define_states(ss.BoolArr("queued", default=False), ss.BoolArr("treated", default=False))
        self.queue: list[int] = []

    def init_pre(self, sim):
        super().init_pre(sim)
        self.product.init_pre(sim)

    def step(self):
        if self.ti < self.start_day or (self.end_day is not None and self.ti > self.end_day):
            return
        disease = self.sim.diseases[0]
        since = getattr(disease, "ti_infectious", None) or disease.ti_infected       # seir family: ti_infectious; sir and sis: ti_infected
        eligible = disease.infectious & ~self.queued & ~self.treated & (since <= self.ti - self.delay_days)
        if self.symptomatic_only and hasattr(disease, "asymptomatic"):
            eligible = eligible & ~disease.asymptomatic
        newly = self.accepts.filter(eligible.uids)
        if len(newly):
            self.queued[newly] = True
            disease.treatment_factor[newly] = self.rel_trans_treated
            self.queue += newly.tolist()
        still = [u for u in self.queue if disease.infectious[ss.uids([u])][0]]          # recovered while waiting: out of the queue
        dropped = ss.uids([u for u in self.queue if u not in still])
        if len(dropped):
            disease.treatment_factor[dropped] = 1.0
            self.queued[dropped] = False
        self.queue = still
        n = len(self.queue) if self.max_capacity is None else min(len(self.queue), int(self.max_capacity))
        if n:
            now = ss.uids(self.queue[:n])
            self.queue = self.queue[n:]
            self.product.administer(now)
            self.queued[now] = False
            self.treated[now] = True


class ContactReduction(ss.Intervention):
    """Part 2, 7.1: scales a network layer's transmissibility (every edge's beta, the pars.beta new edges take, and each mixing pool's
    beta) by 1 − scale from start_day to end_day, restoring the stored values after."""

    LAYERS = {"household": "h", "school": "s", "work": "w", "community": "c"}

    def __init__(self, layer: str = "all", scale: float = 0.0, start_day: int = 0, end_day: int | None = None):
        super().__init__()
        self.layer, self.scale, self.start_day, self.end_day = layer, float(scale), int(start_day), end_day
        self.active = False
        self.base: dict[str, tuple] = {}

    def targets(self):
        nets = self.sim.networks
        if self.layer == "all":
            return list(nets.values())
        key = self.LAYERS[self.layer]
        return [nets[key]] if key in nets else []

    def apply(self, factor: float):
        for net in self.targets():
            if isinstance(net, ss.MixingPools):
                for pool in net.pools:
                    pool.pars.beta = self.base.setdefault(f"{net.name}:{id(pool)}", (float(pool.pars.beta),))[0] * factor
            else:
                base = self.base.setdefault(net.name, (float(net.pars.beta), np.array(net.edges.beta, copy=True)))
                net.pars.beta = base[0] * factor
                net.edges.beta[:] = np.asarray(net.edges.beta) * 0 + base[1][:len(net.edges.beta)] * factor if len(base[1]) == len(net.edges.beta) else base[0] * factor

    def step(self):
        inside = self.start_day <= self.ti and (self.end_day is None or self.ti <= self.end_day)
        if inside and not self.active:
            self.apply(1.0 - self.scale)
            self.active = True
        elif not inside and self.active:
            self.apply(1.0)
            self.active = False
```

For a dynamic random network whose edges are remade every step, `edges.beta` is rebuilt from `pars.beta` each step, so the stored per-edge array only applies to static layers (the hybrid ones); the expression above uses the stored edge betas when the edge count still matches, else the scalar. Simplify if Starsim exposes a cleaner hook (`net.pars.beta` alone suffices when `net.edges.beta` is rebuilt each step: check `RandomNet.add_pairs`); ledger what you find.

- [ ] **Step 5: The builder**

In `epichat/sim/builder.py` import `Treatment` and the two interventions, and replace `build_interventions` with:

```python
def age_eligibility(age_min: int | None, age_max: int | None):
    """Starsim's eligibility callable: the alive agents inside the age range (everyone when no bound is set)."""
    if age_min is None and age_max is None:
        return None

    def eligible(sim):
        age = np.asarray(sim.people.age)
        keep = np.ones(len(age), dtype=bool)
        if age_min is not None:
            keep &= age >= age_min
        if age_max is not None:
            keep &= age < age_max
        return sim.people.auids[keep[np.asarray(sim.people.auids)]] if False else ss.uids(np.flatnonzero(keep))

    return eligible


def vaccine_delivery(entry, run_days: int):
    """Part 2, 7.1: routine coverage is a yearly probability over the window; a campaign reaches its coverage uniformly over it."""
    end_day = run_days if entry.end_day is None else min(entry.end_day, run_days)
    product = Vaccine(efficacy=entry.efficacy, leaky=entry.leaky, protection_days=entry.protection_days)
    kwargs = dict(product=product, start_year=entry.start_day / 365, end_year=end_day / 365, eligibility=age_eligibility(entry.age_min, entry.age_max))
    coverage = entry.coverage or 0.0
    if entry.kind == "campaign":
        days = max(1, end_day - entry.start_day + 1)
        return ss.routine_vx(prob=1 - (1 - coverage) ** (1 / days), annual_prob=False, **kwargs)
    return ss.routine_vx(prob=coverage, **kwargs)


def build_interventions(params: SimParamsV2) -> list:
    d = params.disease
    out = []
    if d.seed.day > 0:
        out.append(SeedInfections(day=d.seed.day, mode=d.seed.mode, value=d.seed.value))
    if d.initial_immune_frac > 0:
        out.append(InitialImmunity(frac=d.initial_immune_frac))
    run_days = sim_days(params.run.sim_dur_years)
    for i in params.interventions:
        if i.type == "treatment" and i.is_v1_treatment():
            out.append(SimpleTreatment(prob=i.coverage if i.coverage is not None else 1.0, max_capacity=i.capacity, start_day=i.start_day))
        elif i.type == "treatment":
            out.append(TreatmentDelivery(Treatment(efficacy=i.efficacy), prob=i.coverage if i.coverage is not None else 1.0, max_capacity=i.capacity,
                                         start_day=i.start_day, end_day=i.end_day, delay_days=i.delay_days, rel_trans_treated=i.rel_trans_treated,
                                         symptomatic_only=i.symptomatic_only))
        elif i.type == "vaccine":
            out.append(vaccine_delivery(i, run_days))
        elif i.type == "contact_reduction":
            out.append(ContactReduction(layer=i.layer, scale=i.scale, start_day=i.start_day, end_day=i.end_day))
    return out
```

(A day-0 vaccine with efficacy 1 never reaches here: the schema folds it. A day-0 vaccine with efficacy below 1 is `kind` routine by default; treat `start_day == 0 and end_day is None and kind == "routine"` the same as the schema's one-day campaign: set `end_day` to 0 and `kind` to campaign in `vaccine_delivery` when `entry.start_day == 0 and entry.efficacy < 1 and entry.end_day is None` — the spec says "a campaign on day 0".) In `build_sim`, the connector gets `reductions=[(i.start_day, i.end_day, i.scale) for i in params.interventions if i.type == "transmission_reduction"]`. Fix `age_eligibility`'s body to the simple form `return ss.uids(np.flatnonzero(keep))` restricted to alive agents (`keep &= np.asarray(sim.people.alive)`); the placeholder expression above is a reminder to restrict to the living, not code to keep.

- [ ] **Step 6: Run the sim suites and the parity baseline**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_interventions.py tests/test_sim_builder.py tests/test_sim_connectors.py tests/test_sim_models.py tests/test_sim_outputs.py tests/test_sim_replicates.py tests/test_sim_run_params.py tests/test_sim_calibrate.py -q -p no:cacheprovider` → all pass; then `.venv/Scripts/python.exe -m pytest tests/test_sim_parity.py -q -p no:cacheprovider` → 6 passed (the v1-shaped entries run through the same objects). A parity failure means the vaccine product call or the treatment path changed for a v1 entry; find which and restore it, never re-capture.

- [ ] **Step 7: Commit**

```bash
git add epichat/sim/products.py epichat/sim/interventions.py epichat/sim/connectors.py epichat/sim/models.py epichat/sim/builder.py tests/test_sim_interventions.py tests/test_sim_builder.py
git commit -m "feat(sim): campaign and routine vaccines with efficacy, ages and waning; treatment with a delay; contact and transmission reductions"
```

---

### Task 4: The fit to a known outcome

**Files:**
- Create: `epichat/sim/fit.py`
- Modify: `epichat/sim/replicates.py`, `epichat/sim/diagnostics.py`
- Test: `tests/test_sim_fit.py` (new), `tests/test_sim_replicates.py`, `tests/test_sim_diagnostics.py`, `sim/tests/test_real_run.py`

**Interfaces:**
- Consumes: `Fit` (Task 1), `build_sim`, `extract`, `REGISTRY_BY_PATH` bounds, `calibrate_by_measurement`.
- Produces: `fit.TOLERANCE = {"attack_rate": 0.02, "peak_day": 3.0, "peak_infections": 0.05}`, `fit.MAX_RUNS = 8`, `fit.outcome(stats, target, n_agents) -> float`, `fit.within(target, achieved, wanted) -> bool`, `fit.fit_lever(p, seed) -> tuple[SimParamsV2, dict | None]` with the dict `{target, wanted, achieved, lever, value, runs}`; `stats["fit"]`; `run_replicates` fits first and skips the measured-R0 calibration when a fit ran; `_final_size_gap` and `_r0_gap` stand down on a fitted run; `well_mixed` stands down when a contact reduction entry exists.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_sim_fit.py`:

```python
"""Part 2, 7.7: a lever bisected on a log scale until one outcome the participant knows is reached."""
import numpy as np
import pytest

from epichat.params.schema_v2 import SimParamsV2
from epichat.sim import fit
from epichat.sim.replicates import run_replicates


def scenario(target: str, value: float, **run) -> SimParamsV2:
    return SimParamsV2.model_validate({"disease": {"dur_inf": {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}, "p_death": 0.0, "seed": {"mode": "count", "value": 50}},
                                       "run": {"n_agents": 10000, "sim_dur_years": 1.0, "rand_seed": 1, "fit": {"target": target, "value": value}, **run}})


def test_outcomes_and_tolerances():
    stats = {"total_infected": 3000, "peak_day": 60, "peak_infections": 400}
    assert fit.outcome(stats, "attack_rate", 10000) == 0.3 and fit.outcome(stats, "peak_day", 10000) == 60 and fit.outcome(stats, "peak_infections", 10000) == 400
    assert fit.within("attack_rate", 0.31, 0.3) and not fit.within("attack_rate", 0.33, 0.3)
    assert fit.within("peak_day", 63, 60) and not fit.within("peak_day", 64, 60)
    assert fit.within("peak_infections", 419, 400) and not fit.within("peak_infections", 425, 400)


def test_no_fit_runs_nothing(monkeypatch):
    monkeypatch.setattr(fit, "evaluate", lambda p, seed: pytest.fail("a run happened without a fit"))
    p = SimParamsV2()
    assert fit.fit_lever(p, 1) == (p, None)


def test_the_attack_rate_is_fitted_within_two_points_in_at_most_eight_runs():
    p = scenario("attack_rate", 0.3)
    fitted, info = fit.fit_lever(p, 1)
    assert info["target"] == "attack_rate" and info["wanted"] == 0.3 and info["lever"] == "disease.beta" and info["runs"] <= fit.MAX_RUNS
    assert abs(info["achieved"] - 0.3) <= 0.02 and fitted.disease.beta == info["value"] and fitted.disease.beta != p.disease.beta


def test_the_peak_day_is_fitted_within_three_days():
    fitted, info = fit.fit_lever(scenario("peak_day", 60), 1)
    assert abs(info["achieved"] - 60) <= 3 and info["runs"] <= fit.MAX_RUNS and fitted.disease.beta == info["value"]


def test_an_unreachable_fit_stops_at_the_levers_bound():
    p = scenario("attack_rate", 0.9, n_agents=2000)
    body = p.model_dump()
    body["network"]["n_contacts"] = 1
    body["disease"]["dur_inf"] = {"mean_days": 2.0, "dist": "constant", "sd_days": None}
    fitted, info = fit.fit_lever(SimParamsV2.model_validate(body), 1)
    assert info["runs"] <= fit.MAX_RUNS and info["achieved"] < 0.9 and fitted.disease.beta == 1000.0            # the registry's upper bound


def test_the_replicates_run_with_the_fitted_lever_and_skip_the_pilot():
    p = scenario("attack_rate", 0.3, n_agents=5000, n_replicates=2)
    payload = run_replicates(p)
    assert set(payload["stats"]["fit"]) == {"target", "wanted", "achieved", "lever", "value", "runs"}
    assert payload["effective_params"]["disease"]["beta"] == payload["stats"]["fit"]["value"]
    assert all(abs(s["total_infected"] / 5000 - 0.3) < 0.06 for s in payload["replicates"]["stats"])
    body = p.model_dump()
    body["network"]["network_type"] = "hybrid"
    hybrid = run_replicates(SimParamsV2.model_validate({**body, "run": {**body["run"], "n_replicates": 1}}))
    assert "fit" in hybrid["stats"] and "r0_calibration" not in hybrid["stats"]                                  # the fit supersedes the pilot
```

Append to `tests/test_sim_diagnostics.py`:

```python
def test_fitted_runs_stand_down_the_final_size_and_r0_gaps_and_a_contact_reduction_stands_down_well_mixed():
    fitted = run(params(), NORMAL, total=3000, seeds=100, stats_extra={"fit": {"target": "attack_rate", "wanted": 0.3, "achieved": 0.3, "lever": "disease.beta", "value": 9.0, "runs": 4}, "r0_measured": 1.1})
    assert "final_size_gap" not in ids(fitted) and "r0_gap" not in ids(fitted)
    assert "final_size_gap" in ids(run(params(), NORMAL, total=3000, seeds=100))
    closed = run(params(interventions=[{"type": "contact_reduction", "layer": "all", "scale": 0.5, "start_day": 10, "end_day": 40}]), NORMAL, total=8600, seeds=100)
    assert "well_mixed" not in ids(closed)
```

(If the file's `params(**over)` helper only takes dotted paths, add an `interventions` keyword to it or build the object with `SimParamsV2.model_validate`.) In `sim/tests/test_real_run.py` add:

```python
def test_a_fitted_run_reports_the_fit_and_the_fitted_beta(client):
    params = {"schema_version": 2, "run": {"n_agents": 2000, "sim_dur_years": 0.5, "rand_seed": 1, "fit": {"target": "attack_rate", "value": 0.4}}}
    r = client.post("/simulate", json={"params": params, "pop_scale": 1}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stats"]["fit"]["runs"] <= 8 and abs(body["stats"]["fit"]["achieved"] - 0.4) <= 0.02
    assert body["effective_params"]["disease"]["beta"] == body["stats"]["fit"]["value"]
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_fit.py -q -p no:cacheprovider -k "outcomes or no_fit"`
Expected: `ModuleNotFoundError: No module named 'epichat.sim.fit'`.

- [ ] **Step 3: Implement**

Create `epichat/sim/fit.py`:

```python
"""Part 2, 7.7: the lever (disease.beta or network.network_beta) bisected on a log scale within its registry bounds until the run's
outcome is within tolerance of the value the participant knows, at most eight full-length runs with the first replicate's seed.
The attack rate and the peak size rise with the lever, the peak day falls with it."""
from __future__ import annotations

import math

from epichat.params.paths import get_path, set_path
from epichat.params.registry import REGISTRY_BY_PATH
from epichat.params.schema_v2 import SimParamsV2

from .builder import build_sim
from .outputs import extract

TOLERANCE = {"attack_rate": 0.02, "peak_day": 3.0, "peak_infections": 0.05}
MAX_RUNS = 8
RISING = {"attack_rate": True, "peak_infections": True, "peak_day": False}


def outcome(stats: dict, target: str, n_agents: int) -> float:
    if target == "attack_rate":
        return float(stats["total_infected"]) / n_agents
    return float(stats[target])


def within(target: str, achieved: float, wanted: float) -> bool:
    tol = TOLERANCE[target]
    gap = abs(achieved - wanted)
    return gap <= tol * wanted if target == "peak_infections" else gap <= tol


def evaluate(p: SimParamsV2, seed: int) -> dict:
    sim = build_sim(p, seed=seed)
    sim.run()
    return extract(sim, p.run.n_agents, sim.seeds_day0, p.demographics.use_demographics)["stats"]


def _with_lever(p: SimParamsV2, lever: str, value: float) -> SimParamsV2:
    body = p.model_dump()
    set_path(body, lever, value)
    return SimParamsV2.model_validate(body)


def fit_lever(p: SimParamsV2, seed: int) -> tuple[SimParamsV2, dict | None]:
    f = p.run.fit
    if f is None:
        return p, None
    lo, hi = REGISTRY_BY_PATH[f.lever].bounds
    value = float(get_path(p.model_dump(), f.lever))
    current = p
    runs, achieved = 0, None
    while runs < MAX_RUNS:
        current = _with_lever(p, f.lever, value)
        achieved = outcome(evaluate(current, seed), f.target, p.run.n_agents)
        runs += 1
        if within(f.target, achieved, f.value):
            break
        too_low = achieved < f.value if RISING[f.target] else achieved > f.value      # the lever must rise
        if too_low:
            lo = value
        else:
            hi = value
        if hi <= lo * (1 + 1e-9) or (too_low and value >= hi) or (not too_low and value <= lo):
            break                                                                        # the bound is the best the lever can do
        value = round(math.sqrt(lo * hi), 6)
    return current, {"target": f.target, "wanted": f.value, "achieved": round(achieved, 4), "lever": f.lever,
                     "value": float(get_path(current.model_dump(), f.lever)), "runs": runs}
```

(`epichat/params/paths.py` has `get_path`/`set_path` for dotted paths; check their names, else use the flatten helpers it exposes.) Note the bracket: the first run uses the current value; when it is too low the lower bound moves up to it and the next value is the geometric midpoint of the new bracket, so a too-low start walks up toward the registry's upper bound and ends there when it cannot reach the target. In `epichat/sim/replicates.py`, before the calibration: `params, fitted = fit_lever(params, seeds[0])`, then `params, calibration = (params, None) if fitted else calibrate_by_measurement(params, seeds[0])`, and after the payload: `if fitted is not None: payload["stats"] = {**payload["stats"], "fit": fitted}`. In `epichat/sim/diagnostics.py`: `_final_size_gap` and `_r0_gap` return `None` when `run.stats.get("fit")`; `_well_mixed` returns `None` when any entry's `type == "contact_reduction"`.

- [ ] **Step 4: Run the tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_fit.py tests/test_sim_replicates.py tests/test_sim_diagnostics.py tests/test_sim_calibrate.py -q -p no:cacheprovider && /c/Users/Yuke/stat/other-projects/EpiChat/epichat/sim/.venv/Scripts/python.exe -m pytest sim/tests/test_real_run.py -q -p no:cacheprovider`
Expected: all pass (the 10k-agent fits take about a minute each).

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/fit.py epichat/sim/replicates.py epichat/sim/diagnostics.py tests/test_sim_fit.py tests/test_sim_diagnostics.py sim/tests/test_real_run.py
git commit -m "feat(sim): a run fitted to one known outcome by bisecting its lever; fitted runs stand down the size and R0 gaps"
```

---

### Task 5: The web tools — structured interventions, the fit field, the vaccine efficacy path

**Files:**
- Modify: `web/lib/tools/configureSimulation.ts`, `web/lib/tools/index.ts`, `web/lib/tools/types.ts`, `web/lib/sim/client.ts`, `web/lib/tools/fetchVaccinationCoverage.ts`, `web/lib/tools/runSimulation.ts`, `web/lib/tools/shared.ts`
- Test: `web/tests/tools/configureSimulation.test.ts`, `web/tests/tools/fetchTools.test.ts`, `web/tests/tools/runSimulation.test.ts`, `web/tests/tools/registry.test.ts`

**Interfaces:**
- Consumes: `InterventionSchema`, `FitSchema`, `isDay0Immunity` (Task 2); `lookup(disease)` with a `vaccine_efficacy` parameter summary when the database carries it.
- Produces: `configure_simulation` inputs `interventions` (an array of entries; each upserted by `type`, and by `type` + `layer` for contact reductions), `remove_interventions` (an array of types, or `"type:layer"` for a contact reduction), `fit` (an object, or `null` to clear); `shared.upsertIntervention` keyed by type and layer; `SimStats.fit?: { target: string; wanted: number; achieved: number; lever: string; value: number; runs: number } | null`; `RunPayload.applied` gains `{ beta_fitted_to_<target>: value }` (lever name in the key) when `stats.fit` exists; `fetch_vaccination_coverage` writes a day-0 campaign with the database's efficacy when `lookup(disease)?.parameters?.vaccine_efficacy?.typical` exists, else initial immunity as today; the tool descriptions.

- [ ] **Step 1: Write the failing tests**

In `web/tests/tools/configureSimulation.test.ts`:

```ts
describe("configure_simulation interventions and fit (Part 2, 7.4, 7.7)", () => {
  it("upserts structured entries by type and layer, removes by type, and keeps the shortcut fields", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", network_type: "hybrid", interventions: [
      { type: "contact_reduction", layer: "school", scale: 0, start_day: 30, end_day: 72 }, { type: "transmission_reduction", scale: 0.3, start_day: 0, end_day: 90 },
      { type: "vaccine", kind: "campaign", coverage: 0.7, start_day: 10, end_day: 40, efficacy: 0.8 }] });
    let p = deps.scenario.params!;
    expect(p.interventions.map((i) => `${i.type}:${i.layer}`)).toEqual(["contact_reduction:school", "transmission_reduction:all", "vaccine:all"]);
    await run(deps, { interventions: [{ type: "contact_reduction", layer: "community", scale: 0.5 }, { type: "vaccine", kind: "campaign", coverage: 0.9, start_day: 10, end_day: 40, efficacy: 0.8 }] });
    p = deps.scenario.params!;
    expect(p.interventions.filter((i) => i.type === "contact_reduction").map((i) => i.layer)).toEqual(["school", "community"]);
    expect(p.interventions.find((i) => i.type === "vaccine")).toMatchObject({ coverage: 0.9, efficacy: 0.8, kind: "campaign" });
    const out = JSON.parse((await run(deps, { remove_interventions: ["transmission_reduction", "contact_reduction:school"], seasonality_scale: 0.2 })).content);
    p = deps.scenario.params!;
    expect(p.interventions.map((i) => `${i.type}:${i.layer}`)).toEqual(["contact_reduction:community", "vaccine:all", "seasonality:all"]);
    expect(out.applied.remove_interventions).toEqual(["transmission_reduction", "contact_reduction:school"]);
    expect(out.config.interventions).toEqual(["contact_reduction", "vaccine", "seasonality"]);
    const bad = await run(deps, { interventions: [{ type: "contact_reduction", layer: "roads", scale: 0.5 }] });
    expect(bad.isError).toBe(true);
    const random = makeDeps();
    const refused = await run(random, { disease: "measles", interventions: [{ type: "contact_reduction", layer: "school", scale: 0 }] });
    expect(refused.content).toContain("layer school needs the hybrid network");
  });

  it("sets and clears the fit, converting a peak size in people to agents when a population is known", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", n_agents: 10000, fit: { target: "attack_rate", value: 0.3 } });
    expect(deps.scenario.params!.run.fit).toEqual({ target: "attack_rate", value: 0.3, lever: "disease.beta" });
    deps.scenario.totalPopulation = 1_000_000;
    const out = JSON.parse((await run(deps, { fit: { target: "peak_infections", value: 50000 } })).content);
    expect(deps.scenario.params!.run.fit).toEqual({ target: "peak_infections", value: 500, lever: "disease.beta" });
    expect(out.applied.fit).toEqual({ target: "peak_infections", value: 50000, value_in_agents: 500 });
    await run(deps, { fit: null });
    expect(deps.scenario.params!.run.fit).toBeNull();
    const bad = await run(deps, { fit: { target: "attack_rate", value: 3 } });
    expect(bad.isError).toBe(true);
  });
});
```

In `web/tests/tools/fetchTools.test.ts` (`fetch_vaccination_coverage` describe):

```ts
  it("writes a day-0 campaign with the database's vaccine efficacy when the database carries one", async () => {
    const deps = await configured(makeDeps({ whoGho: [rf("mcv1_coverage", 88, "WHO GHO, KEN, 2022")], lookup: { measles: { vaccine_efficacy: { status: "ok", typical: 0.93, n_estimates: 2 } } } }), { disease: "measles" });
    const out = JSON.parse((await fetchVaccinationCoverage({ country_iso3: "KEN", disease: "measles" }, deps)).content);
    const p = deps.scenario.params!;
    expect(p.disease.initial_immune_frac).toBe(0);
    expect(p.interventions.find((i) => i.type === "vaccine")).toMatchObject({ kind: "campaign", coverage: 0.88, start_day: 0, end_day: 0, efficacy: 0.93 });
    expect(out.applied).toMatchObject({ applied_vaccine_coverage: 0.88, applied_vaccine_efficacy: 0.93 });
  });
```

(`makeDeps` must accept a `lookup` override that patches the disease entries the tool reads; add it to `tests/tools/helpers.ts` if `makeDeps` lacks one, as a map of canonical names to parameter summaries merged into `lookup`'s result through a `deps.lookup` function the tool calls — read how `fetchVaccinationCoverage` reaches the database today and thread `deps.lookupDisease ?? lookup`.) In `web/tests/tools/runSimulation.test.ts`:

```ts
  it("notes a fitted beta", async () => {
    const result = success();
    result.stats = { ...result.stats, fit: { target: "attack_rate", wanted: 0.3, achieved: 0.31, lever: "disease.beta", value: 9.5, runs: 4 } };
    result.effective_params = { ...result.effective_params, disease: { ...result.effective_params.disease, beta: 9.5 } };
    const deps = makeDeps({ simulate: result, runId: "run-3" });
    deps.scenario.params = params({ disease_type: "sir" });
    const out = await runSimulation({}, deps);
    expect((out.payload as { applied?: Record<string, unknown> }).applied).toEqual({ beta_fitted_to_attack_rate: 9.5 });
  });
```

In `web/tests/tools/registry.test.ts` the configure tool has 25 properties (`interventions`, `remove_interventions`, `fit` after `household_size`).

- [ ] **Step 2: Run them and watch them fail**

Run (from `web/`): `npx vitest run tests/tools`
Expected: the new tests fail (unknown input fields; no `fit` note).

- [ ] **Step 3: Implement**

`web/lib/tools/shared.ts`: `upsertIntervention(list, kind, fields, layer?)` keeps entries whose `type` differs, or whose `type` matches but whose `layer` differs when `layer` is given (contact reductions). `configureSimulation.ts`: inputs `interventions: opt(z.array(z.record(z.unknown())))`, `remove_interventions: opt(z.array(z.string()))`, `fit: z.record(z.unknown()).nullable().optional()`; after the shortcut fields: for each entry of `input.interventions` (after the type alias normalisation through `InterventionSchema.safeParse` on the entry alone, so a bad entry names the problem), upsert by type and, for `contact_reduction`, by layer; `applied.interventions = input.interventions`; for each of `remove_interventions` split on `:` into type and optional layer and filter; `applied.remove_interventions`. For `fit`: `null` clears (`run.fit = null`, `applied.fit = null`); an object is validated by `FitSchema.safeParse`; when `target === "peak_infections"` and `scenario.totalPopulation` is set, the value is divided by `totalPopulation / n_agents` and rounded to an integer, and `applied.fit = { ...input.fit, value_in_agents }`; else `applied.fit = input.fit`. `index.ts`: the three properties with descriptions (`interventions`: "A list of intervention entries, each with a type (vaccine, treatment, seasonality, contact_reduction, transmission_reduction) and its fields: coverage, start_day, end_day, efficacy, kind (routine or campaign), leaky, age_min, age_max, protection_days, capacity, delay_days, rel_trans_treated, symptomatic_only, scale, shift or peak_day, layer (household, school, work, community or all; the hybrid network only). Each entry replaces the one of the same type (and layer)."; `remove_interventions`: "Types to drop, or type:layer for a contact reduction."; `fit`: "Fit the run to one known outcome: {target: attack_rate | peak_day | peak_infections, value, lever?: disease.beta | network.network_beta}; peak_infections is in people when a population is known. null clears the fit."). `types.ts`/`client.ts`: `SimStats.fit`. `runSimulation.ts`: `applied` gains `[`${lever.split(".").pop()}_fitted_to_${fit.target}`]: value` (`beta_fitted_to_attack_rate`). `fetchVaccinationCoverage.ts`: `const efficacy = lookup(canonical)?.parameters?.vaccine_efficacy?.typical`; when a number in (0, 1], write `interventions: upsertIntervention(list, "vaccine", { kind: "campaign", coverage, start_day: 0, end_day: 0, efficacy })` instead of `initial_immune_frac`, with `applied.applied_vaccine_efficacy = efficacy`; the "once" guard checks both `getVaccine` and `initial_immune_frac`.

- [ ] **Step 4: Run the web suites**

Run (from `web/`): `npx vitest run && npm run typecheck && npm run lint`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/lib/tools web/lib/sim/client.ts web/tests/tools
git commit -m "feat(web): structured interventions, remove_interventions and fit in configure_simulation; the database vaccine efficacy path"
```

---

### Task 6: Panel lines, the report and the prompt's Interventions section

**Files:**
- Modify: `web/lib/client/format.ts` (`interventionLines`, `parameterRows`, `FIELDS`, `EFFECTIVE_PARAM_PATHS`), `web/lib/report/compose.ts` (the fit in the Parameters block), `web/lib/chat/prompt.ts`
- Test: `web/tests/client/format.test.ts`, `web/tests/chat/prompt.test.ts`, `web/tests/report/compose.test.ts`

**Interfaces:**
- Produces: `interventionLines` for the five types ("Vaccination campaign: 70% coverage, days 10–40, efficacy 80%, ages 5–17, protection 180 days"; "Treatment: 100% coverage, capacity 20 agents, after 3 days, efficacy 70%, half transmissibility while waiting, symptomatic only"; "School contacts reduced by 100% from day 30 to day 72"; "Transmission reduced by 30% from day 0 to day 90"; seasonality as today), a "Fitted to" row in `parameterRows` when `run.fit` is set ("attack rate 30% by moving the transmission rate"), `describeField` labels for `applied_vaccine_efficacy`, `fit`, `remove_interventions`, `beta_fitted_to_*`; the report's Parameters block gains ["Fitted to", …] from the latest run's `stats.fit` ("attack rate 30% (reached 31%, 4 runs)"); the prompt's "## Interventions" section (translations of "schools closed from day 30 for six weeks" and "masks for the first three months", the illustrative label, the database efficacy, the fit and its limitation sentence).

- [ ] **Step 1: Write the failing tests**

In `web/tests/client/format.test.ts` add expectations for the five lines above (build the params with `params({ interventions: [...] })` and a hybrid network for the school layer), the "Fitted to" row, and the `describeField` labels; in `web/tests/chat/prompt.test.ts` add `"## Interventions"` to the headings and phrases `"schools closed"`, `"illustrative assumption"`, `"fitted"`; in `web/tests/report/compose.test.ts` add a run whose `stats.fit` is `{ target: "attack_rate", wanted: 0.3, achieved: 0.31, lever: "disease.beta", value: 9.5, runs: 4 }` and expect `["Fitted to", "attack rate 30% (reached 31% in 4 runs)"]` in the Parameters key-values, and no such row without a fit.

- [ ] **Step 2: Run them and watch them fail** — `npx vitest run tests/client tests/chat tests/report`.

- [ ] **Step 3: Implement**

`interventionLines`: per type, with the window text `from day S` or `days S–E`, the kind word, efficacy when below 1, the age range when set, the protection when set; the treatment's delay, efficacy, `rel_trans_treated` ("half transmissibility while waiting" when 0.5, else "×0.3 transmissibility while waiting"), `symptomatic only`; the reductions with the layer word ("School contacts", "Household contacts", "All contacts") and the percentage removed. `parameterRows`: `...(p.run.fit ? row("Fitted to", `${fitTargetLabel(p.run.fit.target)} ${fitValueText(p.run.fit)} by moving ${leverLabel(p.run.fit.lever)}`) : [])` with `fitTargetLabel` ("attack rate", "peak day", "peak infections"), `fitValueText` (a percentage for attack_rate, "day 60", a count), `leverLabel` ("the transmission rate" / "the network multiplier"). `FIELDS`: `applied_vaccine_efficacy: { label: "Vaccine efficacy applied", kind: "percent_of_one" }`, `fit: { label: "Fit", kind: "fit" }` (rendered as "attack rate 30%"), `remove_interventions: { label: "Interventions removed" }`, and a prefix rule in `describeField` for keys matching `/^(\w+)_fitted_to_(\w+)$/` → label "Transmission rate fitted to attack rate" (or "Network multiplier fitted to …"). `compose.ts`: in `modelled`, after the measured R0 row, the latest run with `stats.fit` adds `["Fitted to", `${label} ${wanted} (reached ${achieved} in ${runs} runs)`]`. `prompt.ts`: insert `## Interventions` before `## Contact networks`:

```
## Interventions

- configure_simulation takes interventions as a list of entries (vaccine, treatment, seasonality, contact_reduction, transmission_reduction), each replacing the entry of the same type (and layer); remove_interventions drops entries by type. The shortcut fields (vaccine_coverage, vaccine_start_day, treatment_capacity, seasonality_scale) stay for the common cases.
- Translate the user's words: "schools closed from day 30 for six weeks" is {type: contact_reduction, layer: school, scale: 1, start_day: 30, end_day: 72} on the hybrid network; "distancing" is the community layer at a fraction; "masks for the first three months" is {type: transmission_reduction, scale: 0.3, start_day: 0, end_day: 90}; a vaccination drive is a campaign with a window and an efficacy; a treatment with a delay and an efficacy is a treatment entry. Contact reductions by layer need the hybrid network; on the others use layer all.
- Every effect size (a reduction's scale, a vaccine's efficacy, a treatment's efficacy and delay) is an illustrative assumption unless the database carries it: say so in the limitations. When lookup_disease reports a vaccine efficacy, use it; fetch_vaccination_coverage then writes a day-0 campaign with it instead of plain initial immunity.
- The R0 reported is the baseline one; reductions and vaccination lower the effective reproduction number, and the run's measured R0 shows it when they are active from day 0.
- A participant who knows one number from the real event (the share infected, the peak day, the peak size) can have the run fitted to it: configure_simulation's fit field ({target, value}); the service then searches the transmission rate (or the network multiplier) in at most eight runs, reports stats.fit, and you say "beta was set so that the attack rate is 30%" and label the run as fitted in the limitations.
```

- [ ] **Step 4: Run the web suites** — `npx vitest run && npm run typecheck && npm run lint` → all pass.

- [ ] **Step 5: Commit**

```bash
git add web/lib/client/format.ts web/lib/report/compose.ts web/lib/chat/prompt.ts web/tests/client/format.test.ts web/tests/chat/prompt.test.ts web/tests/report/compose.test.ts
git commit -m "feat(web): intervention lines for every type, the fit in the panel and the report, the prompt's Interventions section"
```

---

### Task 7: The review list's effect-size requests, the spec as shipped, the full suites

**Files:**
- Modify: `scripts/review_requests.py`, `tests/test_review_requests.py`, `docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md` (7.1 and 7.7 as shipped)

**Interfaces:**
- Produces: `REQUESTED_FIELDS` gains `school_closure_effect`, `distancing_effect`, `mask_effect` (each "a cited range of the effect on transmission … seeding the illustrative default"), rendered in the Markdown.

- [ ] **Step 1: Write the failing test** — in `tests/test_review_requests.py` extend the field set assertion with the three names and assert `"cited range" in` each note.
- [ ] **Step 2: Run it and watch it fail** — `.venv/Scripts/python.exe -m pytest tests/test_review_requests.py -q -p no:cacheprovider`.
- [ ] **Step 3: Implement** — add the three entries to `REQUESTED_FIELDS` (school closure: "the reduction in school-age contacts or transmission while schools are closed, as a cited range (a systematic review or a modelling study with data), seeding the illustrative default of a full closure"; distancing: "the reduction in community contacts under distancing measures, as a cited range"; masks: "the reduction in per-contact transmission from mask use, as a cited range"). Amend spec 7.1 with the day-0 rule as shipped (a day-0 vaccine with efficacy below 1 becomes a one-day campaign at day 0), the v1-shaped treatment ruling (the parity baseline), the contact reduction's mechanics (edge betas and pool betas scaled over the window); amend 7.7 with the fit's bracket (the current value first, then the geometric midpoint within the registry bounds; a fit together with `calibrate_r0` skips the pilot; `peak_infections` in agents, converted from people by the tool when a population is known).
- [ ] **Step 4: Run everything** — `.venv/Scripts/python.exe -m pytest tests -q -p no:cacheprovider --ignore=tests/test_r0_calibration.py`, the calibration file, `sim/tests`, and from `web/` `npx vitest run > ../.superpowers/vitest-final.log 2>&1 && grep -E "Tests " ../.superpowers/vitest-final.log && npm run typecheck && npm run lint`. Expected: all green; the ledger gets each count.
- [ ] **Step 5: Commit**

```bash
git add scripts/review_requests.py tests/test_review_requests.py docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md
git commit -m "docs: the effect-size review requests; spec 7.1 and 7.7 as shipped"
```

---

## Self-review

**Spec coverage.** 7.1 (fields, the two types, the semantics of routine and campaign coverage, the day-0 rule, the treatment's delay/efficacy/waiting transmissibility/symptomatic_only, the reductions): Tasks 1, 2, 3. 7.2 (the two products on the entry's leaves): Tasks 1, 3. 7.3 (the baseline R0 and the measured one): the prompt sentence in Task 6; `r0_measured` from 2B. 7.4 (`interventions`, `remove_interventions`, the shortcuts, the advanced refusal, the prompt section, the database efficacy path): Tasks 5, 6. 7.5 (`well_mixed` stands down under a contact reduction): Task 4. 7.6 (the review requests): Task 7. 7.7 (the fit, `stats.fit`, `effective_params`, the limitation sentence, `final_size_gap` standing down): Tasks 1, 4, 5, 6. 12 (prompt sections, `interventions` and `fit` as fields): Tasks 5, 6. 13's intervention and fit tests: Tasks 3, 4.

**Placeholders.** The `age_eligibility` body in Task 3 Step 5 contains a reminder expression the step itself tells the executor to replace with the simple form; every other step carries its code.

**Type consistency.** `Intervention.is_v1_treatment()`/`is_day0_immunity()` (Task 1) ↔ `isV1Treatment`/`isDay0Immunity` (Task 2) ↔ the builder (Task 3). `Fit` (Task 1) ↔ `FitSchema` (Task 2) ↔ `fit_lever` (Task 4) ↔ the tool (Task 5). `stats.fit`'s keys (Task 4) are the ones `SimStats.fit` (Task 5) and the report (Task 6) read. `TransmissionModifiers.seasonal(ti)` (Task 3) is what the reduction test calls.

**Review Focus.** 1 → Task 1's defaults, Task 3's parity run and `test_a_v1_shaped_treatment_still_runs_through_simple_treatment`, Task 6's unchanged lines for v1 entries. 2 → `test_a_day_zero_vaccine_folds_into_initial_immunity_only_at_full_efficacy` and `test_a_day_zero_vaccine_with_efficacy_below_one_is_a_one_day_campaign`. 3 → `test_layers_belong_to_the_hybrid_network_and_windows_are_ordered` and the TypeScript message test. 4 → `test_an_unreachable_fit_stops_at_the_levers_bound`. 5 → the hybrid case of `test_the_replicates_run_with_the_fitted_lever_and_skip_the_pilot`.

## After the merge (owner)

- No migration. Push `main`.
- The review list (`py -3.12 scripts/review_requests.py`) now asks the database team for vaccine and treatment efficacies and the three effect-size ranges; phase 2D commits the generated file.
