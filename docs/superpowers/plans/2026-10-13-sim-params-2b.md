# Sim Parameters Part 2, Phase 2B: Demographics and Networks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the simulation the three contact networks (random with its options, age-structured with the country's Prem 2021 matrix, hybrid households/schools/workplaces/community), the real age pyramid and projected birth rates from bundled UN tables, a measured R0 after every run, beta calibrated to it where the formula is approximate, and the two diagnostics that tell a user when random mixing overstated the final size.

**Architecture:** Twenty-six new registry leaves (schema_version stays 2, registry export version 3) carry the network and demographics parameters in Python and TypeScript, pinned by a version-4 parity fixture. Four bundled CSV tables under `epichat/data/` (pyramids, birth rates, household sizes, aggregated contact matrices) are produced once by committed fetch scripts and read through `epichat/params/tables.py`; the web app gets a compact per-country JSON from the same loaders. The builder maps the parameters onto `ss.RandomNet`, `ss.MixingPools` and `ss.HybridNet`, writes pyramid ages before seeding and follows a yearly birth series on the sim's own year axis; `ss.infection_log` feeds `stats.r0_measured`; a pilot run in the child corrects beta on the approximate networks; two new diagnostics read the measured R0 and the attack rate.

**Tech Stack:** Python 3.12, Starsim 3.7.2 (`ss.RandomNet`, `ss.MixingPools`, `ss.HybridNet`, `ss.People(age_data=…)`, `ss.Births`, `ss.infection_log`), pydantic v2, numpy, pandas; Next.js web app with zod and vitest; the `rdata` package (dev-only, in the root `.venv`) to read Prem's `.rdata`.

**Spec:** `docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md`, sections 5 (networks), 6 (demographics), 10 (sources), 13 (testing), 14 (phase 2B), 16 (costs). Part 1 (`docs/superpowers/specs/2026-10-09-sim-parameters-disease-design.md`) sections 7.4 and 18 define the exact R0 and the heterogeneous final-size system the tests reuse.

## Global Constraints

- Starsim is pinned at `starsim==3.7.2` in the root and the service requirements; nothing in this plan changes a requirement file.
- `schema_version` stays 2: every new leaf is optional with a default, so stored scenarios validate unchanged; the registry export's `version` becomes 3 and the parity fixture's `version` 4.
- No database migration in this phase (spec 14).
- The web app gets no new npm dependency; install with `npm --prefix web ci`, never `npm install`.
- The only new Python package is `rdata`, installed into the root `.venv` for `scripts/fetch_contact_matrices.py`; it is not added to any requirements file and nothing at runtime imports it.
- Bundled tables live under `epichat/data/` as UTF-8 CSV with LF line endings; the web copy is `web/data/country_demographics.json`, written by `scripts/export_web_data.py` (so `npm run sync-data` regenerates it).
- The three age groups are under 18, 18 to 64, 65 and over, in that order everywhere (`children`, `adults`, `elderly`).
- Contact matrices are stored and read as Starsim's `MixingPools` reads them: rows are the source group, columns the target group; a cell is the mean daily contacts a target in the column group has with sources in the row group.
- Never print the contents of `web/.env.local`, `sim/.env` or any secret; the fetch scripts need no credentials (the UN WPP files, the UN household workbook and the Prem repository are public).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UL6ToyEthpP1X8yxArZE6g`.
- Interpreters: the root `.venv/Scripts/python.exe` for `tests/` (run from the worktree root), the main checkout's `sim/.venv/Scripts/python.exe` for `sim/tests` (also from the worktree root), `npx vitest run` from `web/`.

## Review Focus

1. **A stored scenario from before this phase.** Its demographics carry the three shares from the UN API and no `age_source`; it must keep the uniform-within-band ages, its contact matrix (the POLYMOD defaults) and its R0 to the last digit. Pinned by the schema defaults test (Task 1), the parity migration cases (Task 4) and the builder's shares-path test (Task 5).
2. **A hybrid scenario with no demographics fetched.** Starsim's default ages (uniform 0 to 60) fill the school and work layers and there is no elderly group; the approximate R0 uses the default shares (0.3, 0.7, 0) for the age-range shares. Pinned by `test_hybrid_r0_sums_the_layers_weighted_by_their_transmissibility` (Task 3) and the hybrid builder test (Task 5).
3. **fetch_demographics for a country the bundled tables do not know** (a small territory with UN API data but no Prem matrix or household row): the UN fields still apply, the contact matrix stays POLYMOD, nothing throws. Pinned in Task 9.
4. **A pilot that measures nothing.** A tiny population (1,000 agents, 20 pilot seeds) or a beta so low that the seeds infect nobody: the calibration stops without dividing by zero, reports what it measured, and the real run proceeds. Pinned in Task 7.
5. **The measured R0 is noisy on small runs.** With 100 day-0 seeds its standard error is about 16% of R0, so a 25% gap fires on noise one run in ten; `r0_gap` widens its threshold to three standard errors when the seeds are few. Pinned in Task 8.

---

## File Structure

- Modify `epichat/params/registry.py` — the contact-matrix defaults and labels; 26 new `ParamSpec` entries; `network_type` gains `hybrid`; `export()` version 3.
- Modify `epichat/params/schema_v2.py` — `ContactMatrix`, `LayerBeta`; `NetworkParams` extended with a validator; `DemographicsParams.age_source`; `RunParams.calibrate_r0`.
- Create `epichat/params/tables.py` — loaders for the four bundled tables and the Prem aggregation function.
- Create `scripts/fetch_un_wpp_tables.py`, `scripts/fetch_household_size.py`, `scripts/fetch_contact_matrices.py` — one-off fetchers that write the bundled tables (committed with their outputs).
- Create `epichat/data/un_wpp_age.csv`, `epichat/data/un_wpp_cbr.csv`, `epichat/data/un_household_size.csv`, `epichat/data/contact_matrices.csv`, `tests/fixtures/prem_2021_sample.csv`.
- Modify `epichat/params/r0.py` — `contact_matrix`, `age_range_share`, `hybrid_contacts`, `r0_is_approximate`, `HYBRID_LEVERS`; `contact_scale` on three networks.
- Modify `scripts/export_parity_fixtures.py` (version 4, three networks, matrices, `approximate`), `scripts/export_web_data.py` (`country_demographics.json`), regenerate `web/tests/fixtures/parity.json`, `web/data/param_registry.json`, create `web/data/country_demographics.json`.
- Modify `web/lib/sim/params.ts` — schemas and R0 mirror; create `web/lib/data/countryDemographics.ts`.
- Create `epichat/sim/demographics.py` — `AgedPeople` (moved from the builder, with the pyramid path) and `YearlyBirths`; modify `epichat/sim/builder.py` — networks, people, demographics, the infection log.
- Modify `epichat/sim/outputs.py` (`measured_r0`), `epichat/sim/replicates.py` (calibration, `effective_params`), create `epichat/sim/calibrate.py`; modify `sim/runner.py` and `sim/service.py` (the corrected parameters travel back).
- Modify `epichat/sim/diagnostics.py` — `well_mixed`, `r0_gap`.
- Modify `web/lib/tools/configureSimulation.ts`, `fetchDemographics.ts`, `runSimulation.ts`, `index.ts`, `types.ts`, `web/lib/sim/client.ts`, `web/lib/client/format.ts`, `web/lib/report/compose.ts`, `web/lib/chat/prompt.ts`.
- Modify `web/docs/DEPLOY.md` (the hybrid timing) and the spec (five amendments).
- Tests: `tests/test_param_registry.py`, `tests/test_schema_v2.py`, `tests/test_tables.py` (new), `tests/test_fetch_scripts.py` (new), `tests/test_param_r0.py`, `tests/test_r0_calibration.py`, `tests/test_web_exports.py`, `tests/test_sim_builder.py`, `tests/test_sim_outputs.py`, `tests/test_sim_calibrate.py` (new), `tests/test_sim_diagnostics.py`, `sim/tests/test_service.py`, `sim/tests/test_real_run.py`; `web/tests/sim/{registry,params,parity}.test.ts`, `web/tests/tools/{configureSimulation,fetchTools,runSimulation}.test.ts`, `web/tests/client/format.test.ts`, `web/tests/chat/prompt.test.ts`, `web/tests/report/compose.test.ts` (if present; else the report test file that covers `composeReport`).

---

### Task 1: Registry and schema v2 — the network, demographics and run leaves

**Files:**
- Modify: `epichat/params/registry.py` (the `network.*` block at lines 130–137, the `demographics.*` block ending line 159, the `run.*` block ending line 182, `export()`)
- Modify: `epichat/params/schema_v2.py` (`NetworkParams` lines 128–131, `DemographicsParams`, `RunParams`)
- Test: `tests/test_param_registry.py`, `tests/test_schema_v2.py`, `tests/test_web_exports.py`

**Interfaces:**
- Consumes: `ParamSpec`, `_field(path)`, `AGE_GROUPS` (schema_v2), `REGISTRY_BY_PATH`.
- Produces: `registry.CONTACT_GROUPS = ("children", "adults", "elderly")`, `registry.CONTACT_DEFAULTS = ((7.0, 2.5, 0.5), (2.5, 9.0, 1.5), (0.5, 1.5, 3.5))`, `registry.GROUP_LABELS`; `schema_v2.NETWORK_TYPES`, `schema_v2.ContactMatrix` with `as_rows() -> list[list[float]]` and `ContactMatrix.from_rows(rows)`, `schema_v2.LayerBeta` (`household`, `school`, `work`, `community`), `NetworkParams` fields `contacts_dist`, `contact_duration_days`, `contacts`, `contacts_source`, `household_size`, `school_contacts`, `work_contacts`, `community_contacts`, `layer_beta`, `school_age_min`, `school_age_max`, `work_age_min`, `work_age_max`; `DemographicsParams.age_source: Literal["default", "shares", "un_wpp"]`; `RunParams.calibrate_r0: bool`; `export()["version"] == 3`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_param_registry.py`:

```python
def test_phase_2b_adds_the_network_demographics_and_run_leaves():
    paths = {s.path for s in reg.REGISTRY}
    for p in ("network.contacts_dist", "network.contact_duration_days", "network.contacts.children_children", "network.contacts.elderly_adults",
              "network.contacts_source", "network.household_size", "network.school_contacts", "network.work_contacts", "network.community_contacts",
              "network.layer_beta.household", "network.layer_beta.community", "network.school_age_min", "network.school_age_max",
              "network.work_age_min", "network.work_age_max", "demographics.age_source", "run.calibrate_r0"):
        assert p in paths, p
    assert reg.spec_for("network.network_type").choices == ("random", "age_structured", "hybrid")
    assert reg.spec_for("network.contacts.adults_adults").default == 9.0 and reg.spec_for("network.contacts.children_elderly").default == 0.5
    assert reg.spec_for("network.contacts.children_adults").bounds == (0.0, 50.0) and reg.spec_for("network.contacts.children_adults").tier == "advanced"
    assert reg.spec_for("network.household_size").tier == "core" and reg.spec_for("network.layer_beta.school").default == 0.6
    assert reg.spec_for("network.contacts_dist").choices == ("constant", "poisson") and reg.spec_for("demographics.age_source").choices == ("default", "shares", "un_wpp")
    assert reg.spec_for("run.calibrate_r0").default is True and reg.spec_for("run.calibrate_r0").kind == "bool"
    assert "no effect on the age-structured" in reg.spec_for("network.n_contacts").description
    assert reg.CONTACT_DEFAULTS == ((7.0, 2.5, 0.5), (2.5, 9.0, 1.5), (0.5, 1.5, 3.5))
    assert reg.export()["version"] == 3
```

Change the two existing pins `reg.export()["version"] == 2` (lines 76 and 111) to `== 3`, and in `tests/test_web_exports.py` the registry pin `["version"] == 2` to `== 3` (leave the parity pin at 3 until Task 3).

Append to `tests/test_schema_v2.py`:

```python
def test_network_leaves_default_and_round_trip():
    from epichat.params.schema_v2 import ContactMatrix
    p = v2()
    n = p.network
    assert n.network_type == "random" and n.contacts_dist == "constant" and n.contact_duration_days == 0.0 and n.contacts_source == "polymod_default"
    assert n.contacts.as_rows() == [[7.0, 2.5, 0.5], [2.5, 9.0, 1.5], [0.5, 1.5, 3.5]]
    assert (n.household_size, n.school_contacts, n.work_contacts, n.community_contacts) == (2.0, 20, 16, 20)
    assert (n.layer_beta.household, n.layer_beta.school, n.layer_beta.work, n.layer_beta.community) == (3.0, 0.6, 0.6, 0.3)
    assert (n.school_age_min, n.school_age_max, n.work_age_min, n.work_age_max) == (6, 22, 22, 65)
    assert p.demographics.age_source == "default" and p.run.calibrate_r0 is True
    hybrid = v2(network={"network_type": "hybrid", "household_size": 4.5, "contacts": {"adults_adults": 12.0}})
    assert hybrid.network.household_size == 4.5 and hybrid.network.contacts.adults_adults == 12.0 and hybrid.network.contacts.children_children == 7.0
    assert ContactMatrix.from_rows([[1, 2, 3], [4, 5, 6], [7, 8, 9]]).as_rows() == [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [7.0, 8.0, 9.0]]


def test_network_bounds_and_age_ranges_are_checked():
    with pytest.raises(ValidationError):
        v2(network={"household_size": 0.5})
    with pytest.raises(ValidationError):
        v2(network={"contacts": {"adults_adults": 60.0}})
    with pytest.raises(ValidationError, match="school_age_min"):
        v2(network={"school_age_min": 22, "school_age_max": 22})
    with pytest.raises(ValidationError, match="work_age_min"):
        v2(network={"work_age_min": 70, "work_age_max": 65})
    with pytest.raises(ValidationError):
        v2(network={"network_type": "cluster"})
    with pytest.raises(ValidationError):
        v2(demographics={"age_source": "census"})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_registry.py tests/test_schema_v2.py tests/test_web_exports.py -q -p no:cacheprovider`
Expected: the three new tests fail (`spec_for` raises on the missing path; `v2()` has no `contacts_dist`); the version pins fail with 2.

- [ ] **Step 3: The registry**

In `epichat/params/registry.py`, after the `DB_FIELDS` constant add:

```python
CONTACT_GROUPS = ("children", "adults", "elderly")
GROUP_LABELS = {"children": "children (under 18)", "adults": "adults (18 to 64)", "elderly": "elderly (65 and over)"}
CONTACT_DEFAULTS = ((7.0, 2.5, 0.5), (2.5, 9.0, 1.5), (0.5, 1.5, 3.5))     # POLYMOD-like; rows source, columns target (Part 2, 5.3)
```

Replace the `network.network_type` and `network.n_contacts` entries with:

```python
    ParamSpec("network.network_type", "network", "Contact network", "random: everyone has n_contacts fresh random contacts a day, which "
              "overstates the final size; age_structured: three age groups mixing by a contact matrix (POLYMOD-like by default, the country's "
              "Prem 2021 matrix after fetch_demographics); hybrid: households, schools, workplaces and community as in Covasim, with limited, "
              "repeated contacts.", "enum", None, "random", None, ("random", "age_structured", "hybrid"), (), "core", None,
              "ss.RandomNet, ss.MixingPools or ss.HybridNet", ("peak", "final_size")),
    ParamSpec("network.n_contacts", "network", "Contacts per day", "Mean number of contacts per person per day on the random network; "
              "no effect on the age-structured and hybrid networks.", "integer", "per day", 4, (1, 100), None, (), "core", "average_contacts_daily",
              "ss.RandomNet(n_contacts=...)", ("peak", "final_size")),
    ParamSpec("network.contacts_dist", "network", "Contacts distribution", "constant: everyone has exactly n_contacts a day; poisson: the daily "
              "number varies around n_contacts. Random network only; the R0 is unchanged.", "enum", None, "constant", None,
              ("constant", "poisson"), (), "advanced", None, "ss.RandomNet(n_contacts=ss.constant or ss.poisson)", ("stochasticity",)),
    ParamSpec("network.contact_duration_days", "network", "Contact duration", "Days a random-network contact lasts before it is replaced; 0 "
              "remakes every contact daily. Longer contacts slow spread by local depletion, so the R0 shown is approximate and the measured R0 "
              "is the one to quote.", "number", "days", 0.0, (0.0, 365.0), None, (), "advanced", None, "ss.RandomNet(dur=ss.days(...))",
              ("peak", "final_size")),
```

Keep `network.network_beta` as it is and insert after it:

```python
    *[ParamSpec(f"network.contacts.{s}_{t}", "network", f"Contacts, {GROUP_LABELS[s]} to {GROUP_LABELS[t]}",
                f"Contacts per day a target among the {GROUP_LABELS[t]} has with sources among the {GROUP_LABELS[s]} on the age-structured "
                "network (rows source, columns target; POLYMOD-like default, the country's Prem 2021 value after fetch_demographics).",
                "number", "per day", CONTACT_DEFAULTS[i][j], (0.0, 50.0), None, (), "advanced", None, "ss.MixingPools(n_contacts=...)",
                ("peak", "final_size"))
      for i, s in enumerate(CONTACT_GROUPS) for j, t in enumerate(CONTACT_GROUPS)],
    ParamSpec("network.contacts_source", "network", "Contact matrix source", "Where the contact matrix came from: polymod_default (European), "
              "prem_2021:<ISO3> (the country's synthetic matrix) or user.", "string", None, "polymod_default", None, None, (), "expert", None,
              "fetch_demographics", ()),
    ParamSpec("network.household_size", "network", "Household size", "Mean household size on the hybrid network (Poisson); the country's value "
              "after fetch_demographics.", "number", "people", 2.0, (1.0, 10.0), None, (), "core", None,
              "ss.HybridNet(household_size=ss.poisson(...))", ("peak", "final_size")),
    ParamSpec("network.school_contacts", "network", "School contacts", "Mean daily contacts in the school layer of the hybrid network "
              "(Covasim's value, illustrative).", "integer", "per day", 20, (0, 100), None, (), "advanced", None,
              "ss.HybridNet(contacts=dict(s=...))", ("peak", "final_size")),
    ParamSpec("network.work_contacts", "network", "Workplace contacts", "Mean daily contacts in the workplace layer of the hybrid network "
              "(Covasim's value, illustrative).", "integer", "per day", 16, (0, 100), None, (), "advanced", None,
              "ss.HybridNet(contacts=dict(w=...))", ("peak", "final_size")),
    ParamSpec("network.community_contacts", "network", "Community contacts", "Mean daily contacts in the community layer of the hybrid network "
              "(Covasim's value, illustrative).", "integer", "per day", 20, (0, 100), None, (), "advanced", None,
              "ss.HybridNet(contacts=dict(c=...))", ("peak", "final_size")),
    ParamSpec("network.layer_beta.household", "network", "Household transmissibility", "Relative transmissibility of a household contact on the "
              "hybrid network (Covasim's value, illustrative).", "number", "multiplier", 3.0, (0.0, 10.0), None, (), "advanced", None,
              "ss.HybridNet(beta=dict(h=...))", ("peak", "final_size")),
    ParamSpec("network.layer_beta.school", "network", "School transmissibility", "Relative transmissibility of a school contact on the hybrid "
              "network (Covasim's value, illustrative).", "number", "multiplier", 0.6, (0.0, 10.0), None, (), "advanced", None,
              "ss.HybridNet(beta=dict(s=...))", ("peak", "final_size")),
    ParamSpec("network.layer_beta.work", "network", "Workplace transmissibility", "Relative transmissibility of a workplace contact on the hybrid "
              "network (Covasim's value, illustrative).", "number", "multiplier", 0.6, (0.0, 10.0), None, (), "advanced", None,
              "ss.HybridNet(beta=dict(w=...))", ("peak", "final_size")),
    ParamSpec("network.layer_beta.community", "network", "Community transmissibility", "Relative transmissibility of a community contact on the "
              "hybrid network (Covasim's value, illustrative).", "number", "multiplier", 0.3, (0.0, 10.0), None, (), "advanced", None,
              "ss.HybridNet(beta=dict(c=...))", ("peak", "final_size")),
    ParamSpec("network.school_age_min", "network", "School age, from", "Youngest age in the school layer of the hybrid network.", "integer",
              "years", 6, (0, 100), None, (), "advanced", None, "ss.HybridNet(school_ages=...)", ("peak",)),
    ParamSpec("network.school_age_max", "network", "School age, to", "Age at which agents leave the school layer (excluded).", "integer",
              "years", 22, (0, 100), None, (), "advanced", None, "ss.HybridNet(school_ages=...)", ("peak",)),
    ParamSpec("network.work_age_min", "network", "Working age, from", "Youngest age in the workplace layer of the hybrid network.", "integer",
              "years", 22, (0, 100), None, (), "advanced", None, "ss.HybridNet(work_ages=...)", ("peak",)),
    ParamSpec("network.work_age_max", "network", "Working age, to", "Age at which agents leave the workplace layer (excluded).", "integer",
              "years", 65, (0, 100), None, (), "advanced", None, "ss.HybridNet(work_ages=...)", ("peak",)),
```

After `demographics.demographics_source` insert:

```python
    ParamSpec("demographics.age_source", "demographics", "Age source", "Where the simulated ages come from: default (Starsim's uniform 0 to "
              "60), shares (uniform ages within the three shares) or un_wpp (the country's single-year age pyramid, bundled from UN WPP 2024).",
              "enum", None, "default", None, ("default", "shares", "un_wpp"), (), "expert", None, "ss.People(age_data=...)",
              ("peak", "final_size", "deaths")),
```

After `run.rand_seed` insert:

```python
    ParamSpec("run.calibrate_r0", "run", "Calibrate beta by measurement", "On the hybrid network, or with a contact duration above 0, the R0 "
              "formula is approximate: a short pilot run measures the seeds' secondary infections and corrects beta until the measured R0 is "
              "within 5% of the target, at most three times. Off, the formula's beta runs as it is.", "bool", None, True, None, None, (),
              "advanced", None, "epichat.sim.calibrate", ("peak", "final_size")),
```

In `export()` change `"version": 2` to `"version": 3`.

- [ ] **Step 4: The schema**

In `epichat/params/schema_v2.py` replace the `NetworkParams` class with:

```python
NETWORK_TYPES = ("random", "age_structured", "hybrid")


class ContactMatrix(BaseModel):
    """The nine leaves network.contacts.<source>_<target> (Part 2, 5.3): rows source, columns target, as ss.MixingPools reads them."""
    children_children: float = _field("network.contacts.children_children")
    children_adults: float = _field("network.contacts.children_adults")
    children_elderly: float = _field("network.contacts.children_elderly")
    adults_children: float = _field("network.contacts.adults_children")
    adults_adults: float = _field("network.contacts.adults_adults")
    adults_elderly: float = _field("network.contacts.adults_elderly")
    elderly_children: float = _field("network.contacts.elderly_children")
    elderly_adults: float = _field("network.contacts.elderly_adults")
    elderly_elderly: float = _field("network.contacts.elderly_elderly")

    def as_rows(self) -> list[list[float]]:
        return [[float(getattr(self, f"{s}_{t}")) for t in AGE_GROUPS] for s in AGE_GROUPS]

    @classmethod
    def from_rows(cls, rows) -> "ContactMatrix":
        return cls(**{f"{s}_{t}": float(rows[i][j]) for i, s in enumerate(AGE_GROUPS) for j, t in enumerate(AGE_GROUPS)})


class LayerBeta(BaseModel):
    """Relative transmissibility of each hybrid layer (Part 2, 5.4; Covasim's values)."""
    household: float = _field("network.layer_beta.household")
    school: float = _field("network.layer_beta.school")
    work: float = _field("network.layer_beta.work")
    community: float = _field("network.layer_beta.community")


class NetworkParams(BaseModel):
    network_type: Literal["random", "age_structured", "hybrid"] = "random"
    n_contacts: int = _field("network.n_contacts")
    network_beta: float = _field("network.network_beta")
    contacts_dist: Literal["constant", "poisson"] = "constant"
    contact_duration_days: float = _field("network.contact_duration_days")
    contacts: ContactMatrix = Field(default_factory=ContactMatrix)
    contacts_source: str = "polymod_default"
    household_size: float = _field("network.household_size")
    school_contacts: int = _field("network.school_contacts")
    work_contacts: int = _field("network.work_contacts")
    community_contacts: int = _field("network.community_contacts")
    layer_beta: LayerBeta = Field(default_factory=LayerBeta)
    school_age_min: int = _field("network.school_age_min")
    school_age_max: int = _field("network.school_age_max")
    work_age_min: int = _field("network.work_age_min")
    work_age_max: int = _field("network.work_age_max")

    @model_validator(mode="after")
    def check_age_ranges(self) -> "NetworkParams":
        if self.school_age_min >= self.school_age_max:
            raise ValueError("network.school_age_min must be below network.school_age_max")
        if self.work_age_min >= self.work_age_max:
            raise ValueError("network.work_age_min must be below network.work_age_max")
        return self
```

In `DemographicsParams` add after `demographics_source`: `age_source: Literal["default", "shares", "un_wpp"] = "default"`. In `RunParams` add `calibrate_r0: bool = True`. (`Field`, `Literal` and `model_validator` are already imported; check `AGE_GROUPS` is defined above `ContactMatrix`, which it is at line 69.)

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_registry.py tests/test_schema_v2.py tests/test_web_exports.py tests/test_param_migrate.py -q -p no:cacheprovider`
Expected: all pass except `tests/test_web_exports.py`'s freshness test if it compares `web/data/param_registry.json` to `export()` — then run `.venv/Scripts/python.exe scripts/export_web_data.py`, restore the end-of-line-only rewrites it makes with `git checkout -- web/tests/fixtures/adapters/` (check `git status` first; only files whose diff is whitespace-only), and rerun: all pass. (`test_defaults_match_the_registry_on_every_leaf` and `test_every_leaf_has_exactly_one_param_spec` now walk the new leaves too; a mismatch there names the leaf.)

- [ ] **Step 6: Commit**

```bash
git add epichat/params/registry.py epichat/params/schema_v2.py tests/test_param_registry.py tests/test_schema_v2.py tests/test_web_exports.py web/data/param_registry.json
git commit -m "feat(params): the network options, the contact matrix, the hybrid layers, the age source and calibrate_r0 (registry v3)"
```

---

### Task 2: The bundled tables, their fetch scripts and loaders

**Files:**
- Create: `epichat/params/tables.py`
- Create: `scripts/fetch_un_wpp_tables.py`, `scripts/fetch_household_size.py`, `scripts/fetch_contact_matrices.py`
- Create (generated, committed): `epichat/data/un_wpp_age.csv`, `epichat/data/un_wpp_cbr.csv`, `epichat/data/un_household_size.csv`, `epichat/data/contact_matrices.csv`, `tests/fixtures/prem_2021_sample.csv`
- Test: `tests/test_tables.py`, `tests/test_fetch_scripts.py`

**Interfaces:**
- Consumes: `epichat/data/demographics/WPP2024_Demographic_Indicators_Medium.csv` (already bundled; columns `ISO3_code`, `LocTypeName`, `Variant`, `Time`, `CBR`).
- Produces: `tables.age_histogram(iso3, year=2024) -> np.ndarray | None` (101 values, population in thousands by single age 0 to 100, nearest of 2024 and 2030), `tables.pyramid_year(year) -> int`, `tables.shares_from_histogram(h) -> tuple[float, float, float]`, `tables.age_shares(iso3, year=2024) -> tuple | None`, `tables.birth_rate_series(iso3, start_year, n_years) -> list[float] | None`, `tables.household_size(iso3) -> float | None`, `tables.contact_matrix(iso3) -> np.ndarray | None` (3×3, rows source, columns target), `tables.countries() -> list[str]`, `tables.aggregate_contacts(m16, pop) -> np.ndarray`, `tables.GROUP_BOUNDS`, `tables.PREM_BANDS`; the four CSV files.

Sources (all public, verified reachable on 2026-10-13):
- Age pyramids: `https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_PopulationBySingleAgeSex_Medium_2024-2100.csv.gz` (67 MB; columns `ISO3_code,…,Variant,Time,…,AgeGrpStart,…,PopTotal`, PopTotal in thousands; regional aggregates have an empty `ISO3_code`).
- Birth rates: the bundled indicators file above (years 2020 to 2050, Medium variant).
- Household sizes: `https://population.un.org/Household/assets/UNDESA_PD_2026_hh-size-composition.xlsx`, sheet `HH size and composition 2026`, header on the fifth row (index 4): `ISO3 Code`, `Reference year`, `Average household size (number of members)`, `Data source category`; several rows per country.
- Contact matrices: `https://raw.githubusercontent.com/kieshaprem/synthetic-contact-matrices/master/generate_synthetic_matrices/output/syntheticmatrices/contact_all.rdata` (200 KB; an R list `contact_all` of 177 ISO3 keys → 16×16 arrays, rows the participant's five-year band 0–4 … 75+, columns the contact's band; parsed with `rdata`).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_tables.py`:

```python
"""The bundled country tables of Part 2 (sections 5.3, 5.4, 6.1, 6.2, 13)."""
import csv
from pathlib import Path

import numpy as np
import pytest

from epichat.params import tables

ROOT = Path(__file__).resolve().parent.parent


def test_every_country_in_the_indicators_table_has_a_pyramid_for_2024():
    with open(ROOT / "epichat" / "data" / "demographics" / "WPP2024_Demographic_Indicators_Medium.csv", newline="", encoding="utf-8") as f:
        iso3s = {r["ISO3_code"] for r in csv.DictReader(f) if r["ISO3_code"] and r["Time"] == "2024" and r["LocTypeName"] == "Country/Area"}
    assert len(iso3s) > 200
    assert iso3s <= set(tables.countries())


def test_kenya_has_a_pyramid_shares_a_household_size_a_matrix_and_a_birth_series():
    h = tables.age_histogram("KEN")
    assert h.shape == (101,) and 40_000 < h.sum() < 80_000            # thousands: about 56 million people
    c, a, e = tables.age_shares("ken")
    assert 0.40 < c < 0.50 and 0.02 < e < 0.05 and abs(c + a + e - 1.0) < 1e-9
    assert tables.pyramid_year(2026) == 2024 and tables.pyramid_year(2028) == 2030 and tables.age_histogram("KEN", 2030)[0] != h[0]
    assert 3.0 < tables.household_size("KEN") < 5.0 and tables.household_size("XXX") is None
    m = tables.contact_matrix("KEN")
    assert m.shape == (3, 3) and m.min() >= 0 and m[1][1] > m[2][2]
    rates = tables.birth_rate_series("KEN", 2024, 30)
    assert len(rates) == 30 and 20 < rates[0] < 35 and rates[-1] < rates[0]
    assert tables.birth_rate_series("KEN", 2049, 5)[-1] == tables.birth_rate_series("KEN", 2050, 1)[0]    # past the table: its last year
    assert tables.age_histogram("XXX") is None and tables.contact_matrix("XXX") is None and tables.birth_rate_series("XXX", 2024, 2) is None


def test_aggregation_counts_bands_and_preserves_each_targets_total():
    pop = np.ones(101)                       # a uniform population: the 15-19 band is 3/5 children, 2/5 adults
    c = tables.aggregate_contacts(np.ones((16, 16)), pop)
    for t in range(3):
        assert np.allclose(c[:, t], [3.6, 9.4, 3.0])         # children 3 bands + 3/5, adults 2/5 + 9, elderly 65-69, 70-74, 75+
    assert np.allclose(c.sum(axis=0), 16.0)                  # a target's contacts with everyone is its bands' mean row sum
    m = np.arange(256, dtype=float).reshape(16, 16)
    c = tables.aggregate_contacts(m, pop)
    rows = m.sum(axis=1)
    assert c[:, 0].sum() == pytest.approx((3 * rows[:3].sum() / 3 * 0 + rows[:3].sum() + 0.6 * rows[3]) / 3.6)   # children: bands 0-2 fully, 3/5 of band 3


def test_aggregation_matches_an_explicit_single_age_sum_on_the_bundled_sample():
    sample = {}
    with open(ROOT / "tests" / "fixtures" / "prem_2021_sample.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            sample.setdefault(r["iso3"], np.zeros((16, 16)))[int(r["row"]), int(r["col"])] = float(r["value"])
    assert set(sample) == {"GBR", "KEN"}
    for iso3, m16 in sample.items():
        pop = tables.age_histogram(iso3)
        c = tables.aggregate_contacts(m16, pop)
        band = lambda age: min(age // 5, 15)
        children = range(0, 18)
        expected = sum(pop[a] * sum(m16[band(a), band(b)] * pop[b] / pop[list(range(5 * band(b), 101 if band(b) == 15 else 5 * band(b) + 5))].sum()
                                    for b in children) for a in children) / pop[list(children)].sum()
        assert c[0][0] == pytest.approx(expected, rel=1e-9)
        assert np.allclose(tables.contact_matrix(iso3), c, atol=1e-4)      # the bundled table is this function's output, rounded
```

Create `tests/test_fetch_scripts.py`:

```python
"""The parsing steps of the one-off fetch scripts, on inline rows (the downloads themselves are not tested)."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_household_rows_keep_the_latest_numeric_value_per_country():
    fetch = load("fetch_household_size")
    header = ["Country and area", "ISO3 Code", "Reference year", "Data source category", "Average household size (number of members)"]
    rows = [header,
            ["Kenya", "KEN", "2014", "DHS", "4.0"], ["Kenya", "KEN", "2022", "DHS", "3.6"], ["Kenya", "KEN", "2019", "Census", ".."],
            ["Nowhere", None, "2020", "DHS", "2.0"], ["Zed", "ZZZ", "2001", "MICS", "5"]]
    out = fetch.select_latest(rows)
    assert out == [{"iso3": "KEN", "household_size": 3.6, "reference_year": 2022, "source": "DHS"},
                   {"iso3": "ZZZ", "household_size": 5.0, "reference_year": 2001, "source": "MICS"}]


def test_single_age_rows_keep_countries_in_the_two_pyramid_years():
    fetch = load("fetch_un_wpp_tables")
    import pandas as pd
    frame = pd.DataFrame({"ISO3_code": ["KEN", "KEN", None, "KEN"], "Variant": ["Medium"] * 4, "Time": [2024, 2030, 2024, 2025],
                          "AgeGrpStart": [0, 0, 0, 0], "PopTotal": [1.5, 1.7, 9.9, 1.6]})
    out = fetch.pyramid_rows(frame)
    assert out == [("KEN", 2024, 0, 1.5), ("KEN", 2030, 0, 1.7)]
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_tables.py tests/test_fetch_scripts.py -q -p no:cacheprovider`
Expected: `ModuleNotFoundError: No module named 'epichat.params.tables'`; `FileNotFoundError` for the scripts.

- [ ] **Step 3: The loaders and the aggregation**

Create `epichat/params/tables.py`:

```python
"""The bundled country tables of Part 2 (section 10) and their loaders: the UN WPP 2024 age pyramids (2024 and 2030) and projected crude
birth rates (2020 to 2050), the UN household sizes (2026 database), and the Prem et al. 2021 contact matrices aggregated to the three age
groups. Every loader is cached, takes an ISO3 code in any case and returns None for a country its table does not know. The tables are
written by scripts/fetch_un_wpp_tables.py, scripts/fetch_household_size.py and scripts/fetch_contact_matrices.py."""
from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

import numpy as np

DATA = Path(__file__).resolve().parents[1] / "data"
AGE_YEARS = (2024, 2030)
MAX_AGE = 100                                      # the pyramid's last single age (100 and over)
PREM_BANDS = tuple(range(0, 80, 5))               # sixteen five-year bands, the last one 75 and over
GROUP_BOUNDS = ((0, 18), (18, 65), (65, MAX_AGE + 1))   # children, adults, elderly on single ages


def _rows(name: str) -> list[dict]:
    with open(DATA / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _band_ages(b: int) -> list[int]:
    start = PREM_BANDS[b]
    return list(range(start, MAX_AGE + 1 if b == len(PREM_BANDS) - 1 else start + 5))


@lru_cache(maxsize=1)
def _pyramids() -> dict[tuple[str, int], np.ndarray]:
    out: dict[tuple[str, int], np.ndarray] = {}
    for r in _rows("un_wpp_age.csv"):
        out.setdefault((r["iso3"], int(r["year"])), np.zeros(MAX_AGE + 1))[int(r["age"])] = float(r["pop_thousands"])
    return out


def pyramid_year(year: int) -> int:
    """The bundled pyramid year nearest to the scenario's demographics year."""
    return min(AGE_YEARS, key=lambda y: (abs(y - year), y))


def age_histogram(iso3: str, year: int = 2024) -> np.ndarray | None:
    h = _pyramids().get((iso3.upper(), pyramid_year(year)))
    return None if h is None else h.copy()


def shares_from_histogram(h: np.ndarray) -> tuple[float, float, float]:
    total = float(h.sum())
    c, a, e = (float(h[lo:hi].sum() / total) for lo, hi in GROUP_BOUNDS)
    return c, a, e


def age_shares(iso3: str, year: int = 2024) -> tuple[float, float, float] | None:
    h = age_histogram(iso3, year)
    return None if h is None else shares_from_histogram(h)


def countries() -> list[str]:
    return sorted({iso3 for iso3, year in _pyramids() if year == AGE_YEARS[0]})


@lru_cache(maxsize=1)
def _birth_rates() -> dict[str, dict[int, float]]:
    out: dict[str, dict[int, float]] = {}
    for r in _rows("un_wpp_cbr.csv"):
        out.setdefault(r["iso3"], {})[int(r["year"])] = float(r["cbr"])
    return out


def birth_rate_series(iso3: str, start_year: int, n_years: int) -> list[float] | None:
    """Crude birth rates per 1,000 for n_years from start_year; a year outside the table takes its nearest year."""
    rates = _birth_rates().get(iso3.upper())
    if not rates:
        return None
    years = sorted(rates)
    return [rates[min(years, key=lambda y: abs(y - (start_year + i)))] for i in range(n_years)]


@lru_cache(maxsize=1)
def _households() -> dict[str, float]:
    return {r["iso3"]: float(r["household_size"]) for r in _rows("un_household_size.csv")}


def household_size(iso3: str) -> float | None:
    return _households().get(iso3.upper())


@lru_cache(maxsize=1)
def _contacts() -> dict[str, np.ndarray]:
    groups = ("children", "adults", "elderly")
    out: dict[str, np.ndarray] = {}
    for r in _rows("contact_matrices.csv"):
        out.setdefault(r["iso3"], np.zeros((3, 3)))[groups.index(r["source"]), groups.index(r["target"])] = float(r["contacts"])
    return out


def contact_matrix(iso3: str) -> np.ndarray | None:
    m = _contacts().get(iso3.upper())
    return None if m is None else m.copy()


def group_fractions(pop: np.ndarray) -> np.ndarray:
    """For each Prem band, the share of its population in each age group (16 × 3); a band with no population splits by its ages."""
    f = np.zeros((len(PREM_BANDS), 3))
    for b in range(len(PREM_BANDS)):
        ages = _band_ages(b)
        total = float(pop[ages].sum())
        for g, (lo, hi) in enumerate(GROUP_BOUNDS):
            inside = [a for a in ages if lo <= a < hi]
            f[b, g] = pop[inside].sum() / total if total > 0 else len(inside) / len(ages)
    return f


def aggregate_contacts(m16: np.ndarray, pop: np.ndarray) -> np.ndarray:
    """Prem's 16-band matrix M[a][b] (daily contacts of a participant in band a with people in band b) to the three groups, rows source S
    and columns target T, as ss.MixingPools reads them (Part 2, 5.3): C[S][T] = Σ_a Σ_b w_T(a) M[a][b] f_S(b), with w_T(a) the share of
    T's population that sits in band a and f_S(b) the share of band b's population that belongs to S."""
    m16 = np.asarray(m16, dtype=float)
    f = group_fractions(pop)                                                            # f[b, S]
    band_pop = np.array([pop[_band_ages(b)].sum() for b in range(len(PREM_BANDS))])
    in_group = f * band_pop[:, None]                                                    # population of band a inside group T
    w = in_group / in_group.sum(axis=0)                                                 # w[a, T]
    return (w.T @ m16 @ f).T                                                            # [S][T]
```

Create `scripts/fetch_un_wpp_tables.py`:

```python
"""Bundle the UN WPP 2024 tables the builder reads (sim-parameters Part 2, 6.1 and 6.2):

    .venv/Scripts/python.exe scripts/fetch_un_wpp_tables.py [--source <local copy of the single-age csv.gz>]

epichat/data/un_wpp_age.csv  — iso3, year (2024 and 2030), age (0 to 100), pop_thousands, Medium variant, countries only, from
    WPP2024_PopulationBySingleAgeSex_Medium_2024-2100.csv.gz (67 MB, downloaded to a temporary file unless --source names a copy).
epichat/data/un_wpp_cbr.csv  — iso3, year (2020 to 2050), cbr (per 1,000), from the bundled WPP2024_Demographic_Indicators_Medium.csv.
Rerun when the WPP vintage changes; the outputs are committed."""
from __future__ import annotations

import argparse
import csv
import sys
import tempfile
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "epichat" / "data"
AGE_URL = ("https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/"
           "WPP2024_PopulationBySingleAgeSex_Medium_2024-2100.csv.gz")
AGE_YEARS = (2024, 2030)
CBR_YEARS = range(2020, 2051)


def pyramid_rows(frame: pd.DataFrame) -> list[tuple[str, int, int, float]]:
    """(iso3, year, age, pop_thousands) for the Medium variant, the two pyramid years and the rows with an ISO3 code."""
    keep = frame[frame["ISO3_code"].notna() & (frame["Variant"] == "Medium") & frame["Time"].isin(AGE_YEARS)]
    return sorted((str(r.ISO3_code), int(r.Time), int(r.AgeGrpStart), float(r.PopTotal)) for r in keep.itertuples())


def cbr_rows(path: Path) -> list[tuple[str, int, float]]:
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["ISO3_code"] and r["Variant"] == "Medium" and r["LocTypeName"] == "Country/Area" and int(r["Time"]) in CBR_YEARS and r["CBR"]:
                out.append((r["ISO3_code"], int(r["Time"]), float(r["CBR"])))
    return sorted(out)


def write_csv(path: Path, header: list[str], rows) -> None:
    with open(path, "w", newline="\n", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    print(f"wrote {path.relative_to(ROOT)} ({len(rows)} rows)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="a local copy of the single-age csv.gz instead of downloading it")
    args = parser.parse_args()
    source = args.source
    if source is None:
        tmp = Path(tempfile.gettempdir()) / "WPP2024_PopulationBySingleAgeSex_Medium_2024-2100.csv.gz"
        if not tmp.exists():
            print(f"downloading {AGE_URL} ...", file=sys.stderr)
            urllib.request.urlretrieve(AGE_URL, tmp)
        source = tmp
    frame = pd.read_csv(source, compression="gzip", usecols=["ISO3_code", "Variant", "Time", "AgeGrpStart", "PopTotal"], low_memory=False)
    write_csv(DATA / "un_wpp_age.csv", ["iso3", "year", "age", "pop_thousands"], pyramid_rows(frame))
    write_csv(DATA / "un_wpp_cbr.csv", ["iso3", "year", "cbr"], cbr_rows(DATA / "demographics" / "WPP2024_Demographic_Indicators_Medium.csv"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Create `scripts/fetch_household_size.py`:

```python
"""Bundle the mean household size by country (sim-parameters Part 2, 5.4):

    .venv/Scripts/python.exe scripts/fetch_household_size.py

Downloads the UN Population Division's Household Size and Composition workbook (2026 database) and writes
epichat/data/un_household_size.csv — iso3, household_size, reference_year, source — keeping, per country, the row with the latest
reference year that carries a numeric average. Rerun when the UN publishes a new database; the output is committed."""
from __future__ import annotations

import csv
import sys
import tempfile
import urllib.request
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
URL = "https://population.un.org/Household/assets/UNDESA_PD_2026_hh-size-composition.xlsx"
SHEET = "HH size and composition 2026"
COLUMNS = {"iso3": "ISO3 Code", "year": "Reference year", "size": "Average household size (number of members)", "source": "Data source category"}


def select_latest(rows: list[list]) -> list[dict]:
    """rows: the header row followed by the data rows (the workbook's sheet from its header on)."""
    header = [str(c).strip() if c is not None else "" for c in rows[0]]
    idx = {k: header.index(v) for k, v in COLUMNS.items()}
    best: dict[str, dict] = {}
    for r in rows[1:]:
        iso3 = r[idx["iso3"]]
        if not iso3 or len(str(iso3)) != 3:
            continue
        try:
            size, year = float(r[idx["size"]]), int(float(r[idx["year"]]))
        except (TypeError, ValueError):
            continue
        if iso3 not in best or year > best[iso3]["reference_year"]:
            best[str(iso3)] = {"iso3": str(iso3), "household_size": size, "reference_year": year, "source": str(r[idx["source"]])}
    return [best[k] for k in sorted(best)]


def main() -> int:
    tmp = Path(tempfile.gettempdir()) / "UNDESA_PD_2026_hh-size-composition.xlsx"
    if not tmp.exists():
        print(f"downloading {URL} ...", file=sys.stderr)
        urllib.request.urlretrieve(URL, tmp)
    ws = openpyxl.load_workbook(tmp, read_only=True, data_only=True)[SHEET]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    start = next(i for i, r in enumerate(rows) if r and "ISO3 Code" in r)
    out = select_latest(rows[start:])
    path = ROOT / "epichat" / "data" / "un_household_size.csv"
    with open(path, "w", newline="\n", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["iso3", "household_size", "reference_year", "source"], lineterminator="\n")
        w.writeheader()
        w.writerows(out)
    print(f"wrote {path.relative_to(ROOT)} ({len(out)} countries)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Create `scripts/fetch_contact_matrices.py`:

```python
"""Bundle the Prem et al. 2021 synthetic contact matrices, aggregated to the three age groups (sim-parameters Part 2, 5.3):

    .venv/Scripts/python.exe -m pip install rdata          # once; a dev-only dependency of this script
    .venv/Scripts/python.exe scripts/fetch_contact_matrices.py [--sample GBR KEN]

Downloads contact_all.rdata (all locations combined; 177 countries, sixteen five-year bands) from the authors' repository, aggregates each
country's matrix with epichat.params.tables.aggregate_contacts and the country's 2024 pyramid (so run scripts/fetch_un_wpp_tables.py
first), and writes epichat/data/contact_matrices.csv — iso3, source, target, contacts (rows source, columns target, as ss.MixingPools
reads them). --sample writes the named countries' raw 16×16 matrices to tests/fixtures/prem_2021_sample.csv for the aggregation test.
Countries without a bundled pyramid are skipped and listed."""
from __future__ import annotations

import argparse
import csv
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from epichat.params import tables  # noqa: E402

URL = ("https://raw.githubusercontent.com/kieshaprem/synthetic-contact-matrices/master/generate_synthetic_matrices/output/"
       "syntheticmatrices/contact_all.rdata")
GROUPS = ("children", "adults", "elderly")


def load_matrices(path: Path) -> dict[str, np.ndarray]:
    import rdata
    converted = rdata.conversion.convert(rdata.parser.parse_file(path))
    matrices = converted["contact_all"]
    return {str(k): np.asarray(v, dtype=float) for k, v in matrices.items()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", nargs="*", default=[], help="ISO3 codes whose raw matrices go to tests/fixtures/prem_2021_sample.csv")
    args = parser.parse_args()
    tmp = Path(tempfile.gettempdir()) / "prem_2021_contact_all.rdata"
    if not tmp.exists():
        print(f"downloading {URL} ...", file=sys.stderr)
        urllib.request.urlretrieve(URL, tmp)
    matrices = load_matrices(tmp)
    rows, skipped = [], []
    for iso3 in sorted(matrices):
        pop = tables.age_histogram(iso3)
        if pop is None:
            skipped.append(iso3)
            continue
        c = tables.aggregate_contacts(matrices[iso3], pop)
        rows += [(iso3, GROUPS[i], GROUPS[j], round(float(c[i, j]), 4)) for i in range(3) for j in range(3)]
    path = ROOT / "epichat" / "data" / "contact_matrices.csv"
    with open(path, "w", newline="\n", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["iso3", "source", "target", "contacts"])
        w.writerows(rows)
    print(f"wrote {path.relative_to(ROOT)} ({len(rows) // 9} countries; skipped without a pyramid: {skipped or 'none'})")
    if args.sample:
        sample = ROOT / "tests" / "fixtures" / "prem_2021_sample.csv"
        with open(sample, "w", newline="\n", encoding="utf-8") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(["iso3", "row", "col", "value"])
            for iso3 in args.sample:
                m = matrices[iso3.upper()]
                w.writerows((iso3.upper(), i, j, round(float(m[i, j]), 6)) for i in range(16) for j in range(16))
        print(f"wrote {sample.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Produce the tables**

Run, from the worktree root:

```bash
.venv/Scripts/python.exe -m pip install rdata
.venv/Scripts/python.exe scripts/fetch_un_wpp_tables.py
.venv/Scripts/python.exe scripts/fetch_household_size.py
.venv/Scripts/python.exe scripts/fetch_contact_matrices.py --sample GBR KEN
ls -la epichat/data/*.csv tests/fixtures/prem_2021_sample.csv
```

Expected: `un_wpp_age.csv` about 48,000 rows (about 237 countries × 101 ages × 2 years, roughly 1.1 MB), `un_wpp_cbr.csv` about 7,300 rows, `un_household_size.csv` about 190 countries, `contact_matrices.csv` 1,593 rows (177 countries; the skipped list is empty or names territories without a WPP pyramid), the sample 512 rows. If the download of the 67 MB file fails, retry once; if the Prem URL moves, find `contact_all.rdata` under `generate_synthetic_matrices/output/syntheticmatrices/` in the repository tree and fix `URL`.

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_tables.py tests/test_fetch_scripts.py -q -p no:cacheprovider`
Expected: all pass. If `test_every_country_in_the_indicators_table_has_a_pyramid_for_2024` lists a few ISO3 codes missing from the single-age file (the two WPP files should cover the same countries), print them, confirm they are not countries (the indicators file marks regions with `LocTypeName` other than `Country/Area`), and ledger the finding; do not weaken the test without a reason.

- [ ] **Step 6: Commit**

```bash
git add epichat/params/tables.py scripts/fetch_un_wpp_tables.py scripts/fetch_household_size.py scripts/fetch_contact_matrices.py epichat/data/un_wpp_age.csv epichat/data/un_wpp_cbr.csv epichat/data/un_household_size.csv epichat/data/contact_matrices.csv tests/fixtures/prem_2021_sample.csv tests/test_tables.py tests/test_fetch_scripts.py
git commit -m "feat(data): the bundled WPP pyramids and birth rates, UN household sizes and Prem 2021 contact matrices, with their fetch scripts"
```

---

### Task 3: The R0 on three networks, and the parity fixture (version 4)

**Files:**
- Modify: `epichat/params/r0.py`
- Modify: `scripts/export_parity_fixtures.py`, regenerate `web/tests/fixtures/parity.json`
- Modify: `tests/test_r0_calibration.py` (the two heterogeneous helpers take the matrix from the parameters)
- Test: `tests/test_param_r0.py`, `tests/test_web_exports.py`

**Interfaces:**
- Consumes: `NetworkParams` of Task 1 (`contacts.as_rows()`, `layer_beta`, `household_size`, the layer contacts and age ranges, `contact_duration_days`), `age_shares(p)`, `effective_days(d)`.
- Produces: `r0.contact_matrix(p) -> np.ndarray`, `r0.AGE_BANDS = ((0.0, 18.0), (18.0, 65.0), (65.0, 95.0))`, `r0.age_range_share(shares, lo, hi) -> float`, `r0.hybrid_contacts(p) -> float`, `r0.r0_is_approximate(p) -> bool`, `r0.HYBRID_LEVERS = ("network.household_size", "network.community_contacts", "disease.dur_inf.mean_days")`; `contact_scale` on the three networks; `CONTACT_MATRIX` stays the POLYMOD default (now built from `registry.CONTACT_DEFAULTS`); fixture cases carry `"approximate": bool`, version 4.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_param_r0.py`:

```python
def test_hybrid_r0_sums_the_layers_weighted_by_their_transmissibility():
    p = v2(network={"network_type": "hybrid"})          # defaults: household 2, contacts 20/16/20, betas 3/0.6/0.6/0.3, ages 6-22 and 22-65
    shares = (0.3, 0.7, 0.0)                             # no demographics: Starsim's default ages
    school = r0.age_range_share(shares, 6, 22)
    work = r0.age_range_share(shares, 22, 65)
    assert school == pytest.approx(0.3 * 12 / 18 + 0.7 * 4 / 47) and work == pytest.approx(0.7 * 43 / 47)
    assert r0.age_range_share(shares, 0, 95) == pytest.approx(1.0) and r0.age_range_share((0.2, 0.6, 0.2), 65, 95) == pytest.approx(0.2)
    contacts = 3.0 * 2.0 + 0.6 * 20 * school + 0.6 * 16 * work + 0.3 * 20
    assert r0.hybrid_contacts(p) == pytest.approx(contacts)
    assert r0.approx_r0(p) == pytest.approx(contacts * r0.per_contact_prob(p.disease.beta) * r0.effective_days(p.disease))
    scaled = v2(network={"network_type": "hybrid", "network_beta": 2.0}, disease={"rel_sus_age": {"children": 1.5, "adults": 1.0, "elderly": 0.7}})
    assert r0.approx_r0(scaled) == pytest.approx(2.0 * (0.3 * 1.5 + 0.7 * 1.0) * r0.approx_r0(p))
    assert r0.r0_is_approximate(p) and not r0.r0_is_approximate(v2()) and r0.r0_is_approximate(v2(network={"contact_duration_days": 7}))
    assert not r0.r0_is_approximate(v2(network={"network_type": "age_structured"}))
    with pytest.raises(r0.R0Unreachable) as e:
        r0.calibrate_beta(p, 1000.0)
    assert e.value.levers == r0.HYBRID_LEVERS
    assert r0.approx_r0(r0.with_r0(p, 2.5)) == pytest.approx(2.5, rel=1e-6)


def test_the_configured_contact_matrix_drives_the_age_structured_r0():
    base = v2(network={"network_type": "age_structured"})
    assert np.array_equal(r0.contact_matrix(base), r0.CONTACT_MATRIX)
    doubled = v2(network={"network_type": "age_structured", "contacts": {k: 2 * v for k, v in base.network.contacts.model_dump().items()}})
    assert r0.approx_r0(doubled) == pytest.approx(2 * r0.approx_r0(base))
    assert r0.max_r0(base) == pytest.approx(r0.CONTACT_SPECTRAL_RADIUS * r0.effective_days(base.disease))
    held = r0.recalibrate_beta(doubled, r0.approx_r0(base), base)      # fetch_demographics holds the confirmed R0 across the matrix change
    assert r0.approx_r0(held) == pytest.approx(r0.approx_r0(base), rel=1e-6) and held.disease.beta < base.disease.beta
    assert r0.contact_matrix(v2()).shape == (3, 3)
```

(`np` is imported in the file; if not, add `import numpy as np`.)

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_r0.py -q -p no:cacheprovider -k "hybrid_r0 or configured_contact_matrix"`
Expected: FAIL with `AttributeError: module 'epichat.params.r0' has no attribute 'age_range_share'` / `'contact_matrix'`.

- [ ] **Step 3: The R0**

In `epichat/params/r0.py`:

```python
from .registry import CONTACT_DEFAULTS, LATENT_MODELS
...
CONTACT_MATRIX = np.array(CONTACT_DEFAULTS)          # the POLYMOD-like default (Part 1, section 18); the parameters may carry another
CONTACT_SPECTRAL_RADIUS = float(np.linalg.eigvals(CONTACT_MATRIX).real.max())
RANDOM_LEVERS = ("network.n_contacts", "disease.dur_inf.mean_days")
AGE_LEVERS = ("network.network_beta", "disease.dur_inf.mean_days")
HYBRID_LEVERS = ("network.household_size", "network.community_contacts", "disease.dur_inf.mean_days")
AGE_BANDS = ((0.0, 18.0), (18.0, 65.0), (65.0, 95.0))    # the shares path draws ages uniformly within these bands (builder)


def contact_matrix(p: SimParamsV2) -> np.ndarray:
    """The age-structured network's matrix as configured: rows source, columns target (Part 2, 5.3)."""
    return np.array(p.network.contacts.as_rows(), dtype=float)


def age_range_share(shares, lo: float, hi: float) -> float:
    """The share of agents aged lo to hi (hi excluded) when ages are uniform within the three bands."""
    total = 0.0
    for s, (a, b) in zip(shares, AGE_BANDS):
        total += s * max(0.0, min(hi, b) - max(lo, a)) / (b - a)
    return total


def hybrid_contacts(p: SimParamsV2) -> float:
    """Part 2, 5.5: Σ_l beta_l × c_l over the four layers, c_l the agent-weighted mean daily contacts of layer l: the household size
    itself for households (a member of a Poisson(λ) household has λ other members on average), the layer's contacts times the share of
    agents in its age range for schools and workplaces, the community contacts as given."""
    n, s, lb = p.network, age_shares(p), p.network.layer_beta
    return (lb.household * n.household_size
            + lb.school * n.school_contacts * age_range_share(s, n.school_age_min, n.school_age_max)
            + lb.work * n.work_contacts * age_range_share(s, n.work_age_min, n.work_age_max)
            + lb.community * n.community_contacts)


def r0_is_approximate(p: SimParamsV2) -> bool:
    """Part 2, 5.2 and 5.5: no closed form holds with persistent contacts or on the hybrid network; the measured R0 is the one to quote."""
    return p.network.network_type == "hybrid" or p.network.contact_duration_days > 0


def contact_scale(p: SimParamsV2) -> float:
    n = p.network
    r = p.disease.rel_sus_age.as_tuple()
    s = age_shares(p)
    mean_r = sum(si * ri for si, ri in zip(s, r))
    if n.network_type == "age_structured":
        # Each target group's column of the next-generation matrix scales by its susceptibility: rho(C · diag(r)) (Part 2, 4.4).
        contacts = float(np.linalg.eigvals(contact_matrix(p) @ np.diag(r)).real.max())
    elif n.network_type == "hybrid":
        contacts = hybrid_contacts(p) * mean_r
    else:
        contacts = n.n_contacts * mean_r
    return contacts * n.network_beta * effective_days(p.disease)
```

In `calibrate_beta` choose the levers by network: `HYBRID_LEVERS if p.network.network_type == "hybrid" else AGE_LEVERS if p.network.network_type == "age_structured" else RANDOM_LEVERS`. Update the module docstring's formula line to name the three networks.

In `tests/test_r0_calibration.py`, change `heterogeneous_final_sizes(a)` to `heterogeneous_final_sizes(a, matrix)` using `matrix.T @ …` and `age_structured_heterogeneous_final_sizes(a, r)` to take `matrix` too; call them with `r0.contact_matrix(p)` (the default scenarios still carry the POLYMOD matrix, so the expected values are unchanged).

- [ ] **Step 4: Run the R0 tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_r0.py -q -p no:cacheprovider`
Expected: all pass.

- [ ] **Step 5: The fixture**

In `scripts/export_parity_fixtures.py`, `random_params`: `network_type = rng.choice(["random", "age_structured", "hybrid"])`; after the `network = {...}` line add

```python
    network["contacts_dist"] = rng.choice(["constant", "poisson"])
    network["contact_duration_days"] = rng.choice([0.0, 0.0, 0.0, 7.0, 30.0])
    if network_type == "age_structured" and rng.random() < 0.6:
        network["contacts"] = {f"{s}_{t}": round(d * rng.uniform(0.5, 1.5), 2) for (s, t), d in zip(
            ((s, t) for s in ("children", "adults", "elderly") for t in ("children", "adults", "elderly")),
            (v for row in r0.CONTACT_DEFAULTS.tolist() for v in row))}
        network["contacts_source"] = rng.choice(["prem_2021:KEN", "user"])
    if network_type == "hybrid":
        network.update(household_size=round(rng.uniform(1.5, 6.0), 2), school_contacts=rng.randint(5, 40), work_contacts=rng.randint(5, 30),
                       community_contacts=rng.randint(5, 40),
                       layer_beta={k: round(rng.uniform(0.1, 4.0), 2) for k in ("household", "school", "work", "community")})
        lo = rng.randint(4, 8)
        network.update(school_age_min=lo, school_age_max=lo + rng.randint(10, 16), work_age_min=rng.randint(16, 25), work_age_max=rng.randint(60, 70))
```

(use `r0.CONTACT_MATRIX.tolist()` for the defaults), add `demographics["age_source"] = rng.choice(["default", "shares", "un_wpp"])` when shares are drawn, and `run["calibrate_r0"] = rng.random() < 0.8`. In `params_cases`: the switched case cycles `random → age_structured → hybrid → random`; each case adds `"approximate": r0.r0_is_approximate(p)`; bump the file's `"version"` to 4. Run `.venv/Scripts/python.exe scripts/export_parity_fixtures.py`, restore end-of-line-only rewrites under `web/tests/fixtures/adapters/` with `git checkout --` (check with `git diff --stat` that nothing but line endings changed), and in `tests/test_web_exports.py` set the parity pin to 4.

- [ ] **Step 6: Run the Python suites that read the fixture**

Run: `.venv/Scripts/python.exe -m pytest tests/test_web_exports.py tests/test_param_r0.py -q -p no:cacheprovider`
Expected: all pass (the TypeScript side goes red until Task 4; that is expected).

- [ ] **Step 7: Commit**

```bash
git add epichat/params/r0.py scripts/export_parity_fixtures.py web/tests/fixtures/parity.json tests/test_param_r0.py tests/test_r0_calibration.py tests/test_web_exports.py
git commit -m "feat(params): the R0 on the hybrid network and the configured contact matrix; parity fixture v4"
```

---

### Task 4: The TypeScript mirror — schemas, R0 and the per-country web table

**Files:**
- Modify: `web/lib/sim/params.ts` (lines 18, 88–131 schemas, 306–400 R0 functions)
- Modify: `scripts/export_web_data.py`; create `web/data/country_demographics.json`; create `web/lib/data/countryDemographics.ts`
- Test: `web/tests/sim/params.test.ts`, `web/tests/sim/parity.test.ts`, `web/tests/sim/registry.test.ts`, `web/tests/data/countryDemographics.test.ts` (new), `tests/test_web_exports.py`

**Interfaces:**
- Consumes: `web/data/param_registry.json` (version 3, Task 1), `web/tests/fixtures/parity.json` (version 4, Task 3), `epichat.params.tables` (Task 2).
- Produces: `NETWORK_TYPES` with `"hybrid"`, `CONTACTS_DISTS`, `AGE_SOURCES`, `ContactMatrixSchema`, `LayerBetaSchema`, `contactRows(c) -> number[][]`, `contactMatrix(p)`, `ageRangeShare(shares, lo, hi)`, `hybridContacts(p)`, `r0IsApproximate(p)`, `HYBRID_LEVERS`; `countryDemographics(iso3) -> { shares: Record<string, [number, number, number]>; household_size: number | null; contacts: number[] | null } | null` and `sharesFor(entry, year) -> [number, number, number] | null` (percentages, one decimal); `web/data/country_demographics.json` `{ version: 1, countries: { ISO3: {...} } }`.

- [ ] **Step 1: Write the failing tests**

In `web/tests/sim/params.test.ts`, inside the describe block that ends with the `weightedCfr` expectation (the "susceptibility and fatality by age, presymptomatic transmissibility" block), add after it:

```ts
  it("mirrors the hybrid R0, the configured matrix and the approximate flag", () => {
    const hybrid = must({ schema_version: 2, network: { network_type: "hybrid" } });
    const school = ageRangeShare([0.3, 0.7, 0], 6, 22);
    const work = ageRangeShare([0.3, 0.7, 0], 22, 65);
    expect(school).toBeCloseTo(0.3 * 12 / 18 + 0.7 * 4 / 47, 12);
    expect(hybridContacts(hybrid)).toBeCloseTo(3 * 2 + 0.6 * 20 * school + 0.6 * 16 * work + 0.3 * 20, 9);
    expect(r0IsApproximate(hybrid)).toBe(true);
    expect(r0IsApproximate(must({ schema_version: 2 }))).toBe(false);
    expect(r0IsApproximate(must({ schema_version: 2, network: { contact_duration_days: 7 } }))).toBe(true);
    expect(() => calibrateBeta(hybrid, 1000)).toThrow(/network.household_size/);
    const base = must({ schema_version: 2, network: { network_type: "age_structured" } });
    const doubled = must({ schema_version: 2, network: { network_type: "age_structured", contacts: Object.fromEntries(Object.entries(base.network.contacts).map(([k, v]) => [k, 2 * v])) } });
    expect(approxR0(doubled)).toBeCloseTo(2 * approxR0(base), 9);
    expect(contactRows(base.network.contacts)).toEqual([[7, 2.5, 0.5], [2.5, 9, 1.5], [0.5, 1.5, 3.5]]);
    expect(validateParams({ schema_version: 2, network: { school_age_min: 22, school_age_max: 22 } })).toEqual({ ok: false, error: expect.stringContaining("school_age_min") });
    expect(must({ schema_version: 2 }).network).toMatchObject({ contacts_dist: "constant", contact_duration_days: 0, contacts_source: "polymod_default", household_size: 2, layer_beta: { household: 3, school: 0.6, work: 0.6, community: 0.3 } });
    expect(must({ schema_version: 2 }).demographics.age_source).toBe("default");
    expect(must({ schema_version: 2 }).run.calibrate_r0).toBe(true);
  });
```

Add `ageRangeShare, contactRows, hybridContacts, r0IsApproximate` to the file's import from `@/lib/sim/params`. In `web/tests/sim/parity.test.ts` set the version pin to 4 and, inside the loop over cases, add `expect(r0IsApproximate(p)).toBe((c as { approximate: boolean }).approximate);` (import `r0IsApproximate`). In `web/tests/sim/registry.test.ts` add `expect(REGISTRY_VERSION).toBe(3);` to the version test (replacing a 2 if one is pinned) and raise the minimum length to 60.

Create `web/tests/data/countryDemographics.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { countryDemographics, sharesFor } from "@/lib/data/countryDemographics";

describe("the bundled country demographics", () => {
  it("carries Kenya's shares, household size and contact matrix", () => {
    const ken = countryDemographics("ken")!;
    const shares = sharesFor(ken, 2024)!;
    expect(shares[0]).toBeGreaterThan(40);
    expect(shares[2]).toBeLessThan(5);
    expect(Math.abs(shares[0] + shares[1] + shares[2] - 100)).toBeLessThan(0.31);
    expect(sharesFor(ken, 2028)).toEqual(sharesFor(ken, 2030));
    expect(ken.household_size).toBeGreaterThan(3);
    expect(ken.contacts).toHaveLength(9);
    expect(countryDemographics("XXX")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run (from `web/`): `npx vitest run tests/sim tests/data`
Expected: compile errors for the missing exports and module; the parity test fails on version 3 and on unknown `hybrid`.

- [ ] **Step 3: The schemas and the R0**

In `web/lib/sim/params.ts`: `export const NETWORK_TYPES = ["random", "age_structured", "hybrid"] as const;` plus `export const CONTACTS_DISTS = ["constant", "poisson"] as const;` and `export const AGE_SOURCES = ["default", "shares", "un_wpp"] as const;`. Replace the `NetworkSchema` with:

```ts
export const ContactMatrixSchema = z.object({
  children_children: withDefault("network.contacts.children_children"),
  children_adults: withDefault("network.contacts.children_adults"),
  children_elderly: withDefault("network.contacts.children_elderly"),
  adults_children: withDefault("network.contacts.adults_children"),
  adults_adults: withDefault("network.contacts.adults_adults"),
  adults_elderly: withDefault("network.contacts.adults_elderly"),
  elderly_children: withDefault("network.contacts.elderly_children"),
  elderly_adults: withDefault("network.contacts.elderly_adults"),
  elderly_elderly: withDefault("network.contacts.elderly_elderly"),
});
export type ContactMatrix = z.infer<typeof ContactMatrixSchema>;
/** Rows source, columns target, as Starsim's MixingPools reads them (Part 2, 5.3). */
export function contactRows(c: ContactMatrix): number[][] {
  return AGE_GROUPS.map((s) => AGE_GROUPS.map((t) => c[`${s}_${t}` as keyof ContactMatrix]));
}
export const LayerBetaSchema = z.object({
  household: withDefault("network.layer_beta.household"),
  school: withDefault("network.layer_beta.school"),
  work: withDefault("network.layer_beta.work"),
  community: withDefault("network.layer_beta.community"),
});
export const NetworkSchema = z
  .object({
    network_type: z.enum(NETWORK_TYPES).default("random"),
    n_contacts: withDefault("network.n_contacts", true),
    network_beta: withDefault("network.network_beta"),
    contacts_dist: z.enum(CONTACTS_DISTS).default("constant"),
    contact_duration_days: withDefault("network.contact_duration_days"),
    contacts: ContactMatrixSchema.prefault({}),
    contacts_source: z.string().default("polymod_default"),
    household_size: withDefault("network.household_size"),
    school_contacts: withDefault("network.school_contacts", true),
    work_contacts: withDefault("network.work_contacts", true),
    community_contacts: withDefault("network.community_contacts", true),
    layer_beta: LayerBetaSchema.prefault({}),
    school_age_min: withDefault("network.school_age_min", true),
    school_age_max: withDefault("network.school_age_max", true),
    work_age_min: withDefault("network.work_age_min", true),
    work_age_max: withDefault("network.work_age_max", true),
  })
  .superRefine((n, ctx) => {
    if (n.school_age_min >= n.school_age_max) issue(ctx, "network.school_age_min must be below network.school_age_max");
    if (n.work_age_min >= n.work_age_max) issue(ctx, "network.work_age_min must be below network.work_age_max");
  });
```

(`withDefault(path, true)` is the file's integer form, as `n_contacts` uses; check its signature at its definition before relying on the second argument.) Add `age_source: z.enum(AGE_SOURCES).default("default"),` to `DemographicsSchema` and `calibrate_r0: z.boolean().default(true),` to `RunSchema`. Then the R0 functions, next to `contactScale`:

```ts
export const HYBRID_LEVERS = ["network.household_size", "network.community_contacts", "disease.dur_inf.mean_days"] as const;
/** The shares path draws ages uniformly within these bands (the builder). */
const AGE_BANDS: [number, number][] = [[0, 18], [18, 65], [65, 95]];

export function contactMatrix(p: SimParams): number[][] {
  return contactRows(p.network.contacts);
}

/** The share of agents aged lo to hi (hi excluded) when ages are uniform within the three bands. */
export function ageRangeShare(shares: readonly [number, number, number], lo: number, hi: number): number {
  return AGE_BANDS.reduce((total, [a, b], i) => total + (shares[i] * Math.max(0, Math.min(hi, b) - Math.max(lo, a))) / (b - a), 0);
}

/** Part 2, 5.5: Σ_l beta_l × c_l, c_l the agent-weighted mean daily contacts of layer l (the household size itself for households). */
export function hybridContacts(p: SimParams): number {
  const n = p.network;
  const s = ageShares(p);
  const lb = n.layer_beta;
  return lb.household * n.household_size + lb.school * n.school_contacts * ageRangeShare(s, n.school_age_min, n.school_age_max)
    + lb.work * n.work_contacts * ageRangeShare(s, n.work_age_min, n.work_age_max) + lb.community * n.community_contacts;
}

/** No closed form holds with persistent contacts or on the hybrid network; the measured R0 is the one to quote (Part 2, 5.2, 5.5). */
export function r0IsApproximate(p: SimParams): boolean {
  return p.network.network_type === "hybrid" || p.network.contact_duration_days > 0;
}
```

and `contactScale` becomes:

```ts
export function contactScale(p: SimParams): number {
  const n = p.network;
  const r = [p.disease.rel_sus_age.children, p.disease.rel_sus_age.adults, p.disease.rel_sus_age.elderly];
  const s = ageShares(p);
  const meanR = s[0] * r[0] + s[1] * r[1] + s[2] * r[2];
  let contacts: number;
  if (n.network_type === "age_structured") contacts = spectralRadius3(contactMatrix(p).map((row) => row.map((v, j) => v * r[j])));
  else if (n.network_type === "hybrid") contacts = hybridContacts(p) * meanR;
  else contacts = n.n_contacts * meanR;
  return contacts * n.network_beta * effectiveDays(p.disease);
}
```

`calibrateBeta` picks `HYBRID_LEVERS` for hybrid, `AGE_LEVERS` for age_structured, `RANDOM_LEVERS` otherwise. If `spectralRadius3` had a shortcut for the identity multipliers, drop it (the matrix is no longer constant).

- [ ] **Step 4: The web table**

In `scripts/export_web_data.py` add:

```python
from epichat.params import tables


def country_demographics_payload() -> dict:
    """Part 2, section 10: the per-country values fetch_demographics applies from the bundled tables (shares as percentages)."""
    countries = {}
    for iso3 in tables.countries():
        shares = {str(year): [round(100 * v, 1) for v in tables.age_shares(iso3, year)] for year in tables.AGE_YEARS}
        m = tables.contact_matrix(iso3)
        countries[iso3] = {"shares": shares, "household_size": tables.household_size(iso3),
                           "contacts": None if m is None else [round(float(v), 4) for v in m.flatten()]}
    return {"version": 1, "countries": countries}
```

and in `main()` `write_json(web_dir / "data" / "country_demographics.json", country_demographics_payload())` (extend the print line). Run `.venv/Scripts/python.exe scripts/export_web_data.py` and restore end-of-line-only rewrites as before. Create `web/lib/data/countryDemographics.ts`:

```ts
/**
 * The bundled per-country demographics of sim-parameters Part 2 (section 10): the UN WPP 2024 age shares for 2024 and 2030, the UN
 * household size and the Prem 2021 contact matrix aggregated to the three age groups (nine values, rows source, columns target).
 * Exported by scripts/export_web_data.py from epichat/params/tables.py.
 */
import FILE from "@/data/country_demographics.json";

export type CountryDemographics = { shares: Record<string, [number, number, number]>; household_size: number | null; contacts: number[] | null };

const COUNTRIES = (FILE as { version: number; countries: Record<string, CountryDemographics> }).countries;

export function countryDemographics(iso3: string): CountryDemographics | null {
  return COUNTRIES[iso3.toUpperCase()] ?? null;
}

/** The shares (percentages) of the bundled year nearest to the scenario's demographics year. */
export function sharesFor(entry: CountryDemographics, year: number): [number, number, number] | null {
  const years = Object.keys(entry.shares).map(Number);
  if (years.length === 0) return null;
  const nearest = years.reduce((best, y) => (Math.abs(y - year) < Math.abs(best - year) ? y : best));
  return entry.shares[String(nearest)] ?? null;
}
```

(Check how `web/lib/data/unWpp.ts` imports `@/data/un_locations.json` and copy its import form.)

- [ ] **Step 5: Run the web suites and the export test**

Run (from `web/`): `npx vitest run && npm run typecheck && npm run lint`; then from the root `.venv/Scripts/python.exe -m pytest tests/test_web_exports.py -q -p no:cacheprovider`.
Expected: all pass; the parity test agrees on all 240 cases including hybrid ones.

- [ ] **Step 6: Commit**

```bash
git add web/lib/sim/params.ts web/lib/data/countryDemographics.ts web/data/country_demographics.json web/data/param_registry.json scripts/export_web_data.py web/tests/sim/params.test.ts web/tests/sim/parity.test.ts web/tests/sim/registry.test.ts web/tests/data/countryDemographics.test.ts
git commit -m "feat(web): the network leaves, the hybrid R0 and the bundled country demographics in TypeScript"
```

---

### Task 5: The builder — three networks, pyramid ages, yearly births, the infection log

**Files:**
- Create: `epichat/sim/demographics.py`
- Modify: `epichat/sim/builder.py` (`build_network`, `_draw_ages`, `AgedPeople` moves out, `build_sim`)
- Test: `tests/test_sim_builder.py`

**Interfaces:**
- Consumes: `tables.age_histogram`, `tables.birth_rate_series` (Task 2); `NetworkParams` (Task 1).
- Produces: `demographics.AgedPeople(n_agents, ages=None, age_data=None)`, `demographics.YearlyBirths(rates_per_1000: list[float], **kwargs)` with `.rates`; `builder.build_people(params, n, seed) -> AgedPeople`, `builder.build_demographics(params) -> list | None`, `builder.build_network(params)` returning `ss.RandomNet`, `ss.MixingPools` or `ss.HybridNet`; every sim built with `analyzers=[ss.infection_log()]` so `sim.diseases[0].infection_log` exists (Task 6 reads it).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_sim_builder.py` (it imports `np`, `ss`, `build_sim`, `v2`; add `from epichat.params import tables` and `from epichat.params.schema_v2 import ContactMatrix` and `from epichat.sim.demographics import YearlyBirths`):

```python
def test_random_network_options_reach_starsim():
    sim = build_sim(v2(network={"contacts_dist": "poisson", "contact_duration_days": 7, "n_contacts": 6, "network_beta": 0.5}))
    net = sim.networks[0]
    assert isinstance(net, ss.RandomNet) and isinstance(net.pars.n_contacts, ss.poisson) and net.pars.n_contacts.pars.lam == 6
    assert float(net.pars.dur.value) == 7.0 and net.pars.beta == 0.5
    plain = build_sim(v2()).networks[0]
    assert isinstance(plain.pars.n_contacts, ss.constant) and float(plain.pars.dur.value) == 0.0


def test_age_structured_network_uses_the_configured_matrix():
    rows = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
    net = build_sim(v2(network={"network_type": "age_structured", "network_beta": 2.0, "contacts": ContactMatrix.from_rows(rows).model_dump()})).networks[0]
    assert isinstance(net, ss.MixingPools) and np.allclose(net.pars.n_contacts, 2.0 * np.array(rows))


def test_hybrid_network_expands_into_four_layers_with_the_configured_values():
    p = v2(network={"network_type": "hybrid", "household_size": 3.5, "school_contacts": 10, "work_contacts": 8, "community_contacts": 5,
                    "layer_beta": {"household": 2.0, "school": 0.5, "work": 0.4, "community": 0.2}, "school_age_min": 5, "school_age_max": 18,
                    "work_age_min": 18, "work_age_max": 60, "network_beta": 2.0},
           demographics={"age_pct_under18": 30.0, "age_pct_18_64": 60.0, "age_pct_over65": 10.0}, run={"n_agents": 3000, "rand_seed": 1})
    sim = build_sim(p)
    assert list(sim.networks.keys()) == ["h", "s", "w", "c"]
    h, s, w, c = (sim.networks[k] for k in "hswc")
    assert isinstance(h, ss.ClusterNet) and h.pars.cluster_size.pars.lam == 3.5 and h.pars.beta == 4.0          # layer beta × network_beta
    assert (s.pars.beta, w.pars.beta, c.pars.beta) == (1.0, 0.8, pytest.approx(0.4))
    assert list(s.pars.age_range) == [5, 18] and list(w.pars.age_range) == [18, 60]
    age = np.asarray(sim.people.age)                                                 # before the run: the layers are built at init
    school = np.unique(np.concatenate([np.asarray(s.p1), np.asarray(s.p2)]))
    work = np.unique(np.concatenate([np.asarray(w.p1), np.asarray(w.p2)]))
    assert len(school) > 100 and np.all((age[school] >= 5) & (age[school] < 18))
    assert len(work) > 100 and np.all((age[work] >= 18) & (age[work] < 60))
    assert len(h) > 1000 and len(c) > 1000
    sim.run()
    assert sim.results.sir.cum_infections.values[-1] > 0
    assert isinstance(build_sim(v2(network={"network_type": "hybrid"})).networks["s"], ss.RandomNet)    # no demographics: default ages fill the layers


def test_pyramid_country_gives_un_ages_and_the_shares_path_stays():
    sim = build_sim(v2(demographics={"country": "KEN", "age_source": "un_wpp"}, run={"n_agents": 20000, "rand_seed": 1}))
    age = np.asarray(sim.people.age)
    c, a, e = tables.age_shares("KEN")
    assert abs((age < 18).mean() - c) < 0.01 and abs((age >= 65).mean() - e) < 0.01 and age.max() <= 101
    assert (age >= 95).sum() > 0                                                      # single ages run to 100, unlike the bands
    old = v2(demographics={"age_pct_under18": 40.0, "age_pct_18_64": 50.0, "age_pct_over65": 10.0}, run={"n_agents": 5000, "rand_seed": 1})
    age = np.asarray(build_sim(old).people.age)                                       # a stored scenario: shares, no age_source
    assert abs((age < 18).mean() - 0.40) < 0.02 and age.max() < 95
    unknown = v2(demographics={"country": "XXX", "age_source": "un_wpp"}, run={"n_agents": 2000, "rand_seed": 1})
    assert np.asarray(build_sim(unknown).people.age).max() < 61                       # no pyramid, no shares: Starsim's defaults


def test_births_follow_the_projected_series_for_multi_year_runs_with_a_country():
    p = v2(demographics={"use_demographics": True, "country": "KEN", "birth_rate": 30.0, "death_rate": 0.1},
           run={"n_agents": 2000, "sim_dur_years": 3.0, "rand_seed": 1})
    births = build_sim(p).demographics[0]
    series = tables.birth_rate_series("KEN", 2022, 3)
    assert isinstance(births, YearlyBirths) and births.rates == [30.0, series[1], series[2]]      # the first year keeps the configured rate
    one_year = v2(demographics={"use_demographics": True, "country": "KEN"}, run={"n_agents": 2000, "sim_dur_years": 1.0})
    assert type(build_sim(one_year).demographics[0]) is ss.Births
    no_country = v2(demographics={"use_demographics": True}, run={"n_agents": 2000, "sim_dur_years": 3.0})
    assert type(build_sim(no_country).demographics[0]) is ss.Births


def test_yearly_births_switch_the_rate_at_each_sim_year():
    sim = ss.Sim(n_agents=2000, networks=ss.RandomNet(n_contacts=2), diseases=ss.SIR(beta=ss.peryear(0.001), init_prev=ss.bernoulli(p=0.0)),
                 demographics=YearlyBirths([200.0, 0.0]), start=ss.days(0), dur=ss.days(730), dt=ss.days(1), rand_seed=1, verbose=0)
    sim.run()
    new = np.asarray(sim.results.yearlybirths.new.values)
    assert new[:365].sum() > 200 and new[365:].sum() == 0


def test_every_sim_logs_its_infections():
    sim = build_sim(v2())
    sim.run()
    assert sim.diseases[0].infection_log is not None and len(sim.diseases[0].infection_log) >= 10
```

(If `sim.results.yearlybirths` is not the result key Starsim gives the subclass, read `sim.demographics[0].results.new.values` instead.)

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_builder.py -q -p no:cacheprovider -k "options_reach or configured_matrix or four_layers or pyramid_country or projected_series or switch_the_rate or logs_its"`
Expected: `ImportError` on `epichat.sim.demographics`; after a stub, the matrix and options tests fail on the old `build_network`.

- [ ] **Step 3: Implement**

Create `epichat/sim/demographics.py`:

```python
"""Population pieces of Part 2 section 6: people whose ages are written before any module's init_post, from the UN pyramid or the three
shares, and births whose crude rate follows a yearly series on the sim's own year axis (the sims run on numeric days from day 0, so
Starsim's calendar-year lookup cannot be used)."""
from __future__ import annotations

import numpy as np
import starsim as ss


class AgedPeople(ss.People):
    """People whose ages are set in init_vals, before any module's init_post, so the day-0 seeds draw their prognoses on them (Part 2, 4.1).
    `age_data` is Starsim's histogram form (a DataFrame with age and value columns); `ages` an explicit array for the shares path."""

    def __init__(self, n_agents: int, ages: np.ndarray | None = None, age_data=None):
        super().__init__(n_agents, age_data=age_data)
        self._ages = ages

    def init_vals(self):
        super().init_vals()
        if self._ages is not None:
            self.age[:] = self._ages[:len(self)]


class YearlyBirths(ss.Births):
    """Births at rates_per_1000[y] during sim year y (the last value for later years); Part 2, 6.2."""

    def __init__(self, rates_per_1000, **kwargs):
        self.rates = [float(r) for r in rates_per_1000]
        super().__init__(birth_rate=ss.peryear(self.rates[0]), **kwargs)

    def step(self):
        year = min(int(self.ti // 365), len(self.rates) - 1)        # dt is one day
        self.pars.birth_rate = ss.peryear(self.rates[year])
        return super().step()
```

In `epichat/sim/builder.py`: remove the `AgedPeople` class (import it from `.demographics` with `YearlyBirths`), `import math`, `import pandas as pd`, `from epichat.params import tables`, and replace `build_network` with:

```python
def build_network(params: SimParamsV2):
    n = params.network
    if n.network_type == "age_structured":
        return ss.MixingPools(src=age_groups(), dst=age_groups(), n_contacts=np.array(n.contacts.as_rows()) * n.network_beta, beta=1.0)
    if n.network_type == "hybrid":
        lb = n.layer_beta
        return ss.HybridNet(household_size=ss.poisson(lam=n.household_size),
                            contacts=dict(s=n.school_contacts, w=n.work_contacts, c=n.community_contacts),
                            beta=dict(h=lb.household * n.network_beta, s=lb.school * n.network_beta, w=lb.work * n.network_beta,
                                      c=lb.community * n.network_beta),
                            school_ages=[n.school_age_min, n.school_age_max], work_ages=[n.work_age_min, n.work_age_max])
    contacts = ss.poisson(lam=n.n_contacts) if n.contacts_dist == "poisson" else ss.constant(n.n_contacts)
    return ss.RandomNet(n_contacts=contacts, dur=ss.days(n.contact_duration_days), beta=n.network_beta)
```

Add, before `build_sim`:

```python
def build_people(params: SimParamsV2, n: int, seed: int) -> AgedPeople:
    """Part 2, 6.1: the UN pyramid when the country has one and age_source is un_wpp; else uniform ages within the shares; else Starsim's."""
    g = params.demographics
    if g.age_source == "un_wpp" and g.country:
        hist = tables.age_histogram(g.country, g.demographics_year)
        if hist is not None:
            ages = list(range(tables.MAX_AGE + 1)) + [tables.MAX_AGE + 1]              # the last row closes the 100-and-over bin
            return AgedPeople(n, age_data=pd.DataFrame({"age": ages, "value": list(hist) + [0.0]}))
    if g.age_pct_under18 is not None:
        return AgedPeople(n, ages=_draw_ages(params, n, seed))
    return AgedPeople(n)


def build_demographics(params: SimParamsV2) -> list | None:
    """Part 2, 6.2: crude rates; for runs longer than a year with a known country the births follow WPP's projected series after the
    first year, which keeps the configured rate."""
    g = params.demographics
    if not g.use_demographics:
        return None
    births = ss.Births(birth_rate=ss.peryear(g.birth_rate))
    if g.country and params.run.sim_dur_years > 1:
        series = tables.birth_rate_series(g.country, g.demographics_year, math.ceil(params.run.sim_dur_years))
        if series:
            births = YearlyBirths([g.birth_rate] + series[1:])
    return [births, ss.Deaths(death_rate=ss.peryear(g.death_rate))]
```

and in `build_sim` replace the demographics block and the `ss.Sim(...)` call with:

```python
    rand_seed = resolve_seed(params, seed)
    n = params.run.n_agents
    sim = ss.Sim(n_agents=n, people=build_people(params, n, rand_seed), networks=build_network(params), diseases=disease,
                 demographics=build_demographics(params), interventions=build_interventions(params) or None, connectors=[connector],
                 analyzers=[ss.infection_log()],        # Part 2, 5.6: the measured R0 reads it
                 start=ss.days(0), dur=ss.days(sim_days(params.run.sim_dur_years)), dt=ss.days(1), verbose=0, rand_seed=rand_seed)
    sim.init()
```

Update the module docstring (networks, pyramid, births, the log) and `__all__` (`build_people`, `build_demographics`).

- [ ] **Step 4: Run the builder suites**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_builder.py tests/test_sim_models.py tests/test_sim_connectors.py tests/test_sim_interventions.py tests/test_sim_run_params.py tests/test_sim_outputs.py tests/test_sim_replicates.py -q -p no:cacheprovider`
Expected: all pass. If `test_random_network_options_reach_starsim` fails on `net.pars.dur.value`, print `net.pars.dur` and assert on the attribute Starsim's `ss.days` exposes; ledger it. If a Starsim result name differs (`yearlybirths`), fix the test as noted.

- [ ] **Step 5: Run the parity suite (the random network's edge draws must be unchanged)**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_parity.py -q -p no:cacheprovider`
Expected: 6 passed. `ss.constant(n)` is what `RandomExactNet` builds from a bare integer and `ss.days(0)` equals its default, so the v1 baseline holds; a failure here means the draws moved and must be investigated, not re-captured.

- [ ] **Step 6: Commit**

```bash
git add epichat/sim/demographics.py epichat/sim/builder.py tests/test_sim_builder.py
git commit -m "feat(sim): the three networks with their options, the UN pyramid ages, yearly births and the infection log"
```

---

### Task 6: The measured R0, and the corrected parameters travelling back

**Files:**
- Modify: `epichat/sim/outputs.py`, `epichat/sim/replicates.py`, `sim/runner.py`, `sim/service.py`
- Test: `tests/test_sim_outputs.py`, `tests/test_r0_calibration.py`, `sim/tests/test_service.py`

**Interfaces:**
- Consumes: `sim.diseases[0].infection_log` (Task 5).
- Produces: `outputs.measured_r0(sim) -> float | None`; `stats["r0_measured"]` on every replicate's stats; the child's payload gains `"effective_params"` (the parameters as run, JSON); `RunResult.effective_params: dict | None`; `Outcome.effective_params` adopts it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_sim_outputs.py` (imports: `numpy as np`, `SimParamsV2`, `build_sim`, `extract`, `measured_r0` from `epichat.sim.outputs`; follow the file's imports):

```python
def test_measured_r0_counts_the_seeds_secondary_infections():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    from epichat.sim.outputs import extract, measured_r0
    p = SimParamsV2.model_validate({"disease": {"beta": 100.0, "dur_inf": {"mean_days": 5}, "seed": {"mode": "count", "value": 20}},
                                    "run": {"n_agents": 2000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    r0 = measured_r0(sim)
    df = sim.diseases[0].infection_log.to_df()
    seeds = df[df["source"].astype(float) < 0]["target"].to_numpy()
    assert len(seeds) == 20 and r0 == float(df["source"].isin(seeds).sum()) / 20 and r0 > 0.5
    assert extract(sim, 2000, sim.seeds_day0, False)["stats"]["r0_measured"] == r0
    quiet = SimParamsV2.model_validate({"disease": {"beta": 0.0001, "seed": {"mode": "count", "value": 20}}, "run": {"n_agents": 2000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(quiet)
    sim.run()
    assert measured_r0(sim) == 0.0                                                   # seeds, but they infected nobody
    later = SimParamsV2.model_validate({"disease": {"seed": {"mode": "count", "value": 20, "day": 5}}, "run": {"n_agents": 2000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(later)
    sim.run()
    assert measured_r0(sim) is None                                                  # no day-0 seeds
```

Append to `tests/test_r0_calibration.py`:

```python
def test_measured_r0_matches_the_configured_r0_on_the_random_network():
    # 500 seeds rather than the spec's 50: the mean of 50 secondary-infection counts has a 9% standard error at R0 2.5
    body = scenario("sir", "gamma", 2.5).model_dump()
    body["disease"]["seed"] = {"mode": "count", "value": 500, "day": 0}
    body["run"]["sim_dur_years"] = 60 / 365
    p = SimParamsV2.model_validate(body)
    measured = []
    for seed in (1, 2, 3):
        sim = build_sim(p, seed=seed)
        sim.run()
        measured.append(sim.results.sir.cum_infections.values[-1] and extract(sim, N, sim.seeds_day0, False)["stats"]["r0_measured"])
    assert abs(np.mean(measured) - 2.5) / 2.5 < 0.10


def test_measured_r0_is_finite_on_the_hybrid_network_and_within_a_factor_of_two_of_the_approximation():
    body = scenario("sir", "gamma", 2.5).model_dump()
    body["network"].update(network_type="hybrid")
    body["demographics"].update(SHARES)
    body["disease"]["seed"] = {"mode": "count", "value": 500, "day": 0}
    body["run"].update(sim_dur_years=60 / 365, calibrate_r0=False)
    p = r0.with_r0(SimParamsV2.model_validate(body), 2.5)
    sim = build_sim(p, seed=1)
    sim.run()
    measured = extract(sim, N, sim.seeds_day0, False)["stats"]["r0_measured"]
    assert measured is not None and 1.25 < measured < 5.0
```

In `sim/tests/test_service.py` add a fake run result carrying `effective_params` and a test that `simulate(...)`'s outcome adopts it:

```python
def test_the_childs_effective_params_replace_the_requests():
    params = _params()                                     # the file's helper; else SimParamsV2.model_validate({...}) as its other tests do
    corrected = params.model_dump(mode="json")
    corrected["disease"]["beta"] = 12.5
    run = FakeRunner([RunResult(True, GOOD_STATS, GOOD_SERIES, None, False, 10, None, corrected)])
    outcome = simulate(params, "", _settings(), run=run, repair=_never_repair)
    assert outcome.ok and outcome.effective_params.disease.beta == 12.5
    plain = FakeRunner([_ok()])
    assert simulate(params, "", _settings(), run=plain, repair=_never_repair).effective_params.disease.beta == params.disease.beta
```

(Use the file's own helper names for the settings and the repairer that must not be called; read its first 60 lines.)

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_outputs.py -q -p no:cacheprovider -k measured_r0` and `/c/Users/Yuke/stat/other-projects/EpiChat/epichat/sim/.venv/Scripts/python.exe -m pytest sim/tests/test_service.py -q -p no:cacheprovider -k effective_params`
Expected: `ImportError: cannot import name 'measured_r0'`; `TypeError: RunResult.__init__() takes … positional arguments`.

- [ ] **Step 3: Implement**

In `epichat/sim/outputs.py` (import `pandas as pd`):

```python
def measured_r0(sim: ss.Sim) -> float | None:
    """Part 2, 5.6: the mean number of secondary infections caused by the day-0 seeds (the log's entries with source −1 at t 0);
    None without day-0 seeds, 0.0 when they infected nobody."""
    log = getattr(sim.diseases[0], "infection_log", None)
    if log is None or len(log) == 0:
        return None
    df = log.to_df()
    source = pd.to_numeric(df["source"], errors="coerce").to_numpy(dtype=float)
    t = np.array([float(x) for x in df["t"]])
    targets = df["target"].to_numpy()
    seeds = targets[(t == 0) & (np.isnan(source) | (source < 0))]
    if len(seeds) == 0:
        return None
    return float(np.isin(source, seeds).sum()) / len(seeds)
```

and in `extract` set `stats["r0_measured"] = measured_r0(sim)`. In `epichat/sim/replicates.py` add `payload["effective_params"] = params.model_dump(mode="json")`. In `sim/runner.py` add `effective_params: dict | None = None` as the last `RunResult` field (after `replicates`) and read `payload.get("effective_params")` in the success return. In `sim/service.py`, on success: `effective = SimParamsV2.model_validate(result.effective_params) if result.effective_params else params` and pass it as the outcome's params. Keep `sim/series.py`'s `COUNT_STATS` as it is: `r0_measured` is a ratio and must not be scaled.

- [ ] **Step 4: Run the tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_outputs.py tests/test_sim_replicates.py tests/test_sim_run_params.py -q -p no:cacheprovider && .venv/Scripts/python.exe -m pytest tests/test_r0_calibration.py -q -p no:cacheprovider -k measured_r0 && /c/Users/Yuke/stat/other-projects/EpiChat/epichat/sim/.venv/Scripts/python.exe -m pytest sim/tests -q -p no:cacheprovider`
Expected: all pass (the two calibration-file tests take about 20 s). If `float(x)` fails on the log's `t` entries, inspect one (`type(df["t"].iloc[0])`) and convert through the attribute it exposes; ledger it.

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/outputs.py epichat/sim/replicates.py sim/runner.py sim/service.py tests/test_sim_outputs.py tests/test_r0_calibration.py sim/tests/test_service.py
git commit -m "feat(sim): the measured R0 from the infection log; the child's effective parameters travel back"
```

---

### Task 7: Calibration to the measured R0

**Files:**
- Create: `epichat/sim/calibrate.py`
- Modify: `epichat/sim/replicates.py`
- Test: `tests/test_sim_calibrate.py` (new), `sim/tests/test_real_run.py`

**Interfaces:**
- Consumes: `r0.r0_is_approximate`, `r0.approx_r0`, `r0.clamp_beta`, `build_sim`, `measured_r0`, `sim_days`.
- Produces: `calibrate.PILOT_SEEDS = 300`, `calibrate.PILOT_SEED_SHARE = 0.02`, `calibrate.PILOT_SEED_FLOOR = 20`, `calibrate.PILOT_WINDOW_MULTIPLE = 4`, `calibrate.TOLERANCE = 0.05`, `calibrate.MAX_CORRECTIONS = 3`; `calibrate.needs_calibration(p) -> bool`; `calibrate.pilot_params(p, seed) -> SimParamsV2`; `calibrate.measure(p, seed) -> float | None`; `calibrate.calibrate_by_measurement(p, seed) -> tuple[SimParamsV2, dict | None]` with the dict `{"target", "measured", "corrections"}`; `stats["r0_calibration"]` on the representative's stats when a pilot ran.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_sim_calibrate.py`:

```python
"""Part 2, 5.7: beta calibrated to the measured R0 where the formula is approximate."""
import numpy as np
import pytest

from epichat.params import r0
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim import calibrate
from epichat.sim.builder import build_sim
from epichat.sim.outputs import extract
from epichat.sim.replicates import run_replicates

SHARES = {"age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8}


def hybrid(n_agents: int, target: float, **run) -> SimParamsV2:
    p = SimParamsV2.model_validate({"disease": {"dur_inf": {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}, "p_death": 0.0,
                                                "seed": {"mode": "count", "value": 50}},
                                    "network": {"network_type": "hybrid"}, "demographics": SHARES,
                                    "run": {"n_agents": n_agents, "sim_dur_years": 1.0, "rand_seed": 1, **run}})
    return r0.with_r0(p, target)


def test_exact_networks_and_the_switch_run_no_pilot(monkeypatch):
    monkeypatch.setattr(calibrate, "measure", lambda p, seed: pytest.fail("a pilot ran on an exact network"))
    for p in (SimParamsV2(), SimParamsV2.model_validate({"network": {"network_type": "age_structured"}}),
              SimParamsV2.model_validate({"network": {"network_type": "hybrid"}, "run": {"calibrate_r0": False}})):
        assert calibrate.calibrate_by_measurement(p, 1) == (p, None)
    assert calibrate.needs_calibration(SimParamsV2.model_validate({"network": {"contact_duration_days": 7}}))


def test_pilot_params_are_short_bare_and_well_seeded():
    p = hybrid(50_000, 2.5)
    body = p.model_dump()
    body["interventions"] = [{"type": "seasonality", "scale": 0.3}]
    body["disease"]["initial_immune_frac"] = 0.4
    p = SimParamsV2.model_validate(body)
    pilot = calibrate.pilot_params(p, 7)
    assert pilot.run.sim_dur_years == pytest.approx(40 / 365) and pilot.run.rand_seed == 7 and pilot.run.n_replicates == 1
    assert pilot.disease.seed.mode == "count" and pilot.disease.seed.value == 300 and pilot.disease.seed.day == 0      # min(300, 2% of 50k)
    assert pilot.interventions == [] and pilot.disease.initial_immune_frac == 0.0 and pilot.run.calibrate_r0 is False
    assert pilot.network.network_type == "hybrid" and pilot.disease.beta == p.disease.beta
    small = calibrate.pilot_params(hybrid(1000, 2.5, sim_dur_years=20 / 365), 1)
    assert small.disease.seed.value == 20 and small.run.sim_dur_years == pytest.approx(20 / 365)                       # the floor; never longer than the run


def test_hybrid_calibration_lands_within_five_percent_in_at_most_three_corrections():
    p = hybrid(50_000, 2.5)
    calibrated, info = calibrate.calibrate_by_measurement(p, 1)
    assert info["target"] == pytest.approx(2.5, abs=1e-3) and info["corrections"] <= calibrate.MAX_CORRECTIONS
    assert abs(info["measured"] - 2.5) / 2.5 <= calibrate.TOLERANCE
    assert calibrated.disease.beta != p.disease.beta or info["corrections"] == 0
    body = calibrated.model_dump()
    body["disease"]["seed"] = {"mode": "count", "value": 500, "day": 0}
    body["run"].update(sim_dur_years=60 / 365, calibrate_r0=False)
    sim = build_sim(SimParamsV2.model_validate(body), seed=2)
    sim.run()
    assert abs(extract(sim, 50_000, sim.seeds_day0, False)["stats"]["r0_measured"] - 2.5) / 2.5 < 0.12               # a fresh seed, 500 seeds


def test_a_pilot_that_measures_nothing_stops_cleanly():
    body = hybrid(1000, 2.5, sim_dur_years=60 / 365).model_dump()
    body["disease"]["beta"] = 0.001
    p = SimParamsV2.model_validate(body)
    calibrated, info = calibrate.calibrate_by_measurement(p, 1)
    assert calibrated.disease.beta == 0.001 and info["corrections"] == 0 and info["measured"] in (0.0, None)


def test_run_replicates_reports_the_calibration_and_the_corrected_beta():
    p = hybrid(5000, 2.5, sim_dur_years=60 / 365)
    payload = run_replicates(p)
    info = payload["stats"]["r0_calibration"]
    assert set(info) == {"target", "measured", "corrections"} and payload["effective_params"]["disease"]["beta"] != p.disease.beta or info["corrections"] == 0
    assert payload["effective_params"]["network"]["network_type"] == "hybrid" and "r0_measured" in payload["stats"]
    plain = run_replicates(SimParamsV2.model_validate({"run": {"n_agents": 1000, "sim_dur_years": 30 / 365, "rand_seed": 1}}))
    assert "r0_calibration" not in plain["stats"] and plain["effective_params"]["disease"]["beta"] == SimParamsV2().disease.beta
```

In `sim/tests/test_real_run.py` add:

```python
def test_hybrid_run_calibrates_beta_and_reports_the_measured_r0(client):
    params = {"schema_version": 2, "disease": {"seed": {"mode": "count", "value": 30}}, "network": {"network_type": "hybrid"},
              "run": {"n_agents": 3000, "sim_dur_years": 90 / 365, "rand_seed": 1}}
    r = client.post("/simulate", json={"params": params, "pop_scale": 1}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["stats"]["r0_measured"], float) and body["stats"]["r0_calibration"]["corrections"] <= 3
    assert body["effective_params"]["network"]["network_type"] == "hybrid"
    assert body["stats"]["r0_measured"] == body["stats_agents"]["r0_measured"]          # a ratio: never scaled
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_calibrate.py -q -p no:cacheprovider -k "no_pilot or pilot_params or measures_nothing"`
Expected: `ModuleNotFoundError: No module named 'epichat.sim.calibrate'`.

- [ ] **Step 3: Implement**

Create `epichat/sim/calibrate.py`:

```python
"""Part 2, 5.7: where the R0 formula is approximate (the hybrid network, or a contact duration above zero) the child runs a short pilot
with the formula's beta, measures the seeds' secondary infections, corrects beta by target / measured and repeats until the measured R0
is within 5% of the target or three corrections have been made. The pilot is the scenario without its interventions and initial
immunity (an R0 is measured in a susceptible population), seeded with at least 300 day-0 infections (2% of the agents when that is
fewer, never under 20) so the measurement's standard error stays near 5%, and runs for four times the latent plus infectious means."""
from __future__ import annotations

import math

from epichat.params.r0 import approx_r0, clamp_beta, r0_is_approximate
from epichat.params.schema_v2 import SimParamsV2, sim_days

from .builder import build_sim
from .outputs import measured_r0

PILOT_SEEDS = 300
PILOT_SEED_SHARE = 0.02
PILOT_SEED_FLOOR = 20
PILOT_WINDOW_MULTIPLE = 4
TOLERANCE = 0.05
MAX_CORRECTIONS = 3


def needs_calibration(p: SimParamsV2) -> bool:
    return r0_is_approximate(p) and p.run.calibrate_r0


def pilot_params(p: SimParamsV2, seed: int) -> SimParamsV2:
    d = p.disease
    window = PILOT_WINDOW_MULTIPLE * (d.dur_inf.mean_days + (d.dur_exp.mean_days if d.dur_exp is not None else 0.0))
    days = max(1, min(sim_days(p.run.sim_dur_years), math.ceil(window)))
    n_seeds = max(PILOT_SEED_FLOOR, min(PILOT_SEEDS, int(PILOT_SEED_SHARE * p.run.n_agents)))
    body = p.model_dump()
    body["disease"].update(seed={"mode": "count", "value": min(n_seeds, p.run.n_agents), "day": 0}, initial_immune_frac=0.0)
    body["interventions"] = []
    body["run"].update(sim_dur_years=days / 365, n_replicates=1, rand_seed=seed, calibrate_r0=False)
    return SimParamsV2.model_validate(body)


def measure(p: SimParamsV2, seed: int) -> float | None:
    sim = build_sim(pilot_params(p, seed), seed=seed)
    sim.run()
    return measured_r0(sim)


def calibrate_by_measurement(p: SimParamsV2, seed: int) -> tuple[SimParamsV2, dict | None]:
    """The parameters to run (beta corrected when a pilot ran) and {target, measured, corrections}, or (p, None) with no pilot."""
    if not needs_calibration(p):
        return p, None
    target = approx_r0(p)
    if target <= 0:
        return p, None
    current = p
    measured = measure(current, seed)
    corrections = 0
    while measured and corrections < MAX_CORRECTIONS and abs(measured - target) / target > TOLERANCE:
        current = current.model_copy(deep=True)
        current.disease.beta = clamp_beta(current.disease.beta * target / measured)
        corrections += 1
        measured = measure(current, seed)
    return current, {"target": round(target, 4), "measured": None if measured is None else round(measured, 4), "corrections": corrections}
```

In `epichat/sim/replicates.py`, after `seeds = [...]`: `params, calibration = calibrate_by_measurement(params, seeds[0])` (import from `.calibrate`), build the payload from `params`, and after the payload: `if calibration is not None: payload["stats"] = {**payload["stats"], "r0_calibration": calibration}`; `payload["effective_params"] = params.model_dump(mode="json")` stays (now with the corrected beta). Update the module docstring.

- [ ] **Step 4: Run the tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_calibrate.py tests/test_sim_replicates.py tests/test_sim_run_params.py -q -p no:cacheprovider && /c/Users/Yuke/stat/other-projects/EpiChat/epichat/sim/.venv/Scripts/python.exe -m pytest sim/tests/test_real_run.py -q -p no:cacheprovider`
Expected: all pass; the 50k hybrid test takes about a minute. If the calibration misses 5% after three corrections, print the three measurements: a measurement whose standard error exceeds the tolerance (few seeds) is a test-design issue to fix with more seeds in the pilot (ledger the new `PILOT_SEEDS`); a systematic miss means the correction `target / measured` is wrong for this beta range (check `per_contact_prob`'s saturation and ledger what you find).

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/calibrate.py epichat/sim/replicates.py tests/test_sim_calibrate.py sim/tests/test_real_run.py
git commit -m "feat(sim): beta calibrated to the measured R0 by a pilot run on the approximate networks"
```

---

### Task 8: The `well_mixed` and `r0_gap` diagnostics

**Files:**
- Modify: `epichat/sim/diagnostics.py`
- Test: `tests/test_sim_diagnostics.py`

**Interfaces:**
- Consumes: `stats["r0_measured"]`, `stats["r0_calibration"]` (Tasks 6, 7), `r0.r0_is_approximate`, `_r0_recheck`.
- Produces: `WELL_MIXED_R_EFF = 2.0`, `WELL_MIXED_ATTACK_RATE = 0.7`, `R0_GAP = 0.25`, `R0_GAP_SIGMAS = 3`, `r0_gap_threshold(approx, seeds) -> float`; diagnostics `well_mixed` and `r0_gap` (both `info`), appended to `diagnose`'s candidates.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_sim_diagnostics.py`:

```python
def test_well_mixed_fires_on_a_random_network_run_that_infected_nearly_everyone():
    d = one(run(params(), NORMAL, total=8600, seeds=100), "well_mixed")             # R0 2.3, attack rate 0.86 on the random network
    assert d.severity == "info" and d.evidence == {"attack_rate": 0.86, "r_eff": pytest.approx(dx.approx_r0(params()), abs=0.01)}
    assert [l.patch for l in d.levers] == [{"network.network_type": "hybrid"}, {"network.contact_duration_days": 7}]
    assert d.levers[0].basis == "rule" and "repeated" in d.levers[0].rationale
    assert "well_mixed" not in ids(run(params(**{"network.network_type": "hybrid"}), NORMAL, total=8600, seeds=100))
    assert "well_mixed" not in ids(run(params(), NORMAL, total=6000, seeds=100))                       # attack rate 0.6
    assert "well_mixed" not in ids(run(params(**{"disease.initial_immune_frac": 0.3}), NORMAL, total=8600, seeds=100))   # R_eff 1.6


def test_r0_gap_fires_on_a_mismatch_beyond_the_noise_and_stands_down_when_calibrated():
    approx = dx.approx_r0(params())                                                                     # about 2.3
    gap = one(run(params(), NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": 1.2}, disease="measles"), "r0_gap")
    assert gap.severity == "info" and gap.evidence["r0_measured"] == 1.2 and gap.evidence["approx_r0"] == pytest.approx(approx, abs=0.01)
    assert gap.levers and gap.levers[0].patch.keys() == {"disease.beta"}                               # the Part 1 recheck on an exact network
    assert "r0_gap" not in ids(run(params(), NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": approx * 0.9}))
    assert "r0_gap" not in ids(run(params(), NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": None}))
    assert dx.r0_gap_threshold(2.3, 500) == 0.25 and dx.r0_gap_threshold(2.3, 20) == pytest.approx(3 * (2.3 / 20) ** 0.5 / 2.3)
    assert "r0_gap" not in ids(run(params(), NORMAL, total=8600, seeds=20, stats_extra={"r0_measured": 1.6}))       # 30% gap, 20 seeds: noise
    assert "r0_gap" in ids(run(params(), NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": 1.6}))
    calibrated = run(params(**{"network.network_type": "hybrid"}), NORMAL, total=8600, seeds=500,
                     stats_extra={"r0_measured": 1.2, "r0_calibration": {"target": approx, "measured": 1.2, "corrections": 3}})
    assert one(calibrated, "r0_gap").levers == [] and one(calibrated, "r0_gap").evidence["calibrated"] is True
    off = run(params(**{"network.network_type": "hybrid", "run.calibrate_r0": False}), NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": 1.2})
    assert one(off, "r0_gap").levers == []
```

Extend the file's `run(...)` helper with `stats_extra: dict | None = None` merged into `stats`, and change `test_a_normal_run_raises_no_diagnostic` to assert that the only diagnostic a normal run raises is `well_mixed` (that run's attack rate is 0.86 on the random network; this is the thesis of Part 2).

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_diagnostics.py -q -p no:cacheprovider`
Expected: the two new tests fail (`StopIteration` from `one`); the normal-run test fails until the rule exists.

- [ ] **Step 3: Implement**

In `epichat/sim/diagnostics.py` add the constants after `R0_RECHECK_TOLERANCE`:

```python
WELL_MIXED_R_EFF = 2.0               # Part 2, 5.8
WELL_MIXED_ATTACK_RATE = 0.7
R0_GAP = 0.25
R0_GAP_SIGMAS = 3                    # the gap must exceed three standard errors of the measured mean when the seeds are few
```

import `r0_is_approximate` from `epichat.params.r0`, and add the rules before `diagnose`:

```python
def _well_mixed(run: _Run) -> Diagnostic | None:
    """Part 2, 5.8: on the random network nearly everyone is eventually infected; offer the hybrid network and lasting contacts."""
    p = run.params
    if p.network.network_type != "random" or run.r_eff < WELL_MIXED_R_EFF or run.n <= 0:
        return None
    attack = run.total / run.n
    if attack <= WELL_MIXED_ATTACK_RATE:
        return None
    levers = [Lever({"network.network_type": "hybrid"}, {"network.network_type": "random"}, "change",
                    "On the random network everyone meets fresh contacts every day, so nearly every susceptible is eventually infected. "
                    "With the households, schools, workplaces and community of the hybrid network, contacts are limited and repeated and "
                    "the final size is lower.", "rule"),
              Lever({"network.contact_duration_days": 7}, {"network.contact_duration_days": p.network.contact_duration_days}, "increase",
                    "Contacts that last a week instead of a day slow the spread by local depletion.", "rule")]
    return Diagnostic("well_mixed", "info", "Nearly everyone was infected: the random network mixes the whole population every day",
                      {"attack_rate": round(attack, 3), "r_eff": round(run.r_eff, 2)}, levers)


def r0_gap_threshold(approx: float, seeds: int) -> float:
    """25%, widened to R0_GAP_SIGMAS standard errors of a mean over `seeds` Poisson-like counts when the seeds are few."""
    if approx <= 0 or seeds <= 0:
        return R0_GAP
    return max(R0_GAP, R0_GAP_SIGMAS * math.sqrt(approx / seeds) / approx)


def _r0_gap(run: _Run) -> Diagnostic | None:
    """Part 2, 5.8: the measured R0 differs from the configured one; levers only on the exact networks (the Part 1 recheck)."""
    measured = run.stats.get("r0_measured")
    if measured is None or run.r0 <= 0:
        return None
    threshold = r0_gap_threshold(run.r0, run.seeds)
    if abs(measured - run.r0) / run.r0 <= threshold:
        return None
    calibrated = run.stats.get("r0_calibration") is not None
    levers = []
    if not calibrated and not r0_is_approximate(run.params):
        lever = _r0_recheck(run)
        if lever is not None:
            levers.append(lever)
    return Diagnostic("r0_gap", "info", "The measured R0 differs from the configured one",
                      {"approx_r0": round(run.r0, 2), "r0_measured": round(float(measured), 2), "threshold": round(threshold, 2),
                       "calibrated": calibrated}, levers)
```

and add `_well_mixed(run), _r0_gap(run)` to the candidates tuple in `diagnose`. Update the module docstring's rule list.

- [ ] **Step 4: Run the tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_diagnostics.py -q -p no:cacheprovider`
Expected: all pass. (The `r_eff` evidence of the first test compares with `approx_r0(params())`: `_Run.r_eff` is `r0 × (1 − initial_immune_frac)` and the default has none.)

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/diagnostics.py tests/test_sim_diagnostics.py
git commit -m "feat(sim): the well_mixed and r0_gap diagnostics"
```

---

### Task 9: The web tools — fields, the bundled demographics, the calibration note

**Files:**
- Modify: `web/lib/tools/configureSimulation.ts`, `web/lib/tools/fetchDemographics.ts`, `web/lib/tools/runSimulation.ts`, `web/lib/tools/index.ts`, `web/lib/tools/types.ts`, `web/lib/sim/client.ts`
- Test: `web/tests/tools/configureSimulation.test.ts`, `web/tests/tools/fetchTools.test.ts`, `web/tests/tools/runSimulation.test.ts`

**Interfaces:**
- Consumes: `countryDemographics`, `sharesFor` (Task 4), `approxR0`, `recalibrateBeta`, `NETWORK_TYPES`.
- Produces: `configure_simulation` fields `network_type` (string) and `household_size` (number); `fetch_demographics` applies the bundled shares (`age_source: "un_wpp"`), household size and contact matrix (`contacts_source: "prem_2021:<ISO3>"`), switches only a random network to age-structured, and holds the confirmed R0 across any change of the formula's inputs; `SimStats` gains `r0_measured?: number | null` and `r0_calibration?: { target: number; measured: number | null; corrections: number } | null`; `RunPayload.applied?: Record<string, unknown>` carrying `beta_calibrated_by_measurement` when the service calibrated.

- [ ] **Step 1: Write the failing tests**

In `web/tests/tools/configureSimulation.test.ts` add:

```ts
  it("sets the network type and household size as fields and holds the confirmed R0 across the switch", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", r0: 3 });
    const before = deps.scenario.params!;
    const out = JSON.parse((await run(deps, { network_type: "hybrid", household_size: 4 })).content);
    const p = deps.scenario.params!;
    expect(p.network.network_type).toBe("hybrid");
    expect(p.network.household_size).toBe(4);
    expect(out.applied.network_type).toBe("hybrid");
    expect(out.applied.beta_recalibrated_to_hold_r0).toBe(3);
    expect(approxR0(p)).toBeCloseTo(3, 6);
    expect(p.disease.beta).not.toBe(before.disease.beta);
    const bad = await run(deps, { network_type: "cluster" });
    expect(bad.isError).toBe(true);
    expect(bad.content).toContain("network_type");
  });

  it("marks the ages as user shares when the advanced patch edits a share", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", advanced: { "demographics.age_source": "un_wpp", "demographics.age_pct_under18": 40, "demographics.age_pct_18_64": 50, "demographics.age_pct_over65": 10 } });
    expect(deps.scenario.params!.demographics.age_source).toBe("un_wpp");
    await run(deps, { advanced: { "demographics.age_pct_over65": 12, "demographics.age_pct_18_64": 48 } });
    expect(deps.scenario.params!.demographics.age_source).toBe("shares");
  });
```

(import `approxR0` from `@/lib/sim/params`.) In `web/tests/tools/fetchTools.test.ts`, inside `describe("fetch_demographics")`, add:

```ts
  it("applies the bundled pyramid shares, household size and contact matrix, holding the confirmed R0", async () => {
    const deps = await configured(makeDeps({ unWpp: kenya }), { disease: "dengue", r0: 2.5 });
    const out = JSON.parse((await fetchDemographics({ country_iso3: "KEN" }, deps)).content);
    const p = deps.scenario.params!;
    expect(p.demographics.age_source).toBe("un_wpp");
    expect(p.demographics.age_pct_under18).not.toBe(38.6);                                  // the bundled WPP 2024 share, not the API's
    expect(p.demographics.age_pct_under18 + p.demographics.age_pct_18_64! + p.demographics.age_pct_over65!).toBeCloseTo(100, 0);
    expect(p.network.network_type).toBe("age_structured");
    expect(p.network.household_size).toBeGreaterThan(3);
    expect(p.network.contacts_source).toBe("prem_2021:KEN");
    expect(p.network.contacts.adults_adults).not.toBe(9);
    expect(out.applied.contact_matrix).toBe("prem_2021:KEN");
    expect(out.applied.household_size).toBe(p.network.household_size);
    expect(out.applied.age_source).toBe("un_wpp");
    expect(out.applied.beta_recalibrated_to_hold_r0).toBe(2.5);
    expect(approxR0(p)).toBeCloseTo(2.5, 6);
  });

  it("keeps a hybrid network and leaves the matrix alone for a country the bundled tables do not know", async () => {
    const deps = await configured(makeDeps({ unWpp: kenya }), { disease: "dengue", network_type: "hybrid" });
    await fetchDemographics({ country_iso3: "KEN" }, deps);
    expect(deps.scenario.params!.network.network_type).toBe("hybrid");
    const tiny = [rf("birth_rate", 9.1, "UN WPP 2024"), rf("death_rate", 8.2, "UN WPP 2024")];
    const other = await configured(makeDeps({ unWpp: tiny }), { disease: "dengue" });
    const out = JSON.parse((await fetchDemographics({ country_iso3: "AIA" }, other)).content);    // Anguilla: a UN location without a Prem matrix
    expect(other.scenario.params!.network.contacts_source).toBe("polymod_default");
    expect(other.scenario.params!.demographics.birth_rate).toBe(9.1);
    expect(out.applied.contact_matrix).toBeUndefined();
  });
```

(import `approxR0`; check with `countryDemographics("AIA")` in a quick `node`-free way: `grep '"AIA"' web/data/country_demographics.json` — if Anguilla has a pyramid but no matrix, the test holds; if it has a matrix, pick another UN location without one, for example `VAT` or a territory the WPP single-age file lacks.) In `web/tests/tools/runSimulation.test.ts` add:

```ts
  it("notes the beta the service calibrated to the measured R0", async () => {
    const result = success();
    result.stats = { ...result.stats, r0_measured: 2.4, r0_calibration: { target: 2.5, measured: 2.4, corrections: 2 } };
    result.effective_params = { ...result.effective_params, disease: { ...result.effective_params.disease, beta: 31.25 } };
    const deps = makeDeps({ simulate: result, runId: "run-1" });
    deps.scenario.params = params({ disease_type: "sir" });
    const out = await runSimulation({}, deps);
    expect((out.payload as { applied?: Record<string, unknown> }).applied).toEqual({ beta_calibrated_by_measurement: 31.25 });
    expect(JSON.parse(out.content).applied).toEqual({ beta_calibrated_by_measurement: 31.25 });
    const plain = await runSimulation({}, makeDeps({ simulate: success(), runId: "run-2", scenario: deps.scenario }));
    expect((plain.payload as { applied?: unknown }).applied).toBeUndefined();
  });
```

(Follow the file's `success()` and scenario set-up conventions exactly; the shape above assumes `success()` returns a mutable `SimSuccess`.)

- [ ] **Step 2: Run them and watch them fail**

Run (from `web/`): `npx vitest run tests/tools`
Expected: the new tests fail (unknown input fields are rejected by the strict input schema; `applied.contact_matrix` undefined; `applied` absent on the run payload).

- [ ] **Step 3: Implement**

`web/lib/sim/client.ts`: `export type SimStats = { …existing…; seeds_day0?: number; r0_measured?: number | null; r0_calibration?: { target: number; measured: number | null; corrections: number } | null };`. `web/lib/tools/types.ts`: add to `RunPayload` `/** Part 2, 5.7: beta_calibrated_by_measurement when the service corrected beta to the measured R0. */ applied?: Record<string, unknown>;`.

`web/lib/tools/configureSimulation.ts`: add `network_type: opt(z.string())` and `household_size: opt(z.number())` to the input; `const network = block(base, "network");` and

```ts
  if (given(input.network_type)) {
    network.network_type = input.network_type;
    applied.network_type = input.network_type;
  }
  if (given(input.household_size)) {
    network.household_size = input.household_size;
    applied.household_size = input.household_size;
  }
```

after the advanced patch: `if (given(input.advanced) && Object.keys(input.advanced).some((k) => k.startsWith("demographics.age_pct_")) && !("demographics.age_source" in input.advanced)) demographics.age_source = "shares";` After validation and before the `r0` block: when `before` exists and `!given(input.r0)` and the network's formula inputs changed, hold the R0:

```ts
  if (before && !given(input.r0) && Math.abs(approxR0(params) - approxR0(before)) > 1e-9 * Math.max(1, approxR0(before))) {
    const held = recalibrateBeta(params, approxR0(before), before);
    if (held.disease.beta !== params.disease.beta) {
      params = held;
      applied.beta_recalibrated_to_hold_r0 = pyRound(approxR0(before), 2);
    } else {
      applied.r0_unreachable_on_new_network = pyRound(approxR0(before), 2);
    }
  }
```

Restrict this hold to changes of network or demographics paths: compute `const formulaInputsChanged = changedPaths(before, params).some((c) => c.path.startsWith("network.") || c.path.startsWith("demographics.age_"))` first (read `changedPaths`'s return type in `lib/sim/paths.ts`), so a user who changed the infectious period keeps their beta as today. Import `recalibrateBeta` from `@/lib/sim/params`. In `web/lib/tools/index.ts` add to `configure_simulation`'s properties: `network_type: str("Contact network: random (fresh contacts daily; overstates the final size), age_structured (three age groups by a contact matrix) or hybrid (households, schools, workplaces, community)."), household_size: num("Mean household size for the hybrid network (people).")`.

`web/lib/tools/fetchDemographics.ts`: import `countryDemographics, sharesFor` and `CONTACT_PAIRS` (export `export const CONTACT_PAIRS = AGE_GROUPS.flatMap((s) => AGE_GROUPS.map((t) => `${s}_${t}`));` from params.ts); in the UN loop, the `age_distribution_pct` branch switches the network only when it is random (`if (network.network_type === "random") network.network_type = "age_structured";`); after the loop:

```ts
    const bundled = countryDemographics(iso3);
    if (bundled) {
      const shares = sharesFor(bundled, Number(demographics.demographics_year ?? 2024));
      if (shares) {
        [demographics.age_pct_under18, demographics.age_pct_18_64, demographics.age_pct_over65] = shares;
        demographics.age_source = "un_wpp";
        if (network.network_type === "random") network.network_type = "age_structured";
        applied.age_structure_pct = { "0-17": shares[0], "18-64": shares[1], "65+": shares[2] };
        applied.age_source = "un_wpp";
      }
      if (bundled.household_size !== null) {
        network.household_size = bundled.household_size;
        applied.household_size = bundled.household_size;
      }
      if (bundled.contacts) {
        network.contacts = Object.fromEntries(CONTACT_PAIRS.map((k, i) => [k, bundled.contacts![i]]));
        network.contacts_source = `prem_2021:${iso3}`;
        applied.contact_matrix = `prem_2021:${iso3}`;
      }
    }
```

and replace the network-switch recalibration with one on any change of the formula's result: `if (Math.abs(approxR0(params) - r0Before) > 1e-9 * Math.max(1, r0Before)) { …recalibrateBeta as today… }` keeping `applied.network_type` when the type changed.

`web/lib/tools/runSimulation.ts`: after `scenario.hasRun = true`: `const applied = result.stats.r0_calibration ? { beta_calibrated_by_measurement: result.effective_params.disease.beta } : undefined;` include `...(applied ? { applied } : {})` in both the payload and the content.

- [ ] **Step 4: Run the web suites**

Run (from `web/`): `npx vitest run && npm run typecheck && npm run lint`
Expected: all pass. Existing fetch tests that pinned `age_pct_under18` to the API's 38.6 for Kenya now see the bundled share; update those expectations to the bundled values (read them from `web/data/country_demographics.json`) and keep the API-only path tested through a country the bundle lacks.

- [ ] **Step 5: Commit**

```bash
git add web/lib/tools/configureSimulation.ts web/lib/tools/fetchDemographics.ts web/lib/tools/runSimulation.ts web/lib/tools/index.ts web/lib/tools/types.ts web/lib/sim/client.ts web/lib/sim/params.ts web/tests/tools/configureSimulation.test.ts web/tests/tools/fetchTools.test.ts web/tests/tools/runSimulation.test.ts
git commit -m "feat(web): network_type and household_size as fields, the bundled demographics in fetch_demographics, the calibration note"
```

---

### Task 10: Panel rows, the report's measured R0, and the prompt's Contact networks section

**Files:**
- Modify: `web/lib/client/format.ts`, `web/lib/report/compose.ts`, `web/lib/chat/prompt.ts`
- Test: `web/tests/client/format.test.ts`, `web/tests/chat/prompt.test.ts`, the report test file that exercises `composeReport` (find it with `grep -rl composeReport web/tests`)

**Interfaces:**
- Consumes: `SimParams` (Task 4), `ReportRun.stats.r0_measured` (Task 9's `SimStats`).
- Produces: `parameterRows` rows "Contact network" (hybrid spelled out), "Household size", "Contact matrix", "Contact duration", "Contacts distribution"; "Contacts per day" only on the random network; `describeField` labels for `household_size`, `contact_matrix`, `age_source`, `beta_calibrated_by_measurement`; `EFFECTIVE_PARAM_PATHS` gains `network.household_size`, `network.contact_duration_days`, `network.contacts_source`; the report's Parameters block gains "R₀ measured" from the latest run that has one; `SYSTEM_PROMPT` gains "## Contact networks".

- [ ] **Step 1: Write the failing tests**

In `web/tests/client/format.test.ts` add:

```ts
  it("names the network, its household size, matrix source and contact options", () => {
    const hybrid = params({ disease_type: "sir" });
    hybrid.network = { ...hybrid.network, network_type: "hybrid", household_size: 4.2 };
    const rows = parameterRows(hybrid);
    expect(rows).toContainEqual(["Contact network", "hybrid (households, schools, workplaces, community)"]);
    expect(rows).toContainEqual(["Household size", "4.2 people"]);
    expect(rows.map(([label]) => label)).not.toContain("Contacts per day");
    const aged = params({ disease_type: "sir" });
    aged.network = { ...aged.network, network_type: "age_structured", contacts_source: "prem_2021:KEN" };
    expect(parameterRows(aged)).toContainEqual(["Contact matrix", "Prem 2021, Kenya"]);
    aged.network.contacts_source = "polymod_default";
    expect(parameterRows(aged)).toContainEqual(["Contact matrix", "POLYMOD default (European)"]);
    const lasting = params({ disease_type: "sir" });
    lasting.network = { ...lasting.network, contact_duration_days: 7, contacts_dist: "poisson" };
    expect(parameterRows(lasting)).toContainEqual(["Contact duration", "7 days"]);
    expect(parameterRows(lasting)).toContainEqual(["Contacts distribution", "Poisson"]);
    expect(describeField("household_size", 4.2)).toEqual({ label: "Household size", value: "4.2 people" });
    expect(describeField("contact_matrix", "prem_2021:KEN")).toEqual({ label: "Contact matrix", value: "Prem 2021, Kenya" });
    expect(describeField("beta_calibrated_by_measurement", 31.25)).toEqual({ label: "Transmission rate calibrated to the measured R₀", value: "31.25" });
    expect(describeField("age_source", "un_wpp")).toEqual({ label: "Age source", value: "UN WPP 2024 pyramid" });
  });
```

In `web/tests/chat/prompt.test.ts` add `"## Contact networks"` to the headings list and a phrases check for `"overstates the final size"`, `"measured R0"`, `"Covasim"`. In the report test, add a case where the latest run's `stats` carry `r0_measured: 2.4` and assert the Parameters key-values contain `["R₀ measured", "2.4"]`, and that a run without it adds no such row.

- [ ] **Step 2: Run them and watch them fail**

Run (from `web/`): `npx vitest run tests/client tests/chat tests/report`
Expected: the new assertions fail.

- [ ] **Step 3: Implement**

`web/lib/client/format.ts`:

```ts
function networkLabel(n: SimParams["network"]): string {
  return n.network_type === "hybrid" ? "hybrid (households, schools, workplaces, community)" : n.network_type.replace(/_/g, "-");
}

/** "POLYMOD default (European)", "Prem 2021, Kenya" or "user-set" (Part 2, 5.3). */
export function contactsSourceLabel(source: string): string {
  if (source === "polymod_default") return "POLYMOD default (European)";
  const prem = /^prem_2021:([A-Z]{3})$/.exec(source);
  if (prem) return `Prem 2021, ${countryName(prem[1])}`;
  return source === "user" ? "user-set" : source;
}
```

In `parameterRows`: `["Contact network", networkLabel(p.network)]`; `...(p.network.network_type === "random" ? row("Contacts per day", fmtValue(p.network.n_contacts)) : [])`; `...(p.network.network_type === "hybrid" ? row("Household size", `${fmtValue(p.network.household_size)} people`) : [])`; `...(p.network.network_type === "age_structured" ? row("Contact matrix", contactsSourceLabel(p.network.contacts_source)) : [])`; `...(p.network.network_type === "random" && p.network.contact_duration_days > 0 ? row("Contact duration", formatQuantity(p.network.contact_duration_days, "days")) : [])`; `...(p.network.network_type === "random" && p.network.contacts_dist === "poisson" ? row("Contacts distribution", "Poisson") : [])`. In `FIELDS`: `household_size: { label: "Household size", unit: "people" }`, `contact_matrix: { label: "Contact matrix", kind: "contacts" }`, `age_source: { label: "Age source", kind: "age_source" }`, `beta_calibrated_by_measurement: { label: "Transmission rate calibrated to the measured R₀" }`; extend `FieldSpec.kind` with `"contacts" | "age_source"` and `describeField` with `if (spec.kind === "contacts") return { label: spec.label, value: contactsSourceLabel(String(value)) }; if (spec.kind === "age_source") return { label: spec.label, value: AGE_SOURCE_LABELS[String(value)] ?? String(value) };` where `const AGE_SOURCE_LABELS: Record<string, string> = { default: "Starsim's default ages", shares: "the three shares", un_wpp: "UN WPP 2024 pyramid" };`. Add the three paths to `EFFECTIVE_PARAM_PATHS` after `"network.network_type"`. Fix the existing format tests that expected "Contacts per day" on an age-structured scenario, if any.

`web/lib/report/compose.ts`: `modelled(scenario, name, runs)`; after the population splice: `const measured = [...runs].reverse().find((r) => typeof r.stats.r0_measured === "number"); if (measured) rows.splice(rows.findIndex(([label]) => label.startsWith("R₀")) + 1, 0, ["R₀ measured", measured.stats.r0_measured!.toFixed(1)]);` and pass `input.runs` at the call site.

`web/lib/chat/prompt.ts`: insert before `## Diagnostics and options`:

```
## Contact networks

- Three networks: random (everyone meets n_contacts fresh contacts a day, which overstates the final size, since nearly every susceptible is eventually infected), age_structured (three age groups mixing by a contact matrix: POLYMOD's European defaults, or the country's Prem 2021 matrix once fetch_demographics has run) and hybrid (households, schools, workplaces and community, as in Covasim, with limited, repeated contacts).
- Choose by scenario: a setting with households, schools or workplaces, or the question why so many were infected, is a hybrid scenario; a national scenario with fetched demographics is age-structured; a quick comparison or a classroom example stays random, and you say in one sentence that random mixing overstates the final size. Set network_type and household_size through configure_simulation's fields; the layer contacts and transmissibilities are Covasim's calibrated values, not measurements for the disease at hand, so call them illustrative. A well_mixed diagnostic offers the hybrid network.
- The R0 formula is exact on the random and age-structured networks and approximate on the hybrid network or with a contact duration above zero. There the service runs a short pilot and adjusts beta so the measured R0 matches the one you set (the run reports stats.r0_calibration and applied.beta_calibrated_by_measurement; run.calibrate_r0 switches it off): say in one sentence that beta was adjusted so the measured R0 matches the one you set, and quote the run's measured R0 (stats.r0_measured, the day-0 seeds' mean secondary infections) when the approximate one is flagged.
```

- [ ] **Step 4: Run the web suites**

Run (from `web/`): `npx vitest run && npm run typecheck && npm run lint`
Expected: all pass (`web/data/system_prompt.json` is the Python agent's prompt, not this one; nothing to regenerate).

- [ ] **Step 5: Commit**

```bash
git add web/lib/client/format.ts web/lib/report/compose.ts web/lib/chat/prompt.ts web/tests/client/format.test.ts web/tests/chat/prompt.test.ts web/tests/report
git commit -m "feat(web): network rows, the report's measured R0 and the prompt's Contact networks section"
```

---

### Task 11: The runbook timing and the spec amendments

**Files:**
- Modify: `web/docs/DEPLOY.md` (the timing table near line 561), `docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md` (5.5, 5.6, 5.7, 5.8, 6.2)

**Interfaces:**
- Consumes: everything above.
- Produces: a local timing line for a 10k-agent one-year hybrid run (with the pilot), and the spec sentences that match what shipped.

- [ ] **Step 1: Measure**

Run from the worktree root:

```bash
.venv/Scripts/python.exe - <<'EOF'
import time
from epichat.params import r0
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.replicates import run_replicates
p = r0.with_r0(SimParamsV2.model_validate({"network": {"network_type": "hybrid"}, "demographics": {"age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8}, "run": {"n_agents": 10000, "rand_seed": 1}}), 2.5)
for label, params in (("hybrid, with the pilot", p), ("hybrid, calibrate_r0 off", p.model_copy(update={"run": p.run.model_copy(update={"calibrate_r0": False})})), ("random", r0.with_r0(SimParamsV2.model_validate({"run": {"n_agents": 10000, "rand_seed": 1}}), 2.5))):
    t = time.perf_counter(); out = run_replicates(params); print(label, round(time.perf_counter() - t, 1), "s;", out["stats"].get("r0_calibration"))
EOF
```

Expected: three timings; record them.

- [ ] **Step 2: The runbook**

Under the timing table in `web/docs/DEPLOY.md` add a short paragraph: the local wall times of the three runs above (hybrid with the pilot, hybrid without, random, 10k agents, one year), the note that the hybrid network builds four edge sets so a 10k-agent year costs the hybrid factor you measured over the random net, and one line telling the owner to re-measure through the binding with a hybrid scenario after the deploy and add the row.

- [ ] **Step 3: The spec**

Amend the spec:
- 5.5: "household size minus one for households" becomes "the household size itself for households (a member of a Poisson(λ) household has λ other members on average, the agent-weighted mean of size − 1)".
- 5.6: add "0 when the seeds infected nobody" after "null when there were none".
- 5.7: add the pilot's seeding rule (at least 300 day-0 seeds, 2% of the agents when that is fewer, never under 20), that the pilot drops interventions and initial immunity (an R0 is measured in a susceptible population), and that the child returns `effective_params` with the corrected beta, which the service adopts.
- 5.8: `r0_gap`'s threshold is 25% or three standard errors of the measured mean (`3 × sqrt(R0 / seeds) / R0`) when that is larger.
- 6.2: the yearly births follow the series on the sim's own year axis (a `Births` subclass switching the rate each sim year, since the sims run on numeric days), and the first year keeps the configured crude rate.

- [ ] **Step 4: Run everything once more**

Run: `.venv/Scripts/python.exe -m pytest tests -q -p no:cacheprovider --ignore=tests/test_r0_calibration.py`, then `.venv/Scripts/python.exe -m pytest tests/test_r0_calibration.py -q -p no:cacheprovider`, then `/c/Users/Yuke/stat/other-projects/EpiChat/epichat/sim/.venv/Scripts/python.exe -m pytest sim/tests -q -p no:cacheprovider`, then from `web/`: `npx vitest run > ../.superpowers/vitest-final.log 2>&1 && grep -E "Tests " ../.superpowers/vitest-final.log && npm run typecheck && npm run lint`.
Expected: all green; write each suite's pass count into the ledger.

- [ ] **Step 5: Commit**

```bash
git add web/docs/DEPLOY.md docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md
git commit -m "docs: the hybrid network's local timing; spec 5.5 to 5.8 and 6.2 as shipped"
```

---

## Self-review

**Spec coverage.** 5.1 (`network_type` with `hybrid`, a core field, the prompt rule): Tasks 1, 9, 10. 5.2 (random options, the approximate flag with a duration): Tasks 1, 3, 4, 5, 10. 5.3 (nine matrix leaves, `contacts_source`, the bundled Prem table and its aggregation, `fetch_demographics` applying it and holding the R0, the `n_contacts` description): Tasks 1, 2, 3, 4, 9, 10. 5.4 (hybrid leaves, the household table, the agent rule, ages fill the layers): Tasks 1, 2, 5, 10. 5.5 (the approximate hybrid R0): Tasks 3, 4; the household term amended in Task 11. 5.6 (the measured R0 in stats, the payload and the report): Tasks 6, 9, 10. 5.7 (the pilot calibration, `run.calibrate_r0`, `effective_params`, `applied`): Tasks 1, 6, 7, 9. 5.8 (the two diagnostics): Task 8. 5.9 (fields and the prompt section): Tasks 9, 10. 6.1 (the pyramid, `age_source`, the shares recorded by `fetch_demographics`): Tasks 1, 2, 5, 9. 6.2 (the birth series, the crude death rate kept): Tasks 2, 5. 6.3 and 11 (the review list's bundled checks): already listed by `scripts/review_requests.py` from 2A. 10 (the sources table): Tasks 2, 4, 9. 13's Python and TypeScript tests for networks, pyramid, measured R0, calibration and diagnostics: Tasks 3 to 10 (the interventions and fit tests belong to 2C). 14's "timings in the runbook": Task 11. Section 16's cost note: Task 11.

**Placeholders.** None: every step carries its code, command and expected result.

**Type consistency.** `ContactMatrix.as_rows()` (Task 1) feeds `r0.contact_matrix` (Task 3) and the builder (Task 5); `contactRows` mirrors it (Task 4). `tables.age_histogram`, `age_shares`, `birth_rate_series`, `household_size`, `contact_matrix`, `countries` (Task 2) are the names the builder (Task 5) and the web export (Task 4) call. `measured_r0` (Task 6) is what `calibrate.measure` (Task 7) reads. `RunResult.effective_params` (Task 6) is positional after `replicates`, as the service test constructs it. `r0IsApproximate`, `hybridContacts`, `ageRangeShare` (Task 4) match the Python names `r0_is_approximate`, `hybrid_contacts`, `age_range_share` (Task 3). `SimStats.r0_measured`/`r0_calibration` (Task 9) are the keys the child writes (Tasks 6, 7) and the report reads (Task 10).

**Review Focus.** 1 → Task 1's defaults test and Task 5's shares-path assertion. 2 → Task 3's default-shares expectation and Task 5's bare hybrid build. 3 → Task 9's Anguilla case. 4 → Task 7's `test_a_pilot_that_measures_nothing_stops_cleanly`. 5 → Task 8's threshold test.

## After the merge (owner)

- No migration. Push `main`; the bundled tables, the registry export and the parity fixture travel with the code. The sim deploy grows by about 1.3 MB of CSV.
- Re-measure a hybrid run through the binding (`web/docs/DEPLOY.md`, the timing section) and add the row.
- `py -3.12 scripts/review_requests.py` lists the bundled tables' checks (vintage WPP 2024, the 2026 household database, the Prem aggregation) for the review list that phase 2D commits.
