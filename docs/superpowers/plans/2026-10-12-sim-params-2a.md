# Sim Parameters Part 2, Phase 2A: Disease Extensions and the Composition Rule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add susceptibility by age, fatality by age and presymptomatic transmissibility to the disease module, make every writer of `rel_sus` and `rel_trans` compose through one connector, extend the exact R0 for all of it in both languages, and ship the review-request script's skeleton.

**Architecture:** Seven registry leaves (`disease.rel_sus_age.{children,adults,elderly}`, `disease.p_death_age.{children,adults,elderly}`, `disease.rel_trans_exposed`) flow through the pydantic and zod schemas as optional leaves with defaults, so stored rows validate unchanged and `schema_version` stays 2. The builder maps them onto Starsim: a per-agent `rel_sus_base` the connector recomputes from ages every step, a `vaccine_protection` state the EpiChat vaccine product writes, a callable `p_death` whose probability depends on the agent's age, and a transmission kernel in the SEIR family that counts exposed agents among the sources at `rel_trans_exposed` of the infectious value. The connector (`TransmissionModifiers`) composes `rel_sus = rel_sus_base × vaccine_protection × (1 − sis_immunity)` and `rel_trans = rel_trans_base × seasonal_factor` once per step before transmission. The exact R0 gains the exposed days and the share-weighted susceptibility on the random network, and the column-scaled contact matrix on the age-structured one; the parity fixture pins both languages. The CFR check and diagnostic read the population-weighted fatality. The review-request script lists, per disease, the existing and requested database fields with their status.

**Tech Stack:** Python 3.12 (pydantic 2, numpy, Starsim 3.7.2) for the package; TypeScript (zod 4, vitest) for the web app. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md`, sections 4 (disease module), 10 and 11 (sources and the review list), 13 (testing), 14 (phase 2A); Part 1 (`2026-10-09-sim-parameters-disease-design.md`) sections 7.4 and 18 for the R0 it extends. Two amendments this plan makes to the spec in its first commit: the age keys are `children`, `adults`, `elderly` (the builder's group names and valid identifiers in both languages, rather than `under18`, `18_64`, `over65`), and ages are assigned from the three shares on every network, not only the age-structured one, since the disease parameters now depend on them.

## Global Constraints

- Interpreters: root `.venv/Scripts/python.exe` (3.12, Starsim 3.7.2), run from the worktree root so its package is imported; web `npx vitest run …`, `npm run typecheck`, `npm run lint` from `web/`; `npm run sync-data` regenerates `web/data/param_registry.json` and `web/tests/fixtures/parity.json` (it runs `scripts/export_web_data.py` and `scripts/export_parity_fixtures.py` with `py -3.12`; the root venv's python works the same).
- `npm --prefix web ci` only; no new npm or Python dependencies.
- Every new leaf has a default; `schema_version` stays 2; the registry export's `version` becomes 2 and the parity fixture's `version` 3.
- The service's parent process imports no Starsim (`sim/tests/test_imports.py`); everything new in `epichat/sim/` is imported by the child only. Nothing in `sim/` changes in this phase.
- Age groups everywhere: children under 18, adults 18 to 64, elderly 65 and over (`epichat/sim/builder.py` `age_groups()`).
- Without fetched shares the agents' ages are Starsim's default, uniform from 0 to 60, so the default shares are children 0.3, adults 0.7, elderly 0; both languages use that constant for the R0 and the weighted CFR.
- Never print `SIM_SHARED_SECRET`, the Supabase secret, the Resend key or the UN API key.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UL6ToyEthpP1X8yxArZE6g`.

## Review Focus

1. **A vaccinated agent after the first step.** The connector now rewrites `rel_sus` every step; a vaccination delivered through Starsim's `simple_vx` would be lost on the next step. The EpiChat product writes `vaccine_protection` instead, and the composition test pins that a vaccinated agent stays protected under seasonality and age multipliers for the whole run. Test in Task 4.
2. **SIS immunity under the connector.** Starsim's SIS writes `rel_sus` itself in `update_immunity`; the connector's composition must give the same protection (an initially immune SIS agent is not infected while its immunity lasts). Test in Task 4.
3. **Multipliers on a run without demographics.** The R0 the user confirms must match what the sim does when no shares were fetched: default ages (no elderly), default shares (0.3, 0.7, 0). The calibration test without shares in Task 5 pins it.
4. **`rel_trans_exposed` on a model without a latent period.** The registry marks it latent-only; the schema accepts it on any model; the builder passes it only to the SEIR family and the R0 ignores it elsewhere. Test in Task 2 (R0) and Task 4 (builder).
5. **A stored scenario from before this phase.** It validates with the defaults in both languages, runs the same (multipliers 1, no age fatality, no presymptomatic transmission), and its R0 is unchanged. The parity migration cases and the builder's defaults test pin it (Tasks 2, 3, 4).

## File Structure

- Modify `epichat/params/registry.py` — seven `ParamSpec` entries; `export()` version 2.
- Modify `epichat/params/schema_v2.py` — `AgeMultipliers`, `AgeFractions`, three `DiseaseParams` fields.
- Modify `epichat/params/r0.py` — `DEFAULT_AGE_SHARES`, `age_shares`, `exposed_days`, `effective_days`, `contact_scale`, `weighted_cfr`.
- Modify `scripts/export_parity_fixtures.py` — the new leaves in `random_params`, `weighted_cfr` per case, version 3.
- Modify `web/lib/sim/params.ts` — the schemas and the R0 functions; `web/lib/client/format.ts` — three panel rows; `web/lib/tools/shared.ts` — the weighted CFR in the warnings; `web/lib/chat/prompt.ts` — one bullet.
- Modify `epichat/sim/models.py` — `rel_sus_base`, `vaccine_protection`, the `_Presymptomatic` mixin; `epichat/sim/connectors.py` — `TransmissionModifiers`; create `epichat/sim/products.py` — the `Vaccine` product; modify `epichat/sim/builder.py` — the kwargs, the product, the ages on every network.
- Modify `epichat/sim/diagnostics.py` — the weighted CFR.
- Create `scripts/review_requests.py`.
- Tests: `tests/test_param_registry.py`, `tests/test_schema_v2.py`, `tests/test_param_r0.py`, `tests/test_web_exports.py`, `tests/test_sim_models.py`, `tests/test_sim_connectors.py`, `tests/test_sim_builder.py`, `tests/test_r0_calibration.py`, `tests/test_sim_diagnostics.py`, `tests/test_review_requests.py` (new); `web/tests/sim/{registry,params,parity}.test.ts`, `web/tests/client/format.test.ts`, `web/tests/tools/configureSimulation.test.ts`, `web/tests/chat/prompt.test.ts`.

---

### Task 1: Registry and schema (Python)

**Files:**
- Modify: `epichat/params/registry.py` (after the `disease.rel_trans_asymp` entry; `export()`)
- Modify: `epichat/params/schema_v2.py` (`DiseaseParams`)
- Modify: `docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md` (section 4.1: the keys and the ages note)
- Test: `tests/test_param_registry.py`, `tests/test_schema_v2.py`

**Interfaces:**
- Produces: registry paths `disease.rel_sus_age.children|adults|elderly` (number, multiplier, default 1, bounds (0, 10), all models, advanced), `disease.p_death_age.children|adults|elderly` (number, fraction, default None, bounds (0, 1), `DEATH_MODELS`, advanced), `disease.rel_trans_exposed` (number, fraction, default 0, bounds (0, 1), `LATENT_MODELS`, advanced); `export()["version"] == 2`.
- Produces: `class AgeMultipliers(BaseModel)` with `children: float`, `adults: float`, `elderly: float` (default 1), `class AgeFractions(BaseModel)` with the same three as `Optional[float]` (default None); `DiseaseParams.rel_sus_age: AgeMultipliers`, `DiseaseParams.p_death_age: AgeFractions`, `DiseaseParams.rel_trans_exposed: float`; a helper `DiseaseParams.death_probabilities() -> tuple[float, float, float]` (each group's own value or the scalar).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_param_registry.py`:

```python
AGE_GROUPS = ("children", "adults", "elderly")


def test_the_age_specific_leaves_and_the_exposed_transmissibility_are_registered():
    for group in AGE_GROUPS:
        sus = reg.spec_for(f"disease.rel_sus_age.{group}")
        assert sus.default == 1.0 and sus.bounds == (0.0, 10.0) and sus.models == () and sus.tier == "advanced"
        death = reg.spec_for(f"disease.p_death_age.{group}")
        assert death.default is None and death.bounds == (0.0, 1.0) and death.models == reg.DEATH_MODELS and death.tier == "advanced"
    exposed = reg.spec_for("disease.rel_trans_exposed")
    assert exposed.default == 0.0 and exposed.bounds == (0.0, 1.0) and exposed.models == reg.LATENT_MODELS
    assert reg.export()["version"] == 2
```

Change the existing assertion `assert out["version"] == 1 and …` in the same file to `assert out["version"] == 2 and …`.

Append to `tests/test_schema_v2.py`:

```python
def test_age_multipliers_fatality_by_age_and_exposed_transmissibility_default_and_validate():
    p = SimParamsV2()
    assert p.disease.rel_sus_age.model_dump() == {"children": 1.0, "adults": 1.0, "elderly": 1.0}
    assert p.disease.p_death_age.model_dump() == {"children": None, "adults": None, "elderly": None}
    assert p.disease.rel_trans_exposed == 0.0
    q = SimParamsV2.model_validate({"disease": {"model": "seir", "dur_exp": {"mean_days": 5}, "p_death": 0.01,
                                                "rel_sus_age": {"children": 1.5, "elderly": 0.7}, "p_death_age": {"elderly": 0.1},
                                                "rel_trans_exposed": 0.5}})
    assert q.disease.rel_sus_age.adults == 1.0 and q.disease.rel_sus_age.elderly == 0.7
    assert q.disease.death_probabilities() == (0.01, 0.01, 0.1)
    with pytest.raises(ValidationError):
        SimParamsV2.model_validate({"disease": {"rel_sus_age": {"children": 11}}})
    with pytest.raises(ValidationError):
        SimParamsV2.model_validate({"disease": {"p_death_age": {"adults": 1.5}}})
    with pytest.raises(ValidationError):
        SimParamsV2.model_validate({"disease": {"model": "seir", "dur_exp": {"mean_days": 5}, "rel_trans_exposed": -0.1}})
```

(`pytest` and `ValidationError` are already imported there; if not, add `import pytest` and `from pydantic import ValidationError`.)

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_registry.py tests/test_schema_v2.py -q -p no:cacheprovider`
Expected: `KeyError: 'disease.rel_sus_age.children'` and `AttributeError: … has no attribute 'rel_sus_age'`; the version assertion fails.

- [ ] **Step 3: The registry entries**

In `epichat/params/registry.py`, after the `disease.rel_trans_asymp` entry, add:

```python
    *[ParamSpec(f"disease.rel_sus_age.{group}", "disease", f"Susceptibility, {label}",
                f"Multiplier on the susceptibility of {label} (1 leaves it as it is). Applies through the agents' ages, so "
                "fetch the demographics first for the elderly to exist; an illustrative assumption unless the database carries it.",
                "number", "multiplier", 1.0, (0.0, 10.0), None, (), "advanced", None,
                "rel_sus_base of the agents in the group, composed by the TransmissionModifiers connector", ("peak", "final_size"))
      for group, label in (("children", "children (under 18)"), ("adults", "adults (18 to 64)"), ("elderly", "the elderly (65 and over)"))],
    *[ParamSpec(f"disease.p_death_age.{group}", "disease", f"Case fatality ratio, {label}",
                f"Share of cases among {label} that die; unset means the overall p_death. An illustrative assumption until the "
                "database carries fatality by age.",
                "number", "fraction", None, (0.0, 1.0), None, DEATH_MODELS, "advanced", None,
                "the per-agent death draw (ss.bernoulli with an age-dependent probability)", ("deaths",))
      for group, label in (("children", "children (under 18)"), ("adults", "adults (18 to 64)"), ("elderly", "the elderly (65 and over)"))],
    ParamSpec("disease.rel_trans_exposed", "disease", "Presymptomatic transmissibility",
              "Transmissibility of an agent in the latent period as a fraction of the infectious value; 0 means no transmission "
              "before symptoms. Raises the effective infectious days the R0 formula uses.",
              "number", "fraction", 0.0, (0.0, 1.0), None, LATENT_MODELS, "advanced", None,
              "rel_trans_base of exposed agents, who become transmission sources", ("peak", "timing")),
```

and change `export()` to return `{"version": 2, …}`.

- [ ] **Step 4: The schema**

In `epichat/params/schema_v2.py`, before `class DiseaseParams`:

```python
AGE_GROUPS = ("children", "adults", "elderly")


class AgeMultipliers(BaseModel):
    """One multiplier per age group (section 4.1 of Part 2); 1 leaves the group as it is."""
    children: float = _field("disease.rel_sus_age.children")
    adults: float = _field("disease.rel_sus_age.adults")
    elderly: float = _field("disease.rel_sus_age.elderly")

    def as_tuple(self) -> tuple[float, float, float]:
        return (self.children, self.adults, self.elderly)


class AgeFractions(BaseModel):
    """One optional probability per age group; None means the scalar applies."""
    children: Optional[float] = _field("disease.p_death_age.children")
    adults: Optional[float] = _field("disease.p_death_age.adults")
    elderly: Optional[float] = _field("disease.p_death_age.elderly")

    def any_set(self) -> bool:
        return any(v is not None for v in (self.children, self.adults, self.elderly))
```

In `DiseaseParams`, after `rel_trans_asymp`:

```python
    rel_sus_age: AgeMultipliers = Field(default_factory=AgeMultipliers)
    p_death_age: AgeFractions = Field(default_factory=AgeFractions)
    rel_trans_exposed: float = _field("disease.rel_trans_exposed")
```

and a method on `DiseaseParams`:

```python
    def death_probabilities(self) -> tuple[float, float, float]:
        """Each group's case fatality ratio: its own value, or the scalar."""
        a = self.p_death_age
        return tuple(v if v is not None else self.p_death for v in (a.children, a.adults, a.elderly))
```

- [ ] **Step 5: The spec amendment**

In `docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md` section 4.1, change the two path rows to `disease.rel_sus_age.children`, `.adults`, `.elderly` and `disease.p_death_age.children`, `.adults`, `.elderly`, and add after the table's paragraph ("The scalar `disease.p_death` stays…"): "Ages are assigned from the three shares on every network from this phase on, not only on the age-structured one, since the disease parameters depend on them; without shares, Starsim's default ages apply."

- [ ] **Step 6: Run the tests, regenerate the registry export**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_registry.py tests/test_schema_v2.py tests/test_param_migrate.py -q -p no:cacheprovider`
Expected: all pass.
Run: `.venv/Scripts/python.exe scripts/export_web_data.py` and check `git diff --stat web/data/param_registry.json` shows the file changed (its `version` is 2 and the seven entries are present).

- [ ] **Step 7: Commit**

```bash
git add epichat/params/registry.py epichat/params/schema_v2.py web/data/param_registry.json docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md tests/test_param_registry.py tests/test_schema_v2.py
git commit -m "feat(params): susceptibility and fatality by age, presymptomatic transmissibility (registry v2, schema v2)"
```

---

### Task 2: The exact R0 with the multipliers (Python) and the parity fixture

**Files:**
- Modify: `epichat/params/r0.py`
- Modify: `scripts/export_parity_fixtures.py`
- Test: `tests/test_param_r0.py`, `tests/test_web_exports.py`

**Interfaces:**
- Produces in `r0.py`: `DEFAULT_AGE_SHARES = (0.3, 0.7, 0.0)`; `age_shares(p) -> tuple[float, float, float]` (the three `age_pct_*` over 100 when all are set, else the default); `exposed_days(d) -> float` (constant: `ceil(mean) − 1`; continuous: `mean − 0.5`; 0 outside the latent models); `effective_days(d)` now adds `d.rel_trans_exposed × exposed_days(d)`; `contact_scale(p)` multiplies by `Σ s_g r_g` on the random network and uses `rho(C · diag(r))` on the age-structured one; `weighted_cfr(p) -> float` (`Σ s_g p_g` with `death_probabilities()`).
- Produces: `web/tests/fixtures/parity.json` version 3 with the new leaves in its random cases and `weighted_cfr` per case (Task 3's TypeScript pins it).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_param_r0.py`:

```python
def test_age_shares_default_to_starsims_ages_and_read_the_fetched_shares():
    assert r0.age_shares(SimParamsV2()) == (0.3, 0.7, 0.0)
    p = SimParamsV2.model_validate({"demographics": {"age_pct_under18": 40.0, "age_pct_18_64": 55.0, "age_pct_over65": 5.0}})
    assert r0.age_shares(p) == pytest.approx((0.4, 0.55, 0.05))


def test_susceptibility_by_age_scales_the_random_network_r0_by_the_weighted_mean():
    base = SimParamsV2()
    scaled = SimParamsV2.model_validate({"disease": {"rel_sus_age": {"children": 2.0, "adults": 0.5, "elderly": 3.0}}})
    assert r0.approx_r0(scaled) == pytest.approx(r0.approx_r0(base) * (0.3 * 2.0 + 0.7 * 0.5))    # the elderly group is empty by default
    with_shares = SimParamsV2.model_validate({"disease": {"rel_sus_age": {"children": 2.0, "adults": 0.5, "elderly": 3.0}},
                                              "demographics": {"age_pct_under18": 40.0, "age_pct_18_64": 50.0, "age_pct_over65": 10.0}})
    assert r0.approx_r0(with_shares) == pytest.approx(r0.approx_r0(base) * (0.4 * 2.0 + 0.5 * 0.5 + 0.1 * 3.0))


def test_susceptibility_by_age_scales_the_age_structured_r0_by_the_column_scaled_spectral_radius():
    base = SimParamsV2.model_validate({"network": {"network_type": "age_structured"}})
    r = (1.5, 1.0, 0.7)
    scaled = SimParamsV2.model_validate({"network": {"network_type": "age_structured"},
                                         "disease": {"rel_sus_age": {"children": r[0], "adults": r[1], "elderly": r[2]}}})
    rho = float(np.linalg.eigvals(r0.CONTACT_MATRIX @ np.diag(r)).real.max())
    assert r0.approx_r0(scaled) == pytest.approx(r0.approx_r0(base) * rho / r0.CONTACT_SPECTRAL_RADIUS)
    assert r0.calibrate_beta(scaled, 4.0) == pytest.approx(-365.0 * math.log(1 - 4.0 / r0.max_r0(scaled)))


def test_presymptomatic_transmissibility_adds_the_exposed_days():
    constant = SimParamsV2.model_validate({"disease": {"model": "seir", "dur_exp": {"mean_days": 5}}})
    assert r0.exposed_days(constant.disease) == 4.0
    gamma = SimParamsV2.model_validate({"disease": {"model": "seir", "dur_exp": {"mean_days": 5, "dist": "gamma", "sd_days": 2}}})
    assert r0.exposed_days(gamma.disease) == 4.5
    assert r0.exposed_days(SimParamsV2().disease) == 0.0                                  # sir has no latent period
    half = SimParamsV2.model_validate({"disease": {"model": "seir", "dur_exp": {"mean_days": 5}, "rel_trans_exposed": 0.5}})
    assert r0.effective_days(half.disease) == pytest.approx(r0.effective_days(constant.disease) + 0.5 * 4.0)
    ignored = SimParamsV2.model_validate({"disease": {"model": "sir", "rel_trans_exposed": 0.5}})
    assert r0.effective_days(ignored.disease) == r0.effective_days(SimParamsV2().disease)


def test_weighted_cfr_follows_the_shares_and_the_scalar_fallback():
    p = SimParamsV2.model_validate({"disease": {"p_death": 0.01, "p_death_age": {"elderly": 0.2}},
                                    "demographics": {"age_pct_under18": 40.0, "age_pct_18_64": 50.0, "age_pct_over65": 10.0}})
    assert r0.weighted_cfr(p) == pytest.approx(0.4 * 0.01 + 0.5 * 0.01 + 0.1 * 0.2)
    assert r0.weighted_cfr(SimParamsV2.model_validate({"disease": {"p_death": 0.02}})) == pytest.approx(0.02)
```

(add `import math`, `import numpy as np`, `import pytest` and `from epichat.params.schema_v2 import SimParamsV2` to the file's imports where missing; the file already imports `r0`.)

In `tests/test_web_exports.py`, change `assert parity["version"] == 2` to `== 3` and add on the next line `assert all("weighted_cfr" in case for case in parity["params"])`.

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_r0.py tests/test_web_exports.py -q -p no:cacheprovider`
Expected: `AttributeError: module 'epichat.params.r0' has no attribute 'age_shares'`; the version pin fails.

- [ ] **Step 3: The R0 module**

In `epichat/params/r0.py`, after the lever constants:

```python
DEFAULT_AGE_SHARES = (0.3, 0.7, 0.0)      # Starsim's default ages are uniform on 0 to 60: no elderly


def age_shares(p: SimParamsV2) -> tuple[float, float, float]:
    """The share of agents in each age group: the fetched shares when all three are set, else the default ages'."""
    g = p.demographics
    if g.age_pct_under18 is not None and g.age_pct_18_64 is not None and g.age_pct_over65 is not None:
        return (g.age_pct_under18 / 100.0, g.age_pct_18_64 / 100.0, g.age_pct_over65 / 100.0)
    return DEFAULT_AGE_SHARES


def exposed_days(d: DiseaseParams) -> float:
    """Days an exposed agent can transmit on a daily step, by the same offsets as the infectious period (0 outside the latent models)."""
    if d.model not in LATENT_MODELS or d.dur_exp is None:
        return 0.0
    exp = d.dur_exp
    days = math.ceil(exp.mean_days) - 1 if exp.dist == "constant" else exp.mean_days - 0.5
    return max(0.0, float(days))
```

Change `effective_days` to add the presymptomatic contribution before returning:

```python
    return max(0.0, float(days)) + d.rel_trans_exposed * exposed_days(d)
```

(keep `exposed_days` returning 0 outside the latent models so the term vanishes there). Replace `contact_scale`:

```python
def contact_scale(p: SimParamsV2) -> float:
    n = p.network
    r = p.disease.rel_sus_age.as_tuple()
    if n.network_type == "age_structured":
        # Each target group's row of the next-generation matrix scales by its susceptibility: rho(C · diag(r)) (section 4.4).
        contacts = float(np.linalg.eigvals(CONTACT_MATRIX @ np.diag(r)).real.max()) if r != (1.0, 1.0, 1.0) else CONTACT_SPECTRAL_RADIUS
    else:
        s = age_shares(p)
        contacts = n.n_contacts * sum(si * ri for si, ri in zip(s, r))
    return contacts * n.network_beta * effective_days(p.disease) * asymp_factor(p.disease)


def weighted_cfr(p: SimParamsV2) -> float:
    """The population case fatality ratio: the groups' values weighted by their shares (the scalar where a group has none)."""
    return float(sum(s * q for s, q in zip(age_shares(p), p.disease.death_probabilities())))
```

- [ ] **Step 4: The fixture**

In `scripts/export_parity_fixtures.py` `random_params`, after the `seiar` block add:

```python
    if rng.random() < 0.5:
        disease["rel_sus_age"] = {g: round(rng.uniform(0.3, 2.5), 2) for g in ("children", "adults", "elderly") if rng.random() < 0.8}
    if rng.random() < 0.4 and model != "sis":
        disease["p_death_age"] = {g: round(rng.choice([0.0, 0.001, 0.05, 0.2]), 3) for g in ("children", "adults", "elderly") if rng.random() < 0.6}
    if model in LATENT and rng.random() < 0.5:
        disease["rel_trans_exposed"] = round(rng.uniform(0.0, 1.0), 2)
```

and in `random_params`' `demographics` block, let the shares appear on the random network too: change `if network_type == "age_structured" and rng.random() < 0.7:` to `if rng.random() < 0.6:`. In `params_cases`, add `"weighted_cfr": round(r0.weighted_cfr(p), 9),` to each case, and change the payload's `"version": 2` to `3`.

- [ ] **Step 5: Run the tests and regenerate the fixture**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_r0.py -q -p no:cacheprovider`
Expected: all pass.
Run: `.venv/Scripts/python.exe scripts/export_parity_fixtures.py` then `.venv/Scripts/python.exe -m pytest tests/test_web_exports.py tests/test_param_registry.py -q -p no:cacheprovider`
Expected: all pass; `git diff --stat web/tests/fixtures/parity.json` shows the regenerated file.

- [ ] **Step 6: Commit**

```bash
git add epichat/params/r0.py scripts/export_parity_fixtures.py web/tests/fixtures/parity.json tests/test_param_r0.py tests/test_web_exports.py
git commit -m "feat(params): the exact R0 with susceptibility by age and presymptomatic days; the weighted CFR; parity fixture v3"
```

The TypeScript parity test is red from this commit until Task 3 lands; both are in one branch.

---

### Task 3: The TypeScript mirror: schema, R0, parity, panel rows, warnings, prompt

**Files:**
- Modify: `web/lib/sim/params.ts` (schemas, `DEFAULT_AGE_SHARES`, `ageShares`, `exposedDays`, `effectiveDays`, `contactScale`, `weightedCfr`, `deathProbabilities`)
- Modify: `web/lib/client/format.ts` (`parameterRows`)
- Modify: `web/lib/tools/shared.ts` (`paramWarnings`)
- Modify: `web/lib/chat/prompt.ts` (one bullet in `## Parameters`)
- Test: `web/tests/sim/registry.test.ts`, `web/tests/sim/params.test.ts`, `web/tests/sim/parity.test.ts`, `web/tests/client/format.test.ts`, `web/tests/tools/configureSimulation.test.ts`, `web/tests/chat/prompt.test.ts`

**Interfaces:**
- Consumes: `web/data/param_registry.json` v2 and `web/tests/fixtures/parity.json` v3 (Tasks 1 and 2).
- Produces: `SimParams["disease"]` gains `rel_sus_age: { children; adults; elderly }`, `p_death_age: { children: number | null; … }`, `rel_trans_exposed: number`; `deathProbabilities(d): [number, number, number]`; `ageShares(p)`, `exposedDays(d)`, `weightedCfr(p)`; the panel rows "Susceptibility by age", "Fatality by age", "Presymptomatic transmission"; the warnings use the weighted CFR.

- [ ] **Step 1: Write the failing tests**

In `web/tests/sim/registry.test.ts`, change `expect(REGISTRY_VERSION).toBe(1)` to `toBe(2)` and add to the "looks up specs" test: `expect(specFor("disease.rel_sus_age.children")).toMatchObject({ unit: "multiplier", tier: "advanced", default: 1 });` and `expect(specFor("disease.p_death_age.elderly")?.models).toEqual(["sir", "seir", "sirs", "seirs", "seiar"]);`.

In `web/tests/sim/parity.test.ts`, change `expect(parity.version).toBe(2)` to `toBe(3)` and, inside the loop over `parity.params`, add `expect(weightedCfr(p)).toBeCloseTo(c.weighted_cfr, 6);` (import `weightedCfr` from `@/lib/sim/params`; the fixture's case type gains `weighted_cfr: number`).

Append to `web/tests/sim/params.test.ts`:

```ts
describe("susceptibility and fatality by age, presymptomatic transmissibility", () => {
  const must = (input: unknown) => { const r = validateParams(input); if (!r.ok) throw new Error(r.error); return r.params; };

  it("defaults, validates and exposes the group values", () => {
    const base = must({ schema_version: 2 });
    expect(base.disease.rel_sus_age).toEqual({ children: 1, adults: 1, elderly: 1 });
    expect(base.disease.p_death_age).toEqual({ children: null, adults: null, elderly: null });
    expect(base.disease.rel_trans_exposed).toBe(0);
    const p = must({ schema_version: 2, disease: { model: "seir", dur_exp: { mean_days: 5 }, p_death: 0.01, rel_sus_age: { children: 1.5, elderly: 0.7 }, p_death_age: { elderly: 0.1 }, rel_trans_exposed: 0.5 } });
    expect(p.disease.rel_sus_age).toEqual({ children: 1.5, adults: 1, elderly: 0.7 });
    expect(deathProbabilities(p.disease)).toEqual([0.01, 0.01, 0.1]);
    expect(validateParams({ schema_version: 2, disease: { rel_sus_age: { children: 11 } } }).ok).toBe(false);
    expect(validateParams({ schema_version: 2, disease: { p_death_age: { adults: 1.5 } } }).ok).toBe(false);
    expect(must({ disease_type: "sir", beta: 5 }).disease.rel_sus_age).toEqual({ children: 1, adults: 1, elderly: 1 }); // a v1 row
  });

  it("scales the R0 by the share-weighted susceptibility, the column-scaled matrix, and the exposed days", () => {
    const base = must({ schema_version: 2 });
    const scaled = must({ schema_version: 2, disease: { rel_sus_age: { children: 2, adults: 0.5, elderly: 3 } } });
    expect(ageShares(base)).toEqual([0.3, 0.7, 0]);
    expect(approxR0(scaled)).toBeCloseTo(approxR0(base) * (0.3 * 2 + 0.7 * 0.5), 9);
    const aged = must({ schema_version: 2, network: { network_type: "age_structured" }, disease: { rel_sus_age: { children: 1.5, adults: 1, elderly: 0.7 } } });
    const matrix = CONTACT_MATRIX.map((row) => row.map((v, j) => v * [1.5, 1, 0.7][j]));
    expect(approxR0(aged)).toBeCloseTo(approxR0(must({ schema_version: 2, network: { network_type: "age_structured" } })) * (spectralRadius3(matrix) / CONTACT_SPECTRAL_RADIUS), 9);
    const seir = must({ schema_version: 2, disease: { model: "seir", dur_exp: { mean_days: 5 } } });
    const half = must({ schema_version: 2, disease: { model: "seir", dur_exp: { mean_days: 5 }, rel_trans_exposed: 0.5 } });
    expect(exposedDays(seir.disease)).toBe(4);
    expect(effectiveDays(half.disease)).toBeCloseTo(effectiveDays(seir.disease) + 2, 9);
    expect(weightedCfr(must({ schema_version: 2, disease: { p_death: 0.01, p_death_age: { elderly: 0.2 } }, demographics: { age_pct_under18: 40, age_pct_18_64: 50, age_pct_over65: 10 } }))).toBeCloseTo(0.4 * 0.01 + 0.5 * 0.01 + 0.1 * 0.2, 9);
  });
});
```

(import `ageShares`, `approxR0`, `CONTACT_MATRIX`, `CONTACT_SPECTRAL_RADIUS`, `deathProbabilities`, `effectiveDays`, `exposedDays`, `spectralRadius3`, `validateParams`, `weightedCfr` from `@/lib/sim/params`, extending the file's existing import.)

In `web/tests/client/format.test.ts`, inside the parameter-rows describe, add:

```ts
  it("shows the age multipliers, the fatality by age and the presymptomatic share only when set", () => {
    const plain = parameterRows(params({ schema_version: 2 })).map(([label]) => label);
    expect(plain).not.toContain("Susceptibility by age");
    expect(plain).not.toContain("Fatality by age");
    expect(plain).not.toContain("Presymptomatic transmission");
    const rows = parameterRows(params({ schema_version: 2, disease: { model: "seir", dur_exp: { mean_days: 5 }, p_death: 0.01, rel_sus_age: { children: 1.5, elderly: 0.7 }, p_death_age: { elderly: 0.1 }, rel_trans_exposed: 0.5 } }));
    expect(rows).toContainEqual(["Susceptibility by age", "children ×1.5, adults ×1, elderly ×0.7"]);
    expect(rows).toContainEqual(["Fatality by age", "children 1%, adults 1%, elderly 10%"]);
    expect(rows).toContainEqual(["Presymptomatic transmission", "50% of the infectious value"]);
  });
```

In `web/tests/tools/configureSimulation.test.ts`, add to the "produces literature warnings" describe block (or as a new test at the end):

```ts
  it("checks the fatality ratio against the literature as the population-weighted value", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "measles", r0: 15, dur_inf_days: 8, p_death: 0.001, advanced: { "disease.p_death_age.elderly": 0.5 } })).content);
    // default shares have no elderly: the weighted CFR is 0.1%, below the 0.5–6% range
    expect(out.warnings.some((w: string) => w.startsWith("Fatality rate 0.1%"))).toBe(true);
    const withElderly = JSON.parse((await run(deps, { advanced: { "demographics.age_pct_under18": 40, "demographics.age_pct_18_64": 50, "demographics.age_pct_over65": 10 } })).content);
    expect(withElderly.warnings.some((w: string) => w.startsWith("Fatality rate"))).toBe(false); // 0.9 × 0.1% + 0.1 × 50% = 5.09%
  });
```

In `web/tests/chat/prompt.test.ts`, add to the phrases of the "tells the assistant to use describe_parameters…" test: `"under 18, 18 to 64, and 65 and over"` and `"no elderly group"`.

- [ ] **Step 2: Run them and watch them fail**

Run (from `web/`): `npx vitest run tests/sim tests/client/format.test.ts tests/tools/configureSimulation.test.ts tests/chat/prompt.test.ts`
Expected: the registry version and parity version pins fail; `ageShares` and friends are not exported; the rows and the prompt phrase are missing.

- [ ] **Step 3: The schema and the R0 functions**

In `web/lib/sim/params.ts`, before `DiseaseSchema`:

```ts
export const AGE_GROUPS = ["children", "adults", "elderly"] as const;
export const AgeMultipliersSchema = z.object({
  children: withDefault("disease.rel_sus_age.children"),
  adults: withDefault("disease.rel_sus_age.adults"),
  elderly: withDefault("disease.rel_sus_age.elderly"),
});
export const AgeFractionsSchema = z.object({
  children: nullable(bounded("disease.p_death_age.children")),
  adults: nullable(bounded("disease.p_death_age.adults")),
  elderly: nullable(bounded("disease.p_death_age.elderly")),
});
```

In `DiseaseSchema`'s object, after `rel_trans_asymp`:

```ts
    rel_sus_age: AgeMultipliersSchema.prefault({}),
    p_death_age: AgeFractionsSchema.prefault({}),
    rel_trans_exposed: withDefault("disease.rel_trans_exposed"),
```

After the `asympFactor` function:

```ts
/** Starsim's default ages are uniform on 0 to 60: no elderly (Part 2, section 4.1). */
export const DEFAULT_AGE_SHARES: [number, number, number] = [0.3, 0.7, 0];

/** The share of agents in each age group: the fetched shares when all three are set, else the default ages'. */
export function ageShares(p: SimParams): [number, number, number] {
  const g = p.demographics;
  if (g.age_pct_under18 !== null && g.age_pct_18_64 !== null && g.age_pct_over65 !== null) return [g.age_pct_under18 / 100, g.age_pct_18_64 / 100, g.age_pct_over65 / 100];
  return DEFAULT_AGE_SHARES;
}

/** Each group's case fatality ratio: its own value, or the scalar. */
export function deathProbabilities(d: DiseaseParams): [number, number, number] {
  return [d.p_death_age.children ?? d.p_death, d.p_death_age.adults ?? d.p_death, d.p_death_age.elderly ?? d.p_death];
}

/** The population case fatality ratio, the groups weighted by their shares. */
export function weightedCfr(p: SimParams): number {
  const s = ageShares(p);
  const q = deathProbabilities(p.disease);
  return s[0] * q[0] + s[1] * q[1] + s[2] * q[2];
}

/** Days an exposed agent can transmit on a daily step, by the infectious period's offsets; 0 outside the latent models. */
export function exposedDays(d: DiseaseParams): number {
  if (!LATENT_MODELS.includes(d.model) || !d.dur_exp) return 0;
  const exp = d.dur_exp;
  return Math.max(0, exp.dist === "constant" ? Math.ceil(exp.mean_days) - 1 : exp.mean_days - 0.5);
}
```

In `effectiveDays`, change the final `return Math.max(0, days);` to `return Math.max(0, days) + d.rel_trans_exposed * exposedDays(d);`. Replace `contactScale`:

```ts
/** The R0 reached if every contact transmitted: contacts × network_beta × D_eff × asymp_factor, with the susceptibility multipliers (Part 2, 4.4). */
export function contactScale(p: SimParams): number {
  const r = [p.disease.rel_sus_age.children, p.disease.rel_sus_age.adults, p.disease.rel_sus_age.elderly];
  let contacts: number;
  if (p.network.network_type === "age_structured") {
    contacts = r.every((v) => v === 1) ? CONTACT_SPECTRAL_RADIUS : spectralRadius3(CONTACT_MATRIX.map((row) => row.map((v, j) => v * r[j])));
  } else {
    const s = ageShares(p);
    contacts = p.network.n_contacts * (s[0] * r[0] + s[1] * r[1] + s[2] * r[2]);
  }
  return contacts * p.network.network_beta * effectiveDays(p.disease) * asympFactor(p.disease);
}
```

(`CONTACT_MATRIX` and `spectralRadius3` are defined above `contactScale` already; keep the order so they exist when called.)

- [ ] **Step 4: The rows, the warnings and the prompt**

In `web/lib/client/format.ts` `parameterRows`, after the asymptomatic rows add:

```ts
    ...(Object.values(d.rel_sus_age).some((v) => v !== 1) ? row("Susceptibility by age", `children ×${fmtValue(d.rel_sus_age.children)}, adults ×${fmtValue(d.rel_sus_age.adults)}, elderly ×${fmtValue(d.rel_sus_age.elderly)}`) : []),
    ...(Object.values(d.p_death_age).some((v) => v !== null) ? row("Fatality by age", deathProbabilities(d).map((q, i) => `${AGE_GROUPS[i]} ${formatQuantity(q, "fraction")}`).join(", ")) : []),
    ...(d.rel_trans_exposed > 0 ? row("Presymptomatic transmission", `${formatQuantity(d.rel_trans_exposed, "fraction")} of the infectious value`) : []),
```

(import `AGE_GROUPS` and `deathProbabilities` from `@/lib/sim/params`.) In `web/lib/tools/shared.ts` `paramWarnings`, change `pDeath: d.p_death || null` to `pDeath: weightedCfr(params) || null` (import `weightedCfr`). In `web/lib/chat/prompt.ts`, add to the `## Parameters` section as its last bullet:

```
- The age groups are under 18, 18 to 64, and 65 and over. Susceptibility and fatality by age and presymptomatic transmission are illustrative assumptions unless the database carries them; say so in the limitations. Without fetched demographics the simulated ages run from 0 to 60, so there is no elderly group: say that, and offer to fetch the demographics, before setting an elderly value.
```

- [ ] **Step 5: Run the web suite, the typecheck and the lint**

Run (from `web/`): `npx vitest run && npm run typecheck && npm run lint`
Expected: all pass (the parity test reads the v3 fixture).

- [ ] **Step 6: Commit**

```bash
git add web/lib/sim/params.ts web/lib/client/format.ts web/lib/tools/shared.ts web/lib/chat/prompt.ts web/tests/sim/registry.test.ts web/tests/sim/params.test.ts web/tests/sim/parity.test.ts web/tests/client/format.test.ts web/tests/tools/configureSimulation.test.ts web/tests/chat/prompt.test.ts
git commit -m "feat(web): susceptibility and fatality by age and presymptomatic transmissibility in the schema, the R0, the panel, the warnings and the prompt"
```

---

### Task 4: The builder: the composition connector, the vaccine product, ages on every network, fatality by age, presymptomatic sources

**Files:**
- Modify: `epichat/sim/models.py` (`EpiChatDisease` states; a `_Presymptomatic` mixin on the SEIR family; the SIS subclass)
- Modify: `epichat/sim/connectors.py` (`TransmissionModifiers`)
- Create: `epichat/sim/products.py` (`Vaccine`)
- Modify: `epichat/sim/builder.py` (`disease_kwargs`, the connector, the product, `_assign_ages` on every network)
- Modify: `epichat/sim/interventions.py` (`InitialImmunity` for sis no longer writes `rel_sus`)
- Test: `tests/test_sim_models.py`, `tests/test_sim_connectors.py`, `tests/test_sim_builder.py`, `tests/test_sim_interventions.py`

**Interfaces:**
- Produces: states `rel_sus_base` (1.0) and `vaccine_protection` (1.0) on every EpiChat disease; module par `rel_trans_exposed` on SEIR, SEIRS, SEIAR; `TransmissionModifiers(disease, seasonality_scale=0, seasonality_shift=0, rel_sus_age=(1, 1, 1))` with `.factors`; `Vaccine(efficacy=1.0, leaky=True)` product whose `administer(people, uids)` writes `vaccine_protection`; `age_fatality(p_death, by_age)` in the builder returning the callable `ss.bernoulli` probability; `build_sim` assigning ages whenever the three shares are set.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_sim_connectors.py` (it already builds small sims through `build_sim`; follow its helpers for a 1000-agent, 30-day run):

```python
def test_the_connector_composes_every_writer_of_rel_sus_and_rel_trans_each_step():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({
        "disease": {"model": "sir", "beta": 50.0, "dur_inf": {"mean_days": 200}, "rel_sus_age": {"children": 1.5, "adults": 1.0, "elderly": 0.5}},
        "interventions": [{"type": "seasonality", "scale": 0.3}, {"type": "vaccine", "coverage": 0.5, "start_day": 1}],
        "demographics": {"age_pct_under18": 40.0, "age_pct_18_64": 50.0, "age_pct_over65": 10.0},
        "run": {"n_agents": 1000, "sim_dur_years": 40 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    disease = sim.diseases[0]
    connector = sim.connectors[0]
    age = np.asarray(sim.people.age)
    expected_base = np.select([age < 18, age < 65], [1.5, 1.0], default=0.5)
    assert np.allclose(np.asarray(disease.rel_sus_base), expected_base)
    protection = np.asarray(disease.vaccine_protection)
    assert 0.3 < (protection == 0.0).mean() < 0.7 and set(np.unique(protection)) <= {0.0, 1.0}      # efficacy 1: protected or not
    assert np.allclose(np.asarray(disease.rel_sus), expected_base * protection)                     # a vaccinated agent stays protected after 40 steps
    assert np.allclose(np.asarray(disease.rel_trans), np.asarray(disease.rel_trans_base) * connector.factors[-1])


def test_sis_immunity_still_protects_under_the_connector():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"model": "sis", "beta": 100.0, "initial_immune_frac": 0.5, "sis_waning": 0.0},
                                    "run": {"n_agents": 1000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    disease = sim.diseases[0]
    immune = np.asarray(disease.immunity) >= 1.0
    assert 0.4 < immune.mean() < 0.6
    assert np.all(np.asarray(disease.rel_sus)[immune] == 0.0)
    assert not np.any(np.asarray(disease.infected)[immune])
```

Append to `tests/test_sim_models.py` (it has a `build(name, **pars)` helper making a small Starsim sim from `MODELS`; if its helper differs, write the same with the file's helper):

```python
def test_exposed_agents_transmit_only_when_rel_trans_exposed_is_set():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    base = {"model": "seir", "beta": 300.0, "dur_exp": {"mean_days": 10}, "dur_inf": {"mean_days": 0.5}, "p_death": 0.0,
            "seed": {"mode": "count", "value": 20}}
    silent = SimParamsV2.model_validate({"disease": base, "run": {"n_agents": 2000, "sim_dur_years": 8 / 365, "rand_seed": 1}})
    sim = build_sim(silent)
    sim.run()
    assert sim.results.seir.cum_infections.values[-1] == 0          # nobody left the latent period: no transmission without the flag
    loud = SimParamsV2.model_validate({"disease": {**base, "rel_trans_exposed": 1.0}, "run": {"n_agents": 2000, "sim_dur_years": 8 / 365, "rand_seed": 1}})
    sim = build_sim(loud)
    sim.run()
    assert sim.results.seir.cum_infections.values[-1] > 100         # the exposed infected others at the full rate
    assert set(np.unique(np.asarray(sim.diseases[0].rel_trans_base)[np.asarray(sim.diseases[0].exposed)])) == {1.0}
    half = SimParamsV2.model_validate({"disease": {**base, "rel_trans_exposed": 0.5}, "run": {"n_agents": 2000, "sim_dur_years": 8 / 365, "rand_seed": 1}})
    sim = build_sim(half)
    sim.run()
    assert set(np.unique(np.asarray(sim.diseases[0].rel_trans_base)[np.asarray(sim.diseases[0].exposed)])) == {0.5}


def test_fatality_by_age_kills_only_the_groups_with_a_fatality():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({
        "disease": {"model": "sir", "beta": 300.0, "dur_inf": {"mean_days": 5}, "p_death": 0.0, "p_death_age": {"elderly": 1.0}, "seed": {"mode": "fraction", "value": 0.2}},
        "demographics": {"age_pct_under18": 30.0, "age_pct_18_64": 50.0, "age_pct_over65": 20.0},
        "run": {"n_agents": 2000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    ages_at_start = np.asarray(sim.people.age).copy()
    sim.run()
    disease = sim.diseases[0]
    dead = np.isfinite(np.asarray(disease.ti_dead.raw)) if hasattr(disease.ti_dead, "raw") else np.isfinite(np.asarray(disease.ti_dead))
    assert dead.sum() > 100
    assert np.all(ages_at_start[dead[: len(ages_at_start)]] >= 65)
```

Append to `tests/test_sim_builder.py`:

```python
def test_ages_follow_the_shares_on_the_random_network_too():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"demographics": {"age_pct_under18": 40.0, "age_pct_18_64": 50.0, "age_pct_over65": 10.0},
                                    "run": {"n_agents": 5000, "rand_seed": 1}})
    age = np.asarray(build_sim(p).people.age)
    assert abs((age < 18).mean() - 0.40) < 0.02 and abs((age >= 65).mean() - 0.10) < 0.02
    default = np.asarray(build_sim(SimParamsV2.model_validate({"run": {"n_agents": 5000, "rand_seed": 1}})).people.age)
    assert (default >= 65).sum() == 0 and abs((default < 18).mean() - 0.30) < 0.03


def test_the_new_leaves_leave_a_default_scenario_unchanged():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    before = SimParamsV2.model_validate({"run": {"n_agents": 2000, "sim_dur_years": 60 / 365, "rand_seed": 3}})
    explicit = SimParamsV2.model_validate({"disease": {"rel_sus_age": {"children": 1.0, "adults": 1.0, "elderly": 1.0}, "rel_trans_exposed": 0.0},
                                           "run": {"n_agents": 2000, "sim_dur_years": 60 / 365, "rand_seed": 3}})
    a, b = build_sim(before), build_sim(explicit)
    a.run()
    b.run()
    assert list(a.results.sir.cum_infections.values) == list(b.results.sir.cum_infections.values)
```

In `tests/test_sim_interventions.py`, the sis initial-immunity test (`test_initial_immunity_wanes_in_sis_at_sis_waning`) reads `rel_sus` directly after `sim.init()` without a connector; it keeps passing because the intervention still writes `immunity` and the test checks infection, not `rel_sus`. If it asserts `rel_sus == 0` before any step, change that assertion to `immunity == 1`.

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_connectors.py tests/test_sim_models.py tests/test_sim_builder.py -q -p no:cacheprovider -k "composes or sis_immunity_still or exposed_agents or fatality_by_age or shares_on_the_random or new_leaves"`
Expected: `AttributeError: … 'rel_sus_base'` / `'vaccine_protection'`; the exposed test's "loud" run infects nobody; the random-network ages are uniform (0.30 under 18 instead of 0.40).

- [ ] **Step 3: The models**

In `epichat/sim/models.py`:

```python
class EpiChatDisease:
    """Mixin for every EpiChat model: the base states the TransmissionModifiers connector composes into
    rel_trans and rel_sus (Part 2, 4.2), and a disease-death counter."""

    def __init__(self, pars=None, **kwargs):
        super().__init__(pars=pars, **kwargs)
        self.define_states(
            ss.FloatArr("rel_trans_base", default=1.0, label="Base relative transmission"),
            ss.FloatArr("rel_sus_base", default=1.0, label="Base relative susceptibility"),
            ss.FloatArr("vaccine_protection", default=1.0, label="Susceptibility left by vaccination"),
        )
```

(the rest of the class unchanged). Add the mixin and use it:

```python
class _Presymptomatic:
    """Part 2, 4.3: exposed agents transmit at rel_trans_exposed of the infectious value. Starsim's kernel takes
    the infectious as sources; this one takes everyone infected (exposed or infectious), with rel_trans_base
    carrying the exposed fraction, so the default 0 changes nothing."""

    def __init__(self, pars=None, **kwargs):
        super().__init__(pars=pars, **kwargs)
        self.define_pars(rel_trans_exposed=0.0)
        self.update_pars(pars, **kwargs)

    def step_state(self):
        super().step_state()
        base = self.rel_trans_base
        base[:] = 1.0
        base[self.exposed] = float(self.pars.rel_trans_exposed)

    def infect(self):
        betamap = self.validate_beta()
        sources_mask = self.exposed.raw | self.infectious.raw
        rel_trans = self.rel_trans.asnew(sources_mask * self.rel_trans.raw, copy=False)
        rel_sus = self.rel_sus.asnew(self.susceptible.raw * self.rel_sus.raw, copy=False)
        new_cases, sources, networks = [], [], []
        for i, (nkey, route) in enumerate(self.sim.networks.items()):
            betas = betamap[ss.standardize_netkey(nkey)]
            target_uids, source_uids, network_ids = self.infect_route(i, route, betas, rel_trans, rel_sus)
            new_cases.append(target_uids)
            sources.append(source_uids)
            networks.append(network_ids)
        return self.finalize_infections(new_cases, sources, networks)


class SEIR(EpiChatDisease, _Presymptomatic, ss.SEIR):
    pass
```

`SEIRS(_Waning, SEIR)` and `SEIAR(SEIR)` inherit it; SEIAR's existing `step_state` sets the asymptomatic base after `super().step_state()`, which now runs the exposed rule first, so the order is: everyone 1, exposed at the fraction, asymptomatic at `rel_trans_asymp`. Keep `clear_infection`'s reset. If `update_pars` with `pars=None` and keyword arguments is not how `_Waning` does it, follow `_Waning`'s pattern exactly.

The SIS subclass defers its `rel_sus` write to the connector:

```python
class SIS(EpiChatDisease, ss.SIS):
    def update_immunity(self):
        # Starsim writes rel_sus here; the connector composes it from immunity instead (Part 2, 4.2).
        has_imm = (self.immunity > 0).uids
        self.immunity[has_imm] *= 1 - self.pars.waning * self.t.dt
```

Check Starsim's `SIS.update_immunity` body (`starsim/diseases.py` around line 1040) and copy its waning line exactly, dropping only the `rel_sus` assignment.

- [ ] **Step 4: The connector and the product**

Replace `epichat/sim/connectors.py`:

```python
"""Transmission composition (Part 1, 8.4; Part 2, 4.2): once per step, after step_state and before
transmission, rel_trans = rel_trans_base × the seasonal factor, and rel_sus = rel_sus_base ×
vaccine_protection × (1 − SIS immunity). rel_sus_base is recomputed from the agents' ages every step,
so births and aging keep the age multipliers right. Seasonality uses Starsim's own formula on the
numeric day axis (year fraction ti / 365)."""
from __future__ import annotations

import math

import numpy as np
import starsim as ss


class TransmissionModifiers(ss.Connector):
    def __init__(self, disease: str, seasonality_scale: float = 0.0, seasonality_shift: float = 0.0,
                 rel_sus_age: tuple[float, float, float] = (1.0, 1.0, 1.0)):
        super().__init__()
        self.disease_name = disease
        self.scale = float(seasonality_scale)
        self.shift = float(seasonality_shift)
        self.rel_sus_age = tuple(float(v) for v in rel_sus_age)
        self.factors: list[float] = []

    def factor(self) -> float:
        if self.scale == 0.0:
            return 1.0
        frac_year = (self.ti / 365.0) % 1.0
        return max(0.0, 1.0 + self.scale * math.cos(2 * math.pi * (frac_year - self.shift)))

    def step(self):
        disease = self.sim.diseases[self.disease_name]
        age = np.asarray(self.sim.people.age)
        children, adults, elderly = self.rel_sus_age
        base = np.select([age < 18, age < 65], [children, adults], default=elderly)
        disease.rel_sus_base[:] = base
        immunity = np.clip(1.0 - np.asarray(disease.immunity), 0.0, 1.0) if hasattr(disease, "immunity") else 1.0
        disease.rel_sus[:] = base * np.asarray(disease.vaccine_protection) * immunity
        factor = self.factor()
        disease.rel_trans[:] = np.asarray(disease.rel_trans_base) * factor
        self.factors.append(factor)


TransmissibilityModifiers = TransmissionModifiers   # the Part 1 name, for the tests that use it
```

Create `epichat/sim/products.py`:

```python
"""The EpiChat vaccine product (Part 2, 4.2 and 7.2): instead of multiplying rel_sus in place as Starsim's
simple_vx does (the connector would overwrite it next step), it writes the vaccine_protection state the
connector composes. Leaky: every recipient keeps 1 − efficacy of its susceptibility; all-or-nothing: a
share efficacy of recipients is fully protected. Waning (protection_days) arrives in phase 2C."""
from __future__ import annotations

import starsim as ss


class Vaccine(ss.Vx):
    def __init__(self, efficacy: float = 1.0, leaky: bool = True):
        super().__init__()
        self.efficacy = float(efficacy)
        self.leaky = bool(leaky)
        self.takes = ss.bernoulli(p=self.efficacy)

    def administer(self, people, uids):
        protected = uids if self.leaky else self.takes.filter(uids)
        left = 1.0 - self.efficacy if self.leaky else 0.0
        for disease in self.sim.diseases.values():
            if hasattr(disease, "vaccine_protection"):
                disease.vaccine_protection[protected] = left
        return protected
```

- [ ] **Step 5: The builder**

In `epichat/sim/builder.py`: import `TransmissionModifiers` from `.connectors` and `Vaccine` from `.products`; add

```python
def age_fatality(p_death: float, by_age) -> float | callable:
    """p_death for ss.bernoulli: the scalar, or a callable of the agents' ages when any group has its own value."""
    if not by_age.any_set():
        return p_death
    children, adults, elderly = (v if v is not None else p_death for v in (by_age.children, by_age.adults, by_age.elderly))

    def probability(sim, uids):
        age = np.asarray(sim.people.age[uids])
        return np.select([age < 18, age < 65], [children, adults], default=elderly)

    return probability
```

In `disease_kwargs`, replace `kw["p_death"] = ss.bernoulli(p=d.p_death)` with `kw["p_death"] = ss.bernoulli(p=age_fatality(d.p_death, d.p_death_age))`, and inside the latent-models branch add `kw["rel_trans_exposed"] = d.rel_trans_exposed`. In `build_sim`, build the connector as `TransmissionModifiers(name, seasonality.scale if seasonality else 0.0, seasonality.shift if seasonality else 0.0, params.disease.rel_sus_age.as_tuple())`, and change the age assignment condition to `if params.demographics.age_pct_under18 is not None:` (every network). In `build_interventions`, use `product=Vaccine(efficacy=1.0)` in place of `ss.simple_vx(efficacy=1.0)`. In `epichat/sim/interventions.py` `InitialImmunity.step`, in the sis branch, keep `disease.immunity[chosen] = 1.0` and drop the `rel_sus` write (the connector composes it).

- [ ] **Step 6: Run the simulation suites**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_models.py tests/test_sim_connectors.py tests/test_sim_builder.py tests/test_sim_interventions.py tests/test_sim_outputs.py tests/test_sim_replicates.py tests/test_sim_run_params.py tests/test_sim_parity.py tests/test_sim_diagnostics.py -q -p no:cacheprovider`
Expected: all pass. `test_sim_parity.py` compares against the v1 baseline with default parameters, which the multipliers leave unchanged (the connector's composition with all factors 1 gives the same `rel_sus`); a change there is a finding, not a tolerance to widen.

- [ ] **Step 7: Commit**

```bash
git add epichat/sim/models.py epichat/sim/connectors.py epichat/sim/products.py epichat/sim/builder.py epichat/sim/interventions.py tests/test_sim_models.py tests/test_sim_connectors.py tests/test_sim_builder.py tests/test_sim_interventions.py
git commit -m "feat(sim): the composition connector, the vaccine product, ages on every network, fatality by age, presymptomatic sources"
```

---

### Task 5: Calibration tests with the multipliers and the exposed days

**Files:**
- Test: `tests/test_r0_calibration.py`

**Interfaces:**
- Consumes: `scenario(model, dist, target)` and `implied_r0(total, n)` of the file; `r0.with_r0`; `build_sim`.

- [ ] **Step 1: Write the tests**

Append to `tests/test_r0_calibration.py`:

```python
SHARES = {"age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8}
MULTIPLIERS = {"children": 1.5, "adults": 1.0, "elderly": 0.7}


def _with(p: SimParamsV2, target: float, **disease) -> SimParamsV2:
    body = p.model_dump()
    body["disease"].update(disease)
    return r0.with_r0(SimParamsV2.model_validate(body), target)


@pytest.mark.parametrize("target", [1.5, 2.5, 4.0])
@pytest.mark.parametrize("network", ["random", "age_structured"])
def test_susceptibility_by_age_keeps_the_calibration_exact(network, target):
    base = scenario("sir", "gamma", target)
    body = base.model_dump()
    body["network"]["network_type"] = network
    body["demographics"].update(SHARES)
    body["disease"]["rel_sus_age"] = MULTIPLIERS
    p = r0.with_r0(SimParamsV2.model_validate(body), target)
    totals = []
    for seed in (1, 2, 3):
        sim = build_sim(p, seed=seed)
        sim.run()
        totals.append(int(sim.results.sir.cum_infections.values[-1]) + sim.seeds_day0)
    implied = implied_r0(int(np.mean(totals)), N)
    if network == "random":
        assert abs(implied - target) / target < 0.05
    else:
        # on the age-structured network the homogeneous final size does not apply; the per-group
        # heterogeneous system of Part 1 section 18, with each group's susceptibility, does
        assert implied > 1.0 and abs(r0.approx_r0(p) - target) < 1e-6


def test_susceptibility_by_age_without_shares_uses_the_default_ages():
    base = scenario("sir", "gamma", 2.5)
    p = _with(base, 2.5, rel_sus_age=MULTIPLIERS)          # no shares: children 0.3, adults 0.7, no elderly
    totals = []
    for seed in (1, 2, 3):
        sim = build_sim(p, seed=seed)
        sim.run()
        totals.append(int(sim.results.sir.cum_infections.values[-1]) + sim.seeds_day0)
    assert abs(implied_r0(int(np.mean(totals)), N) - 2.5) / 2.5 < 0.05


@pytest.mark.parametrize("dist", ["constant", "gamma"])
def test_presymptomatic_transmission_keeps_the_calibration_exact(dist):
    p = _with(scenario("seir", dist, 2.5), 2.5, rel_trans_exposed=0.5)
    totals = []
    for seed in (1, 2, 3):
        sim = build_sim(p, seed=seed)
        sim.run()
        totals.append(int(sim.results.seir.cum_infections.values[-1]) + sim.seeds_day0)
    assert abs(implied_r0(int(np.mean(totals)), N) - 2.5) / 2.5 < 0.05
```

(`np` and `pytest` are imported in the file; add `from epichat.sim.builder import build_sim` if the file imports it under another name, use that.)

- [ ] **Step 2: Run them**

Run: `.venv/Scripts/python.exe -m pytest tests/test_r0_calibration.py -q -p no:cacheprovider -k "susceptibility_by_age or presymptomatic"`
Expected: pass (about 2 minutes: nine 50k-agent two-year runs per parametrized case). If the presymptomatic case misses by more than 5%, the exposed-days rule of Task 2 is wrong by an offset: measure `ti_infectious − ti_exposed` on a constant 5-day latent period in a small sim, set `exposed_days` to the transmitting steps that shows, rerun, and ledger the ruling with the measured number; the same test on the TypeScript side is the parity fixture, so regenerate it after the change.

- [ ] **Step 3: Run the whole calibration file once**

Run: `.venv/Scripts/python.exe -m pytest tests/test_r0_calibration.py -q -p no:cacheprovider`
Expected: all pass (about 4 minutes).

- [ ] **Step 4: Commit**

```bash
git add tests/test_r0_calibration.py
git commit -m "test(sim): the calibration stays exact with susceptibility by age and presymptomatic transmission"
```

---

### Task 6: The weighted CFR in the diagnostic, and the review-request script

**Files:**
- Modify: `epichat/sim/diagnostics.py` (`_cfr_out_of_range`)
- Create: `scripts/review_requests.py`
- Test: `tests/test_sim_diagnostics.py`, `tests/test_review_requests.py` (new)

**Interfaces:**
- Consumes: `weighted_cfr` (Task 2); `load_db`, `parameter_summary` (`epichat/disease_db.py`); `REGISTRY` (`epichat/params/registry.py`).
- Produces: `REQUESTED_FIELDS` (`fatality_rate_by_age`, `vaccine_efficacy`, `treatment_efficacy`, `presymptomatic_transmission`) with a one-line "what to find" each; `review_table() -> list[dict]` (disease, field, status, note); `render(rows) -> str` (Markdown); `python scripts/review_requests.py [--write docs/data-review-requests.md]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_sim_diagnostics.py`:

```python
def test_cfr_out_of_range_reads_the_population_weighted_fatality():
    # measles range 0.5 to 6%: the scalar 0.1% is out, but 10% of the elderly at 50% with 0.1% elsewhere is 5.09%, in
    p = params(**{"disease.p_death": 0.001, "disease.p_death_age": {"elderly": 0.5},
                  "demographics.age_pct_under18": 40.0, "demographics.age_pct_18_64": 50.0, "demographics.age_pct_over65": 10.0})
    assert "cfr_out_of_range" not in ids(run(p, NORMAL, total=8600, seeds=100, disease="measles"))
    scalar = params(**{"disease.p_death": 0.001})
    d = one(run(scalar, NORMAL, total=8600, seeds=100, disease="measles"), "cfr_out_of_range")
    assert d.evidence["p_death"] == pytest.approx(0.001)
    no_elderly = params(**{"disease.p_death": 0.001, "disease.p_death_age": {"elderly": 0.5}})   # default ages: no elderly
    assert one(run(no_elderly, NORMAL, total=8600, seeds=100, disease="measles"), "cfr_out_of_range").evidence["p_death"] == pytest.approx(0.001)
```

Create `tests/test_review_requests.py`:

```python
"""The review-request list for the database team (Part 2, section 11)."""
import json
from pathlib import Path

from scripts.review_requests import REQUESTED_FIELDS, render, review_table

ROOT = Path(__file__).resolve().parent.parent


def test_every_disease_gets_a_row_per_existing_and_requested_field():
    db = json.loads((ROOT / "epichat" / "data" / "disease_parameters.json").read_text(encoding="utf-8"))
    rows = review_table()
    diseases = sorted(db["diseases"])
    fields = {r["field"] for r in rows}
    assert set(REQUESTED_FIELDS) <= fields and {"r0", "fatality_rate", "infectious_days"} <= fields
    for disease in diseases:
        mine = {r["field"]: r for r in rows if r["disease"] == disease}
        assert set(mine) == fields, disease
        assert all(mine[f]["status"] == "requested" for f in REQUESTED_FIELDS)
        assert all(mine[f]["status"] in {"ok", "under_review", "estimates_only", "no_source"} for f in fields - set(REQUESTED_FIELDS))
    measles = {r["field"]: r for r in rows if r["disease"] == "measles"}
    assert measles["r0"]["status"] == "ok" and "children" in measles["fatality_rate_by_age"]["note"]


def test_the_markdown_lists_requests_first_then_the_table_and_the_bundled_checks():
    text = render(review_table())
    assert text.startswith("# Data review requests")
    assert "## Requested fields" in text and "## Coverage by disease" in text and "## Bundled tables" in text
    assert "| measles |" in text and "vaccine_efficacy" in text
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_diagnostics.py tests/test_review_requests.py -q -p no:cacheprovider`
Expected: the diagnostic test fails (the weighted case still fires); `ModuleNotFoundError: No module named 'scripts.review_requests'` (if `scripts/` has no `__init__.py`, the test imports by path: use `importlib.util.spec_from_file_location("review_requests", ROOT / "scripts" / "review_requests.py")` and ledger the choice).

- [ ] **Step 3: The diagnostic**

In `epichat/sim/diagnostics.py`, import `weighted_cfr` from `epichat.params.r0` and in `_cfr_out_of_range` replace the comparison and the evidence: `cfr = weighted_cfr(run.params)`; `if not rng or rng[0] <= cfr <= rng[1]: return None`; the lever's `current` becomes `{"disease.p_death": d.p_death}` (unchanged) and the evidence `{"p_death": cfr, "db_min": lo, "db_max": hi}`; the direction compares `value` with `cfr`.

- [ ] **Step 4: The script**

Create `scripts/review_requests.py`:

```python
"""The review-request list for the database team (sim-parameters Part 2, section 11).

    py -3.12 scripts/review_requests.py                       # print the Markdown
    py -3.12 scripts/review_requests.py --write docs/data-review-requests.md

For every disease and every database field the registry names, existing and requested, the status
and what a reviewer should find. Regenerate whenever the database or the registry changes.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from epichat.disease_db import load_db, parameter_summary  # noqa: E402
from epichat.params.registry import DB_FIELDS  # noqa: E402

REQUESTED_FIELDS = {
    "fatality_rate_by_age": "Case fatality ratio for children (under 18), adults (18 to 64) and the elderly (65 and over), as fractions, with the surveillance or cohort source; the registry's disease.p_death_age.",
    "vaccine_efficacy": "Protection against infection of the routine vaccine, as a fraction, naming the product and the dose schedule; the registry's interventions[].efficacy.",
    "treatment_efficacy": "Share of treated cases cured and the usual delay from symptoms to treatment, naming the treatment; the registry's interventions[].efficacy and delay_days.",
    "presymptomatic_transmission": "Share of transmission that happens before symptoms, or the latent-period infectiousness as a fraction of the symptomatic one; the registry's disease.rel_trans_exposed.",
}

EXISTING_NOTES = {
    "r0": "The basic reproduction number in a susceptible population.",
    "incubation_days": "Days from infection to symptoms (the latent period for the models).",
    "infectious_days": "Days a case transmits.",
    "fatality_rate": "Case fatality ratio of symptomatic cases, as a percentage or fraction with the unit stated.",
    "average_contacts_daily": "Contacts per person per day in the setting the estimate comes from.",
    "immunity_duration": "Duration of immunity after infection, in days.",
    "asymptomatic_fraction": "Share of infections that never show symptoms.",
}

BUNDLED_CHECKS = [
    ("contact matrices (Prem et al. 2021)", "the aggregation from 16 age bands to three against the published matrix for two countries"),
    ("UN WPP 2024 population by age", "the vintage, and a spot check of five countries against the UN site"),
    ("UN WPP 2024 crude birth rates", "the vintage and the projection variant"),
    ("UN household size", "the vintage and the definition of a household"),
]


def review_table() -> list[dict]:
    db = load_db()
    rows = []
    for disease in sorted(db["diseases"]):
        entry = db["diseases"][disease]
        for field in DB_FIELDS:
            summary = parameter_summary(entry, field) or {}
            rows.append({"disease": disease, "field": field, "status": summary.get("status", "no_source"), "note": EXISTING_NOTES[field]})
        for field, note in REQUESTED_FIELDS.items():
            rows.append({"disease": disease, "field": field, "status": "requested", "note": note})
    return rows


def render(rows: list[dict]) -> str:
    fields = list(dict.fromkeys(r["field"] for r in rows))
    lines = ["# Data review requests", "", "Generated by `scripts/review_requests.py` from the parameter database and the registry.", ""]
    lines += ["## Requested fields", ""]
    lines += [f"- **{field}**: {note}" for field, note in REQUESTED_FIELDS.items()]
    lines += ["", "## Coverage by disease", "", "| disease | " + " | ".join(fields) + " |", "|---|" + "---|" * len(fields)]
    for disease in dict.fromkeys(r["disease"] for r in rows):
        mine = {r["field"]: r["status"] for r in rows if r["disease"] == disease}
        lines.append(f"| {disease} | " + " | ".join(mine[f] for f in fields) + " |")
    lines += ["", "What each existing field should hold:", ""]
    lines += [f"- **{field}**: {note}" for field, note in EXISTING_NOTES.items()]
    lines += ["", "## Bundled tables", ""]
    lines += [f"- **{name}**: check {check}." for name, check in BUNDLED_CHECKS]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", type=Path)
    args = parser.parse_args()
    text = render(review_table())
    if args.write:
        args.write.write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote {args.write}")
    else:
        print(text)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_diagnostics.py tests/test_review_requests.py -q -p no:cacheprovider`
Expected: all pass.

- [ ] **Step 6: Run everything once more**

Run: `.venv/Scripts/python.exe -m pytest tests -q -p no:cacheprovider --ignore=tests/test_r0_calibration.py` and `sim/.venv/Scripts/python.exe -m pytest sim/tests -q -p no:cacheprovider` (from the worktree root; the service's tests run real children through the builder), then from `web/`: `npx vitest run && npm run typecheck && npm run lint`.
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add epichat/sim/diagnostics.py scripts/review_requests.py tests/test_sim_diagnostics.py tests/test_review_requests.py
git commit -m "feat(sim): the CFR check reads the population-weighted fatality; the review-request script"
```

---

## Self-review

**Spec coverage.** Part 2 section 4.1 (the seven leaves, their sources and paths): Tasks 1 and 3; 4.2 (composition, `vaccine_protection`, SIS deferral): Task 4; 4.3 (presymptomatic sources): Task 4; 4.4 (the extended R0, both networks): Tasks 2 and 3, verified by Task 5; 4.5 (weighted CFR in the warnings and the diagnostic): Tasks 3 and 6; section 11's script skeleton: Task 6; section 14's phase 2A list, with the parity fixture, is complete. Section 12's prompt sentence: Task 3. The amendment of the keys and of the ages-on-every-network rule is written into the spec in Task 1.

**Placeholders.** None.

**Type consistency.** `AgeMultipliers.as_tuple()` (Task 1) feeds `contact_scale` (Task 2) and the connector (Task 4); `death_probabilities()` (Task 1) feeds `weighted_cfr` (Task 2) and `age_fatality` (Task 4); the TypeScript `deathProbabilities`, `ageShares`, `exposedDays`, `weightedCfr` (Task 3) mirror the Python names and the fixture pins them; `TransmissionModifiers`' fourth argument is the tuple the builder passes; `Vaccine.administer(people, uids)` is the signature `routine_vx` calls (`self.product.administer(sim.people, accept_uids)`).

**Review Focus.** 1 → Task 4's composition test (a vaccinated agent after 40 steps under seasonality). 2 → Task 4's SIS test. 3 → Task 5's no-shares test. 4 → Task 2's `ignored` case and Task 4's builder passing the flag to the latent models only. 5 → Task 3's v1 row, Task 4's unchanged-default-scenario test, the parity migration cases.

## After the merge (owner)

- No migration. Push `main`; the registry export and the parity fixture travel with the code.
- `py -3.12 scripts/review_requests.py` prints the list; phase 2D commits it as `docs/data-review-requests.md`.
