# EpiChat Simulation Parameters, Part 1: Framework and Disease Module (Design)

Date: 2026-10-09. Parents: `2026-10-07-web-agent-architecture-design.md`, `2026-10-08-sim-service-design.md`, `2026-10-08-agent-core-design.md`. Where this document disagrees with them about simulation parameters, the builder, or diagnostics, this one wins. Everything else stays with the parents.

This is the first of four module specs (disease, networks, demographics, interventions). It defines the shared framework (registry, schema v2, builder, diagnostics, options) and fully specifies the disease module. Later specs add registry entries and builder sections without changing the framework.

## 1. Purpose

Today the agent can change 17 settings through `configure_simulation`, and it explains the model's limitations in prose after a run. It cannot see the rest of the parameter space, cannot connect an implausible result to the parameter that caused it, and gives the user no structured way to pick a fix and rerun.

After this project:

1. Every simulation parameter is described once, in a registry, and the agent can list the ones that apply to the current model with their current value, unit, bounds, and source.
2. The agent can set any registry parameter, not only the core ones, and every value is validated against the registry before it reaches Starsim.
3. After every run, deterministic diagnostics flag implausible outcomes and name the parameters that would address each one, with suggested values and their basis.
4. The agent offers those as options; the user picks one (or types their own); the agent applies it, reruns, and reports what changed against the previous run.

Success, verified on a preview deployment:

| Point | How it is checked |
|---|---|
| Service runs Starsim 3.7.x through the builder; no Jinja template is on the `/simulate` path | `sim/tests/test_real_run.py` per model; `starsim_version` in `/health` |
| v1 scenarios saved before the change still load and run | migration tests in Python and TypeScript; one real saved scenario run end to end |
| The agent lists disease parameters for the active model when asked "what can I change?" | golden eval case |
| A run that fades out early returns a diagnostic, the agent offers options, and a chosen option reruns with a comparison to the previous run | golden eval case with `real_sim: true` |
| Results match the v1 pipeline within tolerance for the default parameters of each model | parity test (section 13) |

## 2. Decisions made on 2026-10-09

- **Upgrade the service to Starsim 3.7.x** (3.7.2 at time of writing) as phase 0. Durations and rates become unit-explicit, and SEIR is built in.
- **A Python builder replaces the Jinja templates** on the service path. `build_sim(params)` constructs the `ss.Sim` directly from validated parameters.
- **The Streamlit app and CLI are no longer maintained.** Their code and the templates stay in the repository untouched in this project; they are not updated for schema v2 or Starsim 3.7 and may stop working. Deleting them is a separate cleanup.
- **Agent interface, option (a):** explicit tool fields for core parameters plus an `advanced` patch of `{ path: value }` validated against the registry.
- **Replicates:** default 1, opt-in up to 5 per run. The agent-years cap counts replicates.
- **New scenarios use gamma-distributed durations** (section 7.3). Migrated scenarios keep constant durations.
- **`p_death` is a case fatality ratio.** The database `fatality_rate` is read as a CFR. In seiar it applies to symptomatic infections only; in the other models every infection is treated as a case (section 7.2).
- **Diagnostic thresholds are tuned from pilot feedback.** They ship with the starting values in section 10, and every diagnostic shown and option chosen is recorded so they can be tuned (section 11).
- **R0 math switches to Starsim's exact transmission probability** in this project (section 7.4), replacing the linear approximation in `approxR0`, `calibrateBeta`, `recalibrateBeta`, and the demographics rescale.

## 3. Findings that shape the design

Measured on 2026-10-09 against the repository at `46b45bb`, Starsim 3.3.2 (current service) and 3.7.2 (target). A separate review run against 3.7.2 confirmed the 3.7 behaviors below.

| Finding | Consequence |
|---|---|
| In 3.3.2, `ss.constant(10)` with `dt=1/365` means 10 timesteps (recovery after exactly 10 steps). Durations are days only because `dt` is hard-coded | Schema v2 stores units; the builder passes `ss.days(...)` and `ss.peryear(...)` explicitly |
| Every duration is `ss.constant`. All agents infected on a day recover on the same day | Durations become distributions (section 7.3) |
| `ss.seasonality` replaces `rel_trans` for every agent each step. SEIAR stores reduced asymptomatic transmissibility in `rel_trans`, so the combination silently removes the asymptomatic reduction (likely true in the v1 templates too) | `rel_trans` is composed from a base state and modifiers (section 8.4) |
| 3.7 `ss.SEIR.n_infected` counts exposed plus infectious; `ss.SIR` and `ss.SIS` have no `n_infectious`; `ss.SIS` has no `n_recovered` | `outputs.py` derives each series key per model (section 8.6) |
| `cum_infections` and `new_infections` exclude day-0 seeds (`if self.sim.initialized`) but include agents seeded later | Output and diagnostics add the realized day-0 seed count explicitly (section 8.6) |
| `sim.results.new_deaths` / `cum_deaths` count all causes, including background deaths when demographics are on; the disease modules record no deaths of their own | EpiChat model classes record disease deaths (section 8.6). This changes the meaning of `total_deaths` for runs with demographics |
| Passing `init_prev=None` to a disease constructor is ignored (`update_pars` drops `None`), so the 1% default seeding stays on | Delayed seeding passes `ss.bernoulli(p=0)` (section 8.3) |
| Continuous durations take effect on the first whole step at or after the drawn time, so a continuous distribution's realized mean is about 0.5 days above its configured mean | Tests check against the realized mean; noted in the registry descriptions |
| `approxR0` uses `beta × dt` as the per-contact daily probability and the full `dur_inf` as the transmitting time. Starsim's per-edge daily probability is `network_beta × (1 - exp(-beta × dt))`, and on a daily step an SIR agent can transmit on `dur_inf - 1` days (infected during a step's transmission, recovered at the start of the step `dur_inf` later). On a random network, the R0 implied by simulated final size (50k agents) matched the exact formula within 1.5% in every `D_eff` case of section 7.4 (SIR constant and gamma; SEIR with each combination of constant and gamma latent and infectious periods); the current formula overstated it by 13% to 32% (labelled 2.50 vs 2.20 simulated at the defaults) | R0 math switches to the exact form (section 7.4) |
| On the age-structured `ss.MixingPools` network (3.7.2, ages reassigned after `sim.init()` as the v1 templates do), simulated attack rates were the same in all three age groups, and overall final sizes matched neither the current approximation nor a next-generation-matrix formula. Whether `n_contacts[i][j]` is source-to-destination or the reverse, and whether `rel_trans` is masked to infectious agents in the pool's mean, is not yet established | Phase 1 investigation (section 7.4); until resolved, R0 on this network is reported as approximate |
| Starsim 3.7.2 requires Python >= 3.11 and adds `seaborn` and `optuna` as dependencies | The 3.10 CI job moves to 3.12; the Vercel bundle is re-measured |
| Parameters are stored as `jsonb` in `scenarios.params`, `runs.params`, `runs.effective_params` | Schema v2 carries `schema_version`; v1 rows are migrated on read |
| Golden eval `config` checks reference flat field names | Evals updated in phase 5 |

Prototype results (3.7.2, 10k agents, 365 days, seed 1, beta 22.8125 per year, 4 contacts, infectious 10 days): SIR with constant durations peaked at 3,607 on day 26 with 8,301 cumulative infections; the 3.3.2 equivalent gave 3,847 on day 28 and 8,404. Lognormal and gamma durations, count seeding, initial immunity, SEIR, SIRS, SEIAR, and SIS with waning each built and ran in about 0.9 s. Five sequential replicates took 4.4 s.

## 4. Architecture

```
epichat/params/registry.py      ParamSpec entries: the single source of truth
epichat/params/schema_v2.py     pydantic SimParamsV2 (nested), generated bounds from the registry
epichat/params/migrate.py       v1 flat -> v2 nested
epichat/sim/models.py           SIRS, SEIRS, SEIAR on Starsim 3.7 base classes
epichat/sim/builder.py          build_sim(params, seed) -> ss.Sim
epichat/sim/outputs.py          extract series and stats from a finished sim
epichat/sim/replicates.py       run n seeds, summarize
epichat/sim/run_params.py       subprocess entry point: params JSON in, result JSON out
epichat/diagnostics.py          rules over (params, series, stats, replicates) -> diagnostics
scripts/export_web_data.py      also writes web/data/param_registry.json
web/lib/sim/registry.ts         loads param_registry.json; path lookup, validation of advanced patches
web/lib/sim/params.ts           zod SimParamsV2, migrateV1, approxR0 / calibrateBeta on v2
web/lib/tools/describeParameters.ts   new tool
web/lib/tools/configureSimulation.ts  core fields + advanced
web/lib/tools/runSimulation.ts        diagnostics and comparison in the result
```

Data flow for a run: agent tool call -> TypeScript validates against the exported registry -> `/simulate` with v2 params -> Python validates with `SimParamsV2` -> subprocess `run_params` -> `build_sim` -> run (n replicates) -> `outputs` -> `diagnostics` -> response -> run card and the model's tool result.

The registry is Python; TypeScript reads the exported JSON. This follows the existing pattern for `disease_db.json`, and a parity test fails CI if the export is stale.

## 5. Parameter registry

### 5.1 ParamSpec

```python
@dataclass(frozen=True)
class ParamSpec:
    path: str                    # "disease.dur_inf.mean_days"
    module: Literal["disease", "network", "demographics", "interventions", "run"]
    label: str                   # "Infectious period (mean)"
    description: str             # one or two plain sentences a student can read
    kind: Literal["number", "integer", "bool", "enum", "string"]
    unit: str | None             # "days", "per year", "fraction", None
    default: Any                 # None means required when it applies
    bounds: tuple[float, float] | None
    choices: tuple[str, ...] | None
    models: tuple[str, ...]      # model types it applies to; () = all
    tier: Literal["core", "advanced", "expert"]
    db_field: str | None         # disease_parameters.json key that sources it, e.g. "infectious_days"
    starsim_target: str          # human-readable, e.g. "ss.SIR(dur_inf=...)"
    affects: tuple[Literal["timing", "peak", "final_size", "deaths", "duration", "endemicity", "stochasticity"], ...]
    requires: tuple[str, ...] = ()   # paths that must also be set, e.g. sd_days when dist is gamma
```

Every leaf of `SimParamsV2` has exactly one `ParamSpec`. Composite values get one entry per sub-field: `disease.dur_inf.mean_days`, `disease.dur_inf.dist`, `disease.dur_inf.sd_days`, and `disease.seed.mode`, `.value`, `.day`. That is how a sub-field can have its own tier. Network, demographics, and intervention fields are registered in this spec with their v1 bounds and meanings, tier `core` or `advanced` as in today's tool, so the completeness test covers them; their own specs revise those entries.

Tiers decide what the agent offers unprompted: `core` parameters appear in the configuration summary; `advanced` ones are offered when a diagnostic or the user's question calls for them; `expert` ones only when the user asks.

### 5.2 Export

`scripts/export_web_data.py` writes `web/data/param_registry.json` as `{ "version": <int>, "params": [ParamSpec as dict, ...] }` in registry order. The existing determinism test covers it.

## 6. Schema v2

```python
class Duration(BaseModel):
    mean_days: float = Field(gt=0)
    dist: Literal["constant", "lognormal", "gamma"] = "constant"
    sd_days: float | None = Field(default=None, gt=0)
    # validator: sd_days required unless constant, and at most 2 * mean_days

class Seed(BaseModel):
    mode: Literal["fraction", "count"] = "fraction"
    value: float = Field(gt=0)
    day: int = Field(default=0, ge=0)
    # validator: fraction requires 0 < value < 1; count requires an integer value >= 1
    # (a non-integer count is a validation error, never truncated); count <= run.n_agents is
    # checked on SimParamsV2

class DiseaseParams(BaseModel):     # section 7
class NetworkParams(BaseModel):     # n_contacts, network_type, network_beta (unchanged from v1 for now)
class DemographicsParams(BaseModel):# use_demographics, birth_rate, death_rate, age_pct_*, country, auto_demographics, demographics_year, demographics_source (unchanged)
class RunParams(BaseModel):         # n_agents, sim_dur_years, rand_seed, n_replicates

class SimParamsV2(BaseModel):
    schema_version: Literal[2] = 2
    disease: DiseaseParams
    network: NetworkParams = NetworkParams()
    demographics: DemographicsParams = DemographicsParams()
    interventions: list[Intervention] = []   # v1 Intervention model, unchanged until its module spec
    run: RunParams = RunParams()
```

Network, demographics, and interventions keep their v1 fields and meanings, moved into their blocks. Their own specs redesign them.

### 6.1 Migration

`migrate_v1(flat: dict) -> SimParamsV2` in Python and `migrateV1` in TypeScript, pinned by a shared fixture. Rules:

- No `schema_version` key means v1.
- `dur_inf`, `dur_exp`, `dur_immune` (days) become `Duration(mean_days=x, dist="constant")`, so migrated scenarios reproduce v1 behavior.
- `init_prev` becomes `Seed(mode="fraction", value=init_prev, day=0)`.
- A v1 vaccine with `start_day == 0` was, in the templates, a one-off move of `coverage` × susceptibles to recovered at day 0 with no routine delivery after it (v1 interventions have no efficacy field). It becomes `disease.initial_immune_frac = coverage` and is removed from `interventions`. This applies to every model, including sis (section 8.3 says how sis implements it). A v1 vaccine with `start_day > 0` stays in `interventions` unchanged.
- `disease_type` becomes `disease.model`; `n_agents`, `sim_dur_years`, `rand_seed` move to `run`.

Where migration runs: the sim service accepts v1 or v2 bodies and migrates v1 before validation; the web app migrates on every read of `scenarios.params` and `runs.params` and always writes v2. No database migration is required.

## 7. Disease module

### 7.1 Models

All six models are EpiChat classes in `epichat/sim/models.py`, so they share a transmissibility base state and a disease-death counter (sections 8.4 and 8.6). Each is a thin subclass where Starsim already has the model.

| `disease.model` | EpiChat class (Starsim base) | Compartments |
|---|---|---|
| `sir` | `SIR(ss.SIR)` | S, I, R (+ deaths) |
| `seir` | `SEIR(ss.SEIR)` | S, E, I, R |
| `sis` | `SIS(ss.SIS)` | S, I, S, with immunity that wanes |
| `sirs` | `SIRS(ss.SIR)` | S, I, R, back to S after `dur_immune` |
| `seirs` | `SEIRS(ss.SEIR)` | S, E, I, R, back to S |
| `seiar` | `SEIAR(ss.SEIR)` | S, E, I or A, R; A transmits at `rel_trans_asymp` |

A mixin, `EpiChatDisease`, declares the extra states in `__init__` (states cannot be added by the builder afterwards): `rel_trans_base` (float, 1.0), `ti_susceptible` (sirs, seirs), `asymptomatic` (seiar), and the result `new_deaths_disease`. The custom models override `set_infection`, `set_progression`, `clear_infection`, and `step_state` as the prototype did, without redefining the base states. SEIAR decides each agent's asymptomatic status in `set_progression`, at infection, because that is where Starsim schedules death: only symptomatic agents draw `p_death`. Asymptomatic agents get `rel_trans_base = rel_trans_asymp` when they become infectious (never `rel_trans` directly), and `clear_infection` resets `rel_trans_base` to 1.0 and clears the flag.

### 7.2 Parameters

| Path | Models | Kind, unit | Default | Bounds | Tier | DB field | Affects |
|---|---|---|---|---|---|---|---|
| `disease.model` | all | enum | `sir` | six models | core | | all |
| `disease.beta` | all | number, per year | set from `r0` | 0.001 to 1000 | advanced | | peak, final_size |
| `disease.dur_exp.*` | seir, seirs, seiar | duration, days | required | mean 0.1 to 60 | core (mean), advanced (dist, sd) | `incubation_days` | timing |
| `disease.dur_inf.*` | all | duration, days | mean 10; gamma for new scenarios (7.3) | mean 0.5 to 365 | core (mean), advanced (dist, sd) | `infectious_days` | peak, final_size, timing |
| `disease.dur_immune.*` | sirs, seirs | duration, days | required | mean 7 to 36,500 | core (mean), advanced (dist, sd) | `immunity_duration` | endemicity |
| `disease.p_death` | sir, seir, sirs, seirs, seiar | fraction, case fatality ratio | 0 | 0 to 1 | core | `fatality_rate` (read as CFR) | deaths |
| `disease.p_asymp` | seiar | fraction | 0.3 | 0 to 1 | core | `asymptomatic_fraction` | peak, final_size |
| `disease.rel_trans_asymp` | seiar | fraction | 0.5 | 0 to 1 | advanced | | peak, final_size |
| `disease.sis_waning` | sis | number, per year | 0 | 0 to 52 | advanced | | endemicity |
| `disease.sis_imm_boost` | sis | number | 0 | 0 to 1 | advanced | | endemicity |
| `disease.seed.value` | all | number | 0.01 | fraction (0,1), or integer count 1 to n_agents | core | | timing, stochasticity |
| `disease.seed.mode` | all | enum | `fraction` | fraction, count | advanced | | stochasticity |
| `disease.seed.day` | all | integer, days | 0 | 0 to simulation length | advanced | | timing |
| `disease.initial_immune_frac` | all | fraction | 0 | 0 to 0.99 | advanced | | final_size |
| `run.n_agents` | all | integer | 10,000 | 10 to 1,000,000 | core | | stochasticity |
| `run.sim_dur_years` | all | number, years | 1 | 0.01 to 20 | core | | duration |
| `run.n_replicates` | all | integer | 1 | 1 to 5 | advanced | | stochasticity |
| `run.rand_seed` | all | integer | none | | expert | | stochasticity |

`disease.r0` is an input to `configure_simulation`, not a stored field (bounds 0.1 to 30, sourced from the `r0` database field). The tool back-solves `beta` as today (`calibrateBeta`) and reports `approx_r0`. Setting `beta` directly through `advanced` is allowed; the result then reports the implied R0.

Required durations have no silent default. If the model is set (through a core field or `advanced`) to one that needs `dur_exp` or `dur_immune` and the scenario has none, `configure_simulation` returns `CONFIG ERROR` naming the missing path and suggesting `lookup_disease` or a user value, as v1 does today.

`sis_waning` and `sis_imm_boost` default to 0, which reproduces the v1 SIS (no immunity). Starsim's own defaults (0.05 and 1.0) are not used.

`p_death` is a case fatality ratio. In seiar it is drawn only for agents who become symptomatic; asymptomatic infections never die of the disease (a change from v1, where every infection could). In sir, seir, sirs, and seirs every infection is a case, so a CFR overstates deaths for diseases with many mild or unreported infections; the `fatality_on_all_infections` diagnostic (section 10) points the user to seiar in that situation. Surveillance CFRs carry their own biases (under-ascertainment of mild cases raises them; deaths not yet observed early in an outbreak lower them), which `describe_parameters` mentions in the parameter's description.

### 7.3 Duration defaults for new scenarios

New scenarios use `gamma` for every duration. `sd_days` is `(max - min) / 4` from the database consensus range when the disease is known and min < max; otherwise `0.3 × mean_days`. Either way the sd is an illustrative assumption, because a range of study estimates is not individual-level spread, and the configuration summary and `describe_parameters` say so until the database carries a dispersion field. The user can set `constant` or another sd through `advanced`. Migrated scenarios keep `constant`.

### 7.4 R0 and beta

On the random network, with `dt = 1` day and `p = network_beta × (1 - exp(-beta / 365))` (validation requires p <= 1):

```
R0 = n_contacts × p × D_eff × asymp_factor
asymp_factor = 1 - p_asymp × (1 - rel_trans_asymp)        # seiar; rel_trans multiplies p exactly; 1 otherwise
D_eff, models without a latent period (sir, sirs, sis):
    constant dur_inf:    ceil(mean) - 1
    continuous dur_inf:  mean - 0.5
D_eff, models with a latent period (seir, seirs, seiar):
    both constant:                  ceil(dur_exp + dur_inf) - ceil(dur_exp)
    dur_exp constant, dur_inf not:  dur_inf.mean + 0.5
    dur_exp continuous:             dur_inf.mean
```

`calibrateBeta(params, r0)` inverts it: `beta = -365 × ln(1 - r0 / (n_contacts × network_beta × D_eff × asymp_factor))`. When `r0` is at or above `n_contacts × network_beta × D_eff × asymp_factor` (the R0 reached if every contact were infected), there is no beta; `configure_simulation` returns `CONFIG ERROR` stating that maximum and naming the levers (`network.n_contacts`, `disease.dur_inf`). `recalibrateBeta` and the demographics rescale in `resolve_demographics` re-solve beta for the target R0 with this function instead of scaling it by a ratio. `beta` keeps its unit (per year). Python and TypeScript share the implementation through the parity fixture.

Age-structured network: phase 1 first establishes how `ss.MixingPools` transmits (matrix orientation, the `rel_trans` mean, why attack rates came out equal across age groups, and whether ages assigned after `sim.init()` reach the `AgeGroup`s), then derives the next-generation matrix and verifies it with the per-group final-size test in section 13. Until that lands, `approx_r0` on this network is the current formula and the tool output marks it `approximate: true`. The networks spec owns any fix to the network itself.

### 7.5 Deferred to later module specs

Age-specific `p_death`, `rel_sus`, and `rel_trans` need the age structure the demographics spec will define. Per-network beta needs the networks spec. Waning of vaccine-derived immunity belongs to interventions.

## 8. Builder

### 8.1 Entry point

`build_sim(params: SimParamsV2, seed: int) -> ss.Sim` with `start="2000-01-01"`, `dur=ss.days(round(365 * sim_dur_years))`, `dt=ss.days(1)`, `rand_seed=seed`, `verbose=0`. Every rate is `ss.peryear(...)` and every duration `ss.days(...)`; no bare number reaches a Starsim distribution. `beta` keeps its v1 unit (per year); the R0 functions that relate it to R0 change as section 7.4 describes.

### 8.2 Durations

`to_dist(d: Duration)`: `constant` -> `ss.constant(ss.days(m))`; `lognormal` -> `ss.lognorm_ex(mean=ss.days(m), std=ss.days(sd))`; `gamma` -> `ss.gamma(a=(m/sd)**2, scale=ss.days(sd**2/m))`. Both continuous forms were checked: mean 10.02 and sd 4.0 over 10k draws for m = 10, sd = 4. Realized durations are about 0.5 days longer because transitions happen on whole steps (section 3).

### 8.3 Seeding and initial immunity

- `Seed(mode="fraction", day=0)` -> `init_prev=ss.bernoulli(p=value)`.
- `Seed(mode="count", day=0)` -> `init_prev=ss.choose_n(int(value))`.
- `day > 0` -> `init_prev=ss.bernoulli(p=0)` (not `None`, which Starsim ignores) and an intervention `SeedInfections(day, mode, value)` that, at that step, picks susceptible agents with its own `ss.bernoulli` or `ss.choose_n` and calls `disease.set_prognoses(uids, sources=-1)`.
- `initial_immune_frac > 0` -> an intervention `InitialImmunity(frac)` that, at step 0, picks that fraction of the remaining susceptible agents with its own `ss.bernoulli(p=frac)` (a Starsim distribution, so CRN-safe; no `numpy` generator) and makes them immune:
  - sir, seir, seiar: susceptible off, recovered on.
  - sirs, seirs: as above, and `ti_susceptible = ti + dur_immune.rvs(uids)` so their immunity wanes like everyone else's.
  - sis: `immunity = 1.0` and `rel_sus = 0`, which wanes at `sis_waning`.

  Interventions run after `step_state` and before transmission in the 3.7 loop, so day-0 seeds are already infected and are never picked.

The builder records `seeds_day0`, the realized number infected at initialization, for the outputs.

### 8.4 Transmissibility composition

Every EpiChat disease carries `rel_trans_base` (section 7.1). An EpiChat connector, `TransmissibilityModifiers`, sets `rel_trans = rel_trans_base × product(active modifiers)` once per step; it runs in the connectors slot, after `step_state` and before transmission. Seasonality becomes one modifier (`max(0, 1 + scale × cos(2π(frac_year - shift)))`, Starsim's formula) instead of `ss.seasonality`. The interventions spec will add its modifiers to the same connector. Without seasonality the connector still runs, so SEIAR's reduction always reaches `rel_trans`.

### 8.5 Networks, demographics, interventions in this phase

Carried over from the v1 templates with identical behavior: random network (`ss.RandomNet(n_contacts, beta=network_beta)`), the three-group `ss.MixingPools` age-structured network with the same matrix (checked to build and run on 3.7.2), `ss.Births` and `ss.Deaths` at per-1,000 rates, the age-share assignment, the routine vaccine for `start_day > 0`, and the capacity-limited treatment intervention. Their own specs change them later.

### 8.6 Outputs

`extract(sim, seeds_day0) -> { series, stats }`. Series keys and how each is derived:

| Key | sir, sirs | seir, seirs, seiar | sis |
|---|---|---|---|
| `n_susceptible` | `n_susceptible` | `n_susceptible` | `n_susceptible` |
| `n_exposed` | absent | `n_exposed` | absent |
| `n_infectious` | `n_infected` | `n_infectious` (includes A for seiar) | `n_infected` |
| `n_asymptomatic` | absent | seiar only, from the `asymptomatic` state | absent |
| `n_recovered` | `n_recovered` | `n_recovered` | absent |
| `new_infections` | disease `new_infections`, with `seeds_day0` added on day 0 | same | same |
| `cum_infections` | disease `cum_infections` + `seeds_day0` | same | same |
| `new_deaths`, `cum_deaths` | disease deaths from `new_deaths_disease` | same | zeros |
| `new_deaths_all`, `cum_deaths_all` | sim-level deaths, only when demographics are on | same | same |

Delayed seeds are already in `cum_infections` because they happen after initialization. `stats.total_infected = cum_infections[-1]`, so the attack rate includes every seed exactly once. `stats.peak_infections` is the maximum of `n_infectious`. For one release, `n_infected` is also sent and equals `n_infectious`, so the current run card keeps working; the web app then switches and the alias is removed. `total_deaths` now counts disease deaths only; for runs with demographics this is a change from v1, and the run payload says so in a warning on the first release.

### 8.7 Replicates

`run_replicates(params, n)`: seeds `rand_seed` (or 1) to `rand_seed + n - 1`, run sequentially in one subprocess. The returned `series` and `stats` are those of the representative replicate: the one at sorted index `(n - 1) // 2` by `total_infected` (the lower median; for n = 1 the only run). When n > 1 the response adds `replicates: { n, seeds, stats: [per-replicate stats], bands: { n_infectious: { p10, p90 }, cum_infections: { p10, p90 } } }`, where the bands are per-day `numpy.percentile` values across replicates. The agent-years cap applies to `n_agents × sim_dur_years × n_replicates`.

### 8.8 Service changes

- `sim/requirements.txt`: `starsim==3.7.2`; re-measure bundle size, cold start, and 10k / 100k run times and update the sim-service runbook table.
- The runner executes `python -m epichat.sim.run_params <params.json> <out.json>` instead of a rendered script. Subprocess isolation, timeout, and stderr capture are unchanged.
- The repair loop is kept. It receives v2 params and the error; most former template errors become validation errors that never reach a subprocess.
- `/simulate` accepts v1 or v2 `params` (section 6.1); `effective_params` is always v2. The response adds `diagnostics` (section 10) and `replicates` (8.7).

## 9. Agent interface

### 9.1 `configure_simulation`

Core fields (explicit in the tool schema): `disease`, `country_iso3`, `model` (alias `disease_type` accepted), `n_agents`, `sim_dur_years`, `r0`, `dur_inf_days`, `dur_exp_days`, `dur_immune_days`, `p_death`, `p_asymp`, `seed_fraction`, `seed_count`, the existing vaccine, treatment, and seasonality fields, `start_new_scenario`. `seed_fraction` and `seed_count` are mutually exclusive; passing both is a `CONFIG ERROR`.

New field `advanced: Record<string, unknown>`, keys are registry paths (`"disease.dur_inf.dist"`, `"disease.rel_trans_asymp"`, `"run.n_replicates"`). The whole patch, core fields included, is applied to a copy of the scenario and then validated once, so a change that needs two paths together (for example `dist: "gamma"` with `sd_days`) is accepted in one call. Each failure is returned as `CONFIG ERROR` naming the path:

1. Every path exists in the registry.
2. Every parameter applies to the resulting model.
3. Each value has the right kind and is within bounds (the message states the bounds and unit).
4. Paths in a `requires` relation are present together (for example `sd_days` when `dist` is not `constant`).
5. The result validates as `SimParamsV2`.

The payload gains `changed: [{ path, from, to }]` alongside `applied`.

### 9.2 `describe_parameters` (new)

Input: `{ module?: "disease" | "network" | "demographics" | "interventions" | "run", tier?: "core" | "advanced" | "expert" }`. Returns, for the current model, each applicable parameter's path, label, description, unit, bounds, current value, whether the current value came from the user, the database, a fetch, or a default, its `affects` tags, and the database range when the disease is known. Without a scenario it returns the registry for the default model and says so.

### 9.3 System prompt additions

- When the user asks what can be changed, or a diagnostic names a parameter, call `describe_parameters` rather than answering from memory.
- Never say a parameter cannot be changed without checking the registry.
- When presenting options, state for each one what it changes, the suggested value, and its basis (database range, the user's input, or an illustrative assumption).

## 10. Diagnostics

`diagnose(params, series, stats, replicates, seeds) -> list[Diagnostic]`, pure and deterministic, run by the service after every successful run. `seeds` is the realized number seeded (day 0 plus delayed).

```python
@dataclass
class Lever:
    patch: dict[str, Any]       # registry paths -> suggested values, applied together
    current: dict[str, Any]
    direction: Literal["increase", "decrease", "change"]
    rationale: str
    basis: Literal["disease_db", "rule", "user"]   # db values cite the field; rule values are labelled illustrative

@dataclass
class Diagnostic:
    id: str                  # "early_fadeout"
    severity: Literal["info", "warning"]
    title: str
    evidence: dict           # the numbers that triggered it
    levers: list[Lever]
```

Suggested values are clamped to registry bounds and, when the disease is known, to the database consensus range. A lever never suggests a value outside the database range without saying so.

Definitions used below: `N = run.n_agents`; `T` = number of days; `peak = max(n_infectious)`, `t_peak` its first day; `R_eff = approxR0 × (1 - initial_immune_frac)`; "simple run" = model in sir, seir, seiar, random network, no demographics, no interventions, no seasonality. All thresholds are named constants; the values below are starting points, to be tuned from pilot data (section 11).

| id | Severity | Trigger | Levers |
|---|---|---|---|
| `early_fadeout` | warning | `R_eff > 1`, `n_infectious[-1] == 0`, and `total_infected < 2 × seeds` | seed count to `max(5 × seeds, 10)`; `run.n_replicates` to 5; recheck `disease.r0` against the database |
| `instant_peak` | warning | `t_peak <= 3` and `seeds / N >= 0.02` (above the realized noise of the 1% default) | `disease.seed` to count 10 |
| `unfinished` | warning | model in sir, seir, seiar without demographics, and `n_infectious[-1] >= 0.05 × peak`; or any model with mean `new_infections` over the last `ceil(0.1 T)` days above the mean over the `ceil(0.1 T)` days before | `run.sim_dur_years` × 2, within bounds |
| `final_size_gap` | info | simple run, not `unfinished`, and `abs(total_infected / N - z) > 0.15`, where `z` solves `z = 1 - exp(-R_eff × z)` | check `disease.r0` or `disease.beta`; with the exact R0 of section 7.4 this should not fire on a simple run, so a hit points to a configuration problem |
| `sharp_curve` | info | every duration is `constant` and the number of days with `n_infectious >= peak / 2` is below `2 × dur_inf.mean_days` | `{ dur_inf.dist: "gamma", dur_inf.sd_days: sd }`, sd from section 7.3 or `0.3 × mean` labelled illustrative |
| `cfr_out_of_range` | warning | disease known and `p_death` outside the database `fatality_rate` range | `disease.p_death` to the database typical value |
| `fatality_on_all_infections` | info | model is not seiar, `p_death > 0`, and the database `asymptomatic_fraction` typical value is at least 0.2 | `disease.model` to seiar with the database `p_asymp`, so the CFR applies to symptomatic cases only |
| `no_reinfection` | info | sirs or seirs and `dur_immune.mean_days > 365 × sim_dur_years` | `run.sim_dur_years` up, or note that waning is not observable in this window |
| `high_variance` | info | n_replicates > 1 and `(p90 - p10) / median` of `total_infected` > 0.5 | none; report the band and the share of replicates that faded out (`total_infected < 2 × seeds`) |

## 11. Options and rerun

- `run_simulation`'s tool result and run payload carry `diagnostics`. The run card shows each diagnostic with one button per lever; a button sends a canonical user message built from the lever's whole patch (`Apply: disease.dur_inf.dist = gamma, disease.dur_inf.sd_days = 3; then rerun`) through the existing suggestion mechanism, so the conversation and the step events record the choice. Free text still works.
- The prompt asks the model to offer at most three options per run, highest-severity diagnostic first, and always one "keep as is" path.
- Comparison: `run_simulation` looks up the scenario's previous successful run and adds `compare: { previous_run_id, changed: [{ path, from, to }], stats_delta: { peak_infections, peak_day, total_infected, total_deaths } }` to its content and payload. The model reports what changed and by how much before interpreting.
- Recording for threshold tuning: the `runs` row stores `diagnostics` (new `jsonb` column, migration `0004_run_diagnostics.sql`), and two step events are added: `diagnostic_shown { run_id, ids }` when a run with diagnostics completes, and `option_chosen { run_id, diagnostic_id, patch }` when the next configuration applies a lever's patch (matched by comparing the applied paths and values). The researcher view can then report how often each rule fired and how often its options were taken.
- A new `CardPayload` kind is not needed: `diagnostics` and `compare` are fields of the `run` payload. Their rendering is part of the workspace UI (sub-project 4 follow-up).

## 12. Implementation phases

Each phase ships on its own with its tests green.

0. **Starsim 3.7 and the builder, v1 behavior.** `epichat/sim/*` builds v1-equivalent sims from migrated params; the service uses it; templates leave the service path. CI's Python job moves to 3.12. Parity tests (section 13) pass. Bundle and timing re-measured.
1. **Registry, schema v2, migration, export, exact R0.** Python and TypeScript validate v2; the web app reads v1 and writes v2; `approxR0`, `calibrateBeta`, `recalibrateBeta`, and the demographics rescale use section 7.4; the age-structured investigation is done and its outcome recorded in this spec; parity fixture regenerated.
2. **New disease parameters.** Duration distributions (gamma by default for new scenarios), seed mode and day, initial immunity, SIS waning, replicates, transmissibility composition, symptomatic-only deaths in seiar, `n_infectious`.
3. **Agent interface.** `configure_simulation.advanced`, `describe_parameters`, prompt additions, config payload `changed`.
4. **Diagnostics, options, comparison.** `diagnose`, service response, run payload, prompt guidance, comparison against the previous run, the `runs.diagnostics` column, and the two step events.
5. **Evals and docs.** Golden cases updated to v2 paths; new cases from section 1; README and the sim-service runbook updated.

## 13. Testing

Python (3.12):
- Registry: every leaf of `SimParamsV2` has exactly one `ParamSpec`; every `db_field` exists in `disease_parameters.json`; bounds contain defaults; `requires` paths exist; export is deterministic.
- Migration: a fixture of v1 params (all six models, both networks, every intervention, the day-0 vaccine on every model including sis) migrates to the expected v2; migrated params build and run.
- Builder per model: compartments plus cumulative deaths sum to N each day without demographics; a constant 10-day `dur_inf` recovers exactly 10 days after infectiousness; gamma and lognormal durations realize a mean within 5% of `mean_days + 0.5`; count seeding infects exactly that many on day 0; delayed seeding leaves nobody infected before `day` and infects exactly the count on `day`; `initial_immune_frac` 0.5 leaves 50% ± 2 points of the non-seeded agents immune; in sirs, initially immune agents return to susceptible; SEIAR with and without seasonality keeps asymptomatic `rel_trans` at `rel_trans_asymp ×` the seasonal factor.
- R0 calibration: on a random network with 50k agents and three seeds, for sir, seir, seiar, and sirs with constant and gamma durations, and target R0 of 1.5, 2.5, and 4, the R0 implied by the simulated final size (`-ln(1 - z) / z`, seeds included) is within 5% of the target. The same test per age group for the age-structured network once phase 1 resolves its formula.
- seiar deaths: with `p_asymp = 1` and `p_death = 0.5`, no disease deaths occur; with `p_asymp = 0`, deaths are about half of infections.
- Parity with v1 (phase 0 only, before the R0 switch and the seiar death change): for each model's default parameters at 10k agents, the median over 10 seeds of `cum_infections` (v1 definition, without day-0 seeds, for this comparison) and of peak day are within 5% and 3 days of the 3.3.2 template pipeline. The baseline is captured once, before the upgrade, and committed.
- Outputs: `n_infected` equals `n_infectious`; SEIR `n_infectious` excludes exposed; `cum_infections[-1]` equals disease cumulative plus `seeds_day0`; with demographics on, `cum_deaths` excludes background deaths and `cum_deaths_all` includes them.
- Replicates: n = 3 returns three per-replicate stats, ordered seeds, the lower-median representative, and bands with p10 <= p90.
- Diagnostics: each rule fires on a constructed series and does not fire on a normal default run; `instant_peak` does not fire on the default 1% seeding; suggested values respect bounds and database ranges.
- Service: v1 and v2 bodies both accepted; agent-years cap counts replicates; `diagnostics` present on 200.

TypeScript (vitest):
- Registry loading and path validation messages; `advanced` patch accepted and rejected cases, including a two-path patch and a missing `requires` partner; model applicability; mutually exclusive seed fields.
- `migrateV1` against the shared fixture; `approxR0` and `calibrateBeta` on v2 match Python within 1e-6 (parity fixture regenerated with v2 inputs).
- `describe_parameters` with and without a scenario; value-source attribution.
- `run_simulation` builds `compare` from a fake previous run.

Evals: the two golden cases in section 1, plus existing cases migrated to v2 paths.

## 14. Costs

Replicates run in one subprocess, so the import (about 2 s locally) is paid once and only the simulation time multiplies. With the sim-service spec's local figures (about 2 s import and 1.5 s simulation for a 10k-agent, one-year run) and its 2x Vercel slowdown, one replicate costs about 7 CPU-seconds and five cost about 19. Hobby's 14,400 CPU-seconds then cover about 2,000 single-replicate runs or about 750 five-replicate runs a month at 10k agents. The default of one replicate keeps the budget where it is; the runbook's upgrade trigger stays as written. These figures are re-measured on 3.7.2 in phase 0.

## 15. Out of scope

Network, demographics, and intervention redesigns (their specs follow this one; until then their v1 behavior is carried over). Calibration to observed data. The UI rendering of diagnostics, option buttons, and comparisons beyond the payload fields (workspace follow-up). Deleting the Streamlit app, the CLI, and the templates.

## 16. Questions resolved on 2026-10-09

1. Default duration distribution for new scenarios: gamma (section 7.3).
2. `p_death` semantics: a case fatality ratio; Starsim's `p_death` is simply a per-infected-agent probability, so the meaning is set by which agents draw it (section 7.2).
3. Diagnostic thresholds: tuned from pilot feedback, with recording in place (section 11).
4. Exact R0 conversion: switched in phase 1 (section 7.4).
5. Asymptomatic deaths in seiar: none; `p_death` applies to symptomatic infections only (section 7.2).

Still open: the age-structured network's transmission semantics and R0 formula, to be settled by the phase 1 investigation (section 7.4).

## 17. Revision 2026-10-11: reconciliation with the code at `d4d8fa7`

Checked before planning, against the repository at `d4d8fa7` (fifty commits
after the measurement commit) and against Starsim 3.7.2 installed locally.
Where this section and the sections above disagree, this section wins.

- **Migration number.** The diagnostics column migration is
  `0007_run_diagnostics.sql`; `0004_reports.sql` already exists.
- **Python 3.12 everywhere Starsim runs.** Starsim 3.7.2 needs Python 3.11 or
  later. The root `requirements.txt` pins `starsim==3.7.2` like
  `sim/requirements.txt`; the root CI job and `npm run sync-data` move from
  3.10 to 3.12; the local root environment is a 3.12 virtualenv at `.venv`
  (git-ignored). The root tests that touch the templates only render and
  compile them, so they keep passing; nothing executes a template in CI.
- **Time axis.** The builder uses numeric day-based time: `start=ss.days(0)`,
  `dur=ss.days(round(365 × sim_dur_years))`, `dt=ss.days(1)`. The calendar
  form in section 8.1 (`start="2000-01-01"`) adds a step in leap years (367
  points for 365 days), while numeric time gives `days + 1` points, the v1
  count. On the numeric axis `routine_vx` takes `start_year = start_day / 365`
  and seasonality's year fraction is `ti / 365`, both verified on 3.7.2.
- **Phase 0 builder input.** Phase 0 builds from the v1 `SimParams`; phase 1
  introduces `SimParamsV2` and switches the builder's input. Phase 0 keeps the
  v1 series keys (`n_infected` is the infectious count, `new_deaths` and
  `cum_deaths` are disease deaths from the models' own counter); the key set
  of section 8.6 (`n_infectious`, `*_all`) arrives in phase 2 together with
  the service test that pins the key set.
- **Uniform behaviour across models.** The v1 templates rendered treatment
  only for sir and sis, the vaccine never for sis, and age assignment never
  for sis. The builder applies all three to every model (treatment targets
  infectious agents). The phase 0 parity test uses default parameters with no
  interventions, so it is unaffected. v1 `sis` also drew `p_death`; section
  7.2 excludes sis from `p_death`, so sis deaths are zero from phase 0 on.
- **Phase 0 keeps the day-0 vaccine move and the age assignment as v1 wrote
  them** (numpy generators seeded from `rand_seed`); phase 2 replaces the
  vaccine move with `InitialImmunity` and the interventions spec owns the rest.
- **Prompt additions** (section 9.3) go into `web/lib/chat/prompt.ts`
  (`ADDITIONS`), not into the Python agent's system prompt, which the web app
  only imports as a frozen export.
- **Evals.** The golden harness drives the Python `EpiChatAgent` and the
  templates, both unmaintained after this project. Until the harness drives
  the deployed web agent (sub-project 5, pilot hardening), the existing cases
  keep their flat `config` checks, and the two new cases of section 1 are
  written as YAML with a `pending: api-harness` marker and covered by vitest
  tests of `describe_parameters` and of the diagnostic-to-rerun flow. This is
  an assumption the owner can overturn; nothing in phases 0 to 4 depends on it.
- **Options without new UI.** Section 15 keeps the run-card buttons of
  section 11 for the workspace follow-up. In this project the model offers
  the options as suggested replies through the existing `next` block (which
  already records `suggestion_used`), and `option_chosen` is derived from the
  next configuration's applied patch as section 11 says.
- **Parity baseline.** Captured on Starsim 3.3.2 with the template pipeline
  before any pin changes and committed as `tests/fixtures/sim_baseline_v1.json`
  (per model: parameters, per-seed results, medians over seeds 1 to 10).
- **Plans.** Four implementation plans: phase 0; phases 1 and 2; phases 3
  and 4; phase 5. Each is merged to `main` locally and pushed by the owner,
  so each phase ships on its own as section 12 requires.

## 18. Revision 2026-10-12: the age-structured network, and phase 1 and 2 rulings

The phase 1 investigation of section 7.4 was done before the phases 1 and 2
plan, on Starsim 3.7.2 (`ss.MixingPools` source read; 18 runs of 50k agents
through the phase 0 builder, SIR, constant 10-day infectious period, 0.1%
seeding, R0 1.5, 2.5 and 4, with and without age shares). Findings:

- **Orientation.** `n_contacts[i][j]` is source group `i` to destination
  group `j`: the mean number of effective contacts a destination agent in `j`
  has with the source group `i`. Each pool draws every agent's `eff_contacts`
  once, at initialization, from `Poisson(C[i][j] × network_beta)`; the draw
  is fixed for the run.
- **The `rel_trans` mean.** `Infection.infect` masks `rel_trans` to infectious
  agents before any route sees it, so the pool's `mean(rel_trans[src])` is the
  source group's infectious prevalence weighted by `rel_trans`. The SEIAR
  reduction therefore enters the pool exactly, as `asymp_factor` in 7.4.
- **Ages assigned after `sim.init()` reach the groups.** `ss.AgeGroup`
  recomputes its members from `sim.people.age` on every step (cached per
  step) and the pools' `step()` runs before transmission, so the builder's
  age assignment takes effect from day 0; group sizes matched the shares
  exactly. Without age shares Starsim's default ages are uniform on 0 to 60,
  so the elderly group is empty; the demographics spec owns that.
- **Why the attack rates looked equal.** At the default beta (R0 about 6 on
  this network) every group ends near 100%. At R0 1.5 to 4 the groups differ
  as the matrix's column sums say (children 47%, adults 58%, elderly 21% at
  R0 1.5).
- **The next-generation matrix.** Per day, a destination agent in `j` is
  infected through pool `i → j` with probability
  `p × network_beta × C[i][j] × I_i / N_i` in expectation, `p = 1 − exp(−beta / 365)`.
  Over an infectious period of `D_eff` days (7.4) one infectious agent in `i`
  therefore causes `K[j][i] = p × network_beta × C[i][j] × (N_j / N_i) × D_eff × asymp_factor`
  infections in `j`. `K` is similar to `C^T`, so

  ```
  R0 (age-structured) = rho(C) × network_beta × p × D_eff × asymp_factor,   rho(C) = 11.0028224279
  ```

  independent of the age shares and of `n_contacts`. The population
  weighting in the v1 formula (`C[i][j] × pop[j]`) is dropped; `calibrateBeta`
  inverts this form with the same unreachable-R0 rule as the random network.
  `approx_r0` on this network is exact from phase 1 on, so the
  `approximate: true` marker of 7.4 is not needed.
- **Per-group final sizes.** Because each agent's contacts are a fixed
  Poisson draw, the group attack rates follow the heterogeneous final-size
  system `z_j = 1 − exp(−network_beta × Σ_i C[i][j] × (1 − exp(−a × z_i)))`
  with `a = p × D_eff × asymp_factor`, not the homogeneous one. At 50k agents
  the simulated group attack rates, averaged over three seeds, were within
  1.5 percentage points of that solution at every R0 (the homogeneous
  solution overstates them by up to 7 points). The per-group test of section
  13 is therefore: for R0 1.5, 2.5 and 4 with age shares 38.6 / 57.6 / 3.8,
  each group's attack rate averaged over three seeds is within 0.03 of the
  heterogeneous solution.

Rulings for the phases 1 and 2 plan:

- **R0 calibration tests seed 0.1%** (`Seed(mode="count", value=50)` at
  50k agents) instead of the three seeds of section 13: with three seeds an
  R0 of 1.5 fades out about 30% of the time. The implied R0 includes the
  seeds either way.
- **A vaccine with `start_day == 0` is normalized on validation** in both
  languages: it becomes `disease.initial_immune_frac = coverage` and leaves
  `interventions`, exactly as the migration rule does, so the two never
  coexist. When both are given and differ, validation fails naming both
  paths. The configure tool and the WHO coverage tool write
  `initial_immune_frac` directly for a day-0 vaccine.
- **Gamma defaults apply when a duration is created**, not when an existing
  one's mean changes: the configure tool creates a `Duration` as gamma with
  the 7.3 sd; a later change to its mean keeps the distribution and
  recomputes the sd by the same rule; `constant` stays constant. Migrated
  durations are constant and stay so.
- **`disease.dur_exp.mean_days` ranges 0.1 to 1000 days** (its sd 0.01 to 2000),
  not the 60 days of 7.2: the database's tuberculosis incubation range reaches
  730 days, and a bound below the database locks a disease out.
- **`replicates` in the service answer are population-scaled** like `stats` and
  the series (the per-replicate stats and the bands), so the model reads one
  unit; `recalibrate_beta` reads a changed beta on the network it was set on.
- **`beta` keeps the v1 unit and bounds** (`0.001` to `1000` per year). The
  TypeScript `SimParams` type becomes the v2 shape and `validateParams`
  accepts v1 or v2, migrating v1, so every stored row reads as v2.
- **The service's `/simulate` takes `params` as either shape** and answers
  422 with the same `invalid_params` detail list for both. `effective_params`,
  repair diffs (`field` is now a dotted v2 path), and the run row are v2.
- **The exact R0 lives in `epichat/params/r0.py`** for v2; the v1 functions in
  `schema.py` and `parser.py` stay as they are for the frozen Python agent and
  its tests. The demographics rescale for the service moves to
  `epichat/params/resolve.py` (v2) and the repair loop to
  `epichat/params/repair.py` (v2, same prompt, v2 schema).
- **Series keys from phase 2** are the 8.6 set; `n_infected` is still sent and
  the web app reads `n_infectious` with `n_infected` as the fallback for stored
  runs. `total_deaths` counts disease deaths only; a run with demographics on
  gets a warning line saying so, from the web run tool, this release.
