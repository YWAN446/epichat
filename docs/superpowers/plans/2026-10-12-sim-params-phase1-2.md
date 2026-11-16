# Simulation Parameters, Phases 1 and 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every simulation parameter is described once in a Python registry, parameters travel as nested schema v2 in both languages (v1 rows migrate on read), R0 uses Starsim's exact transmission probability on both networks, and the builder gains the new disease parameters (duration distributions, seed mode and day, initial immunity, SIS waning, replicates, transmissibility composition, symptomatic-only SEIAR deaths, the 8.6 series keys).

**Architecture:** A new package `epichat/params/` holds the registry (`registry.py`), the pydantic v2 schema whose bounds are generated from it (`schema_v2.py`), the v1 migration (`migrate.py`), dotted-path helpers (`paths.py`), the exact R0 math (`r0.py`), the v2 demographics rescale (`resolve.py`) and the v2 repair loop (`repair.py`). The exporter writes `web/data/param_registry.json`; TypeScript reads it for bounds and defaults, so the zod schema and the pydantic schema share one source. The builder's input becomes `SimParamsV2`; new modules `epichat/sim/interventions.py` (seeding, initial immunity, treatment) and `epichat/sim/connectors.py` (transmissibility composition) keep `builder.py` focused; `replicates.py` runs n seeds in one process. The service accepts v1 or v2 bodies and answers v2.

**Tech Stack:** Python 3.12, pydantic 2, numpy, Starsim 3.7.2; TypeScript, zod 4, vitest; FastAPI service.

**Spec:** `docs/superpowers/specs/2026-10-09-sim-parameters-disease-design.md`, sections 5 to 8 and 13, as revised by sections 17 and 18 (section 18 records the age-structured investigation and the rulings this plan follows).

## Global Constraints

- Python 3.12 and `starsim==3.7.2` everywhere Starsim runs; no new Python dependencies.
- `npm --prefix web ci` only, never `npm install`; no new npm dependencies.
- Every duration passed to Starsim is `ss.days(...)` and every rate `ss.peryear(...)`; no bare number reaches a Starsim distribution.
- Numeric time: `start=ss.days(0)`, `dur=ss.days(sim_days(years))`, `dt=ss.days(1)`; `sim_days(y) = max(1, round(365 × y))`.
- `beta` keeps the v1 unit (per year) and bounds `0.001` to `1000`.
- `p_death` is a case fatality ratio: in seiar only symptomatic infections draw it; sis never draws it.
- `sis_waning` and `sis_imm_boost` default to 0 (Starsim's 0.05 and 1.0 are not used).
- Migrated scenarios keep `constant` durations; new durations created by the configure tool are `gamma` with sd `(max − min) / 4` from the database range when known and `min < max`, else `0.3 × mean`.
- A vaccine with `start_day == 0` is normalized on validation into `disease.initial_immune_frac` in both languages.
- The web app migrates v1 on every read and always writes v2; the service accepts v1 or v2 and answers v2.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UL6ToyEthpP1X8yxArZE6g`.
- No database migration in this plan. Pushing is the owner's.
- Test commands: root package `.venv/Scripts/python.exe -m pytest tests -q`; service `sim/.venv/Scripts/python.exe -m pytest sim/tests -q`; web `npm --prefix web test -- --run` plus `npm --prefix web run typecheck`.

## Review Focus

1. A stored v1 scenario whose vaccine has `start_day: 0` and `coverage: 1.0` (everyone immune) must still load: migration clamps `initial_immune_frac` to 0.99 and the run completes. Test in Task 3.
2. A `count` seed larger than `n_agents`, or a `day` past the end of the run, must be a validation error naming the path in both languages, never a crash in the child process. Tests in Tasks 2 and 6.
3. A target R0 at or above what the contacts and infectious period can carry (including a constant infectious period under one day, where `D_eff` is 0) must return a `CONFIG ERROR` naming the maximum and the levers, not a division by zero or an infinite beta. Tests in Tasks 4 and 6.
4. An age-structured scenario without age shares, where Starsim's default ages leave the elderly group empty, must still build, run, and calibrate (R0 does not depend on the shares). Test in Task 13.
5. Five replicates of a 100k-agent scenario count 500k agent-years against the cap and are refused with the cap message before any child process starts. Test in Task 12.

---

## File structure

Create:
- `epichat/params/__init__.py`, `registry.py`, `schema_v2.py`, `migrate.py`, `paths.py`, `r0.py`, `resolve.py`, `repair.py`
- `epichat/sim/interventions.py`, `epichat/sim/connectors.py`, `epichat/sim/replicates.py`
- `web/lib/sim/registry.ts`, `web/lib/sim/paths.ts`, `web/data/param_registry.json`
- `tests/test_param_registry.py`, `tests/test_schema_v2.py`, `tests/test_param_migrate.py`, `tests/test_param_r0.py`, `tests/test_param_resolve.py`, `tests/test_param_repair.py`, `tests/test_sim_interventions.py`, `tests/test_sim_connectors.py`, `tests/test_sim_replicates.py`, `tests/test_r0_calibration.py`
- `web/tests/sim/registry.test.ts`, `web/tests/sim/paths.test.ts`, `web/tests/sim/migrate.test.ts`

Modify:
- `scripts/export_web_data.py`, `scripts/export_parity_fixtures.py`, `tests/test_web_exports.py`
- `epichat/sim/models.py`, `builder.py`, `outputs.py`, `run_params.py`
- `sim/runner.py`, `sim/service.py`, `sim/main.py`, `sim/series.py` and their tests
- `web/lib/sim/params.ts`, `client.ts`; `web/lib/tools/configureSimulation.ts`, `configView.ts`, `shared.ts`, `runSimulation.ts`, `fetchDemographics.ts`, `fetchVaccinationCoverage.ts`, `fetchHealthSystem.ts`, `types.ts`; `web/lib/chat/handleChat.ts`; `web/lib/client/format.ts`, `artifacts.ts`, `chart.ts`; `web/lib/report/compose.ts`; `web/lib/db/runs.ts`; `web/components/panel/RunsSection.tsx`
- the phase 0 tests (`tests/test_sim_*.py`) to v2 inputs
- `web/docs/DEPLOY.md` (one paragraph)

The v1 Python code (`epichat/schema.py`, `parser.py`, `generator.py`) is not modified: the frozen Python agent and its tests keep using it.

---

### Task 1: The parameter registry

**Files:**
- Create: `epichat/params/__init__.py`, `epichat/params/registry.py`
- Test: `tests/test_param_registry.py`

**Interfaces:**
- Produces: `ParamSpec` (frozen dataclass, fields as spec 5.1 plus `applies_to(model) -> bool` and `as_dict() -> dict`); `REGISTRY: tuple[ParamSpec, ...]`; `REGISTRY_BY_PATH: dict[str, ParamSpec]`; `spec_for(path) -> ParamSpec` (KeyError); `applicable(model) -> tuple[ParamSpec, ...]`; `export() -> dict` = `{"version": 1, "params": [...]}`; constants `MODELS`, `LATENT_MODELS`, `WANING_MODELS`, `DEATH_MODELS`, `DISTS`, `DB_FIELDS`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_param_registry.py
"""Spec 5.1: one ParamSpec per leaf, consistent with the disease database."""
import json
from pathlib import Path

import pytest

from epichat.params import registry as reg

ROOT = Path(__file__).resolve().parent.parent
DB_PARAMS = ("r0", "incubation_days", "infectious_days", "fatality_rate",
             "average_contacts_daily", "immunity_duration", "asymptomatic_fraction")


def test_paths_are_unique_and_in_module_order():
    paths = [s.path for s in reg.REGISTRY]
    assert len(paths) == len(set(paths))
    modules = [s.module for s in reg.REGISTRY]
    assert modules == sorted(modules, key=["disease", "network", "demographics", "interventions", "run"].index)
    assert paths[0] == "disease.model" and paths[-1] == "run.rand_seed"


def test_every_db_field_exists_in_the_database():
    db = json.loads((ROOT / "epichat" / "data" / "disease_parameters.json").read_text(encoding="utf-8"))
    fields = {f for entry in db["diseases"].values() for f in entry.get("parameters", {})}
    for s in reg.REGISTRY:
        if s.db_field is not None:
            assert s.db_field in DB_PARAMS and s.db_field in fields, s.path


def test_bounds_contain_defaults_and_choices_contain_enum_defaults():
    for s in reg.REGISTRY:
        if s.default is None:
            continue
        if s.bounds is not None:
            lo, hi = s.bounds
            assert lo <= s.default <= hi, s.path
        if s.kind == "enum":
            assert s.choices and s.default in s.choices, s.path


def test_requires_name_registered_paths_and_models_are_known():
    for s in reg.REGISTRY:
        for path in s.requires:
            assert path in reg.REGISTRY_BY_PATH, (s.path, path)
        for m in s.models:
            assert m in reg.MODELS, (s.path, m)


def test_disease_entries_follow_section_7_2():
    assert reg.spec_for("disease.beta").bounds == (0.001, 1000.0) and reg.spec_for("disease.beta").unit == "per year"
    assert reg.spec_for("disease.dur_inf.mean_days").default == 10.0 and reg.spec_for("disease.dur_inf.mean_days").tier == "core"
    assert reg.spec_for("disease.dur_inf.dist").tier == "advanced" and reg.spec_for("disease.dur_inf.sd_days").tier == "advanced"
    assert reg.spec_for("disease.dur_exp.mean_days").models == reg.LATENT_MODELS
    assert reg.spec_for("disease.dur_immune.mean_days").models == reg.WANING_MODELS
    assert reg.spec_for("disease.p_death").models == reg.DEATH_MODELS and reg.spec_for("disease.p_death").db_field == "fatality_rate"
    assert reg.spec_for("disease.sis_waning").default == 0.0 and reg.spec_for("disease.sis_waning").models == ("sis",)
    assert reg.spec_for("disease.seed.mode").choices == ("fraction", "count")
    assert reg.spec_for("disease.initial_immune_frac").bounds == (0.0, 0.99)
    assert reg.spec_for("run.n_replicates").bounds == (1, 5) and reg.spec_for("run.rand_seed").tier == "expert"
    assert reg.spec_for("disease.dur_inf.dist").requires == ("disease.dur_inf.sd_days",)
    with pytest.raises(KeyError):
        reg.spec_for("disease.nope")


def test_applicable_filters_by_model():
    sir = {s.path for s in reg.applicable("sir")}
    seiar = {s.path for s in reg.applicable("seiar")}
    assert "disease.dur_exp.mean_days" not in sir and "disease.dur_exp.mean_days" in seiar
    assert "disease.p_asymp" in seiar and "disease.p_asymp" not in sir
    assert "disease.sis_waning" not in sir and "disease.p_death" not in {s.path for s in reg.applicable("sis")}
    assert "run.n_agents" in sir and "network.n_contacts" in sir


def test_export_is_a_plain_json_document_in_registry_order():
    out = reg.export()
    assert out["version"] == 1 and [p["path"] for p in out["params"]] == [s.path for s in reg.REGISTRY]
    text = json.dumps(out)
    assert json.loads(text) == out
    first = out["params"][0]
    assert set(first) == {"path", "module", "label", "description", "kind", "unit", "default", "bounds", "choices", "models", "tier", "db_field", "starsim_target", "affects", "requires"}
    assert first["choices"] == list(reg.MODELS) and first["models"] == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_registry.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'epichat.params'`

- [ ] **Step 3: Write the registry**

`epichat/params/__init__.py`:

```python
"""The parameter registry, schema v2, migration and R0 math (spec sections 5 to 7)."""
```

`epichat/params/registry.py`:

```python
"""ParamSpec entries: the single source of truth for every simulation parameter
(spec 5.1). schema_v2 generates its bounds and defaults from this module and
scripts/export_web_data.py writes it to web/data/param_registry.json for the
TypeScript side. Registry order is the order describe_parameters lists."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Module = Literal["disease", "network", "demographics", "interventions", "run"]
Kind = Literal["number", "integer", "bool", "enum", "string"]
Tier = Literal["core", "advanced", "expert"]
Affects = Literal["timing", "peak", "final_size", "deaths", "duration", "endemicity", "stochasticity"]

MODELS = ("sir", "seir", "sis", "sirs", "seirs", "seiar")
LATENT_MODELS = ("seir", "seirs", "seiar")
WANING_MODELS = ("sirs", "seirs")
DEATH_MODELS = ("sir", "seir", "sirs", "seirs", "seiar")
DISTS = ("constant", "lognormal", "gamma")
DB_FIELDS = ("r0", "incubation_days", "infectious_days", "fatality_rate",
             "average_contacts_daily", "immunity_duration", "asymptomatic_fraction")
ALL_EFFECTS: tuple[Affects, ...] = ("timing", "peak", "final_size", "deaths", "duration", "endemicity", "stochasticity")


@dataclass(frozen=True)
class ParamSpec:
    path: str
    module: Module
    label: str
    description: str
    kind: Kind
    unit: str | None
    default: Any
    bounds: tuple[float, float] | None
    choices: tuple[str, ...] | None
    models: tuple[str, ...]
    tier: Tier
    db_field: str | None
    starsim_target: str
    affects: tuple[Affects, ...]
    requires: tuple[str, ...] = field(default=())

    def applies_to(self, model: str) -> bool:
        return not self.models or model in self.models

    def as_dict(self) -> dict:
        return {
            "path": self.path, "module": self.module, "label": self.label, "description": self.description,
            "kind": self.kind, "unit": self.unit, "default": self.default,
            "bounds": list(self.bounds) if self.bounds is not None else None,
            "choices": list(self.choices) if self.choices is not None else None,
            "models": list(self.models), "tier": self.tier, "db_field": self.db_field,
            "starsim_target": self.starsim_target, "affects": list(self.affects), "requires": list(self.requires),
        }


def _duration(name: str, label: str, models: tuple[str, ...], default_mean: float | None, mean_bounds: tuple[float, float],
              sd_bounds: tuple[float, float], db_field: str, target: str, affects: tuple[Affects, ...], about: str) -> list[ParamSpec]:
    base = f"disease.{name}"
    return [
        ParamSpec(f"{base}.mean_days", "disease", f"{label} (mean)", about, "number", "days", default_mean, mean_bounds, None,
                  models, "core", db_field, target, affects),
        ParamSpec(f"{base}.dist", "disease", f"{label} (distribution)",
                  "How the period varies between people: constant (everyone the same), gamma or lognormal (needs sd_days). "
                  "Migrated scenarios are constant; new scenarios use gamma with an illustrative sd.",
                  "enum", None, "constant", None, DISTS, models, "advanced", None, target, affects, (f"{base}.sd_days",)),
        ParamSpec(f"{base}.sd_days", "disease", f"{label} (sd)",
                  "Standard deviation of the period between people, in days; at most twice the mean. Realized periods are "
                  "about half a day longer than configured because transitions happen on whole days.",
                  "number", "days", None, sd_bounds, None, models, "advanced", None, target, affects),
    ]


REGISTRY: tuple[ParamSpec, ...] = tuple([
    ParamSpec("disease.model", "disease", "Model", "Which compartments the disease has: sir, seir (latent period), sis (no lasting immunity), "
              "sirs and seirs (immunity wanes), seiar (an asymptomatic track).", "enum", None, "sir", None, MODELS, (), "core", None,
              "ss.SIR, ss.SEIR, ss.SIS and the EpiChat subclasses in epichat/sim/models.py", ALL_EFFECTS),
    ParamSpec("disease.beta", "disease", "Transmission rate", "Per-contact transmission rate per year; the configure tool sets it from R0. "
              "Starsim turns it into a daily probability 1 - exp(-beta / 365).", "number", "per year", 22.8125, (0.001, 1000.0), None, (),
              "advanced", None, "disease.pars.beta = ss.peryear(beta)", ("peak", "final_size")),
    *_duration("dur_exp", "Latent period", LATENT_MODELS, None, (0.1, 60.0), (0.01, 120.0), "incubation_days", "ss.SEIR(dur_exp=...)", ("timing",),
               "Days between infection and becoming infectious. Required for seir, seirs and seiar; the database incubation period is the usual source."),
    *_duration("dur_inf", "Infectious period", (), 10.0, (0.5, 365.0), (0.01, 730.0), "infectious_days", "ss.SIR(dur_inf=...)", ("peak", "final_size", "timing"),
               "Days an infected person transmits. The database infectious period is the usual source."),
    *_duration("dur_immune", "Immunity duration", WANING_MODELS, None, (7.0, 36500.0), (0.1, 73000.0), "immunity_duration", "EpiChat SIRS/SEIRS dur_immune",
               ("endemicity",), "Days of immunity after recovery before a person can be infected again. Required for sirs and seirs."),
    ParamSpec("disease.p_death", "disease", "Case fatality ratio", "Share of cases that die at the end of the infectious period. In seiar only "
              "symptomatic infections are cases; in the other models every infection is, so a surveillance CFR overstates deaths for "
              "diseases with many mild or unreported infections. Surveillance CFRs also carry their own biases.", "number", "fraction", 0.0,
              (0.0, 1.0), None, DEATH_MODELS, "core", "fatality_rate", "ss.bernoulli(p=p_death) drawn at infection", ("deaths",)),
    ParamSpec("disease.p_asymp", "disease", "Asymptomatic share", "Share of infections that never show symptoms; they still transmit, at "
              "rel_trans_asymp of a symptomatic case, and never die of the disease.", "number", "fraction", 0.3, (0.0, 1.0), None, ("seiar",),
              "core", "asymptomatic_fraction", "SEIAR p_asymp = ss.bernoulli(p=...)", ("peak", "final_size")),
    ParamSpec("disease.rel_trans_asymp", "disease", "Asymptomatic transmissibility", "Transmissibility of an asymptomatic infection relative "
              "to a symptomatic one.", "number", "fraction", 0.5, (0.0, 1.0), None, ("seiar",), "advanced", None,
              "SEIAR rel_trans_base for asymptomatic agents", ("peak", "final_size")),
    ParamSpec("disease.sis_waning", "disease", "Immunity waning (sis)", "Rate per year at which immunity after an sis infection decays; 0 "
              "reproduces the classic SIS with no immunity.", "number", "per year", 0.0, (0.0, 52.0), None, ("sis",), "advanced", None,
              "ss.SIS(waning=ss.peryear(...))", ("endemicity",)),
    ParamSpec("disease.sis_imm_boost", "disease", "Immunity boost (sis)", "How much immunity an sis infection adds (0 to 1); 0 means none.",
              "number", None, 0.0, (0.0, 1.0), None, ("sis",), "advanced", None, "ss.SIS(imm_boost=...)", ("endemicity",)),
    ParamSpec("disease.seed.mode", "disease", "Seeding mode", "fraction: each agent starts infected with probability value; count: exactly "
              "value agents start infected.", "enum", None, "fraction", None, ("fraction", "count"), (), "advanced", None,
              "init_prev = ss.bernoulli or ss.choose_n", ("stochasticity",)),
    ParamSpec("disease.seed.value", "disease", "Seed size", "A fraction between 0 and 1 (mode fraction) or a whole number of agents from 1 "
              "to n_agents (mode count).", "number", None, 0.01, (0.0, 1_000_000.0), None, (), "core", None,
              "init_prev, or SeedInfections when day > 0", ("timing", "stochasticity")),
    ParamSpec("disease.seed.day", "disease", "Seeding day", "Day the seed infections happen; 0 means at the start.", "integer", "days", 0,
              (0, 7300), None, (), "advanced", None, "SeedInfections intervention", ("timing",)),
    ParamSpec("disease.initial_immune_frac", "disease", "Initially immune", "Share of the non-seeded population that starts immune (a past "
              "epidemic or a vaccination campaign before day 0). In sirs and seirs this immunity wanes like everyone else's; in sis at "
              "sis_waning.", "number", "fraction", 0.0, (0.0, 0.99), None, (), "advanced", None, "InitialImmunity intervention", ("final_size",)),
    ParamSpec("network.network_type", "network", "Contact network", "random: everyone has n_contacts random contacts; age_structured: "
              "three age groups mixing by a POLYMOD-like matrix.", "enum", None, "random", None, ("random", "age_structured"), (), "core",
              None, "ss.RandomNet or ss.MixingPools", ("peak", "final_size")),
    ParamSpec("network.n_contacts", "network", "Contacts per day", "Mean number of contacts per person per day on the random network.",
              "integer", "per day", 4, (1, 100), None, (), "core", "average_contacts_daily", "ss.RandomNet(n_contacts=...)", ("peak", "final_size")),
    ParamSpec("network.network_beta", "network", "Network transmission multiplier", "Multiplies the per-contact probability on the network; "
              "1 leaves beta as it is.", "number", None, 1.0, (0.01, 10.0), None, (), "advanced", None,
              "ss.RandomNet(beta=...) or the mixing matrix scale", ("peak", "final_size")),
    ParamSpec("demographics.use_demographics", "demographics", "Births and deaths", "Whether people are born and die of other causes "
              "during the run.", "bool", None, False, None, None, (), "core", None, "ss.Births and ss.Deaths", ("endemicity",)),
    ParamSpec("demographics.birth_rate", "demographics", "Birth rate", "Births per 1,000 people per year.", "number", "per 1,000 per year",
              20.0, (0.1, 1000.0), None, (), "advanced", None, "ss.Births(birth_rate=ss.peryear(...))", ("endemicity",)),
    ParamSpec("demographics.death_rate", "demographics", "Death rate", "Deaths from other causes per 1,000 people per year.", "number",
              "per 1,000 per year", 10.0, (0.1, 1000.0), None, (), "advanced", None, "ss.Deaths(death_rate=ss.peryear(...))", ("endemicity",)),
    ParamSpec("demographics.age_pct_under18", "demographics", "Share under 18", "Percent of the population aged 0 to 17; with the other two "
              "shares it assigns ages on the age-structured network.", "number", "percent", None, (0.0, 100.0), None, (), "advanced", None,
              "age assignment after sim.init()", ("peak", "final_size")),
    ParamSpec("demographics.age_pct_18_64", "demographics", "Share 18 to 64", "Percent of the population aged 18 to 64.", "number", "percent",
              None, (0.0, 100.0), None, (), "advanced", None, "age assignment after sim.init()", ("peak", "final_size")),
    ParamSpec("demographics.age_pct_over65", "demographics", "Share 65 and over", "Percent of the population aged 65 or more.", "number",
              "percent", None, (0.0, 100.0), None, (), "advanced", None, "age assignment after sim.init()", ("peak", "final_size")),
    ParamSpec("demographics.country", "demographics", "Country", "ISO3 code of the country whose demographics are used.", "string", None,
              None, None, None, (), "core", None, "resolve_demographics", ("endemicity",)),
    ParamSpec("demographics.auto_demographics", "demographics", "Fill demographics from the country", "Whether the service fills birth "
              "and death rates and contacts from country data when they are still at their defaults.", "bool", None, True, None, None, (),
              "expert", None, "resolve_demographics", ("endemicity",)),
    ParamSpec("demographics.demographics_year", "demographics", "Demographics year", "Year of the country data used.", "integer", "year",
              2022, (1950, 2100), None, (), "expert", None, "resolve_demographics", ("endemicity",)),
    ParamSpec("demographics.demographics_source", "demographics", "Demographics source", "Where the filled demographics came from.",
              "string", None, None, None, None, (), "expert", None, "resolve_demographics", ()),
    ParamSpec("interventions[].type", "interventions", "Intervention type", "vaccine (a routine campaign from start_day), treatment "
              "(daily capacity-limited recovery), seasonality (a yearly cycle in transmission).", "enum", None, None, None,
              ("vaccine", "treatment", "seasonality"), (), "core", None, "ss.routine_vx, SimpleTreatment, TransmissibilityModifiers", ("peak", "final_size", "timing")),
    ParamSpec("interventions[].coverage", "interventions", "Coverage", "Vaccine: yearly probability each susceptible person is vaccinated; "
              "treatment: share of infectious people treated each day.", "number", "fraction", None, (0.0, 1.0), None, (), "core", None,
              "ss.routine_vx(prob=...) or SimpleTreatment(prob=...)", ("peak", "final_size")),
    ParamSpec("interventions[].start_day", "interventions", "Start day", "Day the intervention begins. A vaccine starting on day 0 is "
              "stored as disease.initial_immune_frac instead.", "integer", "days", 0, (0, 7300), None, (), "core", None,
              "ss.routine_vx(start_year=start_day / 365)", ("timing",)),
    ParamSpec("interventions[].capacity", "interventions", "Treatment capacity", "Most people treated per day.", "integer", "agents per day",
              None, (1, 1_000_000), None, (), "core", None, "SimpleTreatment(max_capacity=...)", ("peak", "final_size")),
    ParamSpec("interventions[].scale", "interventions", "Seasonal amplitude", "Size of the yearly cycle: 0.2 means transmission moves "
              "between 80% and 120% of beta.", "number", None, 0.2, (0.0, 1.0), None, (), "core", None, "TransmissibilityModifiers", ("timing", "peak")),
    ParamSpec("interventions[].shift", "interventions", "Seasonal shift", "Fraction of a year by which the cycle is shifted.", "number",
              None, 0.0, (0.0, 1.0), None, (), "advanced", None, "TransmissibilityModifiers", ("timing",)),
    ParamSpec("run.n_agents", "run", "Agents", "Number of simulated people; results scale to the real population.", "integer", None, 10000,
              (10, 1_000_000), None, (), "core", None, "ss.Sim(n_agents=...)", ("stochasticity",)),
    ParamSpec("run.sim_dur_years", "run", "Duration", "Length of the run in years.", "number", "years", 1.0, (0.01, 20.0), None, (), "core",
              None, "ss.Sim(dur=ss.days(round(365 * years)))", ("duration",)),
    ParamSpec("run.n_replicates", "run", "Replicates", "How many seeds to run; the result shows the median run with 10 to 90% bands.",
              "integer", None, 1, (1, 5), None, (), "advanced", None, "run_replicates", ("stochasticity",)),
    ParamSpec("run.rand_seed", "run", "Random seed", "Seed of the first replicate; unset means 1.", "integer", None, None, None, None, (),
              "expert", None, "ss.Sim(rand_seed=...)", ("stochasticity",)),
])

REGISTRY_BY_PATH: dict[str, ParamSpec] = {s.path: s for s in REGISTRY}


def spec_for(path: str) -> ParamSpec:
    return REGISTRY_BY_PATH[path]


def applicable(model: str) -> tuple[ParamSpec, ...]:
    return tuple(s for s in REGISTRY if s.applies_to(model))


def export() -> dict:
    return {"version": 1, "params": [s.as_dict() for s in REGISTRY]}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_registry.py -q`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add epichat/params/__init__.py epichat/params/registry.py tests/test_param_registry.py
git commit -m "feat(params): the parameter registry (spec 5.1)"
```

### Task 2: Schema v2 and the dotted-path helpers

**Files:**
- Create: `epichat/params/schema_v2.py`, `epichat/params/paths.py`
- Test: `tests/test_schema_v2.py`

**Interfaces:**
- Consumes: `REGISTRY_BY_PATH`, `LATENT_MODELS`, `WANING_MODELS` from Task 1; `Intervention` from `epichat.schema` (v1, unchanged).
- Produces: `Duration`, `Seed`, `DiseaseParams`, `NetworkParams`, `DemographicsParams`, `RunParams`, `SimParamsV2` (pydantic); `sim_days(years) -> int`; `Model` and `Dist` literals. `paths.flatten(d: dict, prefix="") -> dict[str, Any]` (nested dicts become dotted keys; lists stay values), `paths.get_path(d, path)`, `paths.set_path(d, path, value) -> None` (creates intermediate dicts), `paths.diff(before: dict, after: dict) -> list[dict]` (`{"field", "from", "to"}` in `before`'s key order, new keys last).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_schema_v2.py
"""Spec 6: nested parameters with bounds generated from the registry, and the
dotted-path helpers the service and the tools use."""
import pytest
from pydantic import ValidationError

from epichat.params import paths
from epichat.params.registry import REGISTRY, REGISTRY_BY_PATH
from epichat.params.schema_v2 import Duration, Seed, SimParamsV2, sim_days


def v2(**over) -> SimParamsV2:
    return SimParamsV2.model_validate(over)


def test_defaults_match_the_registry_on_every_leaf():
    dumped = paths.flatten(v2().model_dump())
    for spec in REGISTRY:
        if spec.path.startswith("interventions[]") or (spec.default is None and spec.path not in dumped):
            continue
        assert dumped[spec.path] == spec.default, spec.path
    assert dumped["disease.dur_inf.mean_days"] == 10.0 and dumped["disease.dur_inf.dist"] == "constant"
    assert dumped["disease.seed.value"] == 0.01 and dumped["schema_version"] == 2


def test_every_leaf_has_exactly_one_param_spec():
    full = v2(disease={"model": "seirs", "dur_exp": {"mean_days": 3}, "dur_immune": {"mean_days": 90}},
              interventions=[{"type": "treatment", "capacity": 5}]).model_dump()
    leaves = {p for p in paths.flatten(full) if not p.startswith("interventions")} - {"schema_version"}
    registered = {p for p in REGISTRY_BY_PATH if not p.startswith("interventions[]")}
    assert leaves == registered
    assert {p.split(".", 1)[1] for p in REGISTRY_BY_PATH if p.startswith("interventions[]")} == {"type", "coverage", "start_day", "capacity", "scale", "shift"}


def test_bounds_come_from_the_registry():
    with pytest.raises(ValidationError, match="disease.dur_inf.mean_days must be between 0.5 and 365 days"):
        v2(disease={"dur_inf": {"mean_days": 400}})
    with pytest.raises(ValidationError, match="n_agents"):
        v2(run={"n_agents": 5})
    with pytest.raises(ValidationError):
        v2(disease={"beta": 0.0001})
    assert v2(disease={"beta": 1000}).disease.beta == 1000


def test_duration_validators():
    assert Duration(mean_days=10).dist == "constant" and Duration(mean_days=10).sd_days is None
    with pytest.raises(ValidationError, match="sd_days is required when dist is 'gamma'"):
        Duration(mean_days=10, dist="gamma")
    with pytest.raises(ValidationError, match="at most 2"):
        Duration(mean_days=10, dist="gamma", sd_days=25)
    assert Duration(mean_days=10, dist="lognormal", sd_days=4).sd_days == 4


def test_seed_validators():
    assert Seed(value=0.05).mode == "fraction" and Seed(value=0.05).day == 0
    with pytest.raises(ValidationError, match="between 0 and 1"):
        Seed(value=1.0)
    with pytest.raises(ValidationError, match="integer count"):
        Seed(mode="count", value=2.5)
    assert Seed(mode="count", value=20).value == 20
    with pytest.raises(ValidationError, match="disease.seed.value .* run.n_agents"):
        v2(disease={"seed": {"mode": "count", "value": 500}}, run={"n_agents": 100})
    with pytest.raises(ValidationError, match="disease.seed.day"):
        v2(disease={"seed": {"value": 0.01, "day": 400}}, run={"sim_dur_years": 0.5})


def test_model_requirements_name_the_path():
    with pytest.raises(ValidationError, match="disease.dur_exp is required when disease.model is 'seir', 'seirs', or 'seiar'"):
        v2(disease={"model": "seir"})
    with pytest.raises(ValidationError, match="disease.dur_immune is required"):
        v2(disease={"model": "sirs"})
    p = v2(disease={"model": "seirs", "dur_exp": {"mean_days": 3}, "dur_immune": {"mean_days": 90}})
    assert p.disease.dur_exp.mean_days == 3 and p.disease.dur_immune.dist == "constant"


def test_day_zero_vaccine_becomes_initial_immunity():
    p = v2(interventions=[{"type": "vaccination", "coverage": 0.6, "start_day": 0}, {"type": "treatment", "capacity": 5}])
    assert p.disease.initial_immune_frac == 0.6 and [i.type for i in p.interventions] == ["treatment"]
    assert v2(interventions=[{"type": "vaccine", "coverage": 1.0}]).disease.initial_immune_frac == 0.99
    later = v2(interventions=[{"type": "vaccine", "coverage": 0.6, "start_day": 30}])
    assert later.disease.initial_immune_frac == 0.0 and later.interventions[0].start_day == 30
    assert v2(disease={"initial_immune_frac": 0.6}, interventions=[{"type": "vaccine", "coverage": 0.6}]).disease.initial_immune_frac == 0.6
    with pytest.raises(ValidationError, match="initial_immune_frac"):
        v2(disease={"initial_immune_frac": 0.3}, interventions=[{"type": "vaccine", "coverage": 0.6}])


def test_per_contact_probability_cannot_exceed_one():
    with pytest.raises(ValidationError, match="network.network_beta"):
        v2(disease={"beta": 1000}, network={"network_beta": 10})
    assert v2(disease={"beta": 1000}, network={"network_beta": 1.0}).network.network_beta == 1.0


def test_demographics_keep_the_v1_rules():
    with pytest.raises(ValidationError, match="sum to 100"):
        v2(demographics={"age_pct_under18": 10, "age_pct_18_64": 10, "age_pct_over65": 10})
    assert v2(demographics={"country": "ken"}).demographics.country == "KEN"
    assert v2(demographics={"country": "Brazil"}).demographics.country is None


def test_sim_days_rounds_years_to_whole_days():
    assert sim_days(1.0) == 365 and sim_days(30 / 365) == 30 and sim_days(0.001) == 1 and sim_days(2.0) == 730


def test_dumps_round_trip():
    p = v2(disease={"model": "seiar", "dur_exp": {"mean_days": 5, "dist": "gamma", "sd_days": 2}}, run={"n_replicates": 3})
    assert SimParamsV2.model_validate(p.model_dump()) == p
    assert p.model_dump(mode="json")["disease"]["dur_exp"] == {"mean_days": 5.0, "dist": "gamma", "sd_days": 2.0}


def test_path_helpers():
    d = {"a": {"b": 1, "c": {"d": [1, 2]}}, "e": None}
    assert paths.flatten(d) == {"a.b": 1, "a.c.d": [1, 2], "e": None}
    assert paths.get_path(d, "a.c.d") == [1, 2] and paths.get_path(d, "a.x") is None
    paths.set_path(d, "a.c.f", 3)
    paths.set_path(d, "g.h", 4)
    assert d["a"]["c"]["f"] == 3 and d["g"] == {"h": 4}
    assert paths.diff({"a": {"b": 1}, "x": 2}, {"a": {"b": 5}, "x": 2, "y": [1]}) == [
        {"field": "a.b", "from": 1, "to": 5}, {"field": "y", "from": None, "to": [1]}]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_schema_v2.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'epichat.params.paths'`

- [ ] **Step 3: Write the path helpers and the schema**

`epichat/params/paths.py`:

```python
"""Dotted paths over nested parameter dicts ("disease.dur_inf.mean_days")."""
from __future__ import annotations

from typing import Any


def flatten(d: dict, prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in d.items():
        path = f"{prefix}{key}"
        if isinstance(value, dict):
            out.update(flatten(value, f"{path}."))
        else:
            out[path] = value
    return out


def get_path(d: dict, path: str) -> Any:
    node: Any = d
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def set_path(d: dict, path: str, value: Any) -> None:
    parts = path.split(".")
    node = d
    for part in parts[:-1]:
        if not isinstance(node.get(part), dict):
            node[part] = {}
        node = node[part]
    node[parts[-1]] = value


def diff(before: dict, after: dict) -> list[dict]:
    old, new = flatten(before), flatten(after)
    changes = [{"field": k, "from": old[k], "to": new.get(k)} for k in old if old[k] != new.get(k)]
    changes += [{"field": k, "from": None, "to": new[k]} for k in new if k not in old]
    return changes
```

`epichat/params/schema_v2.py`:

```python
"""SimParamsV2: the nested parameter schema (spec 6, revised by 17 and 18).
Defaults and inclusive bounds come from the registry, so the two cannot
disagree; the validators carry the rules the registry cannot express."""
from __future__ import annotations

import math
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from epichat.schema import Intervention

from .registry import LATENT_MODELS, REGISTRY_BY_PATH, WANING_MODELS

Model = Literal["sir", "seir", "sis", "sirs", "seirs", "seiar"]
Dist = Literal["constant", "lognormal", "gamma"]


def sim_days(sim_dur_years: float) -> int:
    return max(1, int(round(365 * sim_dur_years)))


def _field(path: str, **extra):
    spec = REGISTRY_BY_PATH[path]
    kw: dict = {"default": spec.default}
    if spec.bounds is not None:
        kw["ge"], kw["le"] = spec.bounds
    kw.update(extra)
    return Field(**kw)


def _check_bounds(path: str, value: float | None) -> None:
    if value is None:
        return
    lo, hi = REGISTRY_BY_PATH[path].bounds
    if not lo <= value <= hi:
        unit = REGISTRY_BY_PATH[path].unit or ""
        raise ValueError(f"{path} must be between {lo:g} and {hi:g} {unit}".rstrip())


class Duration(BaseModel):
    mean_days: float = Field(gt=0)
    dist: Dist = "constant"
    sd_days: Optional[float] = Field(default=None, gt=0)

    @model_validator(mode="after")
    def check_sd(self) -> "Duration":
        if self.dist != "constant" and self.sd_days is None:
            raise ValueError(f"sd_days is required when dist is '{self.dist}'")
        if self.sd_days is not None and self.sd_days > 2 * self.mean_days:
            raise ValueError("sd_days must be at most 2 × mean_days")
        return self


class Seed(BaseModel):
    mode: Literal["fraction", "count"] = "fraction"
    value: float = Field(gt=0)
    day: int = _field("disease.seed.day")

    @model_validator(mode="after")
    def check_value(self) -> "Seed":
        if self.mode == "fraction" and not 0 < self.value < 1:
            raise ValueError("value must be between 0 and 1 (exclusive) when mode is 'fraction'")
        if self.mode == "count" and (self.value < 1 or self.value != int(self.value)):
            raise ValueError("value must be an integer count of at least 1 when mode is 'count'")
        return self


class DiseaseParams(BaseModel):
    model: Model = "sir"
    beta: float = _field("disease.beta")
    dur_exp: Optional[Duration] = None
    dur_inf: Duration = Field(default_factory=lambda: Duration(mean_days=10.0))
    dur_immune: Optional[Duration] = None
    p_death: float = _field("disease.p_death")
    p_asymp: float = _field("disease.p_asymp")
    rel_trans_asymp: float = _field("disease.rel_trans_asymp")
    sis_waning: float = _field("disease.sis_waning")
    sis_imm_boost: float = _field("disease.sis_imm_boost")
    seed: Seed = Field(default_factory=lambda: Seed(value=0.01))
    initial_immune_frac: float = _field("disease.initial_immune_frac")

    @model_validator(mode="after")
    def check_model_requirements(self) -> "DiseaseParams":
        if self.model in LATENT_MODELS and self.dur_exp is None:
            raise ValueError("disease.dur_exp is required when disease.model is 'seir', 'seirs', or 'seiar'")
        if self.model in WANING_MODELS and self.dur_immune is None:
            raise ValueError("disease.dur_immune is required when disease.model is 'sirs' or 'seirs'")
        for name in ("dur_exp", "dur_inf", "dur_immune"):
            duration = getattr(self, name)
            if duration is not None:
                _check_bounds(f"disease.{name}.mean_days", duration.mean_days)
                _check_bounds(f"disease.{name}.sd_days", duration.sd_days)
        return self


class NetworkParams(BaseModel):
    network_type: Literal["random", "age_structured"] = "random"
    n_contacts: int = _field("network.n_contacts")
    network_beta: float = _field("network.network_beta")


class DemographicsParams(BaseModel):
    use_demographics: bool = False
    birth_rate: float = _field("demographics.birth_rate")
    death_rate: float = _field("demographics.death_rate")
    age_pct_under18: Optional[float] = _field("demographics.age_pct_under18")
    age_pct_18_64: Optional[float] = _field("demographics.age_pct_18_64")
    age_pct_over65: Optional[float] = _field("demographics.age_pct_over65")
    country: Optional[str] = None
    auto_demographics: bool = True
    demographics_year: int = _field("demographics.demographics_year")
    demographics_source: Optional[str] = None

    @model_validator(mode="after")
    def check_age_pcts_sum(self) -> "DemographicsParams":
        pcts = [self.age_pct_under18, self.age_pct_18_64, self.age_pct_over65]
        if all(x is not None for x in pcts):
            total = sum(pcts)
            if abs(total - 100.0) > 1.0:
                raise ValueError(f"age_pct fields must sum to 100 (got {total:.1f})")
        return self

    @field_validator("country")
    @classmethod
    def normalize_country(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip().upper()
        return v if len(v) == 3 and v.isalpha() else None


class RunParams(BaseModel):
    n_agents: int = _field("run.n_agents")
    sim_dur_years: float = _field("run.sim_dur_years")
    rand_seed: Optional[int] = None
    n_replicates: int = _field("run.n_replicates")


class SimParamsV2(BaseModel):
    schema_version: Literal[2] = 2
    disease: DiseaseParams = Field(default_factory=DiseaseParams)
    network: NetworkParams = Field(default_factory=NetworkParams)
    demographics: DemographicsParams = Field(default_factory=DemographicsParams)
    interventions: list[Intervention] = Field(default_factory=list)
    run: RunParams = Field(default_factory=RunParams)

    @model_validator(mode="after")
    def check_cross_fields(self) -> "SimParamsV2":
        seed = self.disease.seed
        if seed.mode == "count" and seed.value > self.run.n_agents:
            raise ValueError(f"disease.seed.value ({seed.value:g}) must not exceed run.n_agents ({self.run.n_agents})")
        days = sim_days(self.run.sim_dur_years)
        if seed.day > days:
            raise ValueError(f"disease.seed.day ({seed.day}) must be within the simulation ({days} days)")
        if self.network.network_beta * (1 - math.exp(-self.disease.beta / 365.0)) > 1.0:
            raise ValueError("network.network_beta × (1 - exp(-disease.beta / 365)) must not exceed 1: lower network.network_beta or disease.beta")
        day0 = [i for i in self.interventions if i.type == "vaccine" and i.start_day <= 0]
        if day0:
            coverage = min(day0[-1].coverage or 0.0, 0.99)
            if self.disease.initial_immune_frac > 0 and abs(self.disease.initial_immune_frac - coverage) > 1e-9:
                raise ValueError("a vaccine with start_day 0 and disease.initial_immune_frac were both given with different values; set one of them")
            self.disease.initial_immune_frac = coverage
            self.interventions = [i for i in self.interventions if not (i.type == "vaccine" and i.start_day <= 0)]
        return self
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_schema_v2.py tests/test_param_registry.py -q`
Expected: 19 passed

- [ ] **Step 5: Commit**

```bash
git add epichat/params/schema_v2.py epichat/params/paths.py tests/test_schema_v2.py
git commit -m "feat(params): SimParamsV2 with registry-generated bounds, and dotted-path helpers (spec 6)"
```

### Task 3: Migration from v1

**Files:**
- Create: `epichat/params/migrate.py`
- Test: `tests/test_param_migrate.py`

**Interfaces:**
- Consumes: `SimParamsV2` from Task 2.
- Produces: `is_v1(data: dict) -> bool`; `migrate_v1(flat: dict) -> dict` (a v2-shaped dict, not yet validated); `coerce_params(data: dict | SimParamsV2) -> SimParamsV2` (v1 or v2 in, validated v2 out; raises `pydantic.ValidationError`). Every later task that accepts parameters from outside the package (the child process, the service, the fixtures) goes through `coerce_params`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_param_migrate.py
"""Spec 6.1: v1 flat params become v2 with constant durations and the day-0
vaccine folded into initial_immune_frac; the result builds and runs (Task 10)."""
import pytest
from pydantic import ValidationError

from epichat.params.migrate import coerce_params, is_v1, migrate_v1
from epichat.params.schema_v2 import SimParamsV2
from template_cases import cases


def test_is_v1_means_no_schema_version():
    assert is_v1({"beta": 1.0}) and not is_v1({"schema_version": 2})


def test_durations_become_constant_and_seed_keeps_init_prev():
    p = coerce_params({"disease_type": "seirs", "beta": 12.5, "dur_inf": 7.0, "dur_exp": 4.0, "dur_immune": 90.0, "init_prev": 0.02,
                       "n_agents": 2000, "sim_dur_years": 0.5, "rand_seed": 9, "p_death": 0.1})
    assert p.disease.model == "seirs" and p.disease.beta == 12.5
    assert p.disease.dur_inf.model_dump() == {"mean_days": 7.0, "dist": "constant", "sd_days": None}
    assert p.disease.dur_exp.mean_days == 4.0 and p.disease.dur_immune.mean_days == 90.0
    assert p.disease.seed.model_dump() == {"mode": "fraction", "value": 0.02, "day": 0}
    assert p.run.model_dump() == {"n_agents": 2000, "sim_dur_years": 0.5, "rand_seed": 9, "n_replicates": 1}
    assert p.disease.p_death == 0.1 and p.disease.sis_waning == 0.0 and p.disease.initial_immune_frac == 0.0


def test_missing_optional_v1_fields_take_v2_defaults():
    p = coerce_params({"beta": 22.8125})
    assert p.disease.dur_inf.mean_days == 10.0 and p.disease.seed.value == 0.01 and p.run.n_agents == 10000
    assert p.disease.dur_exp is None and p.network.n_contacts == 4 and p.demographics.use_demographics is False


@pytest.mark.parametrize("name", sorted(cases()))
def test_every_template_case_migrates(name):
    v1 = cases()[name].model_dump()
    p = coerce_params(v1)
    assert p.disease.model == name
    types = [i.type for i in p.interventions]
    vaccine = next(i for i in v1["interventions"] if i["type"] == "vaccine")
    if vaccine["start_day"] == 0:
        assert p.disease.initial_immune_frac == 0.3 and "vaccine" not in types
    else:
        assert p.disease.initial_immune_frac == 0.0 and "vaccine" in types
    assert "treatment" in types and "seasonality" in types
    if name == "seiar":
        assert p.network.network_type == "age_structured" and p.demographics.age_pct_under18 == 30.0
        assert p.demographics.use_demographics and p.demographics.birth_rate == 25.0


def test_day_zero_vaccine_with_full_coverage_is_clamped_not_rejected():
    p = coerce_params({"beta": 5.0, "interventions": [{"type": "vaccination", "coverage": 1.0, "start_day": 0}]})
    assert p.disease.initial_immune_frac == 0.99 and p.interventions == []


def test_v2_input_passes_through_and_invalid_input_raises():
    v2 = SimParamsV2().model_dump()
    assert coerce_params(v2) == SimParamsV2()
    assert coerce_params(SimParamsV2()) == SimParamsV2()
    with pytest.raises(ValidationError):
        coerce_params({"beta": "ten"})
    with pytest.raises(ValidationError):
        coerce_params({"schema_version": 2, "run": {"n_agents": 1}})


def test_migrate_v1_is_a_pure_dict_transform():
    out = migrate_v1({"disease_type": "sir", "beta": 1.0, "interventions": [{"type": "vaccine", "coverage": 0.4, "start_day": 0}], "country": "KEN"})
    assert out["schema_version"] == 2 and out["disease"]["initial_immune_frac"] == 0.4 and out["interventions"] == []
    assert out["demographics"] == {"country": "KEN"} and out["network"] == {} and out["run"] == {}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_migrate.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'epichat.params.migrate'`

- [ ] **Step 3: Write the migration**

```python
# epichat/params/migrate.py
"""v1 flat parameters -> schema v2 (spec 6.1). Pinned against the TypeScript
migrateV1 by web/tests/fixtures/parity.json."""
from __future__ import annotations

from .schema_v2 import SimParamsV2

_VACCINE = ("vaccine", "vaccination", "vaccinate")
_NETWORK_KEYS = ("network_type", "n_contacts", "network_beta")
_DEMOGRAPHICS_KEYS = ("use_demographics", "birth_rate", "death_rate", "age_pct_under18", "age_pct_18_64", "age_pct_over65",
                      "country", "auto_demographics", "demographics_year", "demographics_source")
_RUN_KEYS = ("n_agents", "sim_dur_years", "rand_seed")


def is_v1(data: dict) -> bool:
    return "schema_version" not in data


def _duration(days):
    return None if days is None else {"mean_days": days, "dist": "constant", "sd_days": None}


def _is_day0_vaccine(i: dict) -> bool:
    return str(i.get("type", "")).lower() in _VACCINE and int(i.get("start_day") or 0) <= 0


def migrate_v1(flat: dict) -> dict:
    f = dict(flat)
    interventions = [dict(i) for i in f.get("interventions") or []]
    day0 = [i for i in interventions if _is_day0_vaccine(i)]
    disease = {
        "model": f.get("disease_type", "sir"),
        "beta": f.get("beta", 22.8125),
        "dur_exp": _duration(f.get("dur_exp")),
        "dur_inf": _duration(f.get("dur_inf", 10.0)),
        "dur_immune": _duration(f.get("dur_immune")),
        "p_death": f.get("p_death", 0.0),
        "p_asymp": f.get("p_asymp", 0.3),
        "rel_trans_asymp": f.get("rel_trans_asymp", 0.5),
        "sis_waning": 0.0,
        "sis_imm_boost": 0.0,
        "seed": {"mode": "fraction", "value": f.get("init_prev", 0.01), "day": 0},
        "initial_immune_frac": min(float(day0[-1].get("coverage") or 0.0), 0.99) if day0 else 0.0,
    }
    return {
        "schema_version": 2,
        "disease": disease,
        "network": {k: f[k] for k in _NETWORK_KEYS if k in f},
        "demographics": {k: f[k] for k in _DEMOGRAPHICS_KEYS if k in f},
        "interventions": [i for i in interventions if not _is_day0_vaccine(i)],
        "run": {k: f[k] for k in _RUN_KEYS if k in f},
    }


def coerce_params(data) -> SimParamsV2:
    if isinstance(data, SimParamsV2):
        return data
    if isinstance(data, dict) and is_v1(data):
        data = migrate_v1(data)
    return SimParamsV2.model_validate(data)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_migrate.py -q`
Expected: 11 passed

- [ ] **Step 5: Commit**

```bash
git add epichat/params/migrate.py tests/test_param_migrate.py
git commit -m "feat(params): migrate v1 flat parameters to schema v2 (spec 6.1)"
```

### Task 4: Exact R0 (Python)

**Files:**
- Create: `epichat/params/r0.py`
- Test: `tests/test_param_r0.py`

**Interfaces:**
- Consumes: `SimParamsV2`, `DiseaseParams`, `Duration` from Task 2; `LATENT_MODELS` from Task 1.
- Produces: `CONTACT_MATRIX` (numpy 3×3), `CONTACT_SPECTRAL_RADIUS` (float, 11.0028224279…), `per_contact_prob(beta) -> float`, `asymp_factor(d: DiseaseParams) -> float`, `effective_days(d: DiseaseParams) -> float`, `contact_scale(p: SimParamsV2) -> float` (the R0 reached if every contact transmitted), `approx_r0(p) -> float`, `max_r0(p) -> float` (= `contact_scale`), `calibrate_beta(p, target_r0) -> float` (raises `R0Unreachable(target, maximum, levers)`), `clamp_beta(beta) -> float`, `with_r0(p, target_r0) -> SimParamsV2`, `recalibrate_beta(p, r0_before, before) -> SimParamsV2` (unchanged beta when unreachable). `R0Unreachable.levers` is a tuple of registry paths.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_param_r0.py
"""Spec 7.4 as revised by section 18: R0 from Starsim's exact per-contact
probability and the effective transmitting days, on both networks."""
import math

import pytest

from epichat.params import r0
from epichat.params.migrate import coerce_params
from epichat.params.schema_v2 import SimParamsV2


def v2(**over) -> SimParamsV2:
    return SimParamsV2.model_validate(over)


def test_per_contact_probability_and_spectral_radius():
    assert r0.per_contact_prob(365.0) == pytest.approx(1 - math.exp(-1))
    assert r0.CONTACT_SPECTRAL_RADIUS == pytest.approx(11.0028224279, abs=1e-9)


def test_effective_days_follow_section_7_4():
    sir_const = v2(disease={"dur_inf": {"mean_days": 10}})
    sir_gamma = v2(disease={"dur_inf": {"mean_days": 10, "dist": "gamma", "sd_days": 4}})
    seir_both_const = v2(disease={"model": "seir", "dur_exp": {"mean_days": 5}, "dur_inf": {"mean_days": 10}})
    seir_exp_const = v2(disease={"model": "seir", "dur_exp": {"mean_days": 5}, "dur_inf": {"mean_days": 10, "dist": "gamma", "sd_days": 4}})
    seir_exp_gamma = v2(disease={"model": "seir", "dur_exp": {"mean_days": 5, "dist": "gamma", "sd_days": 2}, "dur_inf": {"mean_days": 10}})
    assert r0.effective_days(sir_const.disease) == 9
    assert r0.effective_days(sir_gamma.disease) == 9.5
    assert r0.effective_days(seir_both_const.disease) == 10
    assert r0.effective_days(seir_exp_const.disease) == 10.5
    assert r0.effective_days(seir_exp_gamma.disease) == 10
    assert r0.effective_days(v2(disease={"dur_inf": {"mean_days": 5.5}}).disease) == 5      # ceil(5.5) - 1
    assert r0.effective_days(v2(disease={"dur_inf": {"mean_days": 0.5}}).disease) == 0      # never transmits on a daily step


def test_random_network_r0_and_calibration_round_trip():
    p = v2(disease={"beta": 22.8125, "dur_inf": {"mean_days": 10}}, network={"n_contacts": 4})
    expected = 4 * (1 - math.exp(-22.8125 / 365)) * 9
    assert r0.approx_r0(p) == pytest.approx(expected)
    assert r0.max_r0(p) == 36.0
    for target in (1.5, 2.5, 4.0, 15.0):
        beta = r0.calibrate_beta(p, target)
        assert r0.approx_r0(r0.with_r0(p, target)) == pytest.approx(target, rel=1e-6)
        assert beta > 0


def test_seiar_asymptomatic_factor_enters_exactly():
    p = v2(disease={"model": "seiar", "dur_exp": {"mean_days": 5}, "p_asymp": 0.4, "rel_trans_asymp": 0.5})
    plain = v2(disease={"model": "seir", "dur_exp": {"mean_days": 5}})
    assert r0.asymp_factor(p.disease) == pytest.approx(0.8) and r0.asymp_factor(plain.disease) == 1.0
    assert r0.approx_r0(p) == pytest.approx(0.8 * r0.approx_r0(plain))


def test_age_structured_r0_ignores_shares_and_n_contacts():
    base = v2(network={"network_type": "age_structured", "n_contacts": 4})
    shares = v2(network={"network_type": "age_structured", "n_contacts": 40},
                demographics={"age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8})
    expected = r0.CONTACT_SPECTRAL_RADIUS * (1 - math.exp(-22.8125 / 365)) * 9
    assert r0.approx_r0(base) == pytest.approx(expected) and r0.approx_r0(shares) == pytest.approx(expected)
    scaled = v2(network={"network_type": "age_structured", "network_beta": 0.5})
    assert r0.approx_r0(scaled) == pytest.approx(expected / 2)
    assert r0.approx_r0(r0.with_r0(shares, 2.5)) == pytest.approx(2.5, rel=1e-6)


def test_unreachable_r0_names_the_maximum_and_the_levers():
    p = v2(network={"n_contacts": 2}, disease={"dur_inf": {"mean_days": 3}})      # max = 2 × 2 = 4
    with pytest.raises(r0.R0Unreachable) as e:
        r0.calibrate_beta(p, 4.0)
    assert e.value.maximum == 4.0 and e.value.target == 4.0
    assert e.value.levers == ("network.n_contacts", "disease.dur_inf.mean_days")
    short = v2(disease={"dur_inf": {"mean_days": 0.8}})
    with pytest.raises(r0.R0Unreachable) as e2:
        r0.calibrate_beta(short, 1.0)
    assert e2.value.maximum == 0.0
    aged = v2(network={"network_type": "age_structured"}, disease={"dur_inf": {"mean_days": 1}})
    with pytest.raises(r0.R0Unreachable) as e3:
        r0.calibrate_beta(aged, 1.0)
    assert e3.value.levers == ("network.network_beta", "disease.dur_inf.mean_days")


def test_clamp_beta_rounds_like_the_agent():
    assert r0.clamp_beta(0.00001) == 0.001 and r0.clamp_beta(5000) == 1000.0
    assert r0.clamp_beta(12.3456789) == 12.345679


def test_recalibrate_holds_r0_across_a_network_switch_and_recovers_a_changed_beta():
    before = r0.with_r0(v2(), 3.0)
    switched = before.model_copy(deep=True)
    switched.network.network_type = "age_structured"
    held = r0.recalibrate_beta(switched, 3.0, before)
    assert r0.approx_r0(held) == pytest.approx(3.0, rel=1e-6) and held.disease.beta != before.disease.beta
    raised = before.model_copy(deep=True)
    raised.disease.beta = round(before.disease.beta * 1.7, 4)
    intended = 4 * (1 - math.exp(-raised.disease.beta / 365)) * 9
    assert r0.approx_r0(r0.recalibrate_beta(raised, 3.0, before)) == pytest.approx(intended, rel=1e-6)
    stuck = v2(network={"n_contacts": 1}, disease={"dur_inf": {"mean_days": 2}})       # max 1
    assert r0.recalibrate_beta(stuck, 3.0, before).disease.beta == stuck.disease.beta


def test_migrated_v1_params_calibrate_without_the_population_weighting():
    p = coerce_params({"beta": 100.0, "network_type": "age_structured", "dur_inf": 10.0,
                       "age_pct_under18": 42.0, "age_pct_18_64": 55.0, "age_pct_over65": 3.0})
    assert r0.approx_r0(p) == pytest.approx(r0.CONTACT_SPECTRAL_RADIUS * (1 - math.exp(-100 / 365)) * 9)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_r0.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'epichat.params.r0'`

- [ ] **Step 3: Write the R0 module**

```python
# epichat/params/r0.py
"""R0 and beta on schema v2 (spec 7.4, revised by section 18).

Starsim transmits per contact per day with probability
p = network_beta × (1 − exp(−beta / 365)); an agent transmits on D_eff days
(7.4). On the random network R0 = n_contacts × p × D_eff × asymp_factor; on
the age-structured MixingPools network the next-generation matrix is similar
to the contact matrix, so R0 = rho(C) × p × D_eff × asymp_factor whatever the
age shares (section 18). The v1 functions in epichat/schema.py and parser.py
keep the linear approximation for the frozen Python agent."""
from __future__ import annotations

import math

import numpy as np

from .registry import LATENT_MODELS
from .schema_v2 import DiseaseParams, SimParamsV2

CONTACT_MATRIX = np.array([[7.0, 2.5, 0.5], [2.5, 9.0, 1.5], [0.5, 1.5, 3.5]])
CONTACT_SPECTRAL_RADIUS = float(np.linalg.eigvals(CONTACT_MATRIX).real.max())
RANDOM_LEVERS = ("network.n_contacts", "disease.dur_inf.mean_days")
AGE_LEVERS = ("network.network_beta", "disease.dur_inf.mean_days")


class R0Unreachable(ValueError):
    def __init__(self, target: float, maximum: float, levers: tuple[str, ...]):
        self.target, self.maximum, self.levers = target, maximum, levers
        super().__init__(f"R0 {target:g} is not reachable: the most the contacts and infectious period can carry is "
                         f"{maximum:.2f}; raise {' or '.join(levers)}")


def per_contact_prob(beta: float) -> float:
    return 1.0 - math.exp(-beta / 365.0)


def asymp_factor(d: DiseaseParams) -> float:
    return 1.0 - d.p_asymp * (1.0 - d.rel_trans_asymp) if d.model == "seiar" else 1.0


def effective_days(d: DiseaseParams) -> float:
    inf = d.dur_inf
    if d.model in LATENT_MODELS:
        exp = d.dur_exp
        if exp.dist == "constant" and inf.dist == "constant":
            days = math.ceil(exp.mean_days + inf.mean_days) - math.ceil(exp.mean_days)
        elif exp.dist == "constant":
            days = inf.mean_days + 0.5
        else:
            days = inf.mean_days
    elif inf.dist == "constant":
        days = math.ceil(inf.mean_days) - 1
    else:
        days = inf.mean_days - 0.5
    return max(0.0, float(days))


def contact_scale(p: SimParamsV2) -> float:
    n = p.network
    contacts = CONTACT_SPECTRAL_RADIUS if n.network_type == "age_structured" else n.n_contacts
    return contacts * n.network_beta * effective_days(p.disease) * asymp_factor(p.disease)


def approx_r0(p: SimParamsV2) -> float:
    return contact_scale(p) * per_contact_prob(p.disease.beta)


def max_r0(p: SimParamsV2) -> float:
    return contact_scale(p)


def calibrate_beta(p: SimParamsV2, target_r0: float) -> float:
    scale = contact_scale(p)
    if scale <= 0 or target_r0 >= scale:
        raise R0Unreachable(target_r0, scale, AGE_LEVERS if p.network.network_type == "age_structured" else RANDOM_LEVERS)
    return -365.0 * math.log(1.0 - target_r0 / scale)


def clamp_beta(beta: float) -> float:
    return round(min(1000.0, max(0.001, beta)), 6)


def with_r0(p: SimParamsV2, target_r0: float) -> SimParamsV2:
    out = p.model_copy(deep=True)
    out.disease.beta = clamp_beta(calibrate_beta(p, target_r0))
    return out


def recalibrate_beta(p: SimParamsV2, r0_before: float, before: SimParamsV2) -> SimParamsV2:
    """After a change, hold the R0 the user confirmed; a changed beta means a new
    intended R0, read with the random-network formula as the v1 agent did."""
    if abs(p.disease.beta - before.disease.beta) > 1e-4:
        n = p.network
        target = n.n_contacts * n.network_beta * effective_days(p.disease) * asymp_factor(p.disease) * per_contact_prob(p.disease.beta)
    else:
        target = r0_before
    try:
        return with_r0(p, target)
    except R0Unreachable:
        return p
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_r0.py -q`
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add epichat/params/r0.py tests/test_param_r0.py
git commit -m "feat(params): exact R0 and beta calibration on both networks (spec 7.4, section 18)"
```

### Task 5: Demographics resolution and the repair loop on v2

**Files:**
- Create: `epichat/params/resolve.py`, `epichat/params/repair.py`
- Test: `tests/test_param_resolve.py`, `tests/test_param_repair.py`

**Interfaces:**
- Consumes: `SimParamsV2`, `NetworkParams`, `DemographicsParams` (Task 2); `coerce_params` (Task 3); `approx_r0`, `calibrate_beta`, `clamp_beta`, `R0Unreachable` (Task 4); `epichat.data_loaders.demographics.get_country_demographics` and `epichat.data_loaders.contact_matrices.get_mean_contacts` (existing).
- Produces: `resolve.resolve_demographics(params: SimParamsV2) -> SimParamsV2` (pure: returns a new object); `repair.RepairResult` dataclass (`params: SimParamsV2, model: str, input_tokens: int, output_tokens: int`); `repair.repair_params(user_input: str, params: SimParamsV2, error_message: str, model: str) -> RepairResult`. The service (Task 12) swaps its imports to these.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_param_resolve.py
"""The v2 port of generator.resolve_demographics: fill country data into
defaults and re-solve beta for the held R0 with the exact formula."""
from unittest.mock import patch

from epichat.params import r0
from epichat.params.resolve import resolve_demographics
from epichat.params.schema_v2 import SimParamsV2

DEMO = {"birth_rate": 28.1, "death_rate": 7.9, "source": "UN WPP 2024"}


def v2(**over) -> SimParamsV2:
    return SimParamsV2.model_validate(over)


def test_without_a_country_or_with_auto_off_nothing_changes():
    p = v2()
    assert resolve_demographics(p) == p
    off = v2(demographics={"country": "KEN", "auto_demographics": False})
    assert resolve_demographics(off) == off


def test_fills_default_rates_and_holds_r0_when_contacts_change():
    p = r0.with_r0(v2(demographics={"country": "KEN"}), 3.0)
    with patch("epichat.data_loaders.demographics.get_country_demographics", return_value=DEMO), \
         patch("epichat.data_loaders.contact_matrices.get_mean_contacts", return_value=11.6):
        out = resolve_demographics(p)
    assert out.demographics.birth_rate == 28.1 and out.demographics.death_rate == 7.9
    assert out.demographics.use_demographics is True and out.demographics.demographics_source == "UN WPP 2024"
    assert out.network.n_contacts == 12
    assert r0.approx_r0(out) == __import__("pytest").approx(3.0, rel=1e-5)
    assert p.network.n_contacts == 4            # the input is untouched


def test_user_values_are_left_alone():
    p = v2(demographics={"country": "KEN", "birth_rate": 15.0}, network={"n_contacts": 6})
    with patch("epichat.data_loaders.demographics.get_country_demographics", return_value=DEMO), \
         patch("epichat.data_loaders.contact_matrices.get_mean_contacts", return_value=11.6):
        out = resolve_demographics(p)
    assert out.demographics.birth_rate == 15.0 and out.demographics.death_rate == 7.9
    assert out.network.n_contacts == 6 and out.disease.beta == p.disease.beta


def test_lookup_failures_keep_the_defaults():
    p = v2(demographics={"country": "ZZZ"})
    with patch("epichat.data_loaders.demographics.get_country_demographics", side_effect=ValueError("no data")), \
         patch("epichat.data_loaders.contact_matrices.get_mean_contacts", side_effect=RuntimeError("no matrix")):
        out = resolve_demographics(p)
    assert out.demographics.use_demographics is False and out.network.n_contacts == 4


def test_unreachable_r0_after_a_contacts_change_keeps_beta():
    p = v2(demographics={"country": "KEN"}, disease={"beta": 1000.0, "dur_inf": {"mean_days": 2}})     # R0 ≈ 3.7 at 4 contacts
    with patch("epichat.data_loaders.demographics.get_country_demographics", return_value=DEMO), \
         patch("epichat.data_loaders.contact_matrices.get_mean_contacts", return_value=1.0):
        out = resolve_demographics(p)
    assert out.network.n_contacts == 1 and out.disease.beta == 1000.0
```

```python
# tests/test_param_repair.py
"""The v2 repair loop: same prompt as parser.repair_params, v2 schema, and a
v1-shaped answer is migrated rather than rejected."""
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from epichat.params.repair import RepairResult, repair_params
from epichat.params.schema_v2 import SimParamsV2


def _client(answer: str):
    message = SimpleNamespace(content=[SimpleNamespace(text=answer)], usage=SimpleNamespace(input_tokens=120, output_tokens=30))
    calls = []

    class Messages:
        def create(self, **kw):
            calls.append(kw)
            return message

    client = SimpleNamespace(messages=Messages())
    client.calls = calls
    return client


def test_repair_returns_v2_params_and_the_usage(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    p = SimParamsV2()
    fixed = p.model_dump(mode="json")
    fixed["disease"]["dur_inf"]["mean_days"] = 12.0
    client = _client("```json\n" + json.dumps(fixed) + "\n```")
    with patch("epichat.params.repair.anthropic.Anthropic", return_value=client):
        out = repair_params("measles in Kenya", p, "Traceback: ValueError", "claude-opus-5-5")
    assert isinstance(out, RepairResult) and out.params.disease.dur_inf.mean_days == 12.0
    assert out.model == "claude-opus-5-5" and out.input_tokens == 120 and out.output_tokens == 30
    prompt = client.calls[0]["messages"][0]["content"]
    assert "measles in Kenya" in prompt and "Traceback: ValueError" in prompt and '"schema_version": 2' in prompt
    assert client.calls[0]["model"] == "claude-opus-5-5"


def test_a_v1_shaped_answer_is_migrated(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    client = _client(json.dumps({"disease_type": "seir", "beta": 5.0, "dur_exp": 3.0}))
    with patch("epichat.params.repair.anthropic.Anthropic", return_value=client):
        out = repair_params("x", SimParamsV2(), "err", "m")
    assert out.params.disease.model == "seir" and out.params.disease.dur_exp.mean_days == 3.0


def test_an_invalid_answer_raises_validation_error(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    client = _client(json.dumps({"schema_version": 2, "run": {"n_agents": 1}}))
    with patch("epichat.params.repair.anthropic.Anthropic", return_value=client), pytest.raises(ValidationError):
        repair_params("x", SimParamsV2(), "err", "m")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_resolve.py tests/test_param_repair.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'epichat.params.resolve'`

- [ ] **Step 3: Write both modules**

```python
# epichat/params/resolve.py
"""Country-driven demographics on schema v2 (the v2 port of
generator.resolve_demographics). Values still at their defaults are filled
from country data; when the contact count changes, beta is re-solved for the
R0 the scenario had, with the exact formula (spec 7.4)."""
from __future__ import annotations

import logging

from .r0 import R0Unreachable, approx_r0, calibrate_beta, clamp_beta
from .schema_v2 import DemographicsParams, NetworkParams, SimParamsV2

logger = logging.getLogger(__name__)


def resolve_demographics(params: SimParamsV2) -> SimParamsV2:
    d = params.demographics
    if not d.country or not d.auto_demographics:
        return params
    p = params.model_copy(deep=True)
    defaults = DemographicsParams()
    try:
        from epichat.data_loaders.demographics import get_country_demographics
        demo = get_country_demographics(d.country, d.demographics_year)
        if p.demographics.birth_rate == defaults.birth_rate:
            p.demographics.birth_rate = demo["birth_rate"]
        if p.demographics.death_rate == defaults.death_rate:
            p.demographics.death_rate = demo["death_rate"]
        p.demographics.use_demographics = True
        p.demographics.demographics_source = demo["source"]
    except ValueError as e:
        logger.warning("Demographics lookup failed for %s: %s — keeping the defaults", d.country, e)

    if p.network.n_contacts == NetworkParams().n_contacts:
        try:
            from epichat.data_loaders.contact_matrices import get_mean_contacts
            n = get_mean_contacts(d.country)
        except Exception:
            logger.debug("Contact matrix lookup failed for %s", d.country, exc_info=True)
            n = None
        if n is not None and int(round(n)) != p.network.n_contacts:
            r0_before = approx_r0(p)
            p.network.n_contacts = int(round(n))
            try:
                p.disease.beta = clamp_beta(calibrate_beta(p, r0_before))
            except R0Unreachable as e:
                logger.warning("n_contacts set to %d for %s but %s; beta kept", p.network.n_contacts, d.country, e)
    return SimParamsV2.model_validate(p.model_dump())
```

```python
# epichat/params/repair.py
"""Ask the model to repair a v2 parameter set after a failed run (spec 8.8).
The prompt is parser.repair_params's; the answer may come back in either
shape and is coerced to v2."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass

import anthropic

from .migrate import coerce_params
from .schema_v2 import SimParamsV2


@dataclass
class RepairResult:
    params: SimParamsV2
    model: str
    input_tokens: int
    output_tokens: int


def _token_count(usage, name: str) -> int:
    value = getattr(usage, name, None) if usage is not None else None
    return value if isinstance(value, int) else 0


def _strip_fence(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


def repair_params(user_input: str, params: SimParamsV2, error_message: str, model: str) -> RepairResult:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    prompt = (
        f"Original query: {user_input}\n\n"
        f"Parameters used (schema v2, nested):\n{json.dumps(params.model_dump(mode='json'), indent=2)}\n\n"
        f"Starsim produced this error:\n{error_message}\n\n"
        "Please return a corrected JSON parameter object with the same nested shape that will fix the error. "
        "Return ONLY the JSON object."
    )
    message = client.messages.create(
        model=model,
        max_tokens=1024,
        system="You are an epidemiological parameter assistant. Return only valid JSON matching the parameter schema you were given.",
        messages=[{"role": "user", "content": prompt}],
    )
    data = json.loads(_strip_fence(message.content[0].text))
    usage = getattr(message, "usage", None)
    return RepairResult(params=coerce_params(data), model=model,
                        input_tokens=_token_count(usage, "input_tokens"), output_tokens=_token_count(usage, "output_tokens"))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_param_resolve.py tests/test_param_repair.py -q`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add epichat/params/resolve.py epichat/params/repair.py tests/test_param_resolve.py tests/test_param_repair.py
git commit -m "feat(params): demographics resolution and the repair loop on schema v2"
```

### Task 6: Registry export, parity fixtures v2, and the TypeScript schema v2

This task crosses the language boundary, so its deliverable is the pair: the Python exporters and the TypeScript modules they feed. The web consumers (tools, panel, report) still read the flat shape until Task 7, so the completion test here is the `web/tests/sim` subset and the root export tests; the full web suite and `npm run typecheck` are Task 7's completion test.

**Files:**
- Modify: `scripts/export_web_data.py`, `scripts/export_parity_fixtures.py`, `tests/test_web_exports.py`
- Create: `web/data/param_registry.json` (generated), `web/lib/sim/registry.ts`, `web/lib/sim/paths.ts`
- Rewrite: `web/lib/sim/params.ts`
- Test: `web/tests/sim/registry.test.ts`, `web/tests/sim/paths.test.ts`, `web/tests/sim/params.test.ts` (rewritten), `web/tests/sim/parity.test.ts` (rewritten); regenerated `web/tests/fixtures/parity.json`

**Interfaces:**
- Consumes: `registry.export()` (Task 1); `coerce_params` (Task 3); `approx_r0`, `max_r0`, `calibrate_beta`, `clamp_beta`, `recalibrate_beta`, `R0Unreachable` (Task 4); `tests/template_cases.py`.
- Produces (TypeScript): `web/lib/sim/registry.ts` exports `ParamSpec`, `PARAM_REGISTRY`, `REGISTRY_VERSION`, `specFor(path)`, `appliesTo(spec, model)`, `applicableSpecs(model)`, `boundsOf(path): [number, number]`, `defaultOf<T>(path): T`. `web/lib/sim/paths.ts` exports `flattenParams(obj)`, `getPath(obj, path)`, `setPath(obj, path, value)`, `diffParams(before, after)`. `web/lib/sim/params.ts` exports `DEFAULT_BETA`, `DISEASE_TYPES`, `LATENT_MODELS`, `WANING_MODELS`, `NETWORK_TYPES`, `INTERVENTION_TYPES`, `DISTS`, `InterventionSchema`, `DurationSchema`, `SeedSchema`, `SimParamsSchema` (v2), types `SimParams` (v2), `Intervention`, `Duration`, `Seed`, `ParamsResult`; `simDays(years)`, `isV1(input)`, `migrateV1(flat)`, `validateParams(input)` (v1 or v2 in), `coerceParams(input): SimParams | null`, `getVaccine/getTreatment/getSeasonality`, `CONTACT_MATRIX`, `spectralRadius3`, `CONTACT_SPECTRAL_RADIUS`, `perContactProb`, `asympFactor`, `effectiveDays`, `contactScale`, `approxR0`, `maxR0`, `R0UnreachableError` (fields `target`, `maximum`, `levers`), `calibrateBeta(p, r0)` (throws), `clampBeta`, `withR0(p, r0)`, `recalibrateBeta(p, r0Before, before)`.
- Fixture shape (`web/tests/fixtures/parity.json`, version 2): `params: [{input (v2), approx_r0, max_r0, calibrate: [{target_r0, beta | null}], recalibrate: [{r0_before, before, after_input, beta}]}]`, `migration: [{input (v1), expected (v2 dump)}]`, `warnings` and `adapters` unchanged.

- [ ] **Step 1: Write the failing Python export tests**

Append to `tests/test_web_exports.py` and change the existing two tests as shown:

```python
# in test_export_web_data_is_deterministic_and_fresh, the name tuple becomes:
    for name in ("disease_db.json", "system_prompt.json", "disease_refs.json", "param_registry.json"):


def test_param_registry_export_shape(tmp_path):
    mod = _load("export_web_data")
    mod.main(tmp_path)
    reg = json.loads((tmp_path / "data" / "param_registry.json").read_text(encoding="utf-8"))
    assert reg["version"] == 1 and reg["params"][0]["path"] == "disease.model"
    assert len(reg["params"]) >= 40 and all(set(p) >= {"path", "bounds", "default", "tier", "models"} for p in reg["params"])


# in test_export_parity_fixtures_is_deterministic_and_fresh, after the existing asserts:
    assert parity["version"] == 2
    assert all("schema_version" in case["input"] and "max_r0" in case for case in parity["params"])
    assert any(k["beta"] is None for case in parity["params"] for k in case["calibrate"])
    assert len(parity["migration"]) >= 12 and all(c["expected"]["schema_version"] == 2 for c in parity["migration"])
```

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_web_exports.py -q`
Expected: FAIL: `param_registry.json is missing`, and `KeyError: 'version'`/`'max_r0'` on the parity cases

- [ ] **Step 3: Update the two exporters**

`scripts/export_web_data.py`: add the import and one line in `main`:

```python
from epichat.params.registry import export as export_registry  # noqa: E402
...
def main(web_dir: Path = ROOT / "web") -> None:
    write_json(web_dir / "data" / "disease_db.json", disease_db_payload())
    write_json(web_dir / "data" / "disease_refs.json", references_payload())
    write_json(web_dir / "data" / "system_prompt.json", {"system": _SYSTEM})
    write_json(web_dir / "data" / "param_registry.json", export_registry())
```

and the final print names the fourth file.

`scripts/export_parity_fixtures.py`: replace the imports of `_calibrate_beta`, `recalibrate_beta`, `SimParams` and the two functions `random_params` and `params_cases` with the v2 versions below; add `migration_cases`; bump the version.

```python
from epichat.params import r0  # noqa: E402
from epichat.params.migrate import coerce_params  # noqa: E402
from epichat.params.schema_v2 import SimParamsV2  # noqa: E402

sys.path.insert(0, str(ROOT / "tests"))
from template_cases import cases as template_cases  # noqa: E402

LATENT = ("seir", "seirs", "seiar")
WANING = ("sirs", "seirs")


def random_duration(rng: random.Random, mean: float) -> dict:
    dist = rng.choice(["constant", "constant", "gamma", "lognormal"])
    sd = None if dist == "constant" else round(mean * rng.uniform(0.1, 0.6), 2)
    return {"mean_days": mean, "dist": dist, "sd_days": sd}


def random_params(rng: random.Random) -> SimParamsV2 | None:
    model = rng.choice(TYPES)
    network_type = rng.choice(["random", "age_structured"])
    disease = {
        "model": model,
        "beta": round(rng.uniform(0.05, 300.0), 4),
        "dur_inf": random_duration(rng, round(rng.uniform(1.0, 30.0), 2)),
        "p_death": round(rng.choice([0.0, 0.001, 0.01, 0.1]), 3),
    }
    if model in LATENT:
        disease["dur_exp"] = random_duration(rng, round(rng.uniform(1.0, 21.0), 2))
    if model in WANING:
        disease["dur_immune"] = random_duration(rng, round(rng.uniform(30.0, 2000.0), 1))
    if model == "seiar":
        disease["p_asymp"] = round(rng.uniform(0.0, 1.0), 2)
        disease["rel_trans_asymp"] = round(rng.uniform(0.0, 1.0), 2)
    network = {"network_type": network_type, "n_contacts": rng.randint(1, 30), "network_beta": rng.choice([1.0, 0.5, 2.0])}
    demographics = {}
    if network_type == "age_structured" and rng.random() < 0.7:
        under = round(rng.uniform(10.0, 45.0), 1)
        over = round(rng.uniform(2.0, 20.0), 1)
        demographics = {"age_pct_under18": under, "age_pct_over65": over, "age_pct_18_64": round(100.0 - under - over, 1)}
    run = {"n_agents": rng.choice([1000, 5000, 10000, 50000])}
    try:
        return SimParamsV2.model_validate({"schema_version": 2, "disease": disease, "network": network, "demographics": demographics, "run": run})
    except Exception:
        return None


def _calibrate(p: SimParamsV2, target: float):
    try:
        return r0.clamp_beta(r0.calibrate_beta(p, target))
    except r0.R0Unreachable:
        return None


def params_cases(rng: random.Random) -> list[dict]:
    cases = []
    while len(cases) < 240:
        p = random_params(rng)
        if p is None:
            continue
        # approx_r0 on the age-structured network uses numpy's eigvals, whose last bits differ between
        # BLAS builds; nine decimals is far below the TypeScript test's 1e-6 tolerance.
        approx = round(r0.approx_r0(p), 9)
        recalibrate = []
        switched = p.model_dump()
        if p.network.network_type == "random":
            switched["network"]["network_type"] = "age_structured"
            switched["demographics"].update({"age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8})
        else:
            switched["network"]["network_type"] = "random"
        raised = p.model_dump()
        raised["disease"]["beta"] = round(p.disease.beta * 1.7, 4)
        for after_input in (switched, raised):
            try:
                after = SimParamsV2.model_validate(after_input)
            except Exception:
                continue
            rec = r0.recalibrate_beta(after, approx, p)
            recalibrate.append({"r0_before": approx, "before": p.model_dump(mode="json"), "after_input": after.model_dump(mode="json"), "beta": rec.disease.beta})
        cases.append({
            "input": p.model_dump(mode="json"), "approx_r0": approx, "max_r0": round(r0.max_r0(p), 9),
            "calibrate": [{"target_r0": t, "beta": _calibrate(p, t)} for t in (1.5, 3.0, 15.0)],
            "recalibrate": recalibrate,
        })
    return cases


MIGRATION_INPUTS: list[dict] = [
    {"beta": 22.8125},
    {"disease_type": "sir", "beta": 10.0, "dur_inf": 7, "init_prev": 0.02, "n_agents": 5000, "sim_dur_years": 0.5, "rand_seed": 3,
     "p_death": 0.01, "n_contacts": 6, "network_beta": 0.5},
    {"disease_type": "seir", "beta": 171.09375, "dur_exp": 11, "dur_inf": 8, "country": "KEN", "network_type": "age_structured",
     "age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8, "use_demographics": True, "birth_rate": 28.1,
     "death_rate": 7.9, "demographics_source": "UN WPP 2024"},
    {"disease_type": "sis", "beta": 5.0, "interventions": [{"type": "vaccine", "coverage": 0.4, "start_day": 0}]},
    {"disease_type": "sirs", "beta": 5.0, "dur_immune": 180,
     "interventions": [{"type": "vaccination", "coverage": 1.0}, {"type": "treatment", "coverage": 0.5, "capacity": 20.4, "start_day": 3}]},
    {"disease_type": "seirs", "beta": 5.0, "dur_exp": 4, "dur_immune": 90,
     "interventions": [{"type": "vaccine", "coverage": 0.6, "start_day": 60}, {"type": "seasonal", "scale": 0.3, "shift": 0.1}]},
    {"disease_type": "seiar", "beta": 5.0, "dur_exp": 4, "p_asymp": 0.4, "rel_trans_asymp": 0.3,
     "interventions": [{"type": "vaccine", "coverage": 0.2, "start_day": 0}, {"type": "vaccine", "coverage": 0.7, "start_day": 30}]},
]


def migration_cases() -> list[dict]:
    inputs = MIGRATION_INPUTS + [case.model_dump() for case in template_cases().values()]
    return [{"input": v1, "expected": coerce_params(v1).model_dump(mode="json")} for v1 in inputs]
```

and in `main`: `payload = {"version": 2, "params": params_cases(rng), "migration": migration_cases(), "warnings": warning_cases(rng), "adapters": adapter_cases()}`.

Also make the Python `migrate_v1` treat an explicit `null` like a missing key for the defaulted scalars, so both sides agree on a v1 row that stored `"dur_exp": null`:

```python
# epichat/params/migrate.py: replace the direct f.get(...) calls in migrate_v1 with _get
def _get(f: dict, key: str, default):
    value = f.get(key)
    return default if value is None else value
# "model": _get(f, "disease_type", "sir"), "beta": _get(f, "beta", 22.8125), "dur_inf": _duration(_get(f, "dur_inf", 10.0)),
# "p_death": _get(f, "p_death", 0.0), "p_asymp": _get(f, "p_asymp", 0.3), "rel_trans_asymp": _get(f, "rel_trans_asymp", 0.5),
# "seed": {"mode": "fraction", "value": _get(f, "init_prev", 0.01), "day": 0},
```

- [ ] **Step 4: Regenerate the files and run the export tests**

Run: `npm --prefix web run sync-data` then `.venv/Scripts/python.exe -m pytest tests/test_web_exports.py tests/test_param_migrate.py -q`
Expected: 8 passed (web exports) + 11 passed (migration); `git status` shows `web/data/param_registry.json` new and `web/tests/fixtures/parity.json` modified.

- [ ] **Step 5: Write the failing TypeScript tests**

`web/tests/sim/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { PARAM_REGISTRY, REGISTRY_VERSION, applicableSpecs, boundsOf, defaultOf, specFor } from "@/lib/sim/registry";

describe("the exported parameter registry", () => {
  it("loads in registry order with the version", () => {
    expect(REGISTRY_VERSION).toBe(1);
    expect(PARAM_REGISTRY[0].path).toBe("disease.model");
    expect(PARAM_REGISTRY.at(-1)?.path).toBe("run.rand_seed");
    expect(PARAM_REGISTRY.length).toBeGreaterThanOrEqual(40);
  });

  it("looks up specs, bounds and defaults by path", () => {
    expect(specFor("disease.dur_inf.mean_days")).toMatchObject({ label: "Infectious period (mean)", unit: "days", tier: "core", db_field: "infectious_days" });
    expect(specFor("nope")).toBeNull();
    expect(boundsOf("disease.beta")).toEqual([0.001, 1000]);
    expect(defaultOf<number>("run.n_agents")).toBe(10000);
    expect(() => boundsOf("disease.model")).toThrow(/no bounds/);
  });

  it("filters by model", () => {
    const sir = applicableSpecs("sir").map((s) => s.path);
    const seiar = applicableSpecs("seiar").map((s) => s.path);
    expect(sir).not.toContain("disease.dur_exp.mean_days");
    expect(seiar).toContain("disease.p_asymp");
    expect(applicableSpecs("sis").map((s) => s.path)).not.toContain("disease.p_death");
  });
});
```

`web/tests/sim/paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { diffParams, flattenParams, getPath, setPath } from "@/lib/sim/paths";

describe("dotted paths", () => {
  it("flattens, reads and writes nested objects", () => {
    const d: Record<string, unknown> = { a: { b: 1, c: { d: [1, 2] } }, e: null };
    expect(flattenParams(d)).toEqual({ "a.b": 1, "a.c.d": [1, 2], e: null });
    expect(getPath(d, "a.c.d")).toEqual([1, 2]);
    expect(getPath(d, "a.x")).toBeUndefined();
    setPath(d, "a.c.f", 3);
    setPath(d, "g.h", 4);
    expect((d.a as { c: { f: number } }).c.f).toBe(3);
    expect(d.g).toEqual({ h: 4 });
  });

  it("diffs like the Python service", () => {
    expect(diffParams({ a: { b: 1 }, x: 2 }, { a: { b: 5 }, x: 2, y: [1] })).toEqual([
      { field: "a.b", from: 1, to: 5 },
      { field: "y", from: null, to: [1] },
    ]);
  });
});
```

`web/tests/sim/params.test.ts` (replace the file):

```ts
import { describe, expect, it } from "vitest";

import {
  CONTACT_SPECTRAL_RADIUS, DEFAULT_BETA, R0UnreachableError, approxR0, calibrateBeta, clampBeta, effectiveDays, getVaccine, maxR0,
  migrateV1, recalibrateBeta, simDays, spectralRadius3, validateParams, withR0,
} from "@/lib/sim/params";

function must(input: unknown) {
  const r = validateParams(input);
  if (!r.ok) throw new Error(r.error);
  return r.params;
}

describe("SimParams v2 validation", () => {
  it("fills every default like pydantic", () => {
    const p = must({ schema_version: 2 });
    expect(p).toEqual({
      schema_version: 2,
      disease: {
        model: "sir", beta: DEFAULT_BETA, dur_exp: null, dur_inf: { mean_days: 10, dist: "constant", sd_days: null }, dur_immune: null,
        p_death: 0, p_asymp: 0.3, rel_trans_asymp: 0.5, sis_waning: 0, sis_imm_boost: 0, seed: { mode: "fraction", value: 0.01, day: 0 }, initial_immune_frac: 0,
      },
      network: { network_type: "random", n_contacts: 4, network_beta: 1 },
      demographics: {
        use_demographics: false, birth_rate: 20, death_rate: 10, age_pct_under18: null, age_pct_18_64: null, age_pct_over65: null,
        country: null, auto_demographics: true, demographics_year: 2022, demographics_source: null,
      },
      interventions: [],
      run: { n_agents: 10000, sim_dur_years: 1, rand_seed: null, n_replicates: 1 },
    });
    expect(must({})).toEqual(must({ schema_version: 2 }));   // a v1 row with nothing in it migrates to the same defaults
  });

  it("enforces registry bounds and names the dotted path like pydantic", () => {
    const r = validateParams({ schema_version: 2, run: { n_agents: -5 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^1 validation error for SimParams\nrun\.n_agents\n  /);
    expect(validateParams({ schema_version: 2, disease: { beta: 0.0001 } }).ok).toBe(false);
    expect(validateParams({ schema_version: 2, disease: { dur_inf: { mean_days: 400 } } })).toEqual({ ok: false, error: expect.stringContaining("disease.dur_inf.mean_days must be between 0.5 and 365 days") });
    expect(validateParams({ schema_version: 2, run: { n_replicates: 6 } }).ok).toBe(false);
    expect(validateParams({ schema_version: 2, disease: { model: "sirv" } }).ok).toBe(false);
  });

  it("applies the duration, seed and model validators", () => {
    expect(validateParams({ schema_version: 2, disease: { dur_inf: { mean_days: 10, dist: "gamma" } } })).toEqual({ ok: false, error: expect.stringContaining("sd_days is required when dist is 'gamma'") });
    expect(validateParams({ schema_version: 2, disease: { dur_inf: { mean_days: 10, dist: "gamma", sd_days: 25 } } }).ok).toBe(false);
    expect(validateParams({ schema_version: 2, disease: { seed: { value: 1 } } })).toEqual({ ok: false, error: expect.stringContaining("between 0 and 1") });
    expect(validateParams({ schema_version: 2, disease: { seed: { mode: "count", value: 2.5 } } })).toEqual({ ok: false, error: expect.stringContaining("integer count") });
    expect(validateParams({ schema_version: 2, disease: { seed: { mode: "count", value: 500 } }, run: { n_agents: 100 } })).toEqual({ ok: false, error: expect.stringContaining("disease.seed.value (500) must not exceed run.n_agents (100)") });
    expect(validateParams({ schema_version: 2, disease: { seed: { value: 0.01, day: 400 } }, run: { sim_dur_years: 0.5 } })).toEqual({ ok: false, error: expect.stringContaining("disease.seed.day (400) must be within the simulation (182 days)") });
    expect(validateParams({ schema_version: 2, disease: { model: "seir" } })).toEqual({ ok: false, error: expect.stringContaining("disease.dur_exp is required when disease.model is 'seir', 'seirs', or 'seiar'") });
    expect(validateParams({ schema_version: 2, disease: { model: "sirs" } })).toEqual({ ok: false, error: expect.stringContaining("disease.dur_immune is required") });
    expect(validateParams({ schema_version: 2, disease: { beta: 1000 }, network: { network_beta: 10 } })).toEqual({ ok: false, error: expect.stringContaining("network.network_beta") });
  });

  it("normalizes a day-0 vaccine into initial immunity", () => {
    const p = must({ schema_version: 2, interventions: [{ type: "vaccination", coverage: 0.6, start_day: 0 }, { type: "treatment", capacity: 5 }] });
    expect(p.disease.initial_immune_frac).toBe(0.6);
    expect(p.interventions.map((i) => i.type)).toEqual(["treatment"]);
    expect(must({ schema_version: 2, interventions: [{ type: "vaccine", coverage: 1 }] }).disease.initial_immune_frac).toBe(0.99);
    expect(getVaccine(must({ schema_version: 2, interventions: [{ type: "vaccine", coverage: 0.6, start_day: 30 }] }))).toMatchObject({ coverage: 0.6, start_day: 30 });
    expect(validateParams({ schema_version: 2, disease: { initial_immune_frac: 0.3 }, interventions: [{ type: "vaccine", coverage: 0.6 }] })).toEqual({ ok: false, error: expect.stringContaining("initial_immune_frac") });
  });

  it("keeps the v1 demographics rules", () => {
    expect(validateParams({ schema_version: 2, demographics: { age_pct_under18: 10, age_pct_18_64: 10, age_pct_over65: 10 } })).toEqual({ ok: false, error: expect.stringContaining("age_pct fields must sum to 100 (got 30.0)") });
    expect(must({ schema_version: 2, demographics: { country: " ken " } }).demographics.country).toBe("KEN");
    expect(must({ schema_version: 2, demographics: { country: "Brazil" } }).demographics.country).toBeNull();
    expect(simDays(1)).toBe(365);
    expect(simDays(0.5)).toBe(182);
  });
});

describe("migration from v1", () => {
  it("migrates a flat row to constant durations and a fraction seed", () => {
    const p = must({ disease_type: "seirs", beta: 12.5, dur_inf: 7, dur_exp: 4, dur_immune: 90, init_prev: 0.02, n_agents: 2000, sim_dur_years: 0.5, rand_seed: 9, p_death: 0.1 });
    expect(p.disease).toMatchObject({ model: "seirs", beta: 12.5, dur_inf: { mean_days: 7, dist: "constant", sd_days: null }, p_death: 0.1, seed: { mode: "fraction", value: 0.02, day: 0 } });
    expect(p.run).toEqual({ n_agents: 2000, sim_dur_years: 0.5, rand_seed: 9, n_replicates: 1 });
  });

  it("folds a day-0 vaccine into initial immunity and keeps later campaigns", () => {
    const out = migrateV1({ disease_type: "sir", beta: 1, interventions: [{ type: "vaccine", coverage: 0.4, start_day: 0 }], country: "KEN" });
    expect(out).toMatchObject({ schema_version: 2, disease: { initial_immune_frac: 0.4 }, interventions: [], demographics: { country: "KEN" }, network: {}, run: {} });
    expect(must({ beta: 5, interventions: [{ type: "vaccine", coverage: 0.6, start_day: 60 }] }).interventions).toHaveLength(1);
    expect(must({ beta: 5, interventions: [{ type: "vaccination", coverage: 1, start_day: 0 }] }).disease.initial_immune_frac).toBe(0.99);
  });

  it("rejects a v1 row that is not usable", () => {
    expect(validateParams({ beta: "not a number" }).ok).toBe(false);
  });
});

describe("R0 math", () => {
  it("uses the exact per-contact probability and effective days", () => {
    const p = must({ schema_version: 2 });
    expect(effectiveDays(p.disease)).toBe(9);
    expect(approxR0(p)).toBeCloseTo(4 * (1 - Math.exp(-DEFAULT_BETA / 365)) * 9, 12);
    expect(maxR0(p)).toBe(36);
    expect(effectiveDays(must({ schema_version: 2, disease: { dur_inf: { mean_days: 10, dist: "gamma", sd_days: 4 } } }).disease)).toBe(9.5);
    expect(effectiveDays(must({ schema_version: 2, disease: { model: "seir", dur_exp: { mean_days: 5 }, dur_inf: { mean_days: 10, dist: "gamma", sd_days: 4 } } }).disease)).toBe(10.5);
    expect(effectiveDays(must({ schema_version: 2, disease: { dur_inf: { mean_days: 0.5 } } }).disease)).toBe(0);
  });

  it("calibrates, clamps and rounds, and refuses an unreachable R0 naming the levers", () => {
    const p = must({ schema_version: 2 });
    expect(approxR0(withR0(p, 15))).toBeCloseTo(15, 6);
    expect(clampBeta(0.00001)).toBe(0.001);
    expect(clampBeta(12.3456789)).toBe(12.345679);
    const small = must({ schema_version: 2, network: { n_contacts: 2 }, disease: { dur_inf: { mean_days: 3 } } });
    expect(() => calibrateBeta(small, 4)).toThrow(R0UnreachableError);
    try { calibrateBeta(small, 4); } catch (e) { expect(e).toMatchObject({ target: 4, maximum: 4, levers: ["network.n_contacts", "disease.dur_inf.mean_days"] }); }
    const aged = must({ schema_version: 2, network: { network_type: "age_structured" }, disease: { dur_inf: { mean_days: 1 } } });
    try { calibrateBeta(aged, 1); } catch (e) { expect(e).toMatchObject({ maximum: 0, levers: ["network.network_beta", "disease.dur_inf.mean_days"] }); }
  });

  it("ignores age shares and n_contacts on the age-structured network", () => {
    const base = must({ schema_version: 2, network: { network_type: "age_structured", n_contacts: 4 } });
    const shares = must({ schema_version: 2, network: { network_type: "age_structured", n_contacts: 40 }, demographics: { age_pct_under18: 38.6, age_pct_18_64: 57.6, age_pct_over65: 3.8 } });
    expect(CONTACT_SPECTRAL_RADIUS).toBeCloseTo(11.0028224279, 9);
    expect(approxR0(base)).toBeCloseTo(CONTACT_SPECTRAL_RADIUS * (1 - Math.exp(-DEFAULT_BETA / 365)) * 9, 9);
    expect(approxR0(shares)).toBeCloseTo(approxR0(base), 12);
    expect(spectralRadius3([[2, 0, 0], [0, 1, 0], [0, 0, 0.5]])).toBeCloseTo(2, 12);
  });

  it("recalibrates after a network switch to hold the R0, and keeps beta when the R0 is unreachable", () => {
    const before = withR0(must({ schema_version: 2 }), 3);
    const switched = must({ ...before, network: { ...before.network, network_type: "age_structured" } });
    expect(approxR0(recalibrateBeta(switched, 3, before))).toBeCloseTo(3, 6);
    const raised = must({ ...before, disease: { ...before.disease, beta: 54.4 } });
    expect(approxR0(recalibrateBeta(raised, 3, before))).toBeCloseTo(4 * (1 - Math.exp(-54.4 / 365)) * 9, 6);
    const stuck = must({ schema_version: 2, network: { n_contacts: 1 }, disease: { dur_inf: { mean_days: 2 } } });
    expect(recalibrateBeta(stuck, 3, before).disease.beta).toBe(stuck.disease.beta);
  });
});
```

`web/tests/sim/parity.test.ts` (replace the file):

```ts
import { describe, expect, it } from "vitest";

import { checkParams } from "@/lib/disease/checkParams";
import { R0UnreachableError, approxR0, calibrateBeta, clampBeta, maxR0, recalibrateBeta, validateParams } from "@/lib/sim/params";
import parity from "../fixtures/parity.json";

function must(input: unknown) {
  const r = validateParams(input);
  if (!r.ok) throw new Error(r.error);
  return r.params;
}

function calibrateOrNull(p: ReturnType<typeof must>, target: number): number | null {
  try {
    return clampBeta(calibrateBeta(p, target));
  } catch (e) {
    if (e instanceof R0UnreachableError) return null;
    throw e;
  }
}

describe("parity with the Python package", () => {
  it("has enough cases", () => {
    expect(parity.version).toBe(2);
    expect(parity.params.length).toBeGreaterThanOrEqual(200);
    expect(parity.migration.length).toBeGreaterThanOrEqual(12);
    expect(parity.warnings.length).toBeGreaterThanOrEqual(300);
  });

  it("approx_r0, max_r0, calibrate_beta and recalibrate_beta agree within 1e-6", () => {
    for (const c of parity.params) {
      const p = must(c.input);
      expect(approxR0(p)).toBeCloseTo(c.approx_r0, 6);
      expect(maxR0(p)).toBeCloseTo(c.max_r0, 6);
      for (const k of c.calibrate) {
        const beta = calibrateOrNull(p, k.target_r0);
        if (k.beta === null) expect(beta).toBeNull();
        else expect(beta).toBeCloseTo(k.beta, 6);
      }
      for (const r of c.recalibrate) expect(recalibrateBeta(must(r.after_input), r.r0_before, must(r.before)).disease.beta).toBeCloseTo(r.beta, 6);
    }
  });

  it("migrates every v1 fixture to the same v2 document", () => {
    for (const c of parity.migration) expect(must(c.input), JSON.stringify(c.input)).toEqual(c.expected);
  });

  it("check_params warnings are identical strings", () => {
    for (const w of parity.warnings) {
      expect(checkParams(w.disease, w.r0, w.dur_inf, w.dur_exp, { pDeath: w.p_death, nContacts: w.n_contacts, durImmune: w.dur_immune, pAsymp: w.p_asymp }), JSON.stringify(w)).toEqual(w.warnings);
    }
  });
});
```

- [ ] **Step 6: Run the TypeScript tests to verify they fail**

Run: `cd web && npx vitest run tests/sim`
Expected: FAIL: `registry.test.ts` and `paths.test.ts` cannot resolve their modules; `params.test.ts` fails on missing exports (`migrateV1`, `withR0`, …)

- [ ] **Step 7: Write the three TypeScript modules**

`web/lib/sim/registry.ts`:

```ts
/**
 * The parameter registry as Python exports it (scripts/export_web_data.py
 * writes data/param_registry.json from epichat/params/registry.py). Bounds
 * and defaults for the zod schema come from here, so the two languages
 * cannot disagree about them.
 */
import raw from "@/data/param_registry.json";

export type ParamSpec = {
  path: string;
  module: "disease" | "network" | "demographics" | "interventions" | "run";
  label: string;
  description: string;
  kind: "number" | "integer" | "bool" | "enum" | "string";
  unit: string | null;
  default: unknown;
  bounds: [number, number] | null;
  choices: string[] | null;
  models: string[];
  tier: "core" | "advanced" | "expert";
  db_field: string | null;
  starsim_target: string;
  affects: string[];
  requires: string[];
};

const FILE = raw as unknown as { version: number; params: ParamSpec[] };
export const REGISTRY_VERSION = FILE.version;
export const PARAM_REGISTRY: readonly ParamSpec[] = FILE.params;
const BY_PATH = new Map(PARAM_REGISTRY.map((s) => [s.path, s]));

export function specFor(path: string): ParamSpec | null {
  return BY_PATH.get(path) ?? null;
}

export function appliesTo(spec: ParamSpec, model: string): boolean {
  return spec.models.length === 0 || spec.models.includes(model);
}

export function applicableSpecs(model: string): ParamSpec[] {
  return PARAM_REGISTRY.filter((s) => appliesTo(s, model));
}

export function boundsOf(path: string): [number, number] {
  const spec = BY_PATH.get(path);
  if (!spec?.bounds) throw new Error(`no bounds for ${path}`);
  return spec.bounds;
}

export function defaultOf<T>(path: string): T {
  const spec = BY_PATH.get(path);
  if (!spec) throw new Error(`no registry entry for ${path}`);
  return spec.default as T;
}
```

`web/lib/sim/paths.ts`:

```ts
/** Dotted paths over nested parameter objects ("disease.dur_inf.mean_days"); mirrors epichat/params/paths.py. */
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function flattenParams(obj: Obj, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}${key}`;
    if (isObj(value)) Object.assign(out, flattenParams(value, `${path}.`));
    else out[path] = value;
  }
  return out;
}

export function getPath(obj: Obj, path: string): unknown {
  let node: unknown = obj;
  for (const part of path.split(".")) {
    if (!isObj(node) || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

export function setPath(obj: Obj, path: string, value: unknown): void {
  const parts = path.split(".");
  let node: Obj = obj;
  for (const part of parts.slice(0, -1)) {
    if (!isObj(node[part])) node[part] = {};
    node = node[part] as Obj;
  }
  node[parts[parts.length - 1]] = value;
}

export type ParamChange = { field: string; from: unknown; to: unknown };

export function diffParams(before: Obj, after: Obj): ParamChange[] {
  const old = flattenParams(before);
  const now = flattenParams(after);
  const changes: ParamChange[] = [];
  for (const key of Object.keys(old)) if (JSON.stringify(old[key]) !== JSON.stringify(now[key])) changes.push({ field: key, from: old[key], to: now[key] ?? null });
  for (const key of Object.keys(now)) if (!(key in old)) changes.push({ field: key, from: null, to: now[key] });
  return changes;
}
```

`web/lib/sim/params.ts` (replace the whole file):

```ts
/**
 * Schema v2 of the simulation parameters, a port of epichat/params/schema_v2.py
 * (pydantic) with bounds and defaults read from the exported registry, the v1
 * migration (epichat/params/migrate.py) and the exact R0 math
 * (epichat/params/r0.py). The sim service validates again in Python; this
 * copy exists so the agent's tools can merge, validate, and calibrate without
 * a round trip. web/tests/fixtures/parity.json pins the two sides together.
 */
import { z } from "zod";
import { pyRound } from "./pyformat";
import { boundsOf, defaultOf } from "./registry";

export const DEFAULT_BETA = 22.8125;
export const DISEASE_TYPES = ["sir", "seir", "sis", "sirs", "seirs", "seiar"] as const;
export type DiseaseType = (typeof DISEASE_TYPES)[number];
export const LATENT_MODELS: readonly DiseaseType[] = ["seir", "seirs", "seiar"];
export const WANING_MODELS: readonly DiseaseType[] = ["sirs", "seirs"];
export const NETWORK_TYPES = ["random", "age_structured"] as const;
export const INTERVENTION_TYPES = ["vaccine", "treatment", "seasonality"] as const;
export const DISTS = ["constant", "lognormal", "gamma"] as const;

const TYPE_ALIASES: Record<string, string> = {
  vaccination: "vaccine",
  vaccinate: "vaccine",
  treat: "treatment",
  treatment_intervention: "treatment",
  seasonal: "seasonality",
};

const nullable = <T extends z.ZodTypeAny>(inner: T) => inner.nullable().default(null);
const issue = (ctx: z.RefinementCtx, message: string) => ctx.addIssue({ code: "custom", message: `Value error, ${message}`, path: [] });

/** A numeric leaf whose inclusive bounds come from the registry. */
function bounded(path: string, int = false) {
  const [lo, hi] = boundsOf(path);
  return (int ? z.number().int() : z.number()).min(lo).max(hi);
}
const withDefault = (path: string, int = false) => bounded(path, int).default(defaultOf<number>(path));

export function simDays(years: number): number {
  return Math.max(1, pyRound(365 * years, 0));
}

export const InterventionSchema = z.object({
  type: z.preprocess((v) => (typeof v === "string" ? (TYPE_ALIASES[v.toLowerCase()] ?? v) : v), z.enum(INTERVENTION_TYPES)),
  coverage: nullable(z.number().min(0).max(1)),
  start_day: z.number().int().min(0).default(0),
  capacity: nullable(
    z.preprocess((v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v) : v), z.number().int().min(1)),
  ),
  scale: z.number().min(0).max(1).default(0.2),
  shift: z.number().min(0).max(1).default(0),
});
export type Intervention = z.infer<typeof InterventionSchema>;

export const DurationSchema = z
  .object({
    mean_days: z.number().gt(0),
    dist: z.enum(DISTS).default("constant"),
    sd_days: nullable(z.number().gt(0)),
  })
  .superRefine((d, ctx) => {
    if (d.dist !== "constant" && d.sd_days === null) issue(ctx, `sd_days is required when dist is '${d.dist}'`);
    if (d.sd_days !== null && d.sd_days > 2 * d.mean_days) issue(ctx, "sd_days must be at most 2 × mean_days");
  });
export type Duration = z.infer<typeof DurationSchema>;

export const SeedSchema = z
  .object({
    mode: z.enum(["fraction", "count"]).default("fraction"),
    value: z.number().gt(0),
    day: withDefault("disease.seed.day", true),
  })
  .superRefine((s, ctx) => {
    if (s.mode === "fraction" && !(s.value > 0 && s.value < 1)) issue(ctx, "value must be between 0 and 1 (exclusive) when mode is 'fraction'");
    if (s.mode === "count" && (s.value < 1 || !Number.isInteger(s.value))) issue(ctx, "value must be an integer count of at least 1 when mode is 'count'");
  });
export type Seed = z.infer<typeof SeedSchema>;

const DURATIONS = ["dur_exp", "dur_inf", "dur_immune"] as const;

export const DiseaseSchema = z
  .object({
    model: z.enum(DISEASE_TYPES).default("sir"),
    beta: withDefault("disease.beta"),
    dur_exp: nullable(DurationSchema),
    dur_inf: DurationSchema.prefault({ mean_days: 10 }),
    dur_immune: nullable(DurationSchema),
    p_death: withDefault("disease.p_death"),
    p_asymp: withDefault("disease.p_asymp"),
    rel_trans_asymp: withDefault("disease.rel_trans_asymp"),
    sis_waning: withDefault("disease.sis_waning"),
    sis_imm_boost: withDefault("disease.sis_imm_boost"),
    seed: SeedSchema.prefault({ value: 0.01 }),
    initial_immune_frac: withDefault("disease.initial_immune_frac"),
  })
  .superRefine((d, ctx) => {
    if (LATENT_MODELS.includes(d.model) && d.dur_exp === null) issue(ctx, "disease.dur_exp is required when disease.model is 'seir', 'seirs', or 'seiar'");
    if (WANING_MODELS.includes(d.model) && d.dur_immune === null) issue(ctx, "disease.dur_immune is required when disease.model is 'sirs' or 'seirs'");
    for (const name of DURATIONS) {
      const duration = d[name];
      if (!duration) continue;
      for (const [leaf, value] of [["mean_days", duration.mean_days], ["sd_days", duration.sd_days]] as const) {
        if (value === null) continue;
        const path = `disease.${name}.${leaf}`;
        const [lo, hi] = boundsOf(path);
        if (value < lo || value > hi) issue(ctx, `${path} must be between ${lo} and ${hi} days`);
      }
    }
  });

export const NetworkSchema = z.object({
  network_type: z.enum(NETWORK_TYPES).default("random"),
  n_contacts: withDefault("network.n_contacts", true),
  network_beta: withDefault("network.network_beta"),
});

const country = z
  .preprocess((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().toUpperCase();
    return /^[A-Z]{3}$/.test(s) ? s : null;
  }, z.string().nullable())
  .default(null);

export const DemographicsSchema = z
  .object({
    use_demographics: z.boolean().default(false),
    birth_rate: withDefault("demographics.birth_rate"),
    death_rate: withDefault("demographics.death_rate"),
    age_pct_under18: nullable(bounded("demographics.age_pct_under18")),
    age_pct_18_64: nullable(bounded("demographics.age_pct_18_64")),
    age_pct_over65: nullable(bounded("demographics.age_pct_over65")),
    country,
    auto_demographics: z.boolean().default(true),
    demographics_year: withDefault("demographics.demographics_year", true),
    demographics_source: nullable(z.string()),
  })
  .superRefine((d, ctx) => {
    const pcts = [d.age_pct_under18, d.age_pct_18_64, d.age_pct_over65];
    if (pcts.every((x) => x !== null)) {
      const total = (pcts as number[]).reduce((a, b) => a + b, 0);
      if (Math.abs(total - 100) > 1) issue(ctx, `age_pct fields must sum to 100 (got ${total.toFixed(1)})`);
    }
  });

export const RunSchema = z.object({
  n_agents: withDefault("run.n_agents", true),
  sim_dur_years: withDefault("run.sim_dur_years"),
  rand_seed: nullable(z.number().int()),
  n_replicates: withDefault("run.n_replicates", true),
});

const isDayZeroVaccine = (i: { type: string; start_day: number }) => i.type === "vaccine" && i.start_day <= 0;

export const SimParamsSchema = z
  .object({
    schema_version: z.literal(2).default(2),
    disease: DiseaseSchema.prefault({}),
    network: NetworkSchema.prefault({}),
    demographics: DemographicsSchema.prefault({}),
    interventions: z.array(InterventionSchema).default([]),
    run: RunSchema.prefault({}),
  })
  .superRefine((p, ctx) => {
    const seed = p.disease.seed;
    if (seed.mode === "count" && seed.value > p.run.n_agents) issue(ctx, `disease.seed.value (${seed.value}) must not exceed run.n_agents (${p.run.n_agents})`);
    const days = simDays(p.run.sim_dur_years);
    if (seed.day > days) issue(ctx, `disease.seed.day (${seed.day}) must be within the simulation (${days} days)`);
    if (p.network.network_beta * (1 - Math.exp(-p.disease.beta / 365)) > 1) issue(ctx, "network.network_beta × (1 - exp(-disease.beta / 365)) must not exceed 1: lower network.network_beta or disease.beta");
    const day0 = p.interventions.filter(isDayZeroVaccine);
    if (day0.length > 0) {
      const coverage = Math.min(day0[day0.length - 1].coverage ?? 0, 0.99);
      if (p.disease.initial_immune_frac > 0 && Math.abs(p.disease.initial_immune_frac - coverage) > 1e-9) {
        issue(ctx, "a vaccine with start_day 0 and disease.initial_immune_frac were both given with different values; set one of them");
      }
    }
  })
  .transform((p) => {
    const day0 = p.interventions.filter(isDayZeroVaccine);
    if (day0.length === 0) return p;
    const coverage = Math.min(day0[day0.length - 1].coverage ?? 0, 0.99);
    return { ...p, disease: { ...p.disease, initial_immune_frac: coverage }, interventions: p.interventions.filter((i) => !isDayZeroVaccine(i)) };
  });
export type SimParams = z.infer<typeof SimParamsSchema>;
export type DiseaseParams = SimParams["disease"];

export type ParamsResult = { ok: true; params: SimParams } | { ok: false; error: string };

/** A v1 row is any object without schema_version (spec 6.1). */
export function isV1(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) && !("schema_version" in input);
}

const VACCINE_ALIASES = new Set(["vaccine", "vaccination", "vaccinate"]);
const NETWORK_KEYS = ["network_type", "n_contacts", "network_beta"];
const DEMOGRAPHICS_KEYS = ["use_demographics", "birth_rate", "death_rate", "age_pct_under18", "age_pct_18_64", "age_pct_over65", "country", "auto_demographics", "demographics_year", "demographics_source"];
const RUN_KEYS = ["n_agents", "sim_dur_years", "rand_seed"];

const constantDuration = (days: unknown) => (days === null || days === undefined ? null : { mean_days: days, dist: "constant", sd_days: null });
const isV1DayZeroVaccine = (i: Record<string, unknown>) => VACCINE_ALIASES.has(String(i.type ?? "").toLowerCase()) && Number(i.start_day ?? 0) <= 0;

/** epichat/params/migrate.py migrate_v1: a flat v1 object becomes a v2-shaped object (not yet validated). */
export function migrateV1(flat: Record<string, unknown>): Record<string, unknown> {
  const interventions = (Array.isArray(flat.interventions) ? (flat.interventions as Record<string, unknown>[]) : []).map((i) => ({ ...i }));
  const day0 = interventions.filter(isV1DayZeroVaccine);
  const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => k in flat).map((k) => [k, flat[k]]));
  return {
    schema_version: 2,
    disease: {
      model: flat.disease_type ?? "sir",
      beta: flat.beta ?? DEFAULT_BETA,
      dur_exp: constantDuration(flat.dur_exp),
      dur_inf: constantDuration(flat.dur_inf ?? 10),
      dur_immune: constantDuration(flat.dur_immune),
      p_death: flat.p_death ?? 0,
      p_asymp: flat.p_asymp ?? 0.3,
      rel_trans_asymp: flat.rel_trans_asymp ?? 0.5,
      sis_waning: 0,
      sis_imm_boost: 0,
      seed: { mode: "fraction", value: flat.init_prev ?? 0.01, day: 0 },
      initial_immune_frac: day0.length > 0 ? Math.min(Number(day0[day0.length - 1].coverage ?? 0), 0.99) : 0,
    },
    network: pick(NETWORK_KEYS),
    demographics: pick(DEMOGRAPHICS_KEYS),
    interventions: interventions.filter((i) => !isV1DayZeroVaccine(i)),
    run: pick(RUN_KEYS),
  };
}

/** Validate like pydantic's model_validate, migrating a v1 object first; the error text has pydantic's shape so CONFIG ERROR results read the same. */
export function validateParams(input: unknown): ParamsResult {
  const data = isV1(input) ? migrateV1(input) : input;
  const r = SimParamsSchema.safeParse(data);
  if (r.success) return { ok: true, params: r.data };
  const issues = r.error.issues;
  const lines = issues.map((i) => `${i.path.length ? i.path.join(".") : "SimParams"}\n  ${i.message}`);
  const n = issues.length;
  return { ok: false, error: `${n} validation error${n === 1 ? "" : "s"} for SimParams\n${lines.join("\n")}` };
}

/** Stored parameters of either shape, or null when they no longer validate. */
export function coerceParams(input: unknown): SimParams | null {
  if (input === null || input === undefined) return null;
  const r = validateParams(input);
  return r.ok ? r.params : null;
}

export function getVaccine(p: SimParams): Intervention | null {
  return p.interventions.find((i) => i.type === "vaccine") ?? null;
}
export function getTreatment(p: SimParams): Intervention | null {
  return p.interventions.find((i) => i.type === "treatment") ?? null;
}
export function getSeasonality(p: SimParams): Intervention | null {
  return p.interventions.find((i) => i.type === "seasonality") ?? null;
}

/** The POLYMOD-inspired three-group contact matrix shared with the builder. */
export const CONTACT_MATRIX: number[][] = [
  [7.0, 2.5, 0.5],
  [2.5, 9.0, 1.5],
  [0.5, 1.5, 3.5],
];

/** Largest eigenvalue of a non-negative 3×3 matrix (its Perron root), by power iteration with Rayleigh refinement. */
export function spectralRadius3(m: number[][]): number {
  let v = [1, 1, 1];
  let lambda = 0;
  for (let k = 0; k < 2000; k++) {
    const w = m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
    const norm = Math.hypot(w[0], w[1], w[2]);
    if (norm === 0) return 0;
    const next = w.map((x) => x / norm);
    const num = next.reduce((s, x, i) => s + x * (m[i][0] * next[0] + m[i][1] * next[1] + m[i][2] * next[2]), 0);
    const den = next.reduce((s, x) => s + x * x, 0);
    const estimate = num / den;
    const converged = Math.abs(estimate - lambda) <= 1e-16 * Math.abs(estimate);
    lambda = estimate;
    v = next;
    if (converged && k > 50) break;
  }
  return lambda;
}

export const CONTACT_SPECTRAL_RADIUS = spectralRadius3(CONTACT_MATRIX);
export const RANDOM_LEVERS = ["network.n_contacts", "disease.dur_inf.mean_days"] as const;
export const AGE_LEVERS = ["network.network_beta", "disease.dur_inf.mean_days"] as const;

/** Starsim's per-contact daily transmission probability for a per-year beta. */
export function perContactProb(beta: number): number {
  return 1 - Math.exp(-beta / 365);
}

export function asympFactor(d: DiseaseParams): number {
  return d.model === "seiar" ? 1 - d.p_asymp * (1 - d.rel_trans_asymp) : 1;
}

/** Days an infected agent transmits on a daily step (spec 7.4). */
export function effectiveDays(d: DiseaseParams): number {
  const inf = d.dur_inf;
  let days: number;
  if (LATENT_MODELS.includes(d.model)) {
    const exp = d.dur_exp!;
    if (exp.dist === "constant" && inf.dist === "constant") days = Math.ceil(exp.mean_days + inf.mean_days) - Math.ceil(exp.mean_days);
    else if (exp.dist === "constant") days = inf.mean_days + 0.5;
    else days = inf.mean_days;
  } else if (inf.dist === "constant") days = Math.ceil(inf.mean_days) - 1;
  else days = inf.mean_days - 0.5;
  return Math.max(0, days);
}

/** The R0 reached if every contact transmitted: contacts × network_beta × D_eff × asymp_factor. */
export function contactScale(p: SimParams): number {
  const contacts = p.network.network_type === "age_structured" ? CONTACT_SPECTRAL_RADIUS : p.network.n_contacts;
  return contacts * p.network.network_beta * effectiveDays(p.disease) * asympFactor(p.disease);
}

export function approxR0(p: SimParams): number {
  return contactScale(p) * perContactProb(p.disease.beta);
}

export function maxR0(p: SimParams): number {
  return contactScale(p);
}

export class R0UnreachableError extends Error {
  constructor(
    public readonly target: number,
    public readonly maximum: number,
    public readonly levers: readonly string[],
  ) {
    super(`R0 ${target} is not reachable: the most the contacts and infectious period can carry is ${maximum.toFixed(2)}; raise ${levers.join(" or ")}`);
    this.name = "R0UnreachableError";
  }
}

/** The beta whose approxR0 is targetR0 on the current network; throws R0UnreachableError when none exists. Unclamped. */
export function calibrateBeta(p: SimParams, targetR0: number): number {
  const scale = contactScale(p);
  if (scale <= 0 || targetR0 >= scale) throw new R0UnreachableError(targetR0, scale, p.network.network_type === "age_structured" ? AGE_LEVERS : RANDOM_LEVERS);
  return -365 * Math.log(1 - targetR0 / scale);
}

/** The agent's clamp-and-round applied to every calibrated beta. */
export function clampBeta(beta: number): number {
  return pyRound(Math.max(0.001, Math.min(1000, beta)), 6);
}

export function withR0(p: SimParams, targetR0: number): SimParams {
  return { ...p, disease: { ...p.disease, beta: clampBeta(calibrateBeta(p, targetR0)) } };
}

/** After a change, hold the R0 the user confirmed; a changed beta means a new intended R0, read with the random-network formula. Unchanged when unreachable. */
export function recalibrateBeta(p: SimParams, r0Before: number, before: SimParams): SimParams {
  const target =
    Math.abs(p.disease.beta - before.disease.beta) > 1e-4
      ? p.network.n_contacts * p.network.network_beta * effectiveDays(p.disease) * asympFactor(p.disease) * perContactProb(p.disease.beta)
      : r0Before;
  try {
    return withR0(p, target);
  } catch (e) {
    if (e instanceof R0UnreachableError) return p;
    throw e;
  }
}
```

- [ ] **Step 8: Run the sim subset to verify it passes**

Run: `cd web && npx vitest run tests/sim`
Expected: all tests in `registry`, `paths`, `params`, `parity`, `client`, `pyformat` pass (`client.test.ts` builds its params through `validateParams`, which now migrates them).

- [ ] **Step 9: Commit**

```bash
git add scripts/export_web_data.py scripts/export_parity_fixtures.py tests/test_web_exports.py epichat/params/migrate.py web/data/param_registry.json web/tests/fixtures/parity.json web/lib/sim/registry.ts web/lib/sim/paths.ts web/lib/sim/params.ts web/tests/sim/registry.test.ts web/tests/sim/paths.test.ts web/tests/sim/params.test.ts web/tests/sim/parity.test.ts
git commit -m "feat(web): schema v2, v1 migration and exact R0 in TypeScript; registry export and v2 parity fixtures"
```

### Task 7: The web app reads and writes v2

Every consumer of the flat shape moves to the nested one; stored v1 rows are coerced on read. This task also carries the two phase 2 web pieces that belong with the schema switch: gamma defaults for durations the configure tool creates (spec 7.3, section 18 ruling), and the `n_infectious` series key with `n_infected` as the fallback.

**Files:**
- Create: `web/lib/tools/durations.ts`
- Modify: `web/lib/tools/configureSimulation.ts`, `configView.ts`, `shared.ts`, `runSimulation.ts`, `fetchDemographics.ts`, `fetchVaccinationCoverage.ts`, `fetchHealthSystem.ts`, `types.ts`; `web/lib/sim/client.ts`; `web/lib/chat/handleChat.ts`; `web/lib/client/format.ts`, `artifacts.ts`, `chart.ts`; `web/lib/report/compose.ts`; `web/lib/db/runs.ts`; `web/components/panel/RunsSection.tsx`
- Test: `web/tests/tools/durations.test.ts` (new); updates in `web/tests/tools/configureSimulation.test.ts`, `fetchTools.test.ts`, `runSimulation.test.ts`, `registry.test.ts`, `web/tests/client/format.test.ts`, `artifacts.test.ts`, `chart.test.ts`, `web/tests/chat/handleChat.test.ts`, `web/tests/db/stores.test.ts`, `web/tests/report/compose.test.ts`, `web/tests/report/fixture.ts` and any other file `npm run typecheck` names.

**Interfaces:**
- Consumes: everything Task 6 exports from `params.ts`, `paths.ts`; `lookup` from `@/lib/disease/db`.
- Produces: `durations.ts` exports `DurationName`, `illustrativeSd(name, mean, disease)`, `durationFor(existing, mean, name, disease)`. `format.ts` exports `durationText(d)`, `seedText(s)`, `EFFECTIVE_PARAM_PATHS`, `effectiveParameterRows(p)` beside the existing `parameterRows(p)`. `client.ts` adds `Replicates` and `SimSuccess.replicates?: Replicates | null`. `types.ts` adds `RunPayload.replicates?: ReplicateSummary` (`{ n, seeds, representative, stats }`, no bands). `chart.ts` lines accept `alt`.

The flat-to-v2 mapping every test edit follows:

| v1 field | v2 path |
|---|---|
| `disease_type` | `disease.model` |
| `beta`, `p_death`, `p_asymp`, `rel_trans_asymp` | `disease.<same>` |
| `dur_inf`, `dur_exp`, `dur_immune` | `disease.<same>.mean_days` (absent → `null`) |
| `init_prev` | `disease.seed.value` (`mode: "fraction"`) |
| day-0 vaccine | `disease.initial_immune_frac`; later vaccines stay in `interventions` |
| `n_contacts`, `network_type`, `network_beta` | `network.<same>` |
| `use_demographics`, `birth_rate`, `death_rate`, `age_pct_*`, `country`, `auto_demographics`, `demographics_year`, `demographics_source` | `demographics.<same>` |
| `n_agents`, `sim_dur_years`, `rand_seed` | `run.<same>` |

The test helper `params(input)` in `web/tests/tools/helpers.ts` keeps taking flat input (it goes through `validateParams`, which migrates), so fixtures need no change; only assertions that read fields do.

- [ ] **Step 1: Write the failing tests**

`web/tests/tools/durations.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { durationFor, illustrativeSd } from "@/lib/tools/durations";

describe("duration defaults for new scenarios (spec 7.3)", () => {
  it("takes a quarter of the database range when the disease is known and the range is real", () => {
    expect(illustrativeSd("dur_exp", 12, "measles")).toBe(3.5);          // incubation 7–21 days
    expect(illustrativeSd("dur_inf", 8, "measles")).toBe(2.4);           // infectious 8–8: min == max, so 0.3 × mean
    expect(illustrativeSd("dur_inf", 10, null)).toBe(3);
    expect(illustrativeSd("dur_immune", 400, "ebola")).toBe(120);        // no upper bound in the database
  });

  it("caps the sd at the mean so the gamma stays valid", () => {
    expect(illustrativeSd("dur_inf", 20, "tuberculosis")).toBe(20);      // 14–365 days would give 87.75
  });

  it("creates gamma, keeps an existing distribution, recomputes a non-constant sd", () => {
    expect(durationFor(undefined, 8, "dur_inf", "measles")).toEqual({ mean_days: 8, dist: "gamma", sd_days: 2.4 });
    expect(durationFor({ mean_days: 10, dist: "constant", sd_days: null }, 8, "dur_inf", "measles")).toEqual({ mean_days: 8, dist: "constant", sd_days: null });
    expect(durationFor({ mean_days: 10, dist: "lognormal", sd_days: 1 }, 20, "dur_inf", null)).toEqual({ mean_days: 20, dist: "lognormal", sd_days: 6 });
  });
});
```

In `web/tests/tools/configureSimulation.test.ts` change these assertions (the rest of each test stays):

```ts
// "creates params from scratch": new scenarios get gamma durations with the illustrative sd
    expect(deps.scenario.params?.run.n_agents).toBe(50000);
    expect(deps.scenario.params?.demographics.country).toBe("BRA");
    expect(deps.scenario.params?.disease.beta).toBe(22.8125);
    expect(deps.scenario.params?.disease.dur_inf).toEqual({ mean_days: 10, dist: "gamma", sd_days: 0.75 });   // dengue infectious 2–5 days
// "merges without losing prior fields"
    expect(deps.scenario.params?.run.n_agents).toBe(100000);
    expect(deps.scenario.params?.demographics.country).toBe("BRA");
// "returns a CONFIG ERROR and preserves state on an invalid value"
    expect(out.content).toMatch(/^CONFIG ERROR: 1 validation error for SimParams\nrun\.n_agents\n/);
// "calibrates beta to r0": exact formula, gamma infectious period of 8 days (measles 8–8 gives sd 2.4): D_eff 7.5
    const out = JSON.parse((await run(deps, { disease: "measles", disease_type: "sir", r0: 15, dur_inf: 8 })).content);
    expect(out.approx_r0).toBe(15);
    expect(deps.scenario.params?.disease.beta).toBeCloseTo(-365 * Math.log(1 - 15 / (4 * 7.5)), 5);
    expect(out.applied.r0).toBe(15);
// "handles vaccine coverage and start day like the agent": day 0 is initial immunity, a later day a campaign
    await run(deps, { disease: "measles", vaccine_coverage: 0.8 });
    expect(deps.scenario.params!.disease.initial_immune_frac).toBe(0.8);
    expect(getVaccine(deps.scenario.params!)).toBeNull();
    await run(deps, { vaccine_start_day: 60 });
    expect(getVaccine(deps.scenario.params!)).toMatchObject({ coverage: 0.8, start_day: 60 });
    expect(deps.scenario.params!.disease.initial_immune_frac).toBe(0);
// "upserts treatment and seasonality and lists intervention types in order": the day-0 vaccine is initial immunity, not an intervention
    expect(out.config.interventions).toEqual(["seasonality", "treatment"]);
    expect(deps.scenario.params!.disease.initial_immune_frac).toBe(0.6);
// "starts a new scenario when asked"
    expect(deps.scenario.params?.run.n_agents).toBe(10000);
    expect(deps.scenario.params?.demographics.country).toBeNull();
```

and add two tests:

```ts
  it("refuses an R0 the contacts and infectious period cannot carry, naming the levers", async () => {
    const deps = makeDeps();
    const out = await run(deps, { disease: "dengue", dur_inf: 2, r0: 10 });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/^CONFIG ERROR: R0 10 is not reachable: the most the contacts and infectious period can carry is \d+\.\d\d; raise network\.n_contacts or disease\.dur_inf\.mean_days\./);
    expect(deps.scenario.params).toBeNull();
  });

  it("keeps a constant duration constant when its mean changes, and seeds by fraction", async () => {
    const deps = makeDeps({ scenario: { ...emptyScenario(), params: params({ dur_inf: 10 }) } });
    await run(deps, { dur_inf: 12, init_prev: 0.02 });
    expect(deps.scenario.params?.disease.dur_inf).toEqual({ mean_days: 12, dist: "constant", sd_days: null });
    expect(deps.scenario.params?.disease.seed).toEqual({ mode: "fraction", value: 0.02, day: 0 });
  });
```

(import `emptyScenario` from `@/lib/tools/types` and `params` from `./helpers`.)

In `web/tests/tools/fetchTools.test.ts`: `p.network_type` → `p.network.network_type`; `p.birth_rate` → `p.demographics.birth_rate`; `params?.birth_rate` → `params?.demographics.birth_rate`; `params!.beta` → `params!.disease.beta`; `params!.network_type` → `params!.network.network_type`; `params!.use_demographics` → `params!.demographics.use_demographics`; the payload assertion `params.network_type` → `params.network.network_type`; in the vaccination tests the first call's expectations become `expect(deps.scenario.params!.disease.initial_immune_frac).toBe(0.88)` and `expect(getVaccine(deps.scenario.params!)).toBeNull()`, the second call (already covered) keeps one immunity value (`toHaveLength(1)` on vaccines becomes `expect(deps.scenario.params!.disease.initial_immune_frac).toBe(0.88)`), and the payload match becomes `{ kind: "data", params: { disease: { initial_immune_frac: 0.88 } } }`. The existing test at lines 64 to 71 already covers `beta_recalibrated_to_hold_r0`; a held R0 cannot be unreachable there, because the tool only ever switches to the age-structured network, whose contact scale is larger.

In `web/tests/tools/runSimulation.test.ts` add to the first test's success fixture `series: { day: [0, 1], n_infectious: [500, 600], n_infected: [500, 600] }` and add:

```ts
  it("warns that deaths count the disease only when demographics are on, and summarizes replicates without the bands", async () => {
    const replicates = { n: 3, seeds: [1, 2, 3], representative: 2, stats: [STATS, STATS, STATS], bands: { n_infectious: { p10: [1, 2], p90: [3, 4] }, cum_infections: { p10: [1, 2], p90: [3, 4] } } };
    const deps = makeDeps({ simulate: success({ replicates }) });
    await configureSimulation({ disease: "dengue", country_iso3: "KEN" } as never, deps);
    deps.scenario.params = params({ ...deps.scenario.params, demographics: { ...deps.scenario.params!.demographics, use_demographics: true } });
    const out = await runSimulation({}, deps);
    const body = JSON.parse(out.content);
    expect(body.warnings).toContain("Deaths in this run count disease deaths only; deaths from the background death rate are reported separately as cum_deaths_all.");
    expect(body.replicates).toEqual({ n: 3, seeds: [1, 2, 3], representative: 2, stats: [STATS, STATS, STATS] });
    expect(out.payload).toMatchObject({ kind: "run", replicates: { n: 3 } });
    expect((out.payload as { replicates?: { bands?: unknown } }).replicates?.bands).toBeUndefined();
  });
```

In `web/tests/tools/registry.test.ts:63`: `params?.n_agents` → `params?.run.n_agents`.

In `web/tests/client/format.test.ts` "parameter rows": the expected first list becomes

```ts
      ["R₀ (approx.)", approxR0(p).toFixed(1)],
      ["Transmission rate (β)", "171.1"],
      ["Contacts per day", "4"],
      ["Contact network", "random"],
      ["Initial infections", "1%"],
      ["Infectious period", "8 days"],
      ["Exposed period", "11 days"],
      ["Death probability", "0.1%"],
      ["Agents", "10,000"],
      ["Duration", "1 year"],
      ["Births and deaths", "not modelled"],
```

(import `approxR0` from `@/lib/sim/params`), and add to the second test: `expect(parameterRows(params({ schema_version: 2, disease: { dur_inf: { mean_days: 8, dist: "gamma", sd_days: 2.4 }, seed: { mode: "count", value: 20, day: 5 }, initial_immune_frac: 0.4 }, run: { n_replicates: 3 } }))).toEqual(expect.arrayContaining([["Infectious period", "8 days, gamma (sd 2.4)"], ["Initial infections", "20 agents on day 5"], ["Initially immune", "40%"], ["Replicates", "3"]]));` and a third describe:

```ts
describe("effective parameter rows", () => {
  it("lists the v2 paths a run used, skipping unset ones", () => {
    const rows = effectiveParameterRows(params({ disease_type: "seir", dur_exp: 11, rand_seed: 4 }));
    expect(rows).toContainEqual(["disease.model", "seir"]);
    expect(rows).toContainEqual(["disease.dur_exp.mean_days", "11"]);
    expect(rows).toContainEqual(["run.rand_seed", "4"]);
    expect(rows.map(([k]) => k)).not.toContain("disease.dur_immune.mean_days");
  });
});
```

In `web/tests/client/chart.test.ts` lines 7 to 10: the series gains `n_infectious: [1, 2, 3]` and the expected keys read `n_infectious` in place of `n_infected`; add `expect(seriesFor("infected", { day: [0], n_infected: [1] }).map((l) => l.key)).toEqual(["n_infectious"]);` (the fallback for stored runs keeps the line's key).

In `web/tests/client/artifacts.test.ts:80`: `.params?.n_agents` → `.params?.run.n_agents`; add `expect(deriveArtifacts([{ id: "t0", blocks: [result("configure_simulation", { ...CONFIG(true), params: { disease_type: "sir", beta: 5, n_agents: 123 } })] }]).params?.run.n_agents).toBe(123);` (a stored v1 payload is migrated on read).

In `web/tests/chat/handleChat.test.ts:321`: `(payload.scenario.params as { run: { n_agents: number } }).run.n_agents`.

In `web/tests/report/compose.test.ts` and `fixture.ts`: nothing changes in the fixtures (flat input migrates); the "Run 2, vaccine coverage 90%" label still holds because `runLabels` now reads `initial_immune_frac` for a day-0 vaccine.

In `web/tests/db/stores.test.ts`: the `listForReport` rows with `effective_params: {}` still read (an empty object migrates to the defaults).

- [ ] **Step 2: Run the web suite to verify it fails**

Run: `cd web && npx vitest run tests/tools tests/client tests/chat tests/report tests/db`
Expected: FAIL; `npm run typecheck` reports the flat-field reads in the files listed above.

- [ ] **Step 3: Write the code**

`web/lib/tools/durations.ts`:

```ts
import { lookup } from "@/lib/disease/db";
import type { Duration } from "@/lib/sim/params";
import { pyRound } from "@/lib/sim/pyformat";

export type DurationName = "dur_exp" | "dur_inf" | "dur_immune";
const DB_FIELD: Record<DurationName, string> = { dur_exp: "incubation_days", dur_inf: "infectious_days", dur_immune: "immunity_duration" };
const DAYS_PER_UNIT: Record<string, number> = { days: 1, weeks: 7, months: 30.44, years: 365.25 };

/** Spec 7.3: (max − min) / 4 from the database consensus range when the disease is known and min < max, else 0.3 × mean. Capped at the mean so the gamma stays valid (section 18). The sd is an illustrative assumption either way. */
export function illustrativeSd(name: DurationName, mean: number, disease: string | null): number {
  const flat = disease ? (lookup(disease)?.flat[DB_FIELD[name]] ?? null) : null;
  let sd = 0.3 * mean;
  if (flat && flat.min !== null && flat.max !== null && flat.min < flat.max) sd = ((flat.max - flat.min) * (DAYS_PER_UNIT[flat.unit ?? "days"] ?? 1)) / 4;
  return pyRound(Math.min(sd, mean), 4);
}

/** A created duration is gamma with the illustrative sd; an existing one keeps its distribution, with the sd recomputed when it is not constant. */
export function durationFor(existing: Duration | null | undefined, mean: number, name: DurationName, disease: string | null): Duration {
  if (!existing) return { mean_days: mean, dist: "gamma", sd_days: illustrativeSd(name, mean, disease) };
  if (existing.dist === "constant") return { mean_days: mean, dist: "constant", sd_days: null };
  return { mean_days: mean, dist: existing.dist, sd_days: illustrativeSd(name, mean, disease) };
}
```

`web/lib/tools/configureSimulation.ts` (replace the body after `ConfigureSimulationInput`; the input schema is unchanged):

```ts
import { z } from "zod";
import { detectDisease } from "@/lib/disease/db";
import { R0UnreachableError, approxR0, validateParams, withR0, type Duration, type SimParams } from "@/lib/sim/params";
import { pyRound } from "@/lib/sim/pyformat";
import { configView } from "./configView";
import { durationFor, type DurationName } from "./durations";
import { errorOutcome, given, paramWarnings, upsertIntervention } from "./shared";
import { resetScenario, type ToolDeps, type ToolOutcome } from "./types";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish();

export const ConfigureSimulationInput = z.strictObject({ /* unchanged */ });
export type ConfigureSimulationArgs = z.infer<typeof ConfigureSimulationInput>;

type Obj = Record<string, unknown>;
const DURATIONS: DurationName[] = ["dur_inf", "dur_exp", "dur_immune"];

const block = (base: Obj, key: string): Obj => {
  if (typeof base[key] !== "object" || base[key] === null) base[key] = {};
  return base[key] as Obj;
};

/** Ported from epichat/agent.py configure_simulation, on schema v2, plus start_new_scenario and the gamma defaults of spec 7.3. */
export async function configureSimulation(input: ConfigureSimulationArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const newScenario = input.start_new_scenario === true;
  if (newScenario) {
    resetScenario(deps.scenario);
    deps.onScenarioStart();
  }
  const scenario = deps.scenario;
  const fresh = scenario.params === null;
  const base: Obj = scenario.params ? (structuredClone(scenario.params) as unknown as Obj) : { schema_version: 2 };
  const disease = block(base, "disease");
  const run = block(base, "run");
  const demographics = block(base, "demographics");
  const applied: Obj = {};

  if (given(input.disease)) {
    scenario.disease = detectDisease(input.disease) ?? input.disease.toLowerCase();
    applied.disease = scenario.disease;
  }
  if (given(input.disease_type)) {
    disease.model = input.disease_type;
    applied.disease_type = input.disease_type;
  }
  if (given(input.n_agents)) {
    run.n_agents = input.n_agents;
    applied.n_agents = input.n_agents;
  }
  if (given(input.sim_dur_years)) {
    run.sim_dur_years = input.sim_dur_years;
    applied.sim_dur_years = input.sim_dur_years;
  }
  for (const name of DURATIONS) {
    const value = input[name];
    if (given(value)) {
      disease[name] = durationFor(disease[name] as Duration | null | undefined, value, name, scenario.disease);
      applied[name] = value;
    }
  }
  if (fresh && !given(input.dur_inf)) disease.dur_inf = durationFor(undefined, 10, "dur_inf", scenario.disease);
  if (given(input.p_death)) {
    disease.p_death = input.p_death;
    applied.p_death = input.p_death;
  }
  if (given(input.p_asymp)) {
    disease.p_asymp = input.p_asymp;
    applied.p_asymp = input.p_asymp;
  }
  if (given(input.init_prev)) {
    disease.seed = { mode: "fraction", value: input.init_prev, day: 0 };
    applied.init_prev = input.init_prev;
  }
  if (given(input.country_iso3)) {
    demographics.country = input.country_iso3;
    applied.country = input.country_iso3;
  }

  let interventions = [...((base.interventions as Obj[] | undefined) ?? [])];
  if (given(input.vaccine_coverage) || given(input.vaccine_start_day)) {
    // A day-0 vaccine lives in disease.initial_immune_frac (spec 6.1, section 18); a later start is a routine campaign.
    const immune = Number(disease.initial_immune_frac ?? 0);
    const current = interventions.find((i) => i.type === "vaccine") ?? (immune > 0 ? { coverage: immune, start_day: 0 } : {});
    const coverage = given(input.vaccine_coverage) ? input.vaccine_coverage : (current.coverage as number | null | undefined);
    const startDay = given(input.vaccine_start_day) ? input.vaccine_start_day : ((current.start_day as number | undefined) ?? 0);
    if (!given(coverage)) {
      return errorOutcome("CONFIG ERROR: a vaccination campaign needs a coverage level — pass vaccine_coverage alongside vaccine_start_day.");
    }
    interventions = interventions.filter((i) => i.type !== "vaccine");
    if (startDay > 0) {
      interventions = upsertIntervention(interventions, "vaccine", { coverage, start_day: startDay });
      disease.initial_immune_frac = 0;
    } else {
      disease.initial_immune_frac = Math.min(coverage, 0.99);
    }
    applied.vaccine_coverage = coverage;
    applied.vaccine_start_day = startDay;
  }
  if (given(input.treatment_capacity)) {
    interventions = upsertIntervention(interventions, "treatment", { coverage: 1.0, capacity: input.treatment_capacity });
    applied.treatment_capacity = input.treatment_capacity;
  }
  if (given(input.seasonality_scale)) {
    interventions = upsertIntervention(interventions, "seasonality", { scale: input.seasonality_scale });
    applied.seasonality_scale = input.seasonality_scale;
  }
  base.interventions = interventions;

  const validated = validateParams(base);
  if (!validated.ok) return errorOutcome(`CONFIG ERROR: ${validated.error}`);
  let params: SimParams = validated.params;
  if (given(input.r0)) {
    try {
      params = withR0(params, input.r0);
    } catch (error) {
      if (error instanceof R0UnreachableError) return errorOutcome(`CONFIG ERROR: ${error.message}.`);
      throw error;
    }
    const revalidated = validateParams(params);
    if (!revalidated.ok) return errorOutcome(`CONFIG ERROR: ${revalidated.error}`);
    params = revalidated.params;
    applied.r0 = input.r0;
  }

  scenario.params = params;
  scenario.countryIso3 = params.demographics.country;
  const warnings = paramWarnings(scenario, params, deps.contextText);
  const config = configView(params, scenario.disease);
  const approx_r0 = pyRound(approxR0(params), 2);
  return {
    content: JSON.stringify({ applied, approx_r0, config, warnings }),
    payload: { kind: "config", applied, approx_r0, config, warnings, new_scenario: newScenario, params },
  };
}
```

`web/lib/tools/configView.ts`:

```ts
export function configView(params: SimParams, disease: string | null): ConfigPayload["config"] {
  return {
    disease,
    disease_type: params.disease.model,
    country: params.demographics.country,
    n_agents: params.run.n_agents,
    sim_dur_years: params.run.sim_dur_years,
    dur_inf: params.disease.dur_inf.mean_days,
    dur_exp: params.disease.dur_exp?.mean_days ?? null,
    interventions: params.interventions.map((i) => i.type),
  };
}
```

`web/lib/tools/shared.ts` `paramWarnings`:

```ts
export function paramWarnings(scenario: Scenario, params: SimParams, contextText: string): string[] {
  const disease = scenario.disease ?? detectDisease(contextText || "");
  if (!disease) return [];
  const d = params.disease;
  return checkParams(disease, approxR0(params), d.dur_inf.mean_days, d.dur_exp?.mean_days ?? null, {
    pDeath: d.p_death || null,
    nContacts: params.network.n_contacts,
    durImmune: d.dur_immune?.mean_days ?? null,
    pAsymp: d.model === "seiar" ? d.p_asymp : null,
  });
}

/** Notes about how the run is read, beside the literature warnings. */
export function runNotes(params: SimParams): string[] {
  return params.demographics.use_demographics
    ? ["Deaths in this run count disease deaths only; deaths from the background death rate are reported separately as cum_deaths_all."]
    : [];
}
```

`web/lib/tools/runSimulation.ts`: `params.n_agents` → `params.run.n_agents` (two places), `const warnings = [...paramWarnings(scenario, params, deps.contextText), ...runNotes(params)];` (import `runNotes` from `./shared`), and after `const sources = ...`:

```ts
  const replicates = result.replicates ? { n: result.replicates.n, seeds: result.replicates.seeds, representative: result.replicates.representative, stats: result.replicates.stats } : undefined;
```

with `replicates` added to both the payload object and the content object (`...(replicates ? { replicates } : {})`).

`web/lib/sim/client.ts` after `SimStats`:

```ts
export type Replicates = { n: number; seeds: number[]; representative: number; stats: SimStats[]; bands: Record<string, { p10: number[]; p90: number[] }> };
```

and `SimSuccess` gains `replicates?: Replicates | null;`. `web/lib/tools/types.ts` `RunPayload` gains `replicates?: { n: number; seeds: number[]; representative: number; stats: SimStats[] };`.

`web/lib/tools/fetchDemographics.ts` lines 31 to 60 become:

```ts
    const before = scenario.params;
    const r0Before = approxR0(before);
    const base = structuredClone(before) as unknown as Record<string, unknown>;
    const network = base.network as Record<string, unknown>;
    const demographics = base.demographics as Record<string, unknown>;
    const applied: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.field === "age_distribution_pct" && isRecord(f.value)) {
        network.network_type = "age_structured";
        demographics.age_pct_under18 = f.value["0-17"];
        demographics.age_pct_18_64 = f.value["18-64"];
        demographics.age_pct_over65 = f.value["65+"];
        applied.age_structure_pct = f.value;
      } else if (f.field === "total_population") {
        scenario.totalPopulation = Math.trunc(Number(f.value));
        applied.total_population = scenario.totalPopulation;
      } else if (f.field === "birth_rate" || f.field === "death_rate") {
        demographics[f.field] = f.value;
        demographics.use_demographics = true;
        applied[f.field] = f.value;
      }
    }
    demographics.country = iso3;
    const validated = validateParams(base);
    if (!validated.ok) throw new Error(validated.error);
    let params = validated.params;
    if (params.network.network_type !== before.network.network_type) {
      // The network switch changes what R0 a beta implies; hold the R0 the user confirmed when the new network can carry it.
      const held = recalibrateBeta(params, r0Before, before);
      if (held.disease.beta !== params.disease.beta) {
        params = held;
        applied.beta_recalibrated_to_hold_r0 = pyRound(r0Before, 2);
      } else {
        applied.r0_unreachable_on_new_network = pyRound(r0Before, 2);
      }
      applied.network_type = params.network.network_type;
    }
```

`web/lib/tools/fetchVaccinationCoverage.ts` lines 33 to 42:

```ts
    if (cov && !getVaccine(scenario.params) && scenario.params.disease.initial_immune_frac === 0) {
      const coverage = Math.min(0.99, Number(cov.value) / 100);
      const validated = validateParams({ ...scenario.params, disease: { ...scenario.params.disease, initial_immune_frac: coverage } });
      if (!validated.ok) throw new Error(validated.error);
      scenario.params = validated.params;
      applied.applied_vaccine_coverage = coverage;
    }
```

`web/lib/tools/fetchHealthSystem.ts`: `scenario.params.n_agents` → `scenario.params.run.n_agents`.

`web/lib/chat/handleChat.ts:193`: `n_agents: record.params.run.n_agents, sim_dur_years: record.params.run.sim_dur_years`.

`web/lib/client/format.ts`: import `getPath` from `@/lib/sim/paths` and `type Duration, type Seed` from params; replace `parameterRows` and add the helpers:

```ts
/** "8 days", or "8 days, gamma (sd 2.4)" for a distributed period. */
export function durationText(d: Duration): string {
  const mean = formatQuantity(d.mean_days, "days");
  return d.dist === "constant" ? mean : `${mean}, ${d.dist} (sd ${fmtValue(d.sd_days ?? 0)})`;
}

/** "1%", "20 agents", "20 agents on day 5". */
export function seedText(s: Seed): string {
  const size = s.mode === "count" ? `${commaInt(s.value)} agents` : formatQuantity(s.value, "fraction");
  return s.day > 0 ? `${size} on day ${fmtValue(s.day)}` : size;
}

export function parameterRows(p: SimParams): [string, string][] {
  const d = p.disease;
  const g = p.demographics;
  const asymptomatic = d.model === "seiar";
  const ages = g.age_pct_under18 !== null && g.age_pct_18_64 !== null && g.age_pct_over65 !== null;
  const row = (label: string, value: string): [string, string][] => [[label, value]];
  return [
    ["R₀ (approx.)", approxR0(p).toFixed(1)],
    ["Transmission rate (β)", fmtValue(d.beta)],
    ["Contacts per day", fmtValue(p.network.n_contacts)],
    ["Contact network", p.network.network_type.replace(/_/g, "-")],
    ["Initial infections", seedText(d.seed)],
    ...(d.initial_immune_frac > 0 ? row("Initially immune", formatQuantity(d.initial_immune_frac, "fraction")) : []),
    ["Infectious period", durationText(d.dur_inf)],
    ...(d.dur_exp ? row("Exposed period", durationText(d.dur_exp)) : []),
    ...(d.dur_immune ? row("Immunity duration", durationText(d.dur_immune)) : []),
    ...(d.model === "sis" && d.sis_waning > 0 ? row("Immunity waning", `${fmtValue(d.sis_waning)} per year`) : []),
    ...(d.model !== "sis" ? row("Death probability", formatQuantity(d.p_death, "fraction")) : []),
    ...(asymptomatic ? [...row("Asymptomatic share", formatQuantity(d.p_asymp, "fraction")), ...row("Asymptomatic transmission", `${formatQuantity(d.rel_trans_asymp, "fraction")} of symptomatic`)] : []),
    ["Agents", commaInt(p.run.n_agents)],
    ["Duration", formatQuantity(p.run.sim_dur_years, "years")],
    ...(p.run.n_replicates > 1 ? row("Replicates", fmtValue(p.run.n_replicates)) : []),
    ["Births and deaths", g.use_demographics ? `${fmtValue(g.birth_rate)} and ${fmtValue(g.death_rate)} per 1,000 per year` : "not modelled"],
    ...(ages ? row("Age structure", ageStructure({ "0-17": g.age_pct_under18!, "18-64": g.age_pct_18_64!, "65+": g.age_pct_over65! })) : []),
    ...(p.run.rand_seed !== null ? row("Random seed", fmtValue(p.run.rand_seed)) : []),
  ];
}

/** The v2 paths a run's effective parameters are listed by, in the runs panel and the report appendix. */
export const EFFECTIVE_PARAM_PATHS = [
  "disease.model", "run.n_agents", "run.sim_dur_years", "disease.beta", "network.n_contacts", "network.network_type",
  "disease.seed.value", "disease.seed.mode", "disease.dur_inf.mean_days", "disease.dur_inf.dist", "disease.dur_exp.mean_days",
  "disease.dur_immune.mean_days", "disease.p_death", "disease.initial_immune_frac", "demographics.use_demographics",
  "demographics.birth_rate", "demographics.death_rate", "run.n_replicates", "run.rand_seed",
] as const;

export function effectiveParameterRows(p: SimParams): [string, string][] {
  const obj = p as unknown as Record<string, unknown>;
  return EFFECTIVE_PARAM_PATHS.flatMap((path) => {
    const value = getPath(obj, path);
    return value === null || value === undefined ? [] : [[path, fmtValue(value)] as [string, string]];
  });
}
```

(`interventionLines` is unchanged.) `web/lib/client/artifacts.ts` lines 70 to 82: import `coerceParams`; `out.params = coerceParams(payload.params ?? null);` for config; for data `const p = coerceParams(payload.params ?? null); if (p) out.params = p;`; for run:

```ts
        const effective = coerceParams(payload.effective_params);
        out.runs.push({ turnId: turn.id, index: out.runs.length + 1, payload: effective ? { ...payload, effective_params: effective } : payload });
        if (effective) out.params = effective;
```

`web/lib/client/chart.ts`: the line type gains `alt?: string`; the two `n_infected` entries become `{ key: "n_infectious", alt: "n_infected", label: ... }`; `seriesFor`:

```ts
export function seriesFor(view: ChartView, series: Series): Line[] {
  return LINES[view].flatMap((line) => {
    const values = Array.isArray(series[line.key]) && series[line.key].length > 0 ? series[line.key] : line.alt && Array.isArray(series[line.alt]) && series[line.alt].length > 0 ? series[line.alt] : null;
    return values ? [{ key: line.key, label: line.label, color: line.color, values }] : [];
  });
}
```

`web/lib/report/compose.ts`: `scenario.params.disease_type` → `scenario.params.disease.model`; `scenario.params.sim_dur_years` → `scenario.params.run.sim_dur_years`; in `runLabels` the vaccine coverage reads `const cov = intervention(run, "vaccine")?.coverage ?? (run.effectiveParams.disease.initial_immune_frac > 0 ? run.effectiveParams.disease.initial_immune_frac : undefined);` and the same for `prevCov`; `run.effectiveParams.n_agents` → `run.effectiveParams.run.n_agents`; `hasCurve`/the figure use `const curve = (run: ReportRun) => run.series?.n_infectious ?? run.series?.n_infected;` (`hasCurve` checks `Array.isArray(curve(run))`, `figureLine(labels[i], run.series!.day, curve(run)!)`); the appendix table uses `EFFECTIVE_PARAM_PATHS` and `getPath` in place of `PARAM_KEYS` (`present = EFFECTIVE_PARAM_PATHS.filter((path) => runs.some((run) => getPath(run.effectiveParams as unknown as Record<string, unknown>, path) != null))`, rows `[path, ...runs.map((run) => fmtValue(getPath(...) ?? null))]`); delete the local `PARAM_KEYS`.

`web/lib/db/runs.ts` `listForReport`: `.map((row) => ({...}))` becomes `.flatMap((row) => { const effectiveParams = coerceParams(row.effective_params); if (!effectiveParams) { console.error(\`run ${row.id} has unusable effective_params\`); return []; } return [{ ...as before with effectiveParams }]; })`; the row type's `effective_params` becomes `unknown`.

`web/components/panel/RunsSection.tsx`: delete `PARAM_KEYS`, import `effectiveParameterRows` from `@/lib/client/format`, and the `<dl>` block's first part becomes:

```tsx
              {effectiveParameterRows(p.effective_params).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-ink-faint">{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
```

- [ ] **Step 4: Run the web suite, typecheck and lint**

Run: `cd web && npm run typecheck && npm run lint && npx vitest run`
Expected: typecheck clean, lint clean, all test files pass. Fix any assertion the mapping table covers that this plan did not list; each such edit is one line.

- [ ] **Step 5: Commit**

```bash
git add web/lib web/components web/tests
git commit -m "feat(web): tools, panel and report on schema v2; gamma durations for new scenarios; n_infectious with the n_infected fallback"
```

### Task 8: Models, phase 2: `rel_trans_base`, symptomatic-only SEIAR deaths

**Files:**
- Modify: `epichat/sim/models.py`
- Test: `tests/test_sim_models.py` (extend)

**Interfaces:**
- Consumes: nothing new (the models take Starsim parameters from the builder).
- Produces: every EpiChat model carries a `rel_trans_base` float state (default 1.0) that the connector of Task 9 multiplies into `rel_trans`; `SEIAR` sets `rel_trans_base` (never `rel_trans`) to `rel_trans_asymp` for asymptomatic agents and draws `p_death` for symptomatic infections only; `clear_infection` resets `rel_trans_base` to 1.0. `MODELS` is unchanged.

- [ ] **Step 1: Write the failing tests**

`tests/test_sim_models.py` defines `run(model, days=40, n=800, seed=1, **pars)`, which builds a sim on a random network from the Starsim parameters it is given. Append:

```python
def _pars(name, **over):
    pars = dict(init_prev=ss.bernoulli(p=0.05), beta=ss.peryear(30), dur_inf=ss.constant(ss.days(5)))
    if name != "sis":
        pars["p_death"] = ss.bernoulli(p=0.0)
    if name in ("seir", "seirs", "seiar"):
        pars["dur_exp"] = ss.constant(ss.days(2))
    if name in ("sirs", "seirs"):
        pars["dur_immune"] = ss.constant(ss.days(30))
    pars.update(over)
    return pars


@pytest.mark.parametrize("name", sorted(MODELS))
def test_every_model_has_a_transmissibility_base_state(name):
    sim = run(MODELS[name], days=2, **_pars(name))
    d = sim.diseases[0]
    assert float(np.mean(d.rel_trans_base.values)) == 1.0 and len(d.rel_trans_base) == len(sim.people)


def test_seiar_asymptomatic_agents_lower_the_base_not_rel_trans_directly():
    sim = run(SEIAR, days=3, n=2000, init_prev=ss.choose_n(1000), beta=ss.peryear(1e-6),
              dur_exp=ss.constant(ss.days(1)), dur_inf=ss.constant(ss.days(10)), p_death=ss.bernoulli(p=0),
              p_asymp=ss.bernoulli(p=1.0), rel_trans_asymp=0.25)
    d = sim.diseases[0]
    asymp = d.asymptomatic.uids
    assert len(asymp) == 1000
    assert np.all(d.rel_trans_base[asymp] == 0.25)
    assert np.all(d.rel_trans.values == 1.0)          # without the connector of Task 9, rel_trans is untouched


def test_seiar_only_symptomatic_infections_die():
    common = dict(days=20, n=1000, init_prev=ss.choose_n(500), beta=ss.peryear(1e-6), dur_exp=ss.constant(ss.days(1)),
                  dur_inf=ss.constant(ss.days(3)), p_death=ss.bernoulli(p=0.5))
    all_asymp = run(SEIAR, p_asymp=ss.bernoulli(p=1.0), **common)
    assert all_asymp.results.seiar.new_deaths_disease.values.sum() == 0 and all_asymp.results.cum_deaths.values[-1] == 0
    none_asymp = run(SEIAR, p_asymp=ss.bernoulli(p=0.0), **common)
    deaths = none_asymp.results.seiar.new_deaths_disease.values.sum()
    assert 200 <= deaths <= 300                        # half of the 500 seeds, binomial spread (sd 11)


def test_seiar_recovery_restores_the_base():
    sim = run(SEIAR, days=6, n=500, init_prev=ss.choose_n(100), beta=ss.peryear(1e-6),
              dur_exp=ss.constant(ss.days(1)), dur_inf=ss.constant(ss.days(2)), p_death=ss.bernoulli(p=0),
              p_asymp=ss.bernoulli(p=1.0), rel_trans_asymp=0.5)
    d = sim.diseases[0]
    assert int(d.recovered.count()) == 100 and np.all(d.rel_trans_base.values == 1.0)
```

In the existing `test_seiar_marks_an_asymptomatic_share_with_reduced_transmissibility`, the two `rel_trans` assertions become `rel_trans_base` (the connector, not the model, writes `rel_trans` from phase 2 on):

```python
    assert np.all(d.rel_trans_base[d.asymptomatic.uids] == 0.5)
    ...
    assert np.all(d.rel_trans_base[symptomatic] == 1.0)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_models.py -q`
Expected: the new tests FAIL (`AttributeError: ... "rel_trans_base"`; asymptomatic agents die)

- [ ] **Step 3: Implement**

In `epichat/sim/models.py`, the mixin gains an `__init__` and the SEIAR hooks change:

```python
class EpiChatDisease:
    """Mixin for every EpiChat model: a transmissibility base state the
    connector composes into rel_trans (spec 8.4), and a disease-death counter."""

    def __init__(self, pars=None, **kwargs):
        super().__init__(pars=pars, **kwargs)
        self.define_states(ss.FloatArr("rel_trans_base", default=1.0, label="Base relative transmission"))

    def init_results(self):
        super().init_results()
        self.define_results(ss.Result("new_deaths_disease", dtype=int, scale=True, label="Disease deaths"))

    def step_state(self):
        if hasattr(self, "ti_dead"):   # ss.SIS has no deaths
            deaths = (self.ti_dead <= self.ti).uids
            if len(deaths):
                self.results.new_deaths_disease[self.ti] += len(deaths)
        super().step_state()
```

```python
class SEIAR(SEIR):
    """SEIR with an asymptomatic track: E -> I or A -> R; A transmits at rel_trans_asymp
    (through rel_trans_base) and never dies of the disease (spec 7.2)."""

    def __init__(self, pars=None, p_asymp=None, rel_trans_asymp=None, **kwargs):
        # unchanged

    def set_progression(self, uids):
        p = self.pars
        asymp = p.p_asymp.rvs(uids)
        self.asymp_track[uids] = asymp
        dur_inf = p.dur_inf.rvs(uids)
        will_die = p.p_death.rvs(uids) & ~asymp          # p_death is a case fatality ratio: symptomatic cases only
        dead, rec = uids[will_die], uids[~will_die]
        self.ti_dead[dead] = self.ti_infectious[dead] + dur_inf[will_die]
        self.ti_recovered[rec] = self.ti_infectious[rec] + dur_inf[~will_die]

    def step_state(self):
        becoming = (self.exposed & (self.ti_infectious <= self.ti)).uids
        super().step_state()
        asymp = becoming[self.asymp_track[becoming]]
        self.asymptomatic[asymp] = True
        self.rel_trans_base[asymp] = self.pars.rel_trans_asymp

    def clear_infection(self, uids):
        super().clear_infection(uids)
        self.asymptomatic[uids] = False
        self.asymp_track[uids] = False
        self.rel_trans_base[uids] = 1.0
```

Update the module docstring to describe the phase 2 behaviour. `SIS` is unchanged: the builder passes `waning` and `imm_boost` from the parameters.

- [ ] **Step 4: Run the model tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_models.py -q`
Expected: 20 passed

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/models.py tests/test_sim_models.py
git commit -m "feat(sim): rel_trans_base on every model; seiar draws p_death for symptomatic infections only (spec 7.1, 7.2)"
```

### Task 9: Interventions and the transmissibility connector

**Files:**
- Create: `epichat/sim/interventions.py`, `epichat/sim/connectors.py`
- Modify: `epichat/sim/builder.py` (move `SimpleTreatment` out; re-export it for the existing tests)
- Test: `tests/test_sim_interventions.py`, `tests/test_sim_connectors.py`

**Interfaces:**
- Consumes: `rel_trans_base` (Task 8); Starsim's `ss.Intervention`, `ss.Connector`, `ss.bernoulli`, `ss.choose_n`.
- Produces: `interventions.SimpleTreatment(prob, max_capacity, start_day)` (moved, unchanged), `interventions.SeedInfections(day: int, mode: str, value: float)` (at step `day`, infects susceptible agents with `ss.bernoulli(p=value)` or `ss.choose_n(int(value))` through `disease.set_prognoses(uids, sources=-1)`; records `n_seeded`), `interventions.InitialImmunity(frac: float)` (at step 0, picks that share of susceptible agents with `ss.bernoulli(p=frac)` and makes them immune per spec 8.3; records `n_immunised`), `connectors.TransmissibilityModifiers(disease: str, seasonality_scale: float = 0.0, seasonality_shift: float = 0.0)` (each step sets `rel_trans = rel_trans_base × factor`, `factor = max(0, 1 + scale × cos(2π(ti/365 − shift)))`; keeps `factors`).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_sim_interventions.py
"""Spec 8.3: delayed seeding and initial immunity as Starsim interventions
(CRN-safe distributions, no numpy generators)."""
import numpy as np
import pytest
import starsim as ss

from epichat.sim.interventions import InitialImmunity, SeedInfections, SimpleTreatment
from epichat.sim.models import MODELS

EXTRA = {"seir": dict(dur_exp=ss.constant(ss.days(3))), "seirs": dict(dur_exp=ss.constant(ss.days(3)), dur_immune=ss.constant(ss.days(5))),
         "seiar": dict(dur_exp=ss.constant(ss.days(3))), "sirs": dict(dur_immune=ss.constant(ss.days(5)))}


def build(name, interventions, days=12, n_agents=1000, init_prev=0.0, beta=22.8125, **pars):
    kw = dict(init_prev=ss.bernoulli(p=init_prev), beta=ss.peryear(beta), dur_inf=ss.constant(ss.days(4)))
    if name == "sis":
        kw.update(waning=ss.peryear(0), imm_boost=0)
    else:
        kw["p_death"] = ss.bernoulli(p=0.0)
    kw.update(EXTRA.get(name, {}))
    kw.update(pars)
    sim = ss.Sim(n_agents=n_agents, diseases=MODELS[name](**kw), networks=ss.RandomNet(n_contacts=4), interventions=interventions,
                 start=ss.days(0), dur=ss.days(days), dt=ss.days(1), verbose=0, rand_seed=1)
    sim.init()
    return sim


def test_seed_infections_by_count_on_a_later_day():
    sim = build("sir", [SeedInfections(day=3, mode="count", value=25)])
    sim.run()
    res = sim.results.sir
    assert list(res.n_infected.values[:3]) == [0.0, 0.0, 0.0]
    assert sim.interventions[0].n_seeded == 25
    assert res.new_infections.values[3] >= 25 and res.cum_infections.values[-1] >= 25   # seeds count: the sim was initialized


def test_seed_infections_by_fraction_is_reproducible():
    a = build("seir", [SeedInfections(day=2, mode="fraction", value=0.05)])
    b = build("seir", [SeedInfections(day=2, mode="fraction", value=0.05)])
    a.run(); b.run()
    assert 30 <= a.interventions[0].n_seeded <= 70
    assert a.interventions[0].n_seeded == b.interventions[0].n_seeded
    assert list(a.results.seir.cum_infections.values) == list(b.results.seir.cum_infections.values)


@pytest.mark.parametrize("name", sorted(MODELS))
def test_initial_immunity_takes_half_of_the_non_seeded_agents(name):
    sim = build(name, [InitialImmunity(frac=0.5)], init_prev=0.1, beta=0.001)
    sim.run()
    d = sim.diseases[0]
    n = sim.interventions[0].n_immunised
    assert 0.48 * 900 - 40 <= n <= 0.52 * 900 + 40
    if name == "sis":
        assert float(np.mean(d.rel_sus)) < 0.6 and (d.immunity > 0).count() == n
    else:
        assert d.recovered.count() >= n and d.susceptible.count() <= 1000 - n - 80


@pytest.mark.parametrize("name", ["sirs", "seirs"])
def test_initial_immunity_wanes_in_the_waning_models(name):
    sim = build(name, [InitialImmunity(frac=0.5)], init_prev=0.0, beta=0.001, days=12)
    sim.run()
    d = sim.diseases[0]
    assert sim.interventions[0].n_immunised > 400
    assert d.recovered.count() == 0 and d.susceptible.count() == 1000     # dur_immune 5 days: everyone is back


def test_initial_immunity_wanes_in_sis_at_sis_waning():
    held = build("sis", [InitialImmunity(frac=0.5)], init_prev=0.0, beta=0.001, waning=ss.peryear(0))
    held.run()
    waned = build("sis", [InitialImmunity(frac=0.5)], init_prev=0.0, beta=0.001, waning=ss.peryear(52.0))
    waned.run()
    assert float(np.mean(held.diseases[0].rel_sus)) == pytest.approx(0.5, abs=0.05)
    assert float(np.mean(waned.diseases[0].rel_sus)) > 0.8


def test_initial_immunity_never_picks_day_zero_seeds():
    sim = build("sir", [InitialImmunity(frac=0.99)], init_prev=0.1, beta=0.001)
    sim.run()
    assert sim.results.sir.n_infected.values[0] >= 60          # the seeds were not moved to recovered
    assert sim.interventions[0].n_immunised <= 900


def test_simple_treatment_still_lives_here():
    sim = build("sir", [SimpleTreatment(prob=1.0, max_capacity=5, start_day=0)], init_prev=0.1)
    sim.run()
    assert sim.results.sir.n_infected.values[1] < sim.results.sir.n_infected.values[0]
```

```python
# tests/test_sim_connectors.py
"""Spec 8.4: rel_trans is rel_trans_base × the active modifiers, every step."""
import math

import numpy as np
import starsim as ss

from epichat.sim.connectors import TransmissibilityModifiers
from epichat.sim.models import MODELS


def build(name, connector, **pars):
    kw = dict(init_prev=ss.bernoulli(p=0.5), beta=ss.peryear(22.8125), dur_inf=ss.constant(ss.days(30)), p_death=ss.bernoulli(p=0.0))
    kw.update(pars)
    sim = ss.Sim(n_agents=500, diseases=MODELS[name](**kw), networks=ss.RandomNet(n_contacts=4), connectors=connector,
                 start=ss.days(0), dur=ss.days(100), dt=ss.days(1), verbose=0, rand_seed=1)
    return sim


def test_without_seasonality_rel_trans_equals_the_base():
    sim = build("seiar", TransmissibilityModifiers("seiar"), p_asymp=ss.bernoulli(p=1.0), rel_trans_asymp=0.25, dur_exp=ss.constant(ss.days(1)))
    sim.run()
    d = sim.diseases[0]
    asymp = d.asymptomatic.uids
    assert len(asymp) > 0
    assert set(np.round(d.rel_trans[asymp], 6)) == {0.25}
    assert sim.connectors[0].factors[:3] == [1.0, 1.0, 1.0]


def test_seasonality_scales_the_base_with_starsims_formula():
    sim = build("seiar", TransmissibilityModifiers("seiar", seasonality_scale=0.2, seasonality_shift=0.1),
                p_asymp=ss.bernoulli(p=1.0), rel_trans_asymp=0.25, dur_exp=ss.constant(ss.days(1)))
    sim.run()
    d = sim.diseases[0]
    factors = sim.connectors[0].factors
    assert len(factors) == 101
    for ti in (0, 10, 50, 100):
        assert factors[ti] == __import__("pytest").approx(max(0.0, 1 + 0.2 * math.cos(2 * math.pi * (ti / 365 - 0.1))))
    asymp = d.asymptomatic.uids
    assert set(np.round(d.rel_trans[asymp], 6)) == {round(0.25 * factors[-1], 6)}


def test_factor_never_goes_negative():
    sim = build("sir", TransmissibilityModifiers("sir", seasonality_scale=1.0, seasonality_shift=0.5))
    sim.run()
    assert min(sim.connectors[0].factors) == 0.0 and max(sim.connectors[0].factors) <= 2.0
```

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_interventions.py tests/test_sim_connectors.py -q`
Expected: FAIL with `ModuleNotFoundError` for both new modules

- [ ] **Step 3: Write the modules**

`epichat/sim/interventions.py`:

```python
"""EpiChat interventions (spec 8.3 and 8.5): delayed seeding, initial
immunity, and the v1 capacity-limited treatment. Seeding and immunity draw
from Starsim distributions, so they are reproducible under common random
numbers; the treatment keeps its v1 numpy draw until the interventions spec
revises it. ss.Sim copies its inputs: read these objects back through
sim.interventions, not through the instance passed in."""
from __future__ import annotations

import numpy as np
import starsim as ss


class SimpleTreatment(ss.Intervention):
    """v1's _SimpleTreatment: each day from start_day, up to prob × (infectious agents),
    capped at max_capacity, recover on the next step."""

    def __init__(self, prob=1.0, max_capacity=None, start_day=0):
        super().__init__()
        self.prob = prob
        self.max_capacity = max_capacity
        self.start_day = start_day

    def step(self):
        if self.ti < self.start_day:
            return
        disease = self.sim.diseases[0]
        infectious = np.asarray(disease.infectious.uids)
        if len(infectious) == 0:
            return
        n = int(self.prob * len(infectious))
        if self.max_capacity is not None:
            n = min(n, self.max_capacity)
        if n <= 0:
            return
        rng = np.random.default_rng(int(self.ti))
        treated = ss.uids(rng.choice(infectious, size=min(n, len(infectious)), replace=False))
        disease.ti_recovered[treated] = self.ti + 1


class SeedInfections(ss.Intervention):
    """Seed(day > 0): on that step, infect susceptible agents by fraction or by count."""

    def __init__(self, day: int, mode: str, value: float):
        super().__init__()
        self.day = int(day)
        self.mode = mode
        self.value = value
        self.chooser = ss.bernoulli(p=float(value)) if mode == "fraction" else ss.choose_n(int(value))
        self.n_seeded = 0

    def step(self):
        if self.ti != self.day:
            return
        disease = self.sim.diseases[0]
        chosen = self.chooser.filter(disease.susceptible.uids)
        if len(chosen):
            disease.set_prognoses(chosen, sources=-1)
        self.n_seeded = int(len(chosen))


class InitialImmunity(ss.Intervention):
    """initial_immune_frac: at step 0 (after step_state, before transmission, so the
    day-0 seeds are already infected and never picked), that share of the susceptible
    agents becomes immune: recovered in the SIR family (waning like everyone else's
    immunity in sirs and seirs), full immunity that wanes at sis_waning in sis."""

    def __init__(self, frac: float):
        super().__init__()
        self.frac = float(frac)
        self.chooser = ss.bernoulli(p=self.frac)
        self.n_immunised = 0

    def step(self):
        if self.ti != 0:
            return
        disease = self.sim.diseases[0]
        chosen = self.chooser.filter(disease.susceptible.uids)
        if hasattr(disease, "recovered"):
            disease.susceptible[chosen] = False
            disease.recovered[chosen] = True
            if hasattr(disease, "ti_susceptible"):
                disease.ti_susceptible[chosen] = self.ti + disease.pars.dur_immune.rvs(chosen)
        else:                                   # sis: immunity 1 wanes through update_immunity at the waning rate
            disease.immunity[chosen] = 1.0
            disease.rel_sus[chosen] = 0.0
        self.n_immunised = int(len(chosen))
```

`epichat/sim/connectors.py`:

```python
"""Transmissibility composition (spec 8.4): once per step, after step_state
and before transmission, rel_trans = rel_trans_base × the active modifiers.
Seasonality is the first modifier, with Starsim's own formula on the numeric
day axis (year fraction ti / 365). The interventions spec adds its modifiers
here, so SEIAR's asymptomatic reduction always reaches rel_trans."""
from __future__ import annotations

import math

import numpy as np
import starsim as ss


class TransmissibilityModifiers(ss.Connector):
    def __init__(self, disease: str, seasonality_scale: float = 0.0, seasonality_shift: float = 0.0):
        super().__init__()
        self.disease_name = disease
        self.scale = float(seasonality_scale)
        self.shift = float(seasonality_shift)
        self.factors: list[float] = []

    def factor(self) -> float:
        if self.scale == 0.0:
            return 1.0
        frac_year = (self.ti / 365.0) % 1.0
        return max(0.0, 1.0 + self.scale * math.cos(2 * math.pi * (frac_year - self.shift)))

    def step(self):
        disease = self.sim.diseases[self.disease_name]
        factor = self.factor()
        disease.rel_trans[:] = np.asarray(disease.rel_trans_base) * factor
        self.factors.append(factor)
```

In `epichat/sim/builder.py`, delete the `SimpleTreatment` class and add `from .interventions import SimpleTreatment  # noqa: F401` so `tests/test_sim_builder.py`'s import keeps working until Task 10 rewrites it.

- [ ] **Step 4: Run the tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_interventions.py tests/test_sim_connectors.py tests/test_sim_builder.py -q`
Expected: the new files pass; the builder tests still pass (phase 0 behaviour unchanged until Task 10).

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/interventions.py epichat/sim/connectors.py epichat/sim/builder.py tests/test_sim_interventions.py tests/test_sim_connectors.py
git commit -m "feat(sim): SeedInfections, InitialImmunity and the TransmissibilityModifiers connector (spec 8.3, 8.4)"
```

### Task 10: The builder takes `SimParamsV2`

**Files:**
- Modify: `epichat/sim/builder.py` (rewrite), `epichat/sim/run_params.py` (`run` coerces its input so the parity and child-process tests keep passing until Task 11 rewrites them), `epichat/params/migrate.py` (`coerce_params` also accepts a v1 `SimParams` object)
- Test: `tests/test_sim_builder.py` (rewrite), `tests/test_param_migrate.py` (one assertion)

**Interfaces:**
- Consumes: `SimParamsV2`, `Duration`, `Seed`, `sim_days` (Task 2); `coerce_params` (Task 3); `CONTACT_MATRIX` (Task 4); `MODELS` (Task 8); `SeedInfections`, `InitialImmunity`, `SimpleTreatment`, `TransmissibilityModifiers` (Task 9).
- Produces: `build_sim(params: SimParamsV2, seed: int | None = None) -> ss.Sim` with `sim.seeds_day0: int` set after `init()`; `resolve_seed(params, seed) -> int` (explicit seed, else `run.rand_seed`, else 1); `to_dist(d: Duration)`; `seed_dist(seed: Seed)`; `disease_kwargs(params) -> dict`; `build_network(params)`; `build_interventions(params) -> list`; `age_groups()`; re-exports `CONTACT_MATRIX`, `sim_days`, `SimpleTreatment`, `LATENT_MODELS`, `WANING_MODELS`.

- [ ] **Step 1: Write the failing tests**

First the one-line extension of `coerce_params`, test in `tests/test_param_migrate.py`:

```python
def test_a_v1_pydantic_object_is_migrated_too():
    from epichat.schema import SimParams
    assert coerce_params(SimParams(beta=5.0, disease_type="sir")).disease.beta == 5.0
```

Then replace `tests/test_sim_builder.py` with:

```python
"""build_sim on schema v2 (spec 8, revised by 17 and 18): the v1 behaviours
carried over, plus distributions, seeding modes, initial immunity, SIS waning
and the transmissibility connector."""
import numpy as np
import pytest
import starsim as ss

from epichat.params.migrate import coerce_params
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.builder import CONTACT_MATRIX, SimpleTreatment, build_sim, resolve_seed, sim_days, to_dist
from epichat.sim.connectors import TransmissibilityModifiers
from epichat.sim.interventions import InitialImmunity, SeedInfections
from template_cases import cases

CASES = cases()
EXTRA = {"seir": dict(dur_exp=3.0), "seirs": dict(dur_exp=3.0, dur_immune=60.0), "seiar": dict(dur_exp=3.0), "sirs": dict(dur_immune=60.0)}
MODELS = ["sir", "sis", "sirs", "seir", "seirs", "seiar"]


def params(**over) -> SimParamsV2:
    """v1-shaped input, migrated: the shortest way to a v2 object in a test."""
    base = dict(disease_type="sir", beta=22.8125, n_agents=1000, sim_dur_years=30 / 365, rand_seed=1)
    base.update(over)
    return coerce_params(base)


def v2(**over) -> SimParamsV2:
    return SimParamsV2.model_validate({"run": {"n_agents": 1000, "sim_dur_years": 30 / 365, "rand_seed": 1}, **over})


@pytest.mark.parametrize("name", sorted(CASES))
def test_every_template_case_builds_and_runs(name):
    sim = build_sim(coerce_params(CASES[name].model_dump()))
    sim.run()
    assert list(sim.diseases.keys()) == [name]
    assert sim.t.npts == sim_days(0.5) + 1 == 183
    assert sim.results[name].n_infected.values[0] > 0


@pytest.mark.parametrize("years, points", [(30 / 365, 31), (0.01, 5), (1.0, 366), (2.0, 731)])
def test_point_count_matches_v1_for_fractional_years(years, points):
    sim = build_sim(params(n_agents=200, sim_dur_years=years))
    assert sim.t.npts == points


def test_resolve_seed_prefers_the_explicit_seed_then_the_params_seed_then_one():
    assert resolve_seed(params(rand_seed=7), None) == 7
    assert resolve_seed(params(rand_seed=7), 3) == 3
    assert resolve_seed(params(rand_seed=None), None) == 1


def test_explicit_seed_is_deterministic_and_differs_between_seeds():
    a = build_sim(params(), seed=3); a.run()
    b = build_sim(params(), seed=3); b.run()
    c = build_sim(params(), seed=4); c.run()
    assert list(a.results.sir.cum_infections.values) == list(b.results.sir.cum_infections.values)
    assert list(a.results.sir.cum_infections.values) != list(c.results.sir.cum_infections.values)


def test_disease_parameters_reach_starsim_with_units():
    sim = build_sim(params(disease_type="seirs", dur_exp=4.0, dur_inf=7.0, dur_immune=90.0, p_death=0.2, init_prev=0.02, beta=12.5))
    d = sim.diseases[0]
    assert str(d.pars.beta) == str(ss.peryear(12.5))
    assert str(d.pars.dur_inf.pars.v) == str(ss.days(7.0)) and str(d.pars.dur_exp.pars.v) == str(ss.days(4.0))
    assert str(d.pars.dur_immune.pars.v) == str(ss.days(90.0))
    assert d.pars.p_death.pars.p == 0.2 and d.pars.init_prev.pars.p == 0.02


def test_to_dist_builds_the_three_forms():
    assert isinstance(to_dist(params(dur_inf=10).disease.dur_inf), ss.constant)
    gamma = to_dist(v2(disease={"dur_inf": {"mean_days": 10, "dist": "gamma", "sd_days": 4}}).disease.dur_inf)
    assert isinstance(gamma, ss.gamma) and gamma.pars.a == pytest.approx(6.25) and str(gamma.pars.scale) == str(ss.days(1.6))
    logn = to_dist(v2(disease={"dur_inf": {"mean_days": 10, "dist": "lognormal", "sd_days": 4}}).disease.dur_inf)
    assert isinstance(logn, ss.lognorm_ex) and str(logn.pars.mean) == str(ss.days(10)) and str(logn.pars.std) == str(ss.days(4))


@pytest.mark.parametrize("dist", ["gamma", "lognormal"])
def test_distributed_durations_realize_the_mean_plus_half_a_day(dist):
    p = v2(disease={"beta": 0.001, "dur_inf": {"mean_days": 10, "dist": dist, "sd_days": 4}, "seed": {"mode": "count", "value": 4000}},
           run={"n_agents": 5000, "sim_dur_years": 60 / 365, "rand_seed": 1})
    sim = build_sim(p)
    sim.run()
    d = sim.diseases[0]
    seeds = d.ti_infected.notnan.uids
    realized = np.asarray(d.ti_recovered[seeds]) - np.asarray(d.ti_infected[seeds])
    assert abs(realized.mean() - 10.5) <= 0.5


def test_constant_duration_recovers_exactly_ten_days_after_infectiousness():
    sim = build_sim(v2(disease={"beta": 0.001, "seed": {"mode": "count", "value": 200}}, run={"n_agents": 1000, "sim_dur_years": 20 / 365, "rand_seed": 1}))
    sim.run()
    res = sim.results.sir
    assert res.n_infected.values[9] == 200 and res.n_infected.values[10] == 0 and res.n_recovered.values[10] == 200


@pytest.mark.parametrize("name", MODELS)
def test_compartments_plus_cumulative_deaths_sum_to_n_every_day(name):
    p = params(disease_type=name, p_death=0.3, init_prev=0.05, sim_dur_years=40 / 365, **EXTRA.get(name, {}))
    sim = build_sim(p)
    sim.run()
    res = sim.results[name]
    total = np.asarray(res.n_susceptible.values) + np.asarray(res.n_infected.values)
    if "n_recovered" in res:
        total = total + np.asarray(res.n_recovered.values)
    total = total + np.cumsum(np.asarray(res.new_deaths_disease.values))
    assert np.all(total == 1000)


def test_count_seeding_infects_exactly_that_many_on_day_zero():
    sim = build_sim(v2(disease={"seed": {"mode": "count", "value": 37}}))
    assert sim.seeds_day0 == 37 and int(sim.diseases[0].infected.count()) == 37
    assert isinstance(sim.diseases[0].pars.init_prev, ss.choose_n)


def test_delayed_seeding_infects_nobody_before_the_day_and_the_count_on_it():
    sim = build_sim(v2(disease={"seed": {"mode": "count", "value": 25, "day": 5}}))
    assert sim.seeds_day0 == 0 and sim.diseases[0].pars.init_prev.pars.p == 0.0
    assert isinstance(sim.interventions[0], SeedInfections)
    sim.run()
    res = sim.results.sir
    assert list(res.n_infected.values[:5]) == [0.0] * 5
    assert res.new_infections.values[5] >= 25 and sim.interventions[0].n_seeded == 25


@pytest.mark.parametrize("name", MODELS)
def test_initial_immunity_leaves_half_of_the_non_seeded_agents_immune(name):
    p = params(disease_type=name, init_prev=0.1, beta=0.001, interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 0}], **EXTRA.get(name, {}))
    assert p.disease.initial_immune_frac == 0.5 and p.interventions == []
    sim = build_sim(p)
    assert any(isinstance(i, InitialImmunity) for i in sim.interventions)
    sim.run()
    d = sim.diseases[0]
    immune = int((np.asarray(d.rel_sus.values) == 0).sum()) if name == "sis" else int(d.recovered.count())
    share = immune / (1000 - sim.seeds_day0)
    assert abs(share - 0.5) <= 0.04


def test_initially_immune_agents_return_to_susceptible_in_sirs():
    p = params(disease_type="sirs", dur_immune=5.0, init_prev=0.01, beta=0.001, sim_dur_years=12 / 365,
               interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 0}])
    sim = build_sim(p)
    sim.run()
    assert sim.results.sirs.n_recovered.values[2] > 400 and sim.results.sirs.n_recovered.values[-1] < 20


def test_sis_waning_and_boost_reach_starsim():
    sim = build_sim(v2(disease={"model": "sis", "sis_waning": 26.0, "sis_imm_boost": 0.5}))
    d = sim.diseases[0]
    assert str(d.pars.waning) == str(ss.peryear(26.0)) and d.pars.imm_boost == 0.5 and "p_death" not in d.pars
    default = build_sim(v2(disease={"model": "sis"})).diseases[0]
    assert str(default.pars.waning) == str(ss.peryear(0)) and default.pars.imm_boost == 0


@pytest.mark.parametrize("seasonal", [False, True])
def test_seiar_asymptomatic_rel_trans_is_the_reduction_times_the_seasonal_factor(seasonal):
    interventions = [{"type": "seasonality", "scale": 0.3, "shift": 0.1}] if seasonal else []
    p = params(disease_type="seiar", dur_exp=1.0, p_asymp=1.0, rel_trans_asymp=0.25, init_prev=0.2, beta=0.001, sim_dur_years=10 / 365, interventions=interventions)
    sim = build_sim(p)
    assert isinstance(sim.connectors[0], TransmissibilityModifiers)
    sim.run()
    d = sim.diseases[0]
    asymp = d.asymptomatic.uids
    factor = sim.connectors[0].factors[-1]
    assert len(asymp) > 0 and factor == pytest.approx(1.0 if not seasonal else max(0.0, 1 + 0.3 * np.cos(2 * np.pi * (10 / 365 - 0.1))))
    assert np.allclose(np.asarray(d.rel_trans[asymp]), 0.25 * factor)


def test_routine_vaccine_starts_on_its_start_day():
    p = params(sim_dur_years=20 / 365, n_agents=2000, interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 10}])
    sim = build_sim(p)
    vx = next(i for i in sim.interventions if isinstance(i, ss.routine_vx))
    assert vx.start_year == pytest.approx(10 / 365)
    sim.run()
    assert int((np.asarray(sim.diseases[0].rel_sus.values) == 0).sum()) > 0


@pytest.mark.parametrize("name", MODELS)
def test_treatment_runs_on_every_model(name):
    p = params(disease_type=name, interventions=[{"type": "treatment", "coverage": 0.5, "capacity": None, "start_day": 2}], **EXTRA.get(name, {}))
    sim = build_sim(p)
    assert any(isinstance(i, SimpleTreatment) for i in sim.interventions)
    sim.run()


def test_treatment_caps_the_number_treated_per_day():
    p = params(init_prev=0.5, interventions=[{"type": "treatment", "coverage": 1.0, "capacity": 7, "start_day": 0}])
    sim = build_sim(p)
    treatment = next(i for i in sim.interventions if isinstance(i, SimpleTreatment))
    d = sim.diseases[0]
    treatment.step()
    assert int((np.asarray(d.ti_recovered.values) == 1).sum()) == 7


def test_age_structured_network_scales_the_contact_matrix_and_assigns_age_shares():
    p = params(network_type="age_structured", network_beta=2.0, n_agents=4000, age_pct_under18=30.0, age_pct_18_64=60.0, age_pct_over65=10.0)
    sim = build_sim(p)
    net = sim.networks[0]
    assert isinstance(net, ss.MixingPools)
    assert np.allclose(np.asarray(net.pars.n_contacts, dtype=float), CONTACT_MATRIX * 2.0)
    age = np.asarray(sim.people.age.values)
    assert abs((age < 18).mean() - 0.30) < 0.02 and abs((age >= 65).mean() - 0.10) < 0.02
    sim.run()


def test_age_structured_network_without_shares_builds_and_runs():
    sim = build_sim(params(network_type="age_structured", n_agents=2000))
    sim.run()
    assert int((np.asarray(sim.people.age.values) >= 65).sum()) == 0       # Starsim's default ages are 0 to 60 (section 18)
    assert sim.results.sir.cum_infections.values[-1] > 0


def test_random_network_without_age_shares_keeps_default_ages():
    sim = build_sim(params(n_agents=500))
    assert isinstance(sim.networks[0], ss.RandomNet)
    assert sim.networks[0].pars.n_contacts.pars.v == 4


def test_demographics_modules_carry_the_rates_per_thousand():
    sim = build_sim(params(use_demographics=True, birth_rate=25.0, death_rate=8.0))
    assert set(sim.demographics.keys()) == {"births", "deaths"}
    assert str(sim.demographics.births.pars.birth_rate) == str(ss.peryear(25.0))
    assert str(sim.demographics.deaths.pars.death_rate) == str(ss.peryear(8.0))
    assert sim.demographics.births.pars.rate_units == 1e-3
    sim.run()


def test_null_seed_is_reproducible_on_every_random_path():
    p = params(rand_seed=None, n_agents=600, network_type="age_structured", age_pct_under18=30.0, age_pct_18_64=60.0, age_pct_over65=10.0,
               interventions=[{"type": "vaccine", "coverage": 0.3, "start_day": 0}])
    a, b = build_sim(p), build_sim(p)
    assert np.array_equal(np.asarray(a.people.age.values), np.asarray(b.people.age.values))
    a.run(); b.run()
    assert np.array_equal(np.asarray(a.diseases[0].recovered.uids), np.asarray(b.diseases[0].recovered.uids))
    assert list(a.results.sir.cum_infections.values) == list(b.results.sir.cum_infections.values)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_builder.py tests/test_param_migrate.py -q`
Expected: FAIL (`ImportError: cannot import name 'to_dist'`; `coerce_params` rejects the `SimParams` object)

- [ ] **Step 3: Write the builder**

`epichat/params/migrate.py` `coerce_params` gains, after the `SimParamsV2` check: `if hasattr(data, "model_dump"): data = data.model_dump()` (a v1 pydantic object).

`epichat/sim/builder.py` (replace the file):

```python
"""build_sim: a validated SimParamsV2 -> an initialised Starsim 3.7 Sim
(spec 8, revised by 17 and 18).

Numeric day-based time (start 0, dt one day, dur round(365 × years) days).
Every duration is ss.days and every rate ss.peryear. Durations become
distributions (8.2), seeds are fractions or counts on day 0 or later (8.3),
initial immunity and delayed seeds are interventions, the transmissibility
connector always runs (8.4), and the carried-over v1 pieces (networks,
demographics, age assignment, treatment, routine vaccine) keep their
semantics (8.5). ss.Sim copies its inputs: read modules back through sim.*."""
from __future__ import annotations

import numpy as np
import starsim as ss

from epichat.params.r0 import CONTACT_MATRIX
from epichat.params.registry import LATENT_MODELS, WANING_MODELS
from epichat.params.schema_v2 import Duration, Seed, SimParamsV2, sim_days

from .connectors import TransmissibilityModifiers
from .interventions import InitialImmunity, SeedInfections, SimpleTreatment
from .models import MODELS

__all__ = ["CONTACT_MATRIX", "LATENT_MODELS", "WANING_MODELS", "SimpleTreatment", "sim_days", "resolve_seed", "age_groups",
           "to_dist", "seed_dist", "disease_kwargs", "build_network", "build_interventions", "build_sim"]


def resolve_seed(params: SimParamsV2, seed: int | None) -> int:
    """The explicit seed, else the scenario's, else 1 (Starsim's own default; spec 8.7)."""
    if seed is not None:
        return int(seed)
    return int(params.run.rand_seed) if params.run.rand_seed is not None else 1


def age_groups() -> dict:
    return {"children": ss.AgeGroup(0, 18), "adults": ss.AgeGroup(18, 65), "elderly": ss.AgeGroup(65, None)}


def to_dist(d: Duration):
    m = d.mean_days
    if d.dist == "constant":
        return ss.constant(ss.days(m))
    sd = float(d.sd_days)
    if d.dist == "lognormal":
        return ss.lognorm_ex(mean=ss.days(m), std=ss.days(sd))
    return ss.gamma(a=(m / sd) ** 2, scale=ss.days(sd ** 2 / m))


def seed_dist(seed: Seed):
    if seed.day > 0:
        return ss.bernoulli(p=0.0)            # not None, which Starsim ignores; SeedInfections seeds later
    if seed.mode == "count":
        return ss.choose_n(int(seed.value))
    return ss.bernoulli(p=seed.value)


def disease_kwargs(params: SimParamsV2) -> dict:
    d = params.disease
    kw = dict(init_prev=seed_dist(d.seed), beta=ss.peryear(d.beta), dur_inf=to_dist(d.dur_inf))
    if d.model == "sis":
        kw.update(waning=ss.peryear(d.sis_waning), imm_boost=d.sis_imm_boost)     # 0 and 0 reproduce v1
    else:
        kw["p_death"] = ss.bernoulli(p=d.p_death)
    if d.model in LATENT_MODELS:
        kw["dur_exp"] = to_dist(d.dur_exp)
    if d.model in WANING_MODELS:
        kw["dur_immune"] = to_dist(d.dur_immune)
    if d.model == "seiar":
        kw.update(p_asymp=ss.bernoulli(p=d.p_asymp), rel_trans_asymp=d.rel_trans_asymp)
    return kw


def build_network(params: SimParamsV2):
    n = params.network
    if n.network_type == "age_structured":
        return ss.MixingPools(src=age_groups(), dst=age_groups(), n_contacts=CONTACT_MATRIX * n.network_beta, beta=1.0)
    return ss.RandomNet(n_contacts=n.n_contacts, beta=n.network_beta)


def build_interventions(params: SimParamsV2) -> list:
    d = params.disease
    out = []
    if d.seed.day > 0:
        out.append(SeedInfections(day=d.seed.day, mode=d.seed.mode, value=d.seed.value))
    if d.initial_immune_frac > 0:
        out.append(InitialImmunity(frac=d.initial_immune_frac))
    for i in params.interventions:
        if i.type == "treatment":
            out.append(SimpleTreatment(prob=i.coverage if i.coverage is not None else 1.0, max_capacity=i.capacity, start_day=i.start_day))
        elif i.type == "vaccine" and i.start_day > 0:       # a day-0 vaccine was normalized into initial_immune_frac
            out.append(ss.routine_vx(product=ss.simple_vx(efficacy=1.0), prob=i.coverage or 0.0, start_year=i.start_day / 365))
    return out


def _assign_ages(sim: ss.Sim, params: SimParamsV2, seed: int) -> None:
    """v1's age assignment: uniform ages within each share, shuffled (numpy, seed + 1; the interventions spec owns it)."""
    g = params.demographics
    n = len(sim.people)
    n_children = round(g.age_pct_under18 / 100 * n)
    n_elderly = round(g.age_pct_over65 / 100 * n)
    n_adults = max(0, n - n_children - n_elderly)
    rng = np.random.default_rng(seed + 1)
    ages = np.concatenate([rng.uniform(0, 18, n_children), rng.uniform(18, 65, n_adults), rng.uniform(65, 95, n_elderly)])
    rng.shuffle(ages)
    sim.people.age[:] = ages[:n]


def build_sim(params: SimParamsV2, seed: int | None = None) -> ss.Sim:
    name = params.disease.model
    disease = MODELS[name](**disease_kwargs(params))
    seasonality = next((i for i in params.interventions if i.type == "seasonality"), None)
    connector = TransmissibilityModifiers(name, seasonality.scale if seasonality else 0.0, seasonality.shift if seasonality else 0.0)
    demographics = None
    if params.demographics.use_demographics:
        demographics = [ss.Births(birth_rate=ss.peryear(params.demographics.birth_rate)),
                        ss.Deaths(death_rate=ss.peryear(params.demographics.death_rate))]
    rand_seed = resolve_seed(params, seed)
    sim = ss.Sim(n_agents=params.run.n_agents, networks=build_network(params), diseases=disease, demographics=demographics,
                 interventions=build_interventions(params) or None, connectors=[connector],
                 start=ss.days(0), dur=ss.days(sim_days(params.run.sim_dur_years)), dt=ss.days(1), verbose=0, rand_seed=rand_seed)
    sim.init()
    if params.network.network_type == "age_structured" and params.demographics.age_pct_under18 is not None:
        _assign_ages(sim, params, rand_seed)
    sim.seeds_day0 = int(sim.diseases[0].infected.count())      # the realized day-0 seeds, for the outputs (8.6)
    return sim
```

`epichat/sim/run_params.py`: `run(params)` becomes

```python
def run(params) -> dict:
    p = coerce_params(params)
    sim = build_sim(p)
    sim.run()
    return extract(sim, p.run.n_agents)
```

(import `coerce_params`; `main` keeps `SimParams(**json)` for one more task, replaced in Task 11.)

- [ ] **Step 4: Run the builder, migration, outputs, parity and child-process tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_builder.py tests/test_param_migrate.py tests/test_sim_outputs.py tests/test_sim_run_params.py -q`
Expected: builder and migration pass; `test_sim_outputs.py` and `test_sim_run_params.py` still pass through `coerce_params` (their inputs are v1 dicts or objects). Then run the parity test once, about two minutes: `.venv/Scripts/python.exe -m pytest tests/test_sim_parity.py -q` → 6 passed (constant migrated durations and the same seeds reproduce phase 0's numbers; the day-0 seeds are not yet in `total_infected`).

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/builder.py epichat/sim/run_params.py epichat/params/migrate.py tests/test_sim_builder.py tests/test_param_migrate.py
git commit -m "feat(sim): build_sim takes SimParamsV2: distributions, seed modes, initial immunity, SIS waning, the connector (spec 8)"
```

### Task 11: Outputs 8.6, replicates, and the child process on v2

**Files:**
- Modify: `epichat/sim/outputs.py` (rewrite), `epichat/sim/run_params.py` (rewrite)
- Create: `epichat/sim/replicates.py`
- Test: `tests/test_sim_outputs.py` (rewrite), `tests/test_sim_replicates.py` (new), `tests/test_sim_run_params.py` (update), `tests/test_sim_parity.py` (one line)

**Interfaces:**
- Consumes: `build_sim` with `sim.seeds_day0` (Task 10); `coerce_params` (Task 3).
- Produces: `outputs.SERIES_KEYS`; `outputs.extract(sim, n_agents: int, seeds_day0: int, demographics_on: bool) -> {"stats", "series"}` with series keys `day`, `n_susceptible`, `n_exposed` (latent models), `n_infectious`, `n_infected` (alias of `n_infectious`, one release), `n_asymptomatic` (seiar), `n_recovered` (not sis), `new_infections` (day 0 includes `seeds_day0`), `cum_infections` (includes `seeds_day0`), `new_deaths`, `cum_deaths` (disease deaths), and `new_deaths_all`, `cum_deaths_all` when `demographics_on`; stats `peak_infections`, `peak_day`, `total_infected`, `total_deaths`, `n_agents`, `sim_days`, `seeds_day0`. `replicates.run_replicates(params: SimParamsV2, n: int | None = None) -> dict` with keys `stats`, `series` (the representative replicate) and, when n > 1, `replicates: {n, seeds, representative, stats: [...], bands: {n_infectious: {p10, p90}, cum_infections: {p10, p90}}}`. `run_params.run(params) -> dict` (v1 or v2 in) is `run_replicates`; the child process writes that payload.

- [ ] **Step 1: Write the failing tests**

Replace `tests/test_sim_outputs.py`:

```python
"""extract() produces the 8.6 series and stats from a finished Starsim 3.7 sim."""
import numpy as np
import pytest

from epichat.params.migrate import coerce_params
from epichat.sim.builder import build_sim
from epichat.sim.outputs import SERIES_KEYS, extract

BASE = {"day", "n_susceptible", "n_infectious", "n_infected", "new_infections", "cum_infections", "new_deaths", "cum_deaths"}
EXPECTED = {
    "sir": BASE | {"n_recovered"},
    "sis": BASE,
    "sirs": BASE | {"n_recovered"},
    "seir": BASE | {"n_recovered", "n_exposed"},
    "seirs": BASE | {"n_recovered", "n_exposed"},
    "seiar": BASE | {"n_recovered", "n_exposed", "n_asymptomatic"},
}
EXTRA = {"seir": dict(dur_exp=3.0), "seirs": dict(dur_exp=3.0, dur_immune=60.0), "seiar": dict(dur_exp=3.0), "sirs": dict(dur_immune=60.0)}


def run(name, **over):
    base = dict(disease_type=name, beta=22.8125, n_agents=500, sim_dur_years=20 / 365, rand_seed=1, init_prev=0.05, p_death=0.3)
    base.update(EXTRA.get(name, {}))
    base.update(over)
    params = coerce_params(base)
    sim = build_sim(params)
    sim.run()
    return extract(sim, params.run.n_agents, sim.seeds_day0, params.demographics.use_demographics), sim


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_series_keys_lengths_and_stats_follow_8_6(name):
    out, sim = run(name)
    series, stats = out["series"], out["stats"]
    assert set(series) == EXPECTED[name]
    assert {len(v) for v in series.values()} == {21}
    assert series["day"] == list(range(21))
    assert series["n_infected"] == series["n_infectious"]
    assert stats["sim_days"] == 21 and stats["n_agents"] == 500 and stats["seeds_day0"] == sim.seeds_day0 > 0
    assert stats["peak_infections"] == max(series["n_infectious"])
    assert stats["peak_day"] == series["n_infectious"].index(max(series["n_infectious"]))
    assert stats["total_infected"] == round(series["cum_infections"][-1])
    assert stats["total_deaths"] == round(series["cum_deaths"][-1])
    assert all(isinstance(v, float) for key in series if key != "day" for v in series[key])
    assert set(SERIES_KEYS) >= EXPECTED[name] - {"day"}


def test_cumulative_infections_count_the_day_zero_seeds_once():
    out, sim = run("sir")
    res = sim.results.sir
    assert out["series"]["new_infections"][0] == float(res.new_infections.values[0] + sim.seeds_day0)
    assert out["series"]["cum_infections"][-1] == float(res.cum_infections.values[-1] + sim.seeds_day0)
    assert out["stats"]["total_infected"] == round(res.cum_infections.values[-1]) + sim.seeds_day0


def test_delayed_seeds_are_already_in_the_disease_counts():
    from epichat.params.schema_v2 import SimParamsV2
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001, "seed": {"mode": "count", "value": 30, "day": 4}},
                                    "run": {"n_agents": 500, "sim_dur_years": 10 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    out = extract(sim, 500, sim.seeds_day0, False)
    assert out["stats"]["seeds_day0"] == 0 and out["series"]["new_infections"][:4] == [0.0] * 4
    assert out["series"]["new_infections"][4] >= 30 and out["stats"]["total_infected"] >= 30


@pytest.mark.parametrize("name", ["seir", "seirs", "seiar"])
def test_n_infectious_excludes_the_exposed(name):
    out, sim = run(name)
    res = sim.results[name]
    assert out["series"]["n_infectious"] == [float(v) for v in res.n_infectious.values]
    assert out["series"]["n_exposed"] == [float(v) for v in res.n_exposed.values]


def test_seiar_n_infectious_includes_asymptomatic_agents():
    out, sim = run("seiar", p_asymp=1.0)
    assert max(out["series"]["n_asymptomatic"]) > 0
    assert out["series"]["n_infectious"] == [float(v) for v in sim.results.seiar.n_infectious.values]
    assert out["stats"]["peak_infections"] == max(out["series"]["n_infectious"])


def test_deaths_are_the_disease_deaths_and_all_causes_only_with_demographics():
    out, sim = run("sir", use_demographics=True, birth_rate=20.0, death_rate=500.0, p_death=0.0)
    assert out["stats"]["total_deaths"] == 0 and max(out["series"]["new_deaths"]) == 0
    assert out["series"]["cum_deaths_all"][-1] > 0 == out["series"]["cum_deaths"][-1]
    assert out["series"]["new_deaths_all"] == [float(v) for v in sim.results.new_deaths.values]
    plain, _ = run("sir", p_death=0.5)
    assert "cum_deaths_all" not in plain["series"] and plain["stats"]["total_deaths"] > 0
    cum = plain["series"]["cum_deaths"]
    assert all(b >= a for a, b in zip(cum, cum[1:]))
```

`tests/test_sim_replicates.py`:

```python
"""Spec 8.7: n seeds in one process, the lower-median replicate as the result, bands across them."""
import numpy as np

from epichat.params.migrate import coerce_params
from epichat.sim.replicates import run_replicates

SMALL = {"disease_type": "sir", "beta": 22.8125, "n_agents": 400, "sim_dur_years": 20 / 365, "rand_seed": 5}


def test_single_replicate_has_no_replicates_block():
    out = run_replicates(coerce_params(SMALL))
    assert set(out) == {"stats", "series"} and out["stats"]["n_agents"] == 400


def test_three_replicates_seed_in_order_and_report_the_lower_median():
    out = run_replicates(coerce_params({**SMALL, "n_replicates": 3}), n=3)
    rep = out["replicates"]
    assert rep["n"] == 3 and rep["seeds"] == [5, 6, 7] and len(rep["stats"]) == 3
    totals = [s["total_infected"] for s in rep["stats"]]
    assert out["stats"]["total_infected"] == sorted(totals)[1]
    assert rep["representative"] == rep["seeds"][totals.index(out["stats"]["total_infected"])]
    for key in ("n_infectious", "cum_infections"):
        band = rep["bands"][key]
        assert len(band["p10"]) == len(band["p90"]) == 21
        assert all(lo <= hi for lo, hi in zip(band["p10"], band["p90"]))
    assert out["series"]["cum_infections"][-1] == out["stats"]["total_infected"]


def test_null_seed_starts_at_one_and_n_comes_from_the_params():
    out = run_replicates(coerce_params({**SMALL, "rand_seed": None, "n_replicates": 2}))
    assert out["replicates"]["seeds"] == [1, 2]
    again = run_replicates(coerce_params({**SMALL, "rand_seed": None, "n_replicates": 2}))
    assert out == again


def test_two_replicates_take_the_lower_of_the_two():
    out = run_replicates(coerce_params({**SMALL, "n_replicates": 2}))
    totals = sorted(s["total_infected"] for s in out["replicates"]["stats"])
    assert out["stats"]["total_infected"] == totals[0]
```

In `tests/test_sim_run_params.py`: `SMALL` stays v1 (the child migrates it); `test_writes_stats_and_series_for_valid_params` adds `assert "n_infectious" in payload["series"] and payload["stats"]["seeds_day0"] >= 0`; add

```python
def test_v2_params_with_replicates_write_the_replicates_block(tmp_path):
    params = {"schema_version": 2, "disease": {"seed": {"value": 0.05}}, "run": {"n_agents": 300, "sim_dur_years": 10 / 365, "rand_seed": 1, "n_replicates": 2}}
    completed, out_path = run_child(params, tmp_path)
    assert completed.returncode == 0, completed.stderr
    payload = json.loads(out_path.read_text(encoding="utf-8"))
    assert set(payload) == {"stats", "series", "replicates"} and payload["replicates"]["seeds"] == [1, 2]


def test_invalid_v2_params_fail_with_the_path_on_stderr(tmp_path):
    completed, out_path = run_child({"schema_version": 2, "disease": {"seed": {"mode": "count", "value": 5000}}, "run": {"n_agents": 300}}, tmp_path)
    assert completed.returncode != 0 and "disease.seed.value" in completed.stderr and not out_path.exists()
```

and `test_run_in_process_matches_the_child` calls `run(SMALL)` (a dict) instead of `run(SimParams(**SMALL))`.

In `tests/test_sim_parity.py`, the stats line becomes `stats = run({**case["params"], "rand_seed": seed})["stats"]` and the total is the v1 definition: `totals.append(stats["total_infected"] - stats["seeds_day0"])`. Update the docstring: the baseline's `cum_infections` excludes the day-0 seeds.

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_outputs.py tests/test_sim_replicates.py tests/test_sim_run_params.py -q`
Expected: FAIL (`extract()` takes 2 positional arguments; no module `epichat.sim.replicates`)

- [ ] **Step 3: Write the code**

`epichat/sim/outputs.py`:

```python
"""Series and stats from a finished sim, in the spec 8.6 shape. n_infected is
still sent as an alias of n_infectious for one release (section 18); deaths are
the disease's own, with the all-causes pair only when demographics are on."""
from __future__ import annotations

import numpy as np
import starsim as ss

SERIES_KEYS = ("n_susceptible", "n_exposed", "n_infectious", "n_infected", "n_asymptomatic", "n_recovered",
               "new_infections", "cum_infections", "new_deaths", "cum_deaths", "new_deaths_all", "cum_deaths_all")


def _values(res, key) -> list[float]:
    return [float(v) for v in res[key].values]


def extract(sim: ss.Sim, n_agents: int, seeds_day0: int, demographics_on: bool) -> dict:
    name = list(sim.diseases.keys())[0]
    res = sim.results[name]
    npts = len(sim.results.timevec)
    series: dict[str, list] = {"day": list(range(npts))}
    series["n_susceptible"] = _values(res, "n_susceptible")
    if "n_exposed" in res:
        series["n_exposed"] = _values(res, "n_exposed")
    infectious = _values(res, "n_infectious" if "n_infectious" in res else "n_infected")
    series["n_infectious"] = infectious
    series["n_infected"] = list(infectious)
    if "n_asymptomatic" in res:
        series["n_asymptomatic"] = _values(res, "n_asymptomatic")
    if "n_recovered" in res:
        series["n_recovered"] = _values(res, "n_recovered")
    new_infections = np.asarray(res["new_infections"].values, dtype=float)
    new_infections[0] += seeds_day0                      # Starsim counts only incident infections; the seeds are prevalent
    series["new_infections"] = [float(v) for v in new_infections]
    series["cum_infections"] = [float(v) for v in np.cumsum(new_infections)]
    deaths = np.asarray(res["new_deaths_disease"].values, dtype=float) if "new_deaths_disease" in res else np.zeros(npts)
    series["new_deaths"] = [float(v) for v in deaths]
    series["cum_deaths"] = [float(v) for v in np.cumsum(deaths)]
    if demographics_on:
        series["new_deaths_all"] = [float(v) for v in sim.results.new_deaths.values]
        series["cum_deaths_all"] = [float(v) for v in sim.results.cum_deaths.values]
    peak = np.asarray(infectious)
    stats = {
        "peak_infections": int(peak.max()),
        "peak_day": int(peak.argmax()),
        "total_infected": int(round(series["cum_infections"][-1])),
        "total_deaths": int(round(series["cum_deaths"][-1])),
        "n_agents": int(n_agents),
        "sim_days": npts,
        "seeds_day0": int(seeds_day0),
    }
    return {"stats": stats, "series": series}
```

`epichat/sim/replicates.py`:

```python
"""Spec 8.7: run n seeds sequentially in one process (the Starsim import is
paid once), return the lower-median replicate by total infections as the
result, and per-day 10th and 90th percentile bands across replicates."""
from __future__ import annotations

import numpy as np

from epichat.params.schema_v2 import SimParamsV2

from .builder import build_sim
from .outputs import extract

BAND_KEYS = ("n_infectious", "cum_infections")


def run_replicates(params: SimParamsV2, n: int | None = None) -> dict:
    n = int(n or params.run.n_replicates)
    first = params.run.rand_seed if params.run.rand_seed is not None else 1
    seeds = [int(first) + i for i in range(n)]
    results = []
    for seed in seeds:
        sim = build_sim(params, seed=seed)
        sim.run()
        results.append(extract(sim, params.run.n_agents, sim.seeds_day0, params.demographics.use_demographics))
    order = sorted(range(n), key=lambda i: results[i]["stats"]["total_infected"])
    rep = order[(n - 1) // 2]
    payload = {"stats": results[rep]["stats"], "series": results[rep]["series"]}
    if n > 1:
        bands = {}
        for key in BAND_KEYS:
            stack = np.array([r["series"][key] for r in results], dtype=float)
            bands[key] = {"p10": [float(v) for v in np.percentile(stack, 10, axis=0)],
                          "p90": [float(v) for v in np.percentile(stack, 90, axis=0)]}
        payload["replicates"] = {"n": n, "seeds": seeds, "representative": seeds[rep],
                                 "stats": [r["stats"] for r in results], "bands": bands}
    return payload
```

`epichat/sim/run_params.py`:

```python
"""Subprocess entry point for the simulation service (spec 8.8):

    python -m epichat.sim.run_params <params.json> <out.json>

The parent writes the parameters (v1 or v2) as JSON; this process imports
Starsim (the expensive part), validates and migrates them, runs every
replicate, and writes {"stats", "series"[, "replicates"]} to the output
path. Any failure is a traceback on stderr and a non-zero exit; the parent
keeps the stderr tail as the error."""
from __future__ import annotations

import json
import sys

from epichat.params.migrate import coerce_params

from .replicates import run_replicates


def run(params) -> dict:
    return run_replicates(coerce_params(params))


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2:
        print("usage: python -m epichat.sim.run_params <params.json> <out.json>", file=sys.stderr)
        return 2
    with open(argv[0], encoding="utf-8") as f:
        params = coerce_params(json.load(f))
    payload = run(params)
    with open(argv[1], "w", encoding="utf-8") as f:
        json.dump(payload, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_outputs.py tests/test_sim_replicates.py tests/test_sim_run_params.py tests/test_sim_builder.py -q`
Expected: all pass. Then `.venv/Scripts/python.exe -m pytest tests/test_sim_parity.py -q` → 6 passed (about two minutes).

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/outputs.py epichat/sim/replicates.py epichat/sim/run_params.py tests/test_sim_outputs.py tests/test_sim_replicates.py tests/test_sim_run_params.py tests/test_sim_parity.py
git commit -m "feat(sim): 8.6 series keys with the day-0 seeds counted, replicates with bands, child process on v2"
```

### Task 12: The service accepts v1 or v2 and answers v2

**Files:**
- Modify: `sim/runner.py`, `sim/service.py`, `sim/main.py`, `sim/series.py`
- Test: `sim/tests/test_runner.py`, `sim/tests/test_service.py`, `sim/tests/test_api.py`, `sim/tests/test_real_run.py`, `sim/tests/test_series.py`

**Interfaces:**
- Consumes: `coerce_params` (Task 3), `resolve_demographics` (Task 5), `repair_params`/`RepairResult` (Task 5), `paths.diff` (Task 2), the child payload of Task 11.
- Produces: `runner.RunResult` gains `replicates: dict | None`; `runner.run_params(params: SimParamsV2, output_path, timeout)`; `service.simulate(params: SimParamsV2, ...)` with `Outcome.replicates`; `service.agent_years` counts replicates; `service.diff_params` returns dotted-path changes; `/simulate` takes `params` as either shape, answers `effective_params` as v2 and adds `replicates` (agent units, bands thinned like the series) or `null`; `series.stats_from` reads `n_infectious` with the `n_infected` fallback.

- [ ] **Step 1: Write the failing tests**

`sim/tests/test_series.py`: in `test_stats_from_uses_the_full_series` and `test_stats_from_without_deaths_series`, rename the series key `n_infected` to `n_infectious` in one of them and keep `n_infected` in the other, so both paths are covered.

`sim/tests/test_runner.py`: `_params` becomes

```python
from epichat.params.migrate import coerce_params
from epichat.params.schema_v2 import SimParamsV2


def _params(**over) -> SimParamsV2:
    base = dict(disease_type="sir", beta=22.8125, n_agents=200, sim_dur_years=5 / 365, rand_seed=1)
    base.update(over)
    return coerce_params(base)
```

and add to `test_success_reads_the_result_file_and_removes_both_files`: `assert result.replicates is None and "n_infectious" in result.series`, plus

```python
def test_replicates_come_back_from_the_child():
    result = run_params(_params(n_replicates=2), _out(), timeout=120)
    assert result.ok and result.replicates["seeds"] == [1, 2] and len(result.replicates["bands"]["n_infectious"]["p10"]) == 6
```

`sim/tests/test_service.py`: `_params` returns `coerce_params(base)` (import as above; `SimParams` is no longer imported); `_ok()` carries the child's stats:

```python
GOOD_STATS = {"peak_infections": 3, "peak_day": 1, "total_infected": 6, "total_deaths": 1, "n_agents": 100, "sim_days": 3, "seeds_day0": 1}


def _ok(replicates=None) -> RunResult:
    return RunResult(True, GOOD_STATS, GOOD_SERIES, None, False, 10, replicates)
```

`_repair_to` builds `epichat.params.repair.RepairResult`. Assertions change as follows: `test_diff_params_lists_changed_top_level_fields` becomes

```python
def test_diff_params_lists_changed_paths():
    before = _params()
    after = _params(disease_type="seir", dur_exp=5.0, interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 30}])
    changes = diff_params(before, after)
    assert {"field": "disease.model", "from": "sir", "to": "seir"} in changes
    assert {"field": "disease.dur_exp.mean_days", "from": None, "to": 5.0} in changes
    inter = next(c for c in changes if c["field"] == "interventions")
    assert inter["from"] == [] and inter["to"][0]["type"] == "vaccine"
    assert len(changes) == 5      # model, interventions, and the three dur_exp leaves
```

`test_success_first_try...`: `assert out.stats == GOOD_STATS` and `params.run.rand_seed == 1`; `test_fail_then_repair...`: `out.effective_params.disease.model == "seir"`, `{"field": "disease.dur_exp.mean_days", "from": None, "to": 5.0} in record["changes"]`, `run.calls[1][0].disease.model == "seir"`; `test_effective_params_are_the_resolved_ones`: `.network.n_contacts == 4`; `test_repair_diff_ignores...`: `[{"field": "disease.dur_inf.mean_days", "from": 10.0, "to": 11.0}]` and `effective_params.demographics.use_demographics is True and effective_params.demographics.country == "KEN"`. Add:

```python
def test_cap_counts_replicates():
    settings = load_settings({"SIM_SHARED_SECRET": "t", "SIM_MAX_AGENT_YEARS": "400"})
    assert not exceeds_cap(_params(n_agents=100, sim_dur_years=1.0), settings)
    assert exceeds_cap(_params(n_agents=100, sim_dur_years=1.0, n_replicates=5), settings)
    assert agent_years(_params(n_agents=100, sim_dur_years=1.0, n_replicates=5)) == 500


def test_replicates_pass_through_the_outcome():
    rep = {"n": 2, "seeds": [1, 2], "representative": 1, "stats": [GOOD_STATS, GOOD_STATS], "bands": {"n_infectious": {"p10": [1.0, 2.0, 1.0], "p90": [1.0, 4.0, 3.0]}}}
    out = simulate(_params(n_replicates=2), "x", SETTINGS, run=FakeRunner([_ok(rep)]), repair=FakeRepairer([]))
    assert out.ok and out.replicates == rep
```

(import `agent_years`, `exceeds_cap` from `service`.)

`sim/tests/test_api.py`: `_success` builds `Outcome(True, 200, params, stats={...GOOD stats with seeds_day0...}, series=GOOD_SERIES, attempts=1)` where `GOOD_SERIES` gains `"n_infectious": [1.0, 4.0, 3.0, 2.0, 1.0]`; the `PARAMS` fixture stays v1; `test_success_scales_thins_and_flips_cold_start` asserts `body["effective_params"]["run"]["n_agents"] == 1000` and `body["replicates"] is None`; `test_invalid_params_is_422_with_field_errors` keeps its `dur_exp` check (the v2 message names `disease.dur_exp`). Add:

```python
V2 = {"schema_version": 2, "disease": {"beta": 0.05}, "run": {"n_agents": 1000, "sim_dur_years": 0.1, "rand_seed": 1}}


def test_v2_body_is_accepted_and_the_answer_is_v2(client, main, monkeypatch):
    from epichat.params.migrate import coerce_params
    params = coerce_params(V2)
    fake = _fake_simulate(_success(params))
    monkeypatch.setattr(main, "simulate", fake)
    r = client.post("/simulate", json={"params": V2}, headers=AUTH)
    assert r.status_code == 200 and r.json()["effective_params"]["schema_version"] == 2
    assert fake.calls[0][0] == params
    r2 = client.post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r2.json()["effective_params"]["disease"]["model"] == "sir"


def test_invalid_v2_body_names_the_path(client):
    r = client.post("/simulate", json={"params": {**V2, "disease": {"seed": {"mode": "count", "value": 5000}}}}, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["kind"] == "invalid_params"
    assert any("disease.seed.value" in e["msg"] for e in r.json()["error"]["detail"])
    assert all(e["loc"][0] == "params" for e in r.json()["error"]["detail"])


def test_too_large_counts_replicates(client, monkeypatch):
    monkeypatch.setenv("SIM_MAX_AGENT_YEARS", "1000")
    r = client.post("/simulate", json={"params": {**V2, "run": {"n_agents": 300, "sim_dur_years": 1.0, "n_replicates": 5}}}, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["agent_years"] == 1500
    assert "n_replicates" in r.json()["error"]["detail"]


def test_replicates_are_returned_in_agent_units_with_thinned_bands(client, main, monkeypatch):
    params = coerce_params({**PARAMS, "n_replicates": 2})
    rep = {"n": 2, "seeds": [1, 2], "representative": 2, "stats": [_success(params).stats] * 2,
           "bands": {"n_infectious": {"p10": [1.0, 2.0, 3.0, 2.0, 1.0], "p90": [1.0, 4.0, 3.0, 2.0, 1.0]}, "cum_infections": {"p10": [1.0] * 5, "p90": [2.0] * 5}}}
    outcome = _success(params)
    outcome.replicates = rep
    monkeypatch.setattr(main, "simulate", _fake_simulate(outcome))
    monkeypatch.setenv("SIM_SERIES_MAX_POINTS", "3")
    body = client.post("/simulate", json={"params": {**PARAMS, "n_replicates": 2}, "pop_scale": 100}, headers=AUTH).json()
    assert body["replicates"]["n"] == 2 and body["replicates"]["stats"][0]["total_infected"] == 11      # agents, not people
    assert body["replicates"]["bands"]["n_infectious"]["p10"] == [1.0, 3.0, 1.0]                        # thinned like the series
```

(`from epichat.params.migrate import coerce_params` joins the file's imports.)

`sim/tests/test_real_run.py`: the key sets become

```python
    base_keys = {"day", "n_susceptible", "n_infectious", "n_infected", "n_recovered", "new_infections", "cum_infections", "new_deaths", "cum_deaths"}
```

with the three cases unchanged, `body["effective_params"]["run"]["rand_seed"] == 1`, and add:

```python
def test_demographics_add_the_all_causes_deaths_and_keep_disease_deaths_apart(client):
    params = _params(use_demographics=True, birth_rate=20.0, death_rate=500.0, p_death=0.0)
    body = client.post("/simulate", json={"params": params, "pop_scale": 1}, headers=AUTH).json()
    assert body["stats"]["total_deaths"] == 0 and body["series"]["cum_deaths"][-1] == 0
    assert body["series"]["cum_deaths_all"][-1] > 0


def test_two_replicates_run_for_real(client):
    body = client.post("/simulate", json={"params": {**_params(), "n_replicates": 2}, "pop_scale": 1}, headers=AUTH).json()
    rep = body["replicates"]
    assert rep["seeds"] == [1, 2] and len(rep["stats"]) == 2 and rep["representative"] in (1, 2)
    assert len(rep["bands"]["cum_infections"]["p90"]) == len(body["series"]["day"]) == 31
    assert body["stats"]["total_infected"] == min(s["total_infected"] for s in rep["stats"])
```

and replace the old `test_deaths_count_only_the_disease` with the demographics test above.

- [ ] **Step 2: Run them to verify they fail**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests -q -x`
Expected: FAIL at the first v2 fixture (`RunResult.__init__() takes 7 positional arguments`, `SimParams` import errors)

- [ ] **Step 3: Write the service changes**

`sim/runner.py`: `RunResult` gains `replicates: dict | None = None` as its last field; `run_params(params: SimParamsV2, ...)` dumps `params.model_dump(mode="json")`; the success return is `RunResult(True, payload.get("stats", {}), payload.get("series", {}), None, False, elapsed(), payload.get("replicates"))`. Import `SimParamsV2` from `epichat.params.schema_v2` instead of `SimParams`. Update the docstring (v1 or v2 in, replicates out).

`sim/series.py`: `stats_from` starts with `n_infected = series.get("n_infectious") or series["n_infected"]`; add `thin_bands`:

```python
def thin_bands(bands: dict, day: list, max_points: int) -> dict:
    """The replicate bands thinned on the same stride as the series."""
    out = {}
    for key, band in bands.items():
        thinned = thin({"day": day, "p10": band["p10"], "p90": band["p90"]}, max_points)
        out[key] = {"p10": thinned["p10"], "p90": thinned["p90"]}
    return out
```

`sim/service.py`:

```python
from epichat.params.paths import diff as diff_paths
from epichat.params.repair import RepairResult
from epichat.params.resolve import resolve_demographics
from epichat.params.schema_v2 import SimParamsV2
from runner import RunResult, run_params
from settings import Settings

Runner = Callable[[SimParamsV2, Path, float], RunResult]
Repairer = Callable[[str, SimParamsV2, str, str], RepairResult]


def agent_years(params: SimParamsV2) -> float:
    return params.run.n_agents * params.run.sim_dur_years * params.run.n_replicates


def _default_repairer() -> Repairer:
    from epichat.params.repair import repair_params
    return repair_params


@dataclass
class Outcome:
    ...                                   # unchanged fields
    replicates: dict | None = None


def diff_params(before: SimParamsV2, after: SimParamsV2) -> list[dict]:
    return diff_paths(before.model_dump(), after.model_dump())
```

and in `simulate`, the success branch is `return Outcome(True, 200, params, stats=result.stats, series=result.series, replicates=result.replicates, repairs=repairs, attempts=attempts)` (the child computes the stats from the full series; `stats_from` is no longer imported here); the cap message in the repair branch reads `agent-years (n_agents × sim_dur_years × n_replicates)`. Update the module docstring.

`sim/main.py`:

```python
from pydantic import BaseModel, Field, ValidationError  # noqa: E402

from epichat.params.migrate import coerce_params  # noqa: E402
from series import scaled_outcome, thin, thin_bands  # noqa: E402


class SimulateRequest(BaseModel):
    params: dict                                     # v1 flat or schema v2; coerced in the route
    pop_scale: float = Field(default=1.0, ge=1.0, le=1e9)
    context_text: str = Field(default="", max_length=6000)
```

and the route:

```python
@app.post("/simulate")
def simulate_route(body: SimulateRequest, settings: Settings = Depends(require_bearer)):
    try:
        params = coerce_params(body.params)
    except ValidationError as exc:
        detail = [{"loc": ["params", *[str(p) for p in e.get("loc", [])]], "msg": e.get("msg", ""), "type": e.get("type", "")}
                  for e in exc.errors()]
        return _error(422, "invalid_params", detail=detail)
    if exceeds_cap(params, settings):
        requested = agent_years(params)
        return _error(
            422, "too_large",
            detail=(f"n_agents × sim_dur_years × n_replicates = {requested:,.0f} exceeds the cap of "
                    f"{settings.max_agent_years:,.0f} agent-years; reduce n_agents, sim_dur_years or n_replicates"),
            agent_years=requested, cap=settings.max_agent_years,
        )
    cold_start = not _state["served"]
    started = time.perf_counter()
    outcome = simulate(params, body.context_text, settings)
    _state["served"] = True
    duration_ms = int((time.perf_counter() - started) * 1000)

    if not outcome.ok:
        ...                                                   # unchanged

    stats, series = scaled_outcome(outcome.stats, outcome.series, body.pop_scale)
    replicates = None
    if outcome.replicates:
        replicates = dict(outcome.replicates)
        replicates["bands"] = thin_bands(replicates.get("bands", {}), outcome.series["day"], settings.series_max_points)
    return {
        "ok": True,
        "effective_params": outcome.effective_params.model_dump(mode="json"),
        "population": int(round(outcome.effective_params.run.n_agents * body.pop_scale)),
        "stats": stats,
        "stats_agents": outcome.stats,
        "series": thin(series, settings.series_max_points),
        "replicates": replicates,
        "pop_scale": body.pop_scale,
        "repairs": outcome.repairs,
        "attempts": outcome.attempts,
        "duration_ms": duration_ms,
        "cold_start": cold_start,
        "starsim_version": STARSIM_VERSION,
    }
```

Update the module docstring (v1 or v2 in, v2 out, replicates). The `test_too_large` test for v1 expects `"reduce n_agents or sim_dur_years" in detail`: change that assertion to `"reduce n_agents, sim_dur_years or n_replicates"`.

- [ ] **Step 4: Run the service suite**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests -q`
Expected: all pass (about one minute; the real-run file now spawns a few more children).

- [ ] **Step 5: Commit**

```bash
git add sim/runner.py sim/service.py sim/main.py sim/series.py sim/tests
git commit -m "feat(service): /simulate accepts v1 or v2 params, answers v2 with replicates; the cap counts replicates (spec 8.8)"
```

### Task 13: R0 calibration verified by simulation

**Files:**
- Create: `tests/test_r0_calibration.py`

**Interfaces:**
- Consumes: `r0.with_r0`, `r0.approx_r0`, `r0.per_contact_prob`, `r0.effective_days`, `r0.CONTACT_MATRIX` (Task 4); `build_sim` (Task 10); `extract` (Task 11).
- Produces: nothing; this is the spec 13 evidence that the exact formula is exact, on both networks. About three minutes of simulation.

- [ ] **Step 1: Write the tests**

```python
# tests/test_r0_calibration.py
"""Spec 13, R0 calibration, with the section 18 rulings: 50k agents seeded with
50 infections (count mode; three seeds fade out too often), two years so every
epidemic finishes. Random network: the R0 implied by the final size,
-ln(1 - z) / z with the seeds included, is within 5% of the target for sir,
seir, seiar and sirs with constant and gamma durations at R0 1.5, 2.5 and 4.
Age-structured network: each group's attack rate, averaged over three seeds,
is within 0.03 of the heterogeneous final-size solution. About three minutes."""
import math

import numpy as np
import pytest

from epichat.params import r0
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.builder import build_sim
from epichat.sim.outputs import extract

N = 50_000


def scenario(model: str, dist: str, target: float) -> SimParamsV2:
    def dur(mean, sd):
        return {"mean_days": mean, "dist": dist, "sd_days": None if dist == "constant" else sd}
    disease = {"model": model, "dur_inf": dur(10.0, 4.0), "p_death": 0.0, "seed": {"mode": "count", "value": 50}}
    if model in ("seir", "seiar"):
        disease["dur_exp"] = dur(5.0, 2.0)
    if model == "sirs":
        disease["dur_immune"] = {"mean_days": 3650.0, "dist": "constant", "sd_days": None}     # nobody wanes within the run
    if model == "seiar":
        disease.update(p_asymp=0.3, rel_trans_asymp=0.5)
    p = SimParamsV2.model_validate({"disease": disease, "network": {"n_contacts": 4},
                                    "run": {"n_agents": N, "sim_dur_years": 2.0, "rand_seed": 1}})
    return r0.with_r0(p, target)


def implied_r0(total_infected: int, n: int) -> float:
    z = total_infected / n
    return -math.log(1 - z) / z


@pytest.mark.parametrize("target", [1.5, 2.5, 4.0])
@pytest.mark.parametrize("dist", ["constant", "gamma"])
@pytest.mark.parametrize("model", ["sir", "seir", "seiar", "sirs"])
def test_random_network_final_size_implies_the_target_r0(model, dist, target):
    p = scenario(model, dist, target)
    assert r0.approx_r0(p) == pytest.approx(target, rel=1e-6)
    sim = build_sim(p)
    sim.run()
    out = extract(sim, N, sim.seeds_day0, False)
    implied = implied_r0(out["stats"]["total_infected"], N)
    assert abs(implied - target) <= 0.05 * target, (model, dist, target, implied)


def heterogeneous_final_sizes(a: float) -> np.ndarray:
    """Section 18: z_j = 1 - exp(-sum_i C[i][j] (1 - exp(-a z_i))), network_beta 1."""
    z = np.full(3, 0.5)
    for _ in range(5000):
        z = 1 - np.exp(-(r0.CONTACT_MATRIX.T @ (1 - np.exp(-a * z))))
    return z


@pytest.mark.parametrize("target", [1.5, 2.5, 4.0])
def test_age_structured_group_attack_rates_follow_the_heterogeneous_final_size_system(target):
    base = SimParamsV2.model_validate({
        "disease": {"dur_inf": {"mean_days": 10.0}, "p_death": 0.0, "seed": {"mode": "count", "value": 50}},
        "network": {"network_type": "age_structured"},
        "demographics": {"age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8},
        "run": {"n_agents": N, "sim_dur_years": 2.0},
    })
    p = r0.with_r0(base, target)
    assert r0.approx_r0(p) == pytest.approx(target, rel=1e-6)
    a = r0.per_contact_prob(p.disease.beta) * r0.effective_days(p.disease)
    predicted = heterogeneous_final_sizes(a)
    rates = []
    for seed in (1, 2, 3):
        sim = build_sim(p, seed=seed)
        sim.run()
        age = np.asarray(sim.people.age.values)
        ever = ~np.asarray(sim.diseases[0].susceptible.values)
        rates.append([ever[age < 18].mean(), ever[(age >= 18) & (age < 65)].mean(), ever[age >= 65].mean()])
    mean = np.mean(rates, axis=0)
    assert np.all(np.abs(mean - predicted) <= 0.03), (target, mean, predicted)
    assert mean[2] < mean[0] < mean[1]          # the matrix's column sums order the groups


def test_age_structured_without_shares_calibrates_and_runs():
    p = r0.with_r0(SimParamsV2.model_validate({"network": {"network_type": "age_structured"}, "run": {"n_agents": 5000, "sim_dur_years": 0.5}}), 2.0)
    sim = build_sim(p)
    sim.run()
    assert sim.results.sir.cum_infections.values[-1] > 1000
```

- [ ] **Step 2: Run them**

Run: `.venv/Scripts/python.exe -m pytest tests/test_r0_calibration.py -q`
Expected: 28 passed in about three minutes. If a random-network case misses by more than 5%, the formula, not the tolerance, is wrong: compare `effective_days` for that case with the agent-level `ti_recovered − ti_infected` (sir) or `ti_recovered − ti_infectious` (seir) before changing anything, and record the finding in the ledger.

- [ ] **Step 3: Commit**

```bash
git add tests/test_r0_calibration.py
git commit -m "test(params): R0 calibration verified by simulation on both networks (spec 13, section 18)"
```

### Task 14: Runbook, data freshness, and the three suites

**Files:**
- Modify: `web/docs/DEPLOY.md` (section 7, one paragraph), `web/tests/app/deploy.test.ts` (one pin)
- Verify: `web/data/param_registry.json` and `web/tests/fixtures/parity.json` fresh; root, service and web suites green.

**Interfaces:**
- Consumes: everything above.
- Produces: the merged-main checks the finishing skill runs.

- [ ] **Step 1: Write the failing pin**

In `web/tests/app/deploy.test.ts`, beside the existing pins: `expect(doc).toContain("schema v2");` and `expect(doc).toContain("n_replicates");`.

Run: `cd web && npx vitest run tests/app/deploy.test.ts` → FAIL on the new pins.

- [ ] **Step 2: Add the paragraph**

In `web/docs/DEPLOY.md` section 7, after the **Settings** paragraph:

```markdown
**Parameters.** `/simulate` takes `params` in the v1 flat shape or in schema
v2 (`docs/superpowers/specs/2026-10-09-sim-parameters-disease-design.md`,
section 6); a v1 body is migrated before validation, and `effective_params`
in the answer is always v2. `run.n_replicates` (1 to 5) runs that many seeds
in one child process; the answer's `replicates` block (agent units, bands
thinned like the series) is `null` for one replicate. The agent-years cap
counts `n_agents × sim_dur_years × n_replicates`. The web app migrates stored
v1 rows on every read and writes v2; no database migration was needed.
```

Run: `cd web && npx vitest run tests/app/deploy.test.ts` → 3 passed.

- [ ] **Step 3: Regenerate the data files and run everything**

```bash
npm --prefix web run sync-data
git status --short web/data web/tests/fixtures        # expected: nothing (already fresh after Task 6)
.venv/Scripts/python.exe -m pytest tests -q            # root: everything, including the parity and calibration files (about six minutes)
sim/.venv/Scripts/python.exe -m pytest sim/tests -q
npm --prefix web run typecheck && npm --prefix web run lint && npm --prefix web test -- --run
```

Expected: all green. Record the counts in the ledger.

- [ ] **Step 4: Commit**

```bash
git add web/docs/DEPLOY.md web/tests/app/deploy.test.ts
git commit -m "docs: the service takes v1 or v2 parameters and runs replicates"
```

---

## Owner steps after the merge

1. Push `main`. No database migration.
2. In production, open an older conversation (stored v1 parameters) and say "run it again": the run completes and the Parameters section reads the nested values.
3. New scenario: "Model a measles outbreak in Kenya" → the Parameters section shows "Infectious period: 8 days, gamma (sd 2.4)"; R0 15 calibrates (beta about 253 with the exact formula, no longer 171).
4. Ask for the age-structured network through "Fetch the data": the activity line reports beta recalibrated to hold R0; R0 no longer depends on the age shares.
5. Set `n_replicates` is not reachable from the chat until phase 3; the service path is covered by the sim tests.
