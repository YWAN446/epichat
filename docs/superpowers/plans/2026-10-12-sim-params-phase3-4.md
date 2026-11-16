# Sim Parameters, Phases 3 and 4: Agent Interface, Diagnostics, Options and Comparison — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent every registry parameter (the `advanced` patch and `describe_parameters`), and give every run its diagnostics, its options and its comparison with the previous run, recorded for threshold tuning.

**Architecture:** The service grows one pure module, `epichat/sim/diagnostics.py`, that reads a finished run (full series, agent units) and answers a list of `Diagnostic`s with `Lever`s; `/simulate` takes the disease name and returns `diagnostics` beside the stats. On the web side the configure tool learns the spec's core field names and an `advanced` patch of registry paths (applied with the core fields, validated once, every failure naming its path), reports `changed`, and a new `describe_parameters` tool lists the registry for the current model with each value's source. The run tool passes diagnostics and a `compare` block (against the previous run read from the `runs` table) to the model and the card; the chat handler records `diagnostic_shown` and `option_chosen` step events, and the run row stores its diagnostics through migration 0007. The prompt gains the parameter and option guidance of spec 9.3 and 11. No new card kind and no new rendering (spec 11, 15).

**Tech Stack:** Python 3.12 (pydantic 2, numpy, FastAPI) for the service and the package; TypeScript (Next.js 16, zod 4, vitest) for the web app; Supabase SQL for the migration. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-09-sim-parameters-disease-design.md`, sections 9 (agent interface), 10 (diagnostics), 11 (options and rerun), 13 (testing), phases 3 and 4 of section 12, as reconciled by sections 17, 18 and 19. Section 19 records the rulings this plan builds on; read it with the plan.

## Global Constraints

- Interpreters: root package tests `.venv/Scripts/python.exe -m pytest …` (Python 3.12, Starsim 3.7.2); service tests `sim/.venv/Scripts/python.exe -m pytest sim/tests -q`; web tests `npx vitest run …`, `npm run typecheck`, `npm run lint` from `web/`. All commands below run from the repository root unless they say `web/`.
- `npm --prefix web ci` only, never `npm install`; no new npm or Python dependencies.
- The service's parent process never imports Starsim or the Anthropic SDK (`sim/tests/test_imports.py`); `epichat/sim/diagnostics.py` therefore imports only `epichat.params.*`, `epichat.disease_db` and numpy.
- No new `CardPayload` kind: `diagnostics` and `compare` are fields of the `run` payload, `changed` a field of the `config` payload (spec 11). Rendering them is out of scope (spec 15).
- Prompt additions go into `ADDITIONS` in `web/lib/chat/prompt.ts` (spec 17); the system prompt stays dateless, deterministic and cacheable (`web/tests/chat/prompt.test.ts`).
- Tool definitions keep their order; `describe_parameters` is appended after `remember` (spec 19).
- Migration `0007_run_diagnostics.sql` (spec 17): safe to run twice, applied by the owner in the SQL editor before the push; `finish_turn` is not touched (spec 19).
- Options reach the user through the `next` block (spec 17): each line at most 80 characters, so suggested replies name the change in plain words, never a path list.
- Every diagnostic threshold is a named module constant (spec 10); suggested values are clamped to the registry bounds and, when the disease is known, to the database consensus range, and a lever says when the range moved its value (spec 10).
- Evidence and lever values are in agent units (spec 19).
- Never print `SIM_SHARED_SECRET`, the Supabase secret, the Resend key or the UN API key.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UL6ToyEthpP1X8yxArZE6g`.

## Review Focus

1. **A lever that no longer applies.** The user changes the model between a run and the option (for example switches to seiar by hand and then takes the `fatality_on_all_infections` option, whose patch names `disease.p_asymp` and `disease.dur_exp.mean_days`): a reasonable person expects the configure call either to apply cleanly or to answer `CONFIG ERROR` naming the path, with the scenario untouched and no `option_chosen` recorded. Test added to Task 7 (an `advanced` patch that fails validation records no option).
2. **Runs stored before migration 0007.** A conversation whose previous run row has no `diagnostics` column value: `compare` must still work and the diagnostics read as none. Test added to Task 4 (`latest` maps a missing or null `diagnostics` to `[]`).
3. **Diagnostics on the full series.** The web app receives a thinned series (`SIM_SERIES_MAX_POINTS`); the diagnostics must come from the child's full series in the service, never from the thinned one. Test added to Task 3 (with the series thinned to three points, `unfinished` still reads the fourth day's incidence).
4. **An `advanced` value of the wrong kind.** A numeric string (`"5"`) or a fraction for an integer leaf (`run.n_replicates: 2.5`): a reasonable person expects `CONFIG ERROR … must be a whole number`, never a silently coerced value. Test added to Task 5.
5. **`describe_parameters` on a migrated v1 scenario with an unknown disease.** Stored v1 params read as v2; the disease is not in the database: every source is `user` or `default`, `db_range` is `null`, nothing throws. Test added to Task 6.

## File Structure

Python (package and service):
- Modify `epichat/sim/outputs.py` — `realized_seeds(sim, seeds_day0)`; `stats.seeds`.
- Modify `sim/series.py` — `COUNT_STATS` gains `seeds`.
- Create `epichat/sim/diagnostics.py` — `Lever`, `Diagnostic`, the thresholds, `final_size`, `realized_seeds`, `db_range`, `illustrative_sd`, `bounded`, the nine rules, `diagnose`, `as_dicts`.
- Modify `sim/main.py` — `SimulateRequest.disease`, 422 for a malformed v1 body, `diagnostics` in the 200 body.
- Tests: `tests/test_sim_outputs.py`, `sim/tests/test_series.py`, `tests/test_sim_diagnostics.py` (new), `sim/tests/test_api.py`.

TypeScript (web app):
- Modify `web/lib/sim/client.ts` — `Lever`, `Diagnostic`, `SimSuccess.diagnostics`, `simulate(…, disease)`.
- Modify `web/lib/enums.ts` — two server step-event kinds.
- Create `web/supabase/migrations/0007_run_diagnostics.sql`.
- Modify `web/lib/db/runs.ts` — `diagnostics` column on insert, `RunStore.latest`, `PreviousRun`.
- Modify `web/lib/sim/paths.ts` — `PathChange`, `changedPaths`.
- Create `web/lib/tools/advanced.ts` — `applyAdvanced`.
- Modify `web/lib/tools/configureSimulation.ts` — core field names, `advanced`, `changed`, option matching, the clamp warning.
- Create `web/lib/tools/options.ts` — `matchedLevers`.
- Create `web/lib/tools/sources.ts` — `valueSources`, `dbRange`.
- Create `web/lib/tools/describeParameters.ts` — the tool.
- Modify `web/lib/tools/runSimulation.ts` — `diagnostics`, `compare`, the disease argument.
- Modify `web/lib/tools/types.ts` — `ConfigPayload.changed`, `RunPayload.diagnostics/compare`, `RunCompare`, `ToolDeps.previousRun/onOptionChosen`.
- Modify `web/lib/tools/index.ts` — the tool schemas and the registry entry.
- Modify `web/lib/chat/handleChat.ts` — the two step events, `previousRun`.
- Modify `web/lib/chat/prompt.ts` — `## Parameters`, `## Diagnostics and options`.
- Modify `web/lib/client/toolLine.ts`, `web/lib/client/format.ts`, `web/lib/report/compose.ts`, `web/lib/tools/durations.ts`.
- Modify `web/docs/DEPLOY.md` — migration 0007, section 7 paragraph, section 6i.
- Tests under `web/tests/` as each task names them.

---

### Task 1: `stats.seeds`, the realized seeds for the diagnostics

**Files:**
- Modify: `epichat/sim/outputs.py`
- Modify: `sim/series.py:9` (`COUNT_STATS`)
- Test: `tests/test_sim_outputs.py`, `sim/tests/test_series.py`

**Interfaces:**
- Consumes: `SeedInfections.n_seeded` (`epichat/sim/interventions.py`), `sim.seeds_day0` set by `build_sim`.
- Produces: `realized_seeds(sim: ss.Sim, seeds_day0: int) -> int` and `stats["seeds"]` (int) in `extract`'s result; `scale_stats` scales `seeds` like the other counts. Task 2's `realized_seeds(stats, params)` reads `stats["seeds"]`; Task 3's service answers carry it inside `stats`, `stats_agents` and the replicate stats.

- [ ] **Step 1: Write the failing outputs test**

Append to `tests/test_sim_outputs.py`:

```python
def test_seeds_stat_counts_day_zero_and_delayed_seeds():
    out, sim = run("sir")
    assert out["stats"]["seeds"] == out["stats"]["seeds_day0"] == sim.seeds_day0
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001, "seed": {"mode": "count", "value": 30, "day": 4}},
                                    "run": {"n_agents": 500, "sim_dur_years": 10 / 365, "rand_seed": 1}})
    delayed = build_sim(p)
    delayed.run()
    stats = extract(delayed, 500, delayed.seeds_day0, False)["stats"]
    assert stats["seeds_day0"] == 0 and stats["seeds"] == 30
```

- [ ] **Step 2: Run it and watch it fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_outputs.py -q -k seeds_stat`
Expected: FAIL with `KeyError: 'seeds'`.

- [ ] **Step 3: Add `realized_seeds` and the stat**

In `epichat/sim/outputs.py`, add the import and the function, and the stat:

```python
from .interventions import SeedInfections
```

```python
def realized_seeds(sim: ss.Sim, seeds_day0: int) -> int:
    """The day-0 seeds plus what a delayed SeedInfections infected: spec 10's `seeds`."""
    delayed = sum(int(i.n_seeded) for i in sim.interventions.values() if isinstance(i, SeedInfections))
    return int(seeds_day0) + delayed
```

In `extract`, the `stats` dict gains one line after `"seeds_day0": int(seeds_day0),`:

```python
        "seeds": realized_seeds(sim, seeds_day0),
```

Update the module docstring's last sentence to say the stats carry `seeds_day0` and `seeds`.

- [ ] **Step 4: Run the outputs tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_outputs.py -q`
Expected: all pass (the new test among them).

- [ ] **Step 5: Write the failing series test**

In `sim/tests/test_series.py`, extend the import line to `from series import scale_counts, scale_stats, scaled_outcome, stats_from, stride_for, thin` and append:

```python
def test_scale_stats_scales_the_seed_counts_and_leaves_days_alone():
    scaled = scale_stats({"seeds": 3, "seeds_day0": 2, "peak_day": 7, "total_infected": 10}, 100)
    assert scaled == {"seeds": 300, "seeds_day0": 200, "peak_day": 7, "total_infected": 1000}
```

- [ ] **Step 6: Run it and watch it fail**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests/test_series.py -q -k seed_counts`
Expected: FAIL: `seeds` stays 3.

- [ ] **Step 7: Scale `seeds`**

In `sim/series.py`:

```python
COUNT_STATS = ("peak_infections", "total_infected", "total_deaths", "seeds_day0", "seeds")
```

- [ ] **Step 8: Run both suites**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests -q` then `.venv/Scripts/python.exe -m pytest tests/test_sim_outputs.py tests/test_sim_replicates.py tests/test_sim_run_params.py -q`
Expected: all pass. (`sim/tests/test_real_run.py` runs real children, so their stats now carry `seeds`; no test pins the stats key set.)

- [ ] **Step 9: Commit**

```bash
git add epichat/sim/outputs.py sim/series.py tests/test_sim_outputs.py sim/tests/test_series.py
git commit -m "feat(sim): stats.seeds counts the day-0 and delayed seeds for the diagnostics"
```

---

### Task 2: `epichat/sim/diagnostics.py`

**Files:**
- Create: `epichat/sim/diagnostics.py`
- Test: `tests/test_sim_diagnostics.py`

**Interfaces:**
- Consumes: `approx_r0`, `calibrate_beta`, `clamp_beta`, `R0Unreachable` (`epichat/params/r0.py`); `REGISTRY_BY_PATH`, `DEATH_MODELS`, `WANING_MODELS` (`epichat/params/registry.py`); `lookup`, `_range_of`, `_num` (`epichat/disease_db.py`); `stats["seeds"]` from Task 1.
- Produces:
  - `@dataclass Lever(patch: dict, current: dict, direction: "increase"|"decrease"|"change", rationale: str, basis: "disease_db"|"rule"|"user")`
  - `@dataclass Diagnostic(id: str, severity: "info"|"warning", title: str, evidence: dict, levers: list[Lever])`
  - `diagnose(params: SimParamsV2, series: dict, stats: dict, replicates: dict | None, seeds: int, disease: str | None = None) -> list[Diagnostic]` (warnings first)
  - `as_dicts(diagnostics) -> list[dict]` (JSON-ready, `asdict`)
  - `realized_seeds(stats: dict, params: SimParamsV2) -> int`, `final_size(r) -> float`, `db_range(disease, db_field) -> (min, max, typical) | None` in simulation units, `illustrative_sd(db_field, mean, disease) -> (sd, basis)`, `bounded(path, value, disease) -> (value, note)`.
  - The threshold constants named in the module (Task 3's tests and the pilot tuning read them by name).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_sim_diagnostics.py`:

```python
"""Spec 10: each rule fires on a constructed series and stays quiet on a normal run; suggested values respect the bounds and the database."""
import json
import math

import pytest

from epichat.params.r0 import approx_r0, calibrate_beta, clamp_beta
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim import diagnostics as dx
from epichat.sim.diagnostics import bounded, db_range, diagnose, final_size, illustrative_sd, realized_seeds

N = 10000
DAYS = 366
GAMMA_10 = {"mean_days": 10, "dist": "gamma", "sd_days": 3}


def params(**over) -> SimParamsV2:
    """Default sir on 10k agents for a year with a gamma 10-day infectious period (R0 about 2.3), plus dotted-path overrides."""
    body = {"disease": {"dur_inf": dict(GAMMA_10)}, "run": {"n_agents": N, "sim_dur_years": 1.0, "rand_seed": 1}}
    for path, value in over.items():
        node = body
        parts = path.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value
    return SimParamsV2.model_validate(body)


def curve(peak: float, t_peak: int, width: int, tail: float = 0.0, days: int = DAYS) -> list[float]:
    """A triangular epidemic: up to `peak` at `t_peak`, down over `width` days, then flat at `tail`."""
    out = []
    for t in range(days):
        if t <= t_peak:
            out.append(peak * t / max(t_peak, 1))
        elif t <= t_peak + width:
            out.append(max(tail, peak * (1 - (t - t_peak) / width)))
        else:
            out.append(tail)
    return out


def run(p: SimParamsV2, infectious: list[float], total: float, seeds: int, new: list[float] | None = None, replicates=None, disease=None):
    series = {"day": list(range(len(infectious))), "n_infectious": infectious, "new_infections": new or [0.0] * len(infectious)}
    stats = {"total_infected": total, "n_agents": p.run.n_agents, "seeds": seeds, "seeds_day0": seeds if p.disease.seed.day == 0 else 0}
    return diagnose(p, series, stats, replicates, seeds, disease)


def ids(found):
    return [d.id for d in found]


def one(found, wanted):
    return next(d for d in found if d.id == wanted)


FADED = [10.0, 4.0, 1.0] + [0.0] * (DAYS - 3)
NORMAL = curve(800, 60, 200)           # ends at 0; 8600 of 10000 infected matches the final size of R0 2.3


def test_early_fadeout_suggests_more_seeds_replicates_and_the_database_r0():
    p = params()
    found = run(p, FADED, total=15, seeds=10)
    assert ids(found) == ["early_fadeout"]
    d = found[0]
    assert d.severity == "warning" and d.evidence["seeds"] == 10 and d.evidence["total_infected"] == 15 and d.evidence["r_eff"] > 1
    assert [lever.patch for lever in d.levers] == [{"disease.seed.mode": "count", "disease.seed.value": 50}, {"run.n_replicates": 5}]
    assert d.levers[0].basis == "rule" and d.levers[0].direction == "increase"
    assert d.levers[0].current == {"disease.seed.mode": "fraction", "disease.seed.value": 0.01}
    beta = one(run(p, FADED, total=15, seeds=10, disease="measles"), "early_fadeout").levers[2]
    assert beta.basis == "disease_db" and beta.patch == {"disease.beta": clamp_beta(calibrate_beta(p, 15))}
    assert "15" in beta.rationale and "measles" in beta.rationale and beta.current == {"disease.beta": p.disease.beta}
    assert "early_fadeout" not in ids(run(p, NORMAL, total=8600, seeds=100))


def test_early_fadeout_caps_the_seed_suggestion_at_the_agents_and_skips_a_matching_database_r0():
    small = params(**{"run.n_agents": 30})
    d = one(run(small, FADED, total=12, seeds=10), "early_fadeout")
    assert d.levers[0].patch["disease.seed.value"] == 30
    tuned = SimParamsV2.model_validate({**params().model_dump(), "disease": {**params().model_dump()["disease"], "beta": clamp_beta(calibrate_beta(params(), 15))}})
    assert len(one(run(tuned, FADED, total=15, seeds=10, disease="measles"), "early_fadeout").levers) == 2


def test_instant_peak_fires_above_two_percent_seeding_and_not_at_the_one_percent_default():
    p = params()
    found = run(p, [300.0, 320.0, 250.0] + curve(200, 20, 60)[3:], total=8600, seeds=300)
    d = one(found, "instant_peak")
    assert d.severity == "warning" and d.evidence == {"peak_day": 1, "seeds": 300, "seed_share": 0.03}
    assert d.levers[0].patch == {"disease.seed.mode": "count", "disease.seed.value": 10} and d.levers[0].direction == "decrease"
    quiet = run(p, [100.0, 110.0, 90.0] + curve(80, 20, 60)[3:], total=8600, seeds=100)
    assert "instant_peak" not in ids(quiet)


def test_unfinished_fires_on_a_tail_or_a_rising_incidence_and_doubles_the_duration():
    p = params()
    d = one(run(p, curve(500, 60, 200, tail=100), total=8600, seeds=100), "unfinished")
    assert d.severity == "warning" and d.evidence == {"last_infectious": 100, "peak": 500, "still_rising": False}
    assert d.levers[0].patch == {"run.sim_dur_years": 2.0} and d.levers[0].current == {"run.sim_dur_years": 1.0} and d.levers[0].direction == "increase"
    sirs = params(**{"disease.model": "sirs", "disease.dur_immune": {"mean_days": 60}})
    rising = one(run(sirs, NORMAL, total=8600, seeds=100, new=[1.0] * 300 + [5.0] * 66), "unfinished")
    assert rising.evidence["still_rising"] is True
    assert "unfinished" not in ids(run(sirs, NORMAL, total=8600, seeds=100, new=[5.0] * 300 + [1.0] * 66))
    at_the_bound = params(**{"run.sim_dur_years": 20.0})
    assert one(run(at_the_bound, curve(500, 60, 200, tail=100), total=8600, seeds=100), "unfinished").levers == []
    assert "unfinished" not in ids(run(p, NORMAL, total=8600, seeds=100))


def test_final_size_gap_fires_on_a_simple_run_whose_attack_rate_misses_the_final_size():
    p = params()
    z = final_size(approx_r0(p))
    assert 0.8 < z < 0.9
    d = one(run(p, NORMAL, total=3000, seeds=100), "final_size_gap")
    assert d.severity == "info" and d.evidence["attack_rate"] == 0.3 and abs(d.evidence["expected_attack_rate"] - z) < 1e-3 and d.levers == []
    recheck = one(run(p, NORMAL, total=3000, seeds=100, disease="measles"), "final_size_gap").levers[0]
    assert recheck.patch == {"disease.beta": clamp_beta(calibrate_beta(p, 15))} and recheck.basis == "disease_db"
    assert "final_size_gap" not in ids(run(p, NORMAL, total=8600, seeds=100))
    assert "final_size_gap" not in ids(run(p, curve(800, 60, 200, tail=100), total=3000, seeds=100))      # unfinished instead
    assert "final_size_gap" not in ids(run(p, FADED, total=15, seeds=10))                                 # early_fadeout instead
    immune = params(**{"disease.initial_immune_frac": 0.5})                                               # R_eff about 1.15, z about 0.25
    assert "final_size_gap" not in ids(run(immune, curve(300, 60, 200), total=1800, seeds=100))
    age = params(**{"network.network_type": "age_structured"})
    assert "final_size_gap" not in ids(run(age, NORMAL, total=3000, seeds=100))                          # not a simple run


def test_final_size_is_the_fixed_point_and_zero_at_or_below_one():
    assert final_size(0.9) == 0.0 and final_size(1.0) == 0.0
    z = final_size(2.0)
    assert abs(z - (1 - math.exp(-2.0 * z))) < 1e-9 and abs(z - 0.7968) < 1e-3


def test_sharp_curve_fires_only_with_constant_periods_and_suggests_the_illustrative_sd():
    constant = params(**{"disease.dur_inf": {"mean_days": 10}})
    narrow = curve(800, 10, 6)                                   # 9 days at or above half the peak, below 2 × 10
    d = one(run(constant, narrow, total=8600, seeds=100), "sharp_curve")
    assert d.severity == "info" and d.evidence == {"days_at_half_peak": 9, "dur_inf_mean_days": 10}
    assert d.levers[0].patch == {"disease.dur_inf.dist": "gamma", "disease.dur_inf.sd_days": 3.0} and d.levers[0].basis == "rule"
    assert d.levers[0].current == {"disease.dur_inf.dist": "constant", "disease.dur_inf.sd_days": None}
    flu = one(run(constant, narrow, total=8600, seeds=100, disease="influenza"), "sharp_curve")
    assert flu.levers[0].patch["disease.dur_inf.sd_days"] == 0.5 and flu.levers[0].basis == "disease_db"   # 6–8 days: (8 − 6) / 4
    assert "sharp_curve" not in ids(run(params(), narrow, total=8600, seeds=100))                             # gamma already
    assert "sharp_curve" not in ids(run(constant, curve(800, 30, 10), total=8600, seeds=100))                # 21 days at half peak


def test_cfr_out_of_range_needs_a_known_fatal_disease_and_a_model_with_deaths():
    d = one(run(params(**{"disease.p_death": 0.2}), NORMAL, total=8600, seeds=100, disease="measles"), "cfr_out_of_range")
    assert d.severity == "warning" and d.evidence == pytest.approx({"p_death": 0.2, "db_min": 0.005, "db_max": 0.06})
    assert d.levers[0].patch == pytest.approx({"disease.p_death": 0.015}) and d.levers[0].direction == "decrease" and d.levers[0].basis == "disease_db"
    assert "1.5%" in d.levers[0].rationale
    assert "cfr_out_of_range" in ids(run(params(), NORMAL, total=8600, seeds=100, disease="measles"))        # 0 is below 0.5%
    assert "cfr_out_of_range" not in ids(run(params(**{"disease.p_death": 0.01}), NORMAL, total=8600, seeds=100, disease="measles"))
    sis = params(**{"disease.model": "sis"})
    assert "cfr_out_of_range" not in ids(run(sis, curve(800, 60, 200, tail=300), total=8600, seeds=100, disease="measles"))
    assert "cfr_out_of_range" not in ids(run(params(**{"disease.p_death": 0.2}), NORMAL, total=8600, seeds=100, disease="dengue"))   # no range
    assert "cfr_out_of_range" not in ids(run(params(**{"disease.p_death": 0.2}), NORMAL, total=8600, seeds=100))


def test_fatality_on_all_infections_offers_seiar_with_the_database_asymptomatic_share():
    d = one(run(params(**{"disease.p_death": 0.001}), NORMAL, total=8600, seeds=100, disease="influenza"), "fatality_on_all_infections")
    assert d.severity == "info" and d.evidence == {"p_death": 0.001, "db_asymptomatic_fraction": 0.3}
    assert d.levers[0].patch == {"disease.model": "seiar", "disease.p_asymp": 0.3, "disease.dur_exp.mean_days": 2} and d.levers[0].basis == "disease_db"
    assert d.levers[0].current == {"disease.model": "sir", "disease.p_asymp": 0.3, "disease.dur_exp.mean_days": None}
    seir = params(**{"disease.model": "seir", "disease.dur_exp": {"mean_days": 2}, "disease.p_death": 0.001})
    assert one(run(seir, NORMAL, total=8600, seeds=100, disease="influenza"), "fatality_on_all_infections").levers[0].patch == {"disease.model": "seiar", "disease.p_asymp": 0.3}
    assert "fatality_on_all_infections" not in ids(run(params(), NORMAL, total=8600, seeds=100, disease="influenza"))                     # no deaths configured
    assert "fatality_on_all_infections" not in ids(run(params(**{"disease.p_death": 0.01}), NORMAL, total=8600, seeds=100, disease="measles"))   # no asymptomatic share
    seiar = params(**{"disease.model": "seiar", "disease.dur_exp": {"mean_days": 2}, "disease.p_death": 0.001})
    assert "fatality_on_all_infections" not in ids(run(seiar, NORMAL, total=8600, seeds=100, disease="influenza"))


def test_no_reinfection_when_immunity_outlasts_the_run():
    sirs = params(**{"disease.model": "sirs", "disease.dur_immune": {"mean_days": 1825}})
    d = one(run(sirs, NORMAL, total=8600, seeds=100), "no_reinfection")
    assert d.severity == "info" and d.evidence == {"dur_immune_mean_days": 1825, "sim_days": 365}
    assert d.levers[0].patch == {"run.sim_dur_years": 10} and d.levers[0].direction == "increase" and d.levers[0].basis == "rule"
    forever = params(**{"disease.model": "sirs", "disease.dur_immune": {"mean_days": 36500}})
    assert one(run(forever, NORMAL, total=8600, seeds=100), "no_reinfection").levers == []     # 200 years is past the 20-year bound
    short = params(**{"disease.model": "sirs", "disease.dur_immune": {"mean_days": 180}})
    assert "no_reinfection" not in ids(run(short, NORMAL, total=8600, seeds=100))


def test_high_variance_reports_the_spread_and_the_faded_share():
    p = params(**{"run.n_replicates": 3})
    stats = lambda total: {"total_infected": total, "n_agents": N}      # noqa: E731
    rep = {"n": 3, "seeds": [1, 2, 3], "representative": 2, "stats": [stats(50), stats(5000), stats(9000)], "bands": {}}
    d = one(run(p, curve(500, 60, 200), total=8600, seeds=100, replicates=rep), "high_variance")
    assert d.severity == "info" and d.levers == []
    assert d.evidence["median_total_infected"] == 5000 and d.evidence["n_replicates"] == 3 and d.evidence["spread"] > 0.5
    assert d.evidence["faded_out_share"] == pytest.approx(1 / 3, abs=0.01) and d.evidence["p10_total_infected"] < d.evidence["p90_total_infected"]
    tight = {**rep, "stats": [stats(4900), stats(5000), stats(5100)]}
    assert "high_variance" not in ids(run(p, curve(500, 60, 200), total=8600, seeds=100, replicates=tight))
    assert "high_variance" not in ids(run(params(), curve(500, 60, 200), total=8600, seeds=100))


def test_warnings_come_before_infos_and_the_dict_form_is_json_ready():
    found = run(params(**{"disease.p_death": 0.2}), curve(800, 60, 200, tail=100), total=3000, seeds=100, disease="measles")
    assert ids(found) == ["unfinished", "cfr_out_of_range"]            # the gap stands down when the run is unfinished
    mixed = run(params(**{"disease.model": "sirs", "disease.dur_immune": {"mean_days": 1825}, "disease.p_death": 0.2}),
                NORMAL, total=8600, seeds=100, disease="measles")
    assert ids(mixed) == ["cfr_out_of_range", "no_reinfection"]        # warning first, then the info
    as_json = dx.as_dicts(found)
    assert as_json[0]["levers"][0]["patch"] == {"run.sim_dur_years": 2.0} and as_json[0]["severity"] == "warning"
    json.dumps(as_json)


def test_bounded_clamps_to_the_registry_and_names_the_database_range():
    assert bounded("run.sim_dur_years", 50, None) == (20.0, "")
    value, note = bounded("disease.p_death", 0.5, "measles")
    assert value == pytest.approx(0.06) and "database range" in note
    assert bounded("disease.p_death", 0.02, "measles") == (0.02, "")
    assert bounded("run.n_replicates", 7.4, None) == (5, "")


def test_database_ranges_come_back_in_simulation_units():
    assert db_range("measles", "fatality_rate") == pytest.approx((0.005, 0.06, 0.015))
    assert db_range("influenza", "asymptomatic_fraction") == pytest.approx((0.16, 0.85, 0.3))
    assert db_range("influenza", "immunity_duration") == pytest.approx((1278, 2920, 1825))
    assert db_range("dengue", "fatality_rate") is None and db_range(None, "r0") is None and db_range("not a disease", "r0") is None
    assert illustrative_sd("infectious_days", 8, "measles") == (2.4, "rule")             # 8–8 is not a range
    assert illustrative_sd("infectious_days", 7, "influenza") == (0.5, "disease_db")
    assert illustrative_sd("incubation_days", 1, "measles") == (1.0, "disease_db")      # (21 − 7) / 4 capped at the mean


def test_realized_seeds_prefers_the_stat_and_falls_back_sensibly():
    p = params()
    assert realized_seeds({"seeds": 7, "seeds_day0": 3}, p) == 7
    assert realized_seeds({"seeds_day0": 3}, p) == 3
    assert realized_seeds({}, p) == 100
    delayed = params(**{"disease.seed": {"mode": "count", "value": 30, "day": 4}})
    assert realized_seeds({"seeds_day0": 0}, delayed) == 30


def test_the_thresholds_are_named_constants():
    for name in ("FADEOUT_SEED_MULTIPLE", "INSTANT_PEAK_DAY", "INSTANT_PEAK_SEED_SHARE", "UNFINISHED_TAIL_SHARE", "UNFINISHED_WINDOW_SHARE",
                 "FINAL_SIZE_GAP", "SHARP_CURVE_WIDTH_MULTIPLE", "FATALITY_ASYMP_SHARE", "HIGH_VARIANCE_SPREAD", "R0_RECHECK_TOLERANCE"):
        assert isinstance(getattr(dx, name), (int, float)), name


def test_a_normal_run_raises_no_diagnostic():
    from epichat.sim.replicates import run_replicates
    p = params(**{"run.n_agents": 2000})
    out = run_replicates(p)
    assert diagnose(p, out["series"], out["stats"], None, out["stats"]["seeds"], None) == []
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_diagnostics.py -q`
Expected: collection error, `ModuleNotFoundError: No module named 'epichat.sim.diagnostics'`.

- [ ] **Step 3: Write the module**

Create `epichat/sim/diagnostics.py`:

```python
"""Spec 10: diagnostics over a finished run. Pure and deterministic, no Starsim:
the service calls diagnose() after every successful run, on the child's full
agent-unit series, and sends the result with the answer. Every threshold is a
named constant; the values are the spec's starting points, to be tuned from
the diagnostic_shown and option_chosen events of section 11.

The disease name comes from the web app (the scenario's disease, or the one
detected in the conversation). With it, suggested values are checked against
the database consensus range and the levers cite it (section 19)."""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

import numpy as np

from epichat.disease_db import _num, _range_of, lookup
from epichat.params.r0 import R0Unreachable, approx_r0, calibrate_beta, clamp_beta
from epichat.params.registry import DEATH_MODELS, REGISTRY_BY_PATH, WANING_MODELS
from epichat.params.schema_v2 import SimParamsV2

Severity = Literal["info", "warning"]
Direction = Literal["increase", "decrease", "change"]
Basis = Literal["disease_db", "rule", "user"]

# Section 10's thresholds; starting points, tuned from pilot data.
FADEOUT_SEED_MULTIPLE = 2            # early_fadeout and the faded-out share: total_infected < 2 × seeds
FADEOUT_SEED_FACTOR = 5              # suggested seeds: max(5 × seeds, 10), at most n_agents
FADEOUT_SEED_FLOOR = 10
FADEOUT_REPLICATES = 5
INSTANT_PEAK_DAY = 3
INSTANT_PEAK_SEED_SHARE = 0.02       # above the realized noise of the 1% default
INSTANT_PEAK_SEEDS = 10
UNFINISHED_TAIL_SHARE = 0.05         # n_infectious[-1] >= 0.05 × peak
UNFINISHED_WINDOW_SHARE = 0.1        # the last ceil(0.1 T) days against the ceil(0.1 T) before them
FINAL_SIZE_GAP = 0.15
SHARP_CURVE_WIDTH_MULTIPLE = 2       # days at or above half the peak below 2 × dur_inf.mean_days
ILLUSTRATIVE_SD_SHARE = 0.3          # spec 7.3: 0.3 × mean without a database range
FATALITY_ASYMP_SHARE = 0.2
HIGH_VARIANCE_SPREAD = 0.5
R0_RECHECK_TOLERANCE = 0.1           # a configured R0 within 10% of the database typical needs no recheck
DAYS_PER_UNIT = {"days": 1.0, "weeks": 7.0, "months": 30.44, "years": 365.25}
SIMPLE_MODELS = ("sir", "seir", "seiar")


@dataclass
class Lever:
    patch: dict[str, Any]        # registry paths -> suggested values, applied together
    current: dict[str, Any]
    direction: Direction
    rationale: str
    basis: Basis                 # disease_db values cite the field; rule values are illustrative


@dataclass
class Diagnostic:
    id: str
    severity: Severity
    title: str
    evidence: dict[str, Any]     # the numbers that triggered it, in agent units
    levers: list[Lever] = field(default_factory=list)


def final_size(r: float) -> float:
    """z = 1 − exp(−r z): the homogeneous final size; 0 at or below R 1."""
    if r <= 1:
        return 0.0
    z = 0.99
    for _ in range(200):
        z = 1 - math.exp(-r * z)
    return z


def realized_seeds(stats: dict, params: SimParamsV2) -> int:
    """stats["seeds"] from the child; a child without it falls back to seeds_day0 for day-0 seeding, then to the configured seed."""
    if stats.get("seeds") is not None:
        return int(stats["seeds"])
    seed = params.disease.seed
    if seed.day == 0 and stats.get("seeds_day0") is not None:
        return int(stats["seeds_day0"])
    return int(seed.value) if seed.mode == "count" else int(round(seed.value * params.run.n_agents))


def db_range(disease: str | None, db_field: str) -> tuple[float, float, float | None] | None:
    """(min, max, typical) of the database consensus in simulation units (fractions of 1, days), or None without a range."""
    if not disease:
        return None
    entry = lookup(disease)
    rng = _range_of(entry, db_field) if entry else None
    if not rng:
        return None
    lo, hi, data = rng
    unit = data.get("unit")
    factor = 1.0
    if db_field in ("fatality_rate", "asymptomatic_fraction") and unit == "percentage":
        factor = 0.01
    elif db_field == "immunity_duration":
        factor = DAYS_PER_UNIT.get(unit or "days", 1.0)
    typical = _num(data.get("typical"))
    return lo * factor, hi * factor, None if typical is None else typical * factor


def illustrative_sd(db_field: str, mean: float, disease: str | None) -> tuple[float, Basis]:
    """Spec 7.3 as web/lib/tools/durations.ts computes it: (max − min) / 4 of a database range, else 0.3 × mean; capped at the mean."""
    rng = db_range(disease, db_field)
    if rng and rng[0] < rng[1]:
        return round(min((rng[1] - rng[0]) / 4, mean), 4), "disease_db"
    return round(min(ILLUSTRATIVE_SD_SHARE * mean, mean), 4), "rule"


def bounded(path: str, value: float, disease: str | None) -> tuple[float, str]:
    """The value within the registry bounds and, when the disease is known, the database range; the note says when the range moved it."""
    spec = REGISTRY_BY_PATH[path]
    if spec.bounds is not None:
        value = min(max(value, spec.bounds[0]), spec.bounds[1])
    note = ""
    if spec.db_field:
        rng = db_range(disease, spec.db_field)
        if rng and not rng[0] <= value <= rng[1]:
            moved = min(max(value, rng[0]), rng[1])
            note = f" (moved from {value:g} into the database range {rng[0]:g}–{rng[1]:g})"
            value = moved
    if spec.kind == "integer":
        value = int(round(value))
    return value, note


@dataclass
class _Run:
    """What every rule reads, computed once."""
    params: SimParamsV2
    series: dict
    stats: dict
    replicates: dict | None
    seeds: int
    disease: str | None

    def __post_init__(self) -> None:
        p = self.params
        self.n = p.run.n_agents
        self.infectious = [float(v) for v in (self.series.get("n_infectious") or self.series.get("n_infected") or [])]
        self.days = len(self.infectious)
        self.peak = max(self.infectious) if self.infectious else 0.0
        self.t_peak = self.infectious.index(self.peak) if self.infectious else 0
        self.total = float(self.stats.get("total_infected", 0))
        self.r0 = approx_r0(p)
        self.r_eff = self.r0 * (1 - p.disease.initial_immune_frac)
        self.simple = (p.disease.model in SIMPLE_MODELS and p.network.network_type == "random"
                       and not p.demographics.use_demographics and not p.interventions)


def _r0_recheck(run: _Run) -> Lever | None:
    """A beta for the database R0 when the disease is known and the configured R0 is more than 10% away from it."""
    rng = db_range(run.disease, "r0")
    if not rng or rng[2] is None:
        return None
    typical = rng[2]
    if abs(run.r0 - typical) <= R0_RECHECK_TOLERANCE * typical:
        return None
    try:
        beta = clamp_beta(calibrate_beta(run.params, typical))
    except R0Unreachable:
        return None
    return Lever({"disease.beta": beta}, {"disease.beta": run.params.disease.beta}, "change",
                 f"The configured R0 is {run.r0:.2f}; the database typical value for {run.disease} is {typical:g} (beta {beta:g}).",
                 "disease_db")


def _early_fadeout(run: _Run) -> Diagnostic | None:
    if not (run.days and run.r_eff > 1 and run.infectious[-1] == 0 and run.total < FADEOUT_SEED_MULTIPLE * run.seeds):
        return None
    p = run.params
    seeds_to = min(max(FADEOUT_SEED_FACTOR * run.seeds, FADEOUT_SEED_FLOOR), p.run.n_agents)
    levers = [
        Lever({"disease.seed.mode": "count", "disease.seed.value": seeds_to},
              {"disease.seed.mode": p.disease.seed.mode, "disease.seed.value": p.disease.seed.value}, "increase",
              f"More seeds make an early fade-out less likely: {seeds_to} instead of {run.seeds}.", "rule"),
        Lever({"run.n_replicates": FADEOUT_REPLICATES}, {"run.n_replicates": p.run.n_replicates}, "increase",
              "Several replicates show how often the outbreak takes off at all.", "rule"),
    ]
    recheck = _r0_recheck(run)
    if recheck:
        levers.append(recheck)
    return Diagnostic("early_fadeout", "warning", "The outbreak died out early",
                      {"r_eff": round(run.r_eff, 2), "seeds": run.seeds, "total_infected": int(run.total), "last_infectious": 0}, levers)


def _instant_peak(run: _Run) -> Diagnostic | None:
    if not (run.days and run.n and run.t_peak <= INSTANT_PEAK_DAY and run.seeds / run.n >= INSTANT_PEAK_SEED_SHARE):
        return None
    p = run.params
    share = run.seeds / run.n
    return Diagnostic("instant_peak", "warning", "The peak is the seeding itself",
                      {"peak_day": run.t_peak, "seeds": run.seeds, "seed_share": round(share, 4)},
                      [Lever({"disease.seed.mode": "count", "disease.seed.value": INSTANT_PEAK_SEEDS},
                             {"disease.seed.mode": p.disease.seed.mode, "disease.seed.value": p.disease.seed.value}, "decrease",
                             f"{run.seeds} initial infections ({100 * share:.1f}% of the agents) make the first days the peak; "
                             f"{INSTANT_PEAK_SEEDS} seeds let the epidemic build.", "rule")])


def _unfinished(run: _Run) -> Diagnostic | None:
    p = run.params
    tail = bool(run.days and run.peak > 0 and p.disease.model in SIMPLE_MODELS and not p.demographics.use_demographics
                and run.infectious[-1] >= UNFINISHED_TAIL_SHARE * run.peak)
    new = [float(v) for v in run.series.get("new_infections", [])]
    window = math.ceil(UNFINISHED_WINDOW_SHARE * run.days)
    rising = False
    if window and len(new) >= 2 * window:
        rising = sum(new[-window:]) / window > sum(new[-2 * window:-window]) / window
    if not (tail or rising):
        return None
    years = p.run.sim_dur_years
    hi = REGISTRY_BY_PATH["run.sim_dur_years"].bounds[1]
    levers = []
    if years < hi:
        levers.append(Lever({"run.sim_dur_years": min(2 * years, hi)}, {"run.sim_dur_years": years}, "increase",
                            "The epidemic was still going when the run ended; a longer run shows how it ends.", "rule"))
    return Diagnostic("unfinished", "warning", "The run ended before the epidemic did",
                      {"last_infectious": run.infectious[-1] if run.days else 0, "peak": run.peak, "still_rising": rising}, levers)


def _final_size_gap(run: _Run, unfinished: bool) -> Diagnostic | None:
    if not run.simple or unfinished or not run.n:
        return None
    z = final_size(run.r_eff)
    attack = run.total / run.n
    if abs(attack - z) <= FINAL_SIZE_GAP:
        return None
    recheck = _r0_recheck(run)
    return Diagnostic("final_size_gap", "info", "The attack rate does not match the configured R0",
                      {"attack_rate": round(attack, 3), "expected_attack_rate": round(z, 3), "r_eff": round(run.r_eff, 2)},
                      [recheck] if recheck else [])


def _sharp_curve(run: _Run) -> Diagnostic | None:
    d = run.params.disease
    durations = [x for x in (d.dur_exp, d.dur_inf, d.dur_immune) if x is not None]
    if any(x.dist != "constant" for x in durations) or not run.days or run.peak <= 0:
        return None
    wide = sum(1 for v in run.infectious if v >= run.peak / 2)
    if wide >= SHARP_CURVE_WIDTH_MULTIPLE * d.dur_inf.mean_days:
        return None
    sd, basis = illustrative_sd("infectious_days", d.dur_inf.mean_days, run.disease)
    source = "from the database range" if basis == "disease_db" else "an illustrative assumption"
    return Diagnostic("sharp_curve", "info", "Every period is the same for everyone, which sharpens the curve",
                      {"days_at_half_peak": wide, "dur_inf_mean_days": d.dur_inf.mean_days},
                      [Lever({"disease.dur_inf.dist": "gamma", "disease.dur_inf.sd_days": sd},
                             {"disease.dur_inf.dist": d.dur_inf.dist, "disease.dur_inf.sd_days": d.dur_inf.sd_days}, "change",
                             f"A gamma-distributed infectious period (sd {sd:g} days, {source}) spreads the curve the way real variation does.",
                             basis)])


def _cfr_out_of_range(run: _Run) -> Diagnostic | None:
    d = run.params.disease
    if d.model not in DEATH_MODELS:
        return None
    rng = db_range(run.disease, "fatality_rate")
    if not rng or rng[0] <= d.p_death <= rng[1]:
        return None
    lo, hi, typical = rng
    levers = []
    if typical is not None:
        value, note = bounded("disease.p_death", typical, run.disease)
        levers.append(Lever({"disease.p_death": value}, {"disease.p_death": d.p_death}, "increase" if value > d.p_death else "decrease",
                            f"The database case fatality ratio for {run.disease} is {100 * typical:g}% (range {100 * lo:g}–{100 * hi:g}%){note}.",
                            "disease_db"))
    return Diagnostic("cfr_out_of_range", "warning", "The case fatality ratio is outside the literature range",
                      {"p_death": d.p_death, "db_min": lo, "db_max": hi}, levers)


def _fatality_on_all_infections(run: _Run) -> Diagnostic | None:
    d = run.params.disease
    if d.model == "seiar" or d.p_death <= 0:
        return None
    asymp = db_range(run.disease, "asymptomatic_fraction")
    if not asymp or asymp[2] is None or asymp[2] < FATALITY_ASYMP_SHARE:
        return None
    patch: dict[str, Any] = {"disease.model": "seiar", "disease.p_asymp": asymp[2]}
    current: dict[str, Any] = {"disease.model": d.model, "disease.p_asymp": d.p_asymp}
    if d.dur_exp is None:
        incubation = db_range(run.disease, "incubation_days")
        if not incubation or incubation[2] is None:
            return None
        patch["disease.dur_exp.mean_days"] = incubation[2]
        current["disease.dur_exp.mean_days"] = None
    return Diagnostic("fatality_on_all_infections", "info", "The fatality ratio applies to every infection, asymptomatic ones included",
                      {"p_death": d.p_death, "db_asymptomatic_fraction": asymp[2]},
                      [Lever(patch, current, "change",
                             f"About {100 * asymp[2]:g}% of {run.disease} infections are asymptomatic in the database; in the seiar model "
                             "the case fatality ratio applies to symptomatic cases only.", "disease_db")])


def _no_reinfection(run: _Run) -> Diagnostic | None:
    p = run.params
    d = p.disease
    if d.model not in WANING_MODELS or d.dur_immune is None:
        return None
    horizon = 365 * p.run.sim_dur_years
    if d.dur_immune.mean_days <= horizon:
        return None
    hi = REGISTRY_BY_PATH["run.sim_dur_years"].bounds[1]
    wanted = math.ceil(2 * d.dur_immune.mean_days / 365)
    levers = []
    if p.run.sim_dur_years < wanted <= hi:
        levers.append(Lever({"run.sim_dur_years": wanted}, {"run.sim_dur_years": p.run.sim_dur_years}, "increase",
                            f"Immunity lasts about {d.dur_immune.mean_days:g} days, longer than the {horizon:g}-day run; waning only shows in a longer run.",
                            "rule"))
    return Diagnostic("no_reinfection", "info", "Immunity outlasts the run, so waning is not observable",
                      {"dur_immune_mean_days": d.dur_immune.mean_days, "sim_days": horizon}, levers)


def _high_variance(run: _Run) -> Diagnostic | None:
    rep = run.replicates
    if not rep or int(rep.get("n", 1)) <= 1:
        return None
    totals = [float(s.get("total_infected", 0)) for s in rep.get("stats", [])]
    if len(totals) < 2:
        return None
    median = float(np.median(totals))
    if median <= 0:
        return None
    p10, p90 = float(np.percentile(totals, 10)), float(np.percentile(totals, 90))
    spread = (p90 - p10) / median
    if spread <= HIGH_VARIANCE_SPREAD:
        return None
    faded = sum(1 for t in totals if t < FADEOUT_SEED_MULTIPLE * run.seeds)
    return Diagnostic("high_variance", "info", "The replicates disagree widely",
                      {"p10_total_infected": p10, "p90_total_infected": p90, "median_total_infected": median, "spread": round(spread, 2),
                       "faded_out_share": round(faded / len(totals), 2), "n_replicates": len(totals)}, [])


def diagnose(params: SimParamsV2, series: dict, stats: dict, replicates: dict | None, seeds: int,
             disease: str | None = None) -> list[Diagnostic]:
    """Every diagnostic the run triggers, warnings first and in the table's order within (section 10, 19)."""
    run = _Run(params, series, stats, replicates, int(seeds), disease)
    fadeout = _early_fadeout(run)
    unfinished = _unfinished(run)
    candidates = (fadeout, _instant_peak(run), unfinished,
                  None if fadeout else _final_size_gap(run, unfinished is not None),
                  _sharp_curve(run), _cfr_out_of_range(run), _fatality_on_all_infections(run),
                  _no_reinfection(run), _high_variance(run))
    found = [c for c in candidates if c is not None]
    return sorted(found, key=lambda d: 0 if d.severity == "warning" else 1)


def as_dicts(diagnostics: list[Diagnostic]) -> list[dict]:
    """The JSON form the service sends and the web app types as Diagnostic[]."""
    return [asdict(d) for d in diagnostics]
```

- [ ] **Step 4: Run the tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_diagnostics.py -q`
Expected: all pass (the last test runs one real 2000-agent year, about 3 s). If `test_a_normal_run_raises_no_diagnostic` fails on `final_size_gap`, read the evidence: a 2000-agent run at R0 2.3 lands within a few points of the final size, so a miss means a rule reads the wrong key, not a bad seed.

- [ ] **Step 5: Check the service's parent still imports nothing heavy**

Run: `sim/.venv/Scripts/python.exe -c "import sys; sys.path.insert(0, '.'); import epichat.sim.diagnostics; print('starsim' in sys.modules)"`
Expected: `False`.

- [ ] **Step 6: Commit**

```bash
git add epichat/sim/diagnostics.py tests/test_sim_diagnostics.py
git commit -m "feat(sim): diagnostics over a finished run (spec 10), pure and deterministic"
```

---

### Task 3: The service answers `diagnostics`, takes `disease`, and answers 422 for a malformed v1 body

**Files:**
- Modify: `sim/main.py` (`SimulateRequest`, the coerce block, the 200 body)
- Modify: `web/docs/DEPLOY.md` section 7 (the **Parameters** paragraph and the **Settings** line)
- Test: `sim/tests/test_api.py`, `sim/tests/test_imports.py` (unchanged, must stay green)

**Interfaces:**
- Consumes: `diagnose`, `as_dicts`, `realized_seeds` (Task 2); `Outcome.series/stats/replicates/effective_params` (`sim/service.py`).
- Produces: the `/simulate` request field `disease: str | None` (at most 80 characters); the 200 body key `diagnostics: list[dict]` (the `as_dicts` form, agent units); 422 `invalid_params` with `detail: [{"loc": ["params"], "msg": "...", "type": "value_error"}]` for a v1 body the migration cannot read. Task 4's client sends `disease` and types `diagnostics`.

- [ ] **Step 1: Write the failing API tests**

Append to `sim/tests/test_api.py`:

```python
def test_success_carries_diagnostics_computed_on_the_full_series(client, main, monkeypatch):
    params = coerce_params(PARAMS)
    monkeypatch.setattr(main, "simulate", _fake_simulate(_success(params)))
    monkeypatch.setenv("SIM_SERIES_MAX_POINTS", "3")
    body = client.post("/simulate", json={"params": PARAMS, "pop_scale": 100}, headers=AUTH).json()
    assert [d["id"] for d in body["diagnostics"]] == ["unfinished", "sharp_curve"]
    unfinished = body["diagnostics"][0]
    assert unfinished["severity"] == "warning" and unfinished["evidence"] == {"last_infectious": 1.0, "peak": 4.0, "still_rising": False}
    assert unfinished["levers"] == [{"patch": {"run.sim_dur_years": 0.2}, "current": {"run.sim_dur_years": 0.1}, "direction": "increase",
                                     "rationale": "The epidemic was still going when the run ended; a longer run shows how it ends.", "basis": "rule"}]
    # three of the five full days sit at or above half the peak; the thinned series the client gets has one
    assert body["diagnostics"][1]["evidence"] == {"days_at_half_peak": 3, "dur_inf_mean_days": 10.0}
    assert body["series"]["day"] == [0, 2, 4]


def test_the_disease_reaches_the_diagnostics(client, main, monkeypatch):
    fatal = {**PARAMS, "p_death": 0.2}
    monkeypatch.setattr(main, "simulate", _fake_simulate(_success(coerce_params(fatal))))
    with_disease = client.post("/simulate", json={"params": fatal, "disease": "measles"}, headers=AUTH).json()
    cfr = next(d for d in with_disease["diagnostics"] if d["id"] == "cfr_out_of_range")
    assert cfr["levers"][0]["basis"] == "disease_db" and cfr["levers"][0]["patch"] == {"disease.p_death": 0.015}
    without = client.post("/simulate", json={"params": fatal}, headers=AUTH).json()
    assert "cfr_out_of_range" not in [d["id"] for d in without["diagnostics"]]
    assert client.post("/simulate", json={"params": PARAMS, "disease": "x" * 81}, headers=AUTH).status_code == 422


def test_a_malformed_v1_body_is_422_not_500(client):
    body = {"params": {**PARAMS, "interventions": [{"type": "vaccine", "coverage": 0.5, "start_day": "soon"}]}}
    r = client.post("/simulate", json=body, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["kind"] == "invalid_params"
    detail = r.json()["error"]["detail"]
    assert detail[0]["loc"] == ["params"] and "soon" in detail[0]["msg"]


def test_a_request_exactly_at_the_cap_is_accepted(client, main, monkeypatch):
    """Pins the strict comparison (spec 19); a pin passes before any change, which is its point."""
    monkeypatch.setenv("SIM_MAX_AGENT_YEARS", "1000")
    at_cap = {**PARAMS, "n_agents": 1000, "sim_dur_years": 1.0}
    monkeypatch.setattr(main, "simulate", _fake_simulate(_success(coerce_params(at_cap))))
    assert client.post("/simulate", json={"params": at_cap}, headers=AUTH).status_code == 200
```

- [ ] **Step 2: Run them and watch the first three fail**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests/test_api.py -q -k "diagnostics or disease_reaches or malformed or exactly_at_the_cap"`
Expected: `KeyError: 'diagnostics'` twice, a `ValueError` raised through the test client for the malformed body (`invalid literal for int()`), and the cap pin passing.

- [ ] **Step 3: Change the route**

In `sim/main.py`, add the import after the `coerce_params` import:

```python
from epichat.sim.diagnostics import as_dicts, diagnose, realized_seeds  # noqa: E402
```

Extend the request model:

```python
class SimulateRequest(BaseModel):
    params: dict                                     # v1 flat or schema v2; coerced in the route
    pop_scale: float = Field(default=1.0, ge=1.0, le=1e9)
    context_text: str = Field(default="", max_length=6000)
    disease: str | None = Field(default=None, max_length=80)   # the scenario's disease, for the diagnostics' database checks
```

Replace the coerce block at the top of `simulate_route` with:

```python
    try:
        params = coerce_params(body.params)
    except ValidationError as exc:
        return _error(422, "invalid_params", detail=_validation_detail(exc.errors(), ("params",)))
    except (TypeError, ValueError) as exc:
        # A malformed v1 body fails inside the migration, before pydantic sees it; still the client's fault.
        return _error(422, "invalid_params", detail=[{"loc": ["params"], "msg": f"{type(exc).__name__}: {exc}", "type": "value_error"}])
```

After the `replicates` block and before the `return {`, add:

```python
    # Spec 10: on the child's full series, in agent units, with the disease the web app named.
    diagnostics = as_dicts(diagnose(outcome.effective_params, outcome.series, outcome.stats, outcome.replicates,
                                    realized_seeds(outcome.stats, outcome.effective_params), body.disease))
```

and add `"diagnostics": diagnostics,` to the returned dict after `"replicates": replicates,`. Update the module docstring: the answer carries "stats, series, the replicate block for more than one replicate, and the diagnostics".

- [ ] **Step 4: Run the service suite**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests -q`
Expected: all pass, including `test_imports.py` (the diagnostics module imports no Starsim).

- [ ] **Step 5: Document the service contract**

In `web/docs/DEPLOY.md`, section 7, after the sentence `The web app migrates stored v1 rows on every read and writes v2; no database migration was needed.` in the **Parameters** paragraph, add:

```
The request may also carry `disease` (the scenario's disease name, at most
80 characters); the 200 answer then carries `diagnostics`: the list of
section 10 of the same spec, computed on the child's full series in agent
units (evidence and lever values alike), each with its levers, empty when
nothing fired. A v1 body the migration cannot read (a non-numeric
`start_day`, say) answers 422 like any other invalid body.
```

In the **Settings** line, change `SIM_MAX_AGENT_YEARS` 500000` to `SIM_MAX_AGENT_YEARS` 500000 (a request exactly at the cap is accepted)`.

- [ ] **Step 6: Commit**

```bash
git add sim/main.py sim/tests/test_api.py web/docs/DEPLOY.md
git commit -m "feat(service): /simulate takes the disease and answers the diagnostics; a malformed v1 body is 422"
```

---

### Task 4: The web client, the run store, the step-event kinds and migration 0007

**Files:**
- Modify: `web/lib/sim/client.ts`
- Modify: `web/lib/enums.ts:66-90` (`SERVER_EVENT_KINDS`)
- Create: `web/supabase/migrations/0007_run_diagnostics.sql`
- Modify: `web/lib/db/runs.ts`
- Modify: `web/docs/DEPLOY.md` section 1 (the migration list)
- Test: `web/tests/sim/client.test.ts`, `web/tests/db/schema.test.ts`, `web/tests/db/stores.test.ts`, `web/tests/chat/handleChat.test.ts` (the fake run store), `web/tests/app/deploy.test.ts`

**Interfaces:**
- Consumes: Task 3's contract.
- Produces:
  - `type Lever`, `type Diagnostic`, `SimSuccess.diagnostics?: Diagnostic[]`, `SimClient.simulate(params, popScale, contextText, disease?: string | null)` in `client.ts`.
  - `SERVER_EVENT_KINDS` with `"diagnostic_shown"` and `"option_chosen"`.
  - `type PreviousRun = { id: string; effectiveParams: SimParams; stats: SimStats; diagnostics: Diagnostic[] }`, `RunStore.latest(conversationId, scenarioId, turnId): Promise<PreviousRun | null>`, and `runRow(...)` writing `diagnostics` in `runs.ts`.
  - The `runs.diagnostics jsonb not null default '[]'` column.

- [ ] **Step 1: Write the failing client test**

In `web/tests/sim/client.test.ts`, add `diagnostics: []` to the `SUCCESS` fixture (after `starsim_version`), and replace the first test with:

```ts
  it("posts the request with the secret and the disease, and returns the body on success", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: answering(200, SUCCESS, capture) });
    const result = await client.simulate(PARAMS, 2419.6, "measles in Kenya", "measles");
    expect(result).toEqual(SUCCESS);
    expect(capture.url).toBe("http://sim.internal/simulate");
    expect((capture.init?.headers as Record<string, string>).authorization).toBe("Bearer s3");
    expect(JSON.parse(capture.init?.body as string)).toEqual({ params: PARAMS, pop_scale: 2419.6, context_text: "measles in Kenya", disease: "measles" });
    expect(capture.init?.signal).toBeInstanceOf(AbortSignal);
    await client.simulate(PARAMS, 1, "");
    expect(JSON.parse(capture.init?.body as string).disease).toBeNull();
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run (from `web/`): `npx vitest run tests/sim/client.test.ts`
Expected: FAIL on the body (`disease` missing); the typecheck would also reject the fourth argument.

- [ ] **Step 3: The client**

In `web/lib/sim/client.ts`, after the `Replicates` type add:

```ts
/** Spec 10: one suggested change, a patch of registry paths applied together. */
export type Lever = {
  patch: Record<string, unknown>;
  current: Record<string, unknown>;
  direction: "increase" | "decrease" | "change";
  rationale: string;
  basis: "disease_db" | "rule" | "user";
};
export type Diagnostic = { id: string; severity: "info" | "warning"; title: string; evidence: Record<string, unknown>; levers: Lever[] };
```

Add to `SimSuccess` after `replicates?`:

```ts
  /** Spec 10, in agent units; absent from answers of a service older than phase 4. */
  diagnostics?: Diagnostic[];
```

Change the interface and the implementation:

```ts
  /** `disease` is the scenario's disease name, for the service's database checks (spec 19). */
  simulate(params: SimParams, popScale: number, contextText: string, disease?: string | null): Promise<SimResult>;
```

```ts
    async simulate(params, popScale, contextText, disease) {
      ...
          body: JSON.stringify({ params, pop_scale: popScale, context_text: contextText, disease: disease ?? null }),
```

- [ ] **Step 4: Run it**

Run (from `web/`): `npx vitest run tests/sim/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing schema test**

Append to `web/tests/db/schema.test.ts`:

```ts
describe("runs", () => {
  it("stores diagnostics, an empty list by default", async () => {
    const { rows } = await db.query<{ diagnostics: unknown }>(
      "insert into runs (user_id, params, diagnostics) values ($1, '{}'::jsonb, $2::jsonb) returning diagnostics",
      [ALICE, JSON.stringify([{ id: "unfinished", severity: "warning", title: "t", evidence: {}, levers: [] }])],
    );
    expect(rows[0].diagnostics).toEqual([{ id: "unfinished", severity: "warning", title: "t", evidence: {}, levers: [] }]);
    const { rows: plain } = await db.query<{ diagnostics: unknown }>("insert into runs (user_id, params) values ($1, '{}'::jsonb) returning diagnostics", [ALICE]);
    expect(plain[0].diagnostics).toEqual([]);
  });
});
```

In `web/lib/enums.ts`, add `"diagnostic_shown",` and `"option_chosen",` to `SERVER_EVENT_KINDS` after `"memory_toggled",`.

- [ ] **Step 6: Run the schema tests and watch them fail**

Run (from `web/`): `npx vitest run tests/db/schema.test.ts`
Expected: the new runs test fails (`column "diagnostics" of relation "runs" does not exist`) and the step_events kinds test fails on `diagnostic_shown`.

- [ ] **Step 7: The migration**

Create `web/supabase/migrations/0007_run_diagnostics.sql`:

```sql
-- Sim parameters, phase 4: every run row keeps its diagnostics (spec
-- 2026-10-09, sections 10 and 11), and two step-event kinds record which
-- diagnostics were shown and which options were taken. Apply after 0006 in
-- the SQL editor; safe to run twice. finish_turn is unchanged.

alter table runs add column if not exists diagnostics jsonb not null default '[]'::jsonb;

alter table step_events drop constraint if exists step_events_kind_check;
alter table step_events add constraint step_events_kind_check check (kind in (
  'conversation_started', 'turn', 'stage_reached', 'tool_called', 'tool_failed',
  'run_completed', 'run_failed', 'refusal', 'new_scenario', 'consent_given',
  'consent_declined', 'web_search', 'web_fetch',
  'session_start', 'session_end', 'conversation_opened', 'conversation_resumed',
  'suggestion_used', 'card_expanded', 'chart_view_changed', 'series_downloaded',
  'export', 'feedback_given', 'scenario_panel_opened',
  'share_created', 'share_updated', 'share_revoked', 'share_opened',
  'profile_completed', 'profile_updated', 'memory_added', 'memory_updated', 'memory_removed', 'memory_toggled',
  'diagnostic_shown', 'option_chosen'
));
```

- [ ] **Step 8: Run the schema tests**

Run (from `web/`): `npx vitest run tests/db/schema.test.ts`
Expected: PASS (every migration applies twice).

- [ ] **Step 9: Write the failing store tests**

In `web/tests/db/stores.test.ts`, in the run store's "maps a success and a failure" test, add `diagnostics: []` to the first `toMatchObject` (beside `repairs: []`) and, before the `failed` lines, add:

```ts
    const diagnostics = [{ id: "unfinished", severity: "warning" as const, title: "t", evidence: {}, levers: [] }];
    expect(runRow({ ...insert, record: { ...record, result: { ...success, diagnostics } } })).toMatchObject({ diagnostics });
```

and `diagnostics: []` to the failed row's `toMatchObject`. Then append a new describe:

```ts
describe("the previous run", () => {
  const row = (id: string, scenario_id: string | null, turn_id: string, extra: Record<string, unknown> = {}) =>
    ({ id, created_at: `2026-10-09T0${id.at(-1)}:00:00Z`, scenario_id, turn_id, effective_params: {}, stats: STATS, diagnostics: [], ...extra });

  it("is the newest successful run of the scenario or of this turn, with its diagnostics", async () => {
    const diagnostics = [{ id: "unfinished", severity: "warning", title: "t", evidence: {}, levers: [] }];
    const admin = fakeAdmin({ runs: [{ data: [row("run-3", null, "t9", { diagnostics }), row("run-2", "s0", "t0"), row("run-1", "s1", "t1")] }] });
    const previous = await supabaseRunStore(admin.client).latest("c1", "s1", "t9");
    expect(previous).toMatchObject({ id: "run-3", diagnostics, stats: STATS });
    expect(previous?.effectiveParams.run.n_agents).toBe(10000);
    expect(callOn(admin.recorded, "runs", "order")).toEqual(["created_at", { ascending: false }]);
    expect(callOn(admin.recorded, "runs", "is")).toEqual(["error", null]);
  });

  it("reads a row without diagnostics as having none, skips unusable params, and is null without a run", async () => {
    const admin = fakeAdmin({ runs: [{ data: [row("run-2", "s1", "t2", { diagnostics: null }), row("run-1", "s1", "t1")] }] });
    expect(await supabaseRunStore(admin.client).latest("c1", "s1", "t9")).toMatchObject({ id: "run-2", diagnostics: [] });
    const bad = fakeAdmin({ runs: [{ data: [row("run-2", "s1", "t2", { effective_params: { n_agents: -1 } }), row("run-1", "s1", "t1")] }] });
    expect((await supabaseRunStore(bad.client).latest("c1", "s1", "t9"))?.id).toBe("run-1");
    expect(await supabaseRunStore(fakeAdmin({ runs: [{ data: [row("run-1", "s1", "t1")] }] }).client).latest("c1", null, "t9")).toBeNull();
    await expect(supabaseRunStore(fakeAdmin({ runs: [{ data: null, error: { message: "down" } }] }).client).latest("c1", "s1", "t9")).rejects.toThrow(/down/);
  });
});
```

- [ ] **Step 10: Run them and watch them fail**

Run (from `web/`): `npx vitest run tests/db/stores.test.ts`
Expected: `latest is not a function`; the `diagnostics` column expectation fails on `runRow`.

- [ ] **Step 11: The run store**

In `web/lib/db/runs.ts`: extend the client import to `import type { Diagnostic, RepairRecord, SimStats } from "@/lib/sim/client";`, add after `ReportRun`:

```ts
/** The scenario's latest successful run, as the comparison and the option matching read it (spec 11). */
export type PreviousRun = { id: string; effectiveParams: SimParams; stats: SimStats; diagnostics: Diagnostic[] };
```

add to `RunStore`:

```ts
  /** The newest successful run of the scenario (this turn's unlinked ones included), or null. Throws when the database refuses. */
  latest(conversationId: string, scenarioId: string | null, turnId: string): Promise<PreviousRun | null>;
```

add the row type and the shared filter after `ReportRunRow`:

```ts
type PreviousRow = { id: string; created_at: string; scenario_id: string | null; turn_id: string | null; effective_params: unknown; stats: SimStats; diagnostics: Diagnostic[] | null };

/** The stored scenario's runs, plus this turn's not-yet-linked ones; never an earlier turn's orphan when the scenario is new. */
function belongs(row: { scenario_id: string | null; turn_id: string | null }, scenarioId: string | null, turnId: string): boolean {
  return (scenarioId !== null && row.scenario_id === scenarioId) || (row.scenario_id === null && row.turn_id === turnId);
}
```

in `runRow`, add to `common`: `diagnostics: result.ok ? (result.diagnostics ?? []) : [],`; in `listForReport`, replace the `.filter((row) => (scenarioId !== null && …))` line with `.filter((row) => belongs(row, scenarioId, turnId))`; and add the method to the store:

```ts
    async latest(conversationId, scenarioId, turnId) {
      const { data, error } = await admin
        .from("runs")
        .select("id, created_at, scenario_id, turn_id, effective_params, stats, diagnostics")
        .eq("conversation_id", conversationId)
        .is("error", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`runs read failed: ${error.message}`);
      for (const row of (data ?? []) as PreviousRow[]) {
        if (!belongs(row, scenarioId, turnId)) continue;
        const effectiveParams = coerceParams(row.effective_params);
        if (!effectiveParams) continue; // an unusable row is no comparison; the next older one may be
        return { id: row.id, effectiveParams, stats: row.stats, diagnostics: Array.isArray(row.diagnostics) ? row.diagnostics : [] };
      }
      return null;
    },
```

In `web/tests/chat/handleChat.test.ts`, give the fake run store the method: `async latest() { return null; }` (Task 7 makes it return `over.previous`).

- [ ] **Step 12: Run the store and handler tests**

Run (from `web/`): `npx vitest run tests/db tests/chat/handleChat.test.ts`
Expected: PASS.

- [ ] **Step 13: Document the migration**

In `web/docs/DEPLOY.md` section 1, step 2, after the sub-project 4d paragraph (ending `…passes the consent page and then the profile page once.`), add:

```
   The sim-parameters work (phases 3 and 4) adds
   `web/supabase/migrations/0007_run_diagnostics.sql` (the `runs.diagnostics`
   column and two step-event kinds, `diagnostic_shown` and `option_chosen`);
   run it after 0006, twice, before that code deploys, or every run row
   insert fails on the missing column (the run still answers, with `run_id`
   null and no comparison) and `finish_turn` rejects the two new step
   events.
```

In `web/tests/app/deploy.test.ts`, beside the existing pins for `schema v2` and `n_replicates`, pin `0007_run_diagnostics.sql` and `` carries `diagnostics` `` the same way.

- [ ] **Step 14: Typecheck, lint, the deploy test**

Run (from `web/`): `npx vitest run tests/app tests/sim tests/db && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add web/lib/sim/client.ts web/lib/enums.ts web/supabase/migrations/0007_run_diagnostics.sql web/lib/db/runs.ts web/docs/DEPLOY.md web/tests/sim/client.test.ts web/tests/db/schema.test.ts web/tests/db/stores.test.ts web/tests/chat/handleChat.test.ts web/tests/app/deploy.test.ts
git commit -m "feat(web): the sim client sends the disease and reads diagnostics; runs keep them (migration 0007) and the store reads the previous run"
```

---

### Task 5: `configure_simulation` on the spec's field names, with `advanced` and `changed`

**Files:**
- Modify: `web/lib/sim/paths.ts` (add `PathChange`, `changedPaths`)
- Create: `web/lib/tools/advanced.ts`
- Modify: `web/lib/tools/configureSimulation.ts` (full replacement below)
- Modify: `web/lib/tools/types.ts` (`ConfigPayload.changed`)
- Modify: `web/lib/tools/index.ts:24-57` (the configure tool's description and properties)
- Test: `web/tests/sim/paths.test.ts`, `web/tests/tools/configureSimulation.test.ts`, `web/tests/tools/fetchTools.test.ts`, `web/tests/tools/registry.test.ts`

**Interfaces:**
- Consumes: `specFor`, `appliesTo`, `ParamSpec` (`web/lib/sim/registry.ts`); `getPath`, `setPath`, `diffParams` (`web/lib/sim/paths.ts`); `durationFor` (`./durations`); `validateParams`, `withR0`, `approxR0`, `R0UnreachableError` (`web/lib/sim/params.ts`).
- Produces:
  - `type PathChange = { path: string; from: unknown; to: unknown }` and `changedPaths(before, after): PathChange[]` in `paths.ts` (Task 7's `compare.changed` uses them).
  - `applyAdvanced(base: Record<string, unknown>, patch: Record<string, unknown>): string | null` and `checkValue(spec, value): string | null` in `advanced.ts`.
  - `ConfigureSimulationInput` with the fields `disease, country_iso3, model, disease_type, n_agents, sim_dur_years, r0, dur_inf_days, dur_exp_days, dur_immune_days, p_death, p_asymp, seed_fraction, seed_count, vaccine_coverage, vaccine_start_day, treatment_capacity, seasonality_scale, advanced, start_new_scenario` (twenty).
  - `ConfigPayload.changed?: PathChange[]`; the tool's content JSON gains `changed`. Task 7 adds the option matching at the marked line.

- [ ] **Step 1: Write the failing paths test**

Append to `web/tests/sim/paths.test.ts` (inside its describe, or as a new one):

```ts
describe("changedPaths", () => {
  it("names each changed leaf by path", async () => {
    const { changedPaths } = await import("@/lib/sim/paths");
    expect(changedPaths({ a: { b: 1, c: "x" }, d: [1] }, { a: { b: 2, c: "x" }, d: [1, 2] })).toEqual([
      { path: "a.b", from: 1, to: 2 },
      { path: "d", from: [1], to: [1, 2] },
    ]);
    expect(changedPaths({ a: { b: 1 } }, { a: { b: 1 } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run (from `web/`): `npx vitest run tests/sim/paths.test.ts`
Expected: FAIL: `changedPaths is not a function`.

- [ ] **Step 3: Add `changedPaths`**

Append to `web/lib/sim/paths.ts`:

```ts
/** A change by registry path: the config payload's `changed` and the run payload's `compare.changed` (spec 9.1, 11). */
export type PathChange = { path: string; from: unknown; to: unknown };

export function changedPaths(before: Obj, after: Obj): PathChange[] {
  return diffParams(before, after).map((c) => ({ path: c.field, from: c.from, to: c.to }));
}
```

- [ ] **Step 4: Run it**

Run (from `web/`): `npx vitest run tests/sim/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Rename the fields the existing tests use**

In `web/tests/tools/configureSimulation.test.ts`, change every tool call argument `dur_inf:` to `dur_inf_days:` (lines 45, 54, 60, 93, 113, 121) and `init_prev: 0.02` to `seed_fraction: 0.02` (line 121). The helper call `params({ dur_inf: 10 })` on line 120 builds v1 parameters and stays as it is.
In `web/tests/tools/fetchTools.test.ts`, change line 64's `dur_exp: 11, dur_inf: 8` to `dur_exp_days: 11, dur_inf_days: 8` and line 76's `dur_inf: 30` to `dur_inf_days: 30`.
In `web/tests/tools/registry.test.ts`, change `toHaveLength(17)` to `toHaveLength(20)` and add, after it:

```ts
    expect(Object.keys(configure.properties)).toEqual(["disease", "country_iso3", "model", "disease_type", "n_agents", "sim_dur_years", "r0", "dur_inf_days", "dur_exp_days", "dur_immune_days", "p_death", "p_asymp", "seed_fraction", "seed_count", "vaccine_coverage", "vaccine_start_day", "treatment_capacity", "seasonality_scale", "advanced", "start_new_scenario"]);
    expect((configure.properties.advanced as { type: string[]; additionalProperties: boolean }).type).toEqual(["object", "null"]);
    expect((configure.properties.advanced as { additionalProperties: boolean }).additionalProperties).toBe(true);
    expect(TOOLS[0].description).toContain("describe_parameters");
```

- [ ] **Step 6: Write the failing configure tests**

Append to `web/tests/tools/configureSimulation.test.ts`:

```ts
describe("configure_simulation: the spec's field names, advanced and changed", () => {
  it("accepts model and its alias disease_type, and the _days duration fields", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "measles", model: "seir", dur_exp_days: 11, dur_inf_days: 8 })).content);
    expect(deps.scenario.params?.disease.model).toBe("seir");
    expect(deps.scenario.params?.disease.dur_exp).toEqual({ mean_days: 11, dist: "gamma", sd_days: 3.5 }); // measles incubation 7–21: (21 − 7) / 4
    expect(out.applied).toEqual({ disease: "measles", model: "seir", dur_exp_days: 11, dur_inf_days: 8 });
    await run(deps, { disease_type: "sir" });
    expect(deps.scenario.params?.disease.model).toBe("sir");
  });

  it("seeds by count or by fraction, never both, keeping the seeding day", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", seed_count: 20 });
    expect(deps.scenario.params?.disease.seed).toEqual({ mode: "count", value: 20, day: 0 });
    await run(deps, { advanced: { "disease.seed.day": 5 } });
    await run(deps, { seed_fraction: 0.02 });
    expect(deps.scenario.params?.disease.seed).toEqual({ mode: "fraction", value: 0.02, day: 5 });
    const both = await run(deps, { seed_fraction: 0.02, seed_count: 5 });
    expect(both.content).toBe("CONFIG ERROR: seed_fraction and seed_count are mutually exclusive; pass one of them.");
    expect(both.isError).toBe(true);
  });

  it("applies a multi-path advanced patch with the core fields, validates once, and reports changed", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", n_agents: 50000 });
    const out = JSON.parse((await run(deps, { n_agents: 100000, advanced: { "disease.dur_inf.dist": "lognormal", "disease.dur_inf.sd_days": 2, "run.n_replicates": 3 } })).content);
    expect(deps.scenario.params?.disease.dur_inf).toEqual({ mean_days: 10, dist: "lognormal", sd_days: 2 });
    expect(deps.scenario.params?.run.n_replicates).toBe(3);
    expect(out.applied.advanced).toEqual({ "disease.dur_inf.dist": "lognormal", "disease.dur_inf.sd_days": 2, "run.n_replicates": 3 });
    expect(out.changed).toEqual(expect.arrayContaining([
      { path: "run.n_agents", from: 50000, to: 100000 },
      { path: "disease.dur_inf.dist", from: "gamma", to: "lognormal" },
      { path: "disease.dur_inf.sd_days", from: 3, to: 2 },
      { path: "run.n_replicates", from: 1, to: 3 },
    ]));
    expect(out.changed).toHaveLength(4);
    await run(deps, { dur_inf_days: 8, advanced: { "disease.dur_inf.sd_days": 1 } }); // the patch wins over the field it overlaps
    expect(deps.scenario.params?.disease.dur_inf).toEqual({ mean_days: 8, dist: "lognormal", sd_days: 1 });
  });

  it("reports no changes on a fresh scenario and carries changed on the payload", async () => {
    const deps = makeDeps();
    const out = await run(deps, { disease: "measles" });
    expect(JSON.parse(out.content).changed).toEqual([]);
    expect(out.payload).toMatchObject({ kind: "config", changed: [] });
    const next = await run(deps, { sim_dur_years: 2 });
    expect(out.payload && "changed" in out.payload).toBe(true);
    expect(JSON.parse(next.content).changed).toEqual([{ path: "run.sim_dur_years", from: 1, to: 2 }]);
  });

  it("refuses an advanced patch that names the wrong path, model, kind, bound or partner, and leaves the scenario alone", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles" });
    const before = deps.scenario.params;
    const cases: [Record<string, unknown>, string][] = [
      [{ "disease.nope": 1 }, 'CONFIG ERROR: unknown parameter path "disease.nope"; call describe_parameters for the list'],
      [{ "disease.p_asymp": 0.2 }, "CONFIG ERROR: disease.p_asymp does not apply to the sir model (it applies to seiar)"],
      [{ "run.n_replicates": 2.5 }, "CONFIG ERROR: run.n_replicates must be a whole number"],
      [{ "run.n_replicates": "5" }, "CONFIG ERROR: run.n_replicates must be a whole number"],
      [{ "run.n_replicates": 9 }, "CONFIG ERROR: run.n_replicates must be between 1 and 5"],
      [{ "disease.dur_inf.mean_days": 5000 }, "CONFIG ERROR: disease.dur_inf.mean_days must be between 0.5 and 365 days"],
      [{ "disease.dur_inf.dist": "normal" }, "CONFIG ERROR: disease.dur_inf.dist must be one of constant, lognormal, gamma"],
      [{ "demographics.use_demographics": "yes" }, "CONFIG ERROR: demographics.use_demographics must be true or false"],
      [{ "interventions[].coverage": 0.5 }, "CONFIG ERROR: interventions[].coverage is set through the vaccine, treatment and seasonality fields, not through advanced"],
      [{ "disease.dur_inf.mean_days": null }, "CONFIG ERROR: disease.dur_inf.mean_days cannot be unset"],
      [{ "run.n_agents": 20000, "disease.seed.mode": "count", "disease.seed.value": 50000 }, "schema"],
    ];
    for (const [advanced, message] of cases) {
      const out = await run(deps, { advanced });
      expect(out.isError).toBe(true);
      if (message === "schema") expect(out.content).toMatch(/^CONFIG ERROR: 1 validation error for SimParams\n[\s\S]*must not exceed run\.n_agents \(20000\)/);
      else expect(out.content).toBe(message);
    }
    expect(deps.scenario.params).toBe(before);
  });

  it("needs the requires partner in the same call unless it is already set", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles" });
    await run(deps, { advanced: { "disease.dur_inf.dist": "constant", "disease.dur_inf.sd_days": null } });
    expect(deps.scenario.params?.disease.dur_inf).toEqual({ mean_days: 10, dist: "constant", sd_days: null });
    const missing = await run(deps, { advanced: { "disease.dur_inf.dist": "gamma" } });
    expect(missing.content).toBe("CONFIG ERROR: disease.dur_inf.dist needs disease.dur_inf.sd_days in the same call");
    const together = await run(deps, { advanced: { "disease.dur_inf.dist": "gamma", "disease.dur_inf.sd_days": 2 } });
    expect(together.isError).toBeUndefined();
    const kept = await run(deps, { advanced: { "disease.dur_inf.dist": "lognormal" } }); // the sd is already set
    expect(kept.isError).toBeUndefined();
    expect(deps.scenario.params?.disease.dur_inf).toEqual({ mean_days: 10, dist: "lognormal", sd_days: 2 });
  });

  it("says when the clamped beta carries less R0 than asked", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "dengue", dur_inf_days: 2, r0: 5.99 })).content); // the most 4 contacts × 1.5 days carry is 6: beta 2335 clamps to 1000
    expect(deps.scenario.params?.disease.beta).toBe(1000);
    expect(out.approx_r0).toBeLessThan(5.7);
    expect(out.warnings.some((w: string) => w.startsWith("beta was clamped at 1000"))).toBe(true);
    const fine = JSON.parse((await run(deps, { r0: 3 })).content);
    expect(fine.warnings.some((w: string) => w.includes("clamped"))).toBe(false);
  });
});
```

- [ ] **Step 7: Run the configure tests and watch the new ones fail**

Run (from `web/`): `npx vitest run tests/tools/configureSimulation.test.ts`
Expected: the renamed tests fail with `INVALID_INPUT`-style zod errors on unknown keys is NOT what happens here (the tool is called directly, not through `executeTool`): they fail because `dur_inf_days` is ignored, so the duration stays at 10; the new tests fail on `applied.model`, `changed` being `undefined`, and `advanced` being ignored.

- [ ] **Step 8: Write `advanced.ts`**

Create `web/lib/tools/advanced.ts`:

```ts
import { getPath, setPath } from "@/lib/sim/paths";
import { appliesTo, specFor, type ParamSpec } from "@/lib/sim/registry";

type Obj = Record<string, unknown>;

/**
 * Spec 9.1: apply an `advanced` patch of registry paths to a v2-shaped object
 * in place. Every path is checked before anything is written, so a bad patch
 * leaves the object untouched; the message names the first path that fails.
 * The caller validates the whole object afterwards (rule 5).
 */
export function applyAdvanced(base: Obj, patch: Record<string, unknown>): string | null {
  const model = String(patch["disease.model"] ?? getPath(base, "disease.model") ?? "sir");
  const entries = Object.entries(patch);
  for (const [path, value] of entries) {
    if (path.startsWith("interventions[]")) return `${path} is set through the vaccine, treatment and seasonality fields, not through advanced`;
    const spec = specFor(path);
    if (!spec) return `unknown parameter path "${path}"; call describe_parameters for the list`;
    if (!appliesTo(spec, model)) return `${path} does not apply to the ${model} model (it applies to ${spec.models.join(", ")})`;
    const problem = checkValue(spec, value);
    if (problem) return `${path} ${problem}`;
    for (const partner of spec.requires) {
      // A partner is needed when the value is not the default (constant needs no sd) and nothing supplies it.
      if (value !== spec.default && !(partner in patch) && (getPath(base, partner) ?? null) === null) return `${path} needs ${partner} in the same call`;
    }
  }
  for (const [path, value] of entries) setPath(base, path, value);
  return null;
}

/** Spec 9.1 (3): the kind and the bounds, stated with the unit. Null is allowed only where the registry default is null. */
export function checkValue(spec: ParamSpec, value: unknown): string | null {
  if (value === null) return spec.default === null ? null : "cannot be unset";
  switch (spec.kind) {
    case "bool":
      return typeof value === "boolean" ? null : "must be true or false";
    case "string":
      return typeof value === "string" ? null : "must be text";
    case "enum":
      return typeof value === "string" && (spec.choices ?? []).includes(value) ? null : `must be one of ${(spec.choices ?? []).join(", ")}`;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) return "must be a whole number";
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
      break;
  }
  const n = value as number;
  if (spec.bounds && (n < spec.bounds[0] || n > spec.bounds[1])) return `must be between ${spec.bounds[0]} and ${spec.bounds[1]}${spec.unit ? ` ${spec.unit}` : ""}`;
  return null;
}
```

- [ ] **Step 9: Replace `configureSimulation.ts`**

Replace the whole of `web/lib/tools/configureSimulation.ts` with:

```ts
import { z } from "zod";
import { detectDisease } from "@/lib/disease/db";
import { R0UnreachableError, approxR0, validateParams, withR0, type Duration, type SimParams } from "@/lib/sim/params";
import { changedPaths, type PathChange } from "@/lib/sim/paths";
import { pyRound } from "@/lib/sim/pyformat";
import { applyAdvanced } from "./advanced";
import { configView } from "./configView";
import { durationFor, type DurationName } from "./durations";
import { errorOutcome, given, paramWarnings, upsertIntervention } from "./shared";
import { resetScenario, type ToolDeps, type ToolOutcome } from "./types";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish();

export const ConfigureSimulationInput = z.strictObject({
  disease: opt(z.string()),
  country_iso3: opt(z.string()),
  model: opt(z.string()),
  disease_type: opt(z.string()),
  n_agents: opt(z.number()),
  sim_dur_years: opt(z.number()),
  r0: opt(z.number()),
  dur_inf_days: opt(z.number()),
  dur_exp_days: opt(z.number()),
  dur_immune_days: opt(z.number()),
  p_death: opt(z.number()),
  p_asymp: opt(z.number()),
  seed_fraction: opt(z.number()),
  seed_count: opt(z.number()),
  vaccine_coverage: opt(z.number()),
  vaccine_start_day: opt(z.number()),
  treatment_capacity: opt(z.number()),
  seasonality_scale: opt(z.number()),
  advanced: opt(z.record(z.string(), z.unknown())),
  start_new_scenario: opt(z.boolean()),
});
export type ConfigureSimulationArgs = z.infer<typeof ConfigureSimulationInput>;

type Obj = Record<string, unknown>;
type DurationField = "dur_inf_days" | "dur_exp_days" | "dur_immune_days";
const DURATION_FIELDS: [DurationName, DurationField][] = [["dur_inf", "dur_inf_days"], ["dur_exp", "dur_exp_days"], ["dur_immune", "dur_immune_days"]];
/** A beta clamped at the registry bound carries less R0 than asked; above this relative gap the tool says so. */
const R0_CLAMP_TOLERANCE = 0.01;

const block = (base: Obj, key: string): Obj => {
  if (typeof base[key] !== "object" || base[key] === null) base[key] = {};
  return base[key] as Obj;
};

/**
 * Ported from epichat/agent.py configure_simulation, on schema v2 with the
 * field names of spec 9.1, the advanced patch (applied after the fields,
 * validated once), `changed`, start_new_scenario, and the gamma defaults of
 * spec 7.3.
 */
export async function configureSimulation(input: ConfigureSimulationArgs, deps: ToolDeps): Promise<ToolOutcome> {
  if (given(input.seed_fraction) && given(input.seed_count)) return errorOutcome("CONFIG ERROR: seed_fraction and seed_count are mutually exclusive; pass one of them.");
  const newScenario = input.start_new_scenario === true;
  if (newScenario) {
    resetScenario(deps.scenario);
    deps.onScenarioStart();
  }
  const scenario = deps.scenario;
  const before = scenario.params;
  const fresh = before === null;
  const base: Obj = before ? (structuredClone(before) as unknown as Obj) : { schema_version: 2 };
  const disease = block(base, "disease");
  const run = block(base, "run");
  const demographics = block(base, "demographics");
  const applied: Obj = {};

  if (given(input.disease)) {
    scenario.disease = detectDisease(input.disease) ?? input.disease.toLowerCase();
    applied.disease = scenario.disease;
  }
  const model = given(input.model) ? input.model : input.disease_type;
  if (given(model)) {
    disease.model = model;
    applied.model = model;
  }
  if (given(input.n_agents)) {
    run.n_agents = input.n_agents;
    applied.n_agents = input.n_agents;
  }
  if (given(input.sim_dur_years)) {
    run.sim_dur_years = input.sim_dur_years;
    applied.sim_dur_years = input.sim_dur_years;
  }
  for (const [name, field] of DURATION_FIELDS) {
    const value = input[field];
    if (given(value)) {
      disease[name] = durationFor(disease[name] as Duration | null | undefined, value, name, scenario.disease);
      applied[field] = value;
    }
  }
  if (fresh && !given(input.dur_inf_days)) disease.dur_inf = durationFor(undefined, 10, "dur_inf", scenario.disease);
  if (given(input.p_death)) {
    disease.p_death = input.p_death;
    applied.p_death = input.p_death;
  }
  if (given(input.p_asymp)) {
    disease.p_asymp = input.p_asymp;
    applied.p_asymp = input.p_asymp;
  }
  const seedDay = ((disease.seed as Obj | undefined)?.day as number | undefined) ?? 0;
  if (given(input.seed_fraction)) {
    disease.seed = { mode: "fraction", value: input.seed_fraction, day: seedDay };
    applied.seed_fraction = input.seed_fraction;
  }
  if (given(input.seed_count)) {
    disease.seed = { mode: "count", value: input.seed_count, day: seedDay };
    applied.seed_count = input.seed_count;
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

  if (given(input.advanced) && Object.keys(input.advanced).length > 0) {
    // After the core fields, so a path given both ways takes the patch's value (spec 19); checked whole before anything is written.
    const problem = applyAdvanced(base, input.advanced);
    if (problem) return errorOutcome(`CONFIG ERROR: ${problem}`);
    applied.advanced = input.advanced;
  }

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
  const approx_r0 = pyRound(approxR0(params), 2);
  if (given(input.r0) && Math.abs(approx_r0 - input.r0) > R0_CLAMP_TOLERANCE * input.r0) {
    warnings.push(`beta was clamped at ${params.disease.beta}, so the run's R0 is ${approx_r0} rather than the requested ${input.r0}; more contacts or a longer infectious period would reach it.`);
  }
  const changed: PathChange[] = before ? changedPaths(before as unknown as Obj, params as unknown as Obj) : [];
  // Task 7 records a taken option here, from `changed` and the previous run's levers.
  const config = configView(params, scenario.disease);
  return {
    content: JSON.stringify({ applied, changed, approx_r0, config, warnings }),
    payload: { kind: "config", applied, changed, approx_r0, config, warnings, new_scenario: newScenario, params },
  };
}
```

- [ ] **Step 10: `ConfigPayload.changed` and the tool schema**

In `web/lib/tools/types.ts`, import the type and add the field:

```ts
import type { PathChange } from "@/lib/sim/paths";
```

```ts
export type ConfigPayload = {
  kind: "config";
  applied: Record<string, unknown>;
  /** Spec 9.1: what this call changed, by path; absent on payloads stored before it existed, empty on a fresh scenario. */
  changed?: PathChange[];
  approx_r0: number;
  ...
```

In `web/lib/tools/index.ts`, replace the `configure_simulation` entry's `description` and `properties` with:

```ts
    description:
      "Create or update the validated simulation configuration.\n\nCall this whenever the user specifies or changes any setting, passing\nonly the fields that changed — earlier settings are preserved. Pass\nr0 to have beta calibrated deterministically to that R0. Any other\nparameter goes in advanced, keyed by its registry path (call\ndescribe_parameters for the paths, bounds and units); the fields and\nthe patch are applied together and validated once. The result reports\nthe validated configuration, what changed, and any literature-range\nwarnings; a CONFIG ERROR result names what to fix.",
```

```ts
      properties: {
        disease: str('Disease name as the user said it (e.g. "dengue").'),
        country_iso3: str('ISO3 country code (e.g. "BRA").'),
        model: str("Model type: sir, seir, sis, sirs, seirs, or seiar."),
        disease_type: str("Alias of model."),
        n_agents: int("Number of simulated agents."),
        sim_dur_years: num("Simulation duration in years."),
        r0: num("Target basic reproduction number; beta is calibrated to it."),
        dur_inf_days: num("Infectious period in days (the mean; a new scenario gets a gamma spread around it)."),
        dur_exp_days: num("Latent (incubation) period in days (seir, seirs, seiar)."),
        dur_immune_days: num("Immunity duration in days (sirs, seirs)."),
        p_death: num("Case fatality ratio as a fraction of 1 (symptomatic cases only in seiar)."),
        p_asymp: num("Asymptomatic fraction (seiar), fraction of 1."),
        seed_fraction: num("Share of agents infected at the start, 0 to 1. Exclusive with seed_count."),
        seed_count: int("Number of agents infected at the start. Exclusive with seed_fraction."),
        vaccine_coverage: num("Vaccine coverage fraction; adds/updates the\nvaccine intervention."),
        vaccine_start_day: int("Day the vaccination campaign begins. 0 (the\ndefault) means pre-existing immunity at the start rather than\na campaign. Requires vaccine_coverage."),
        treatment_capacity: int("Daily treatment capacity; adds/updates the\ntreatment intervention."),
        seasonality_scale: num("Seasonal forcing amplitude 0-1; adds/updates\nthe seasonality intervention."),
        advanced: {
          type: ["object", "null"],
          description: 'Any other parameter by its registry path, for example {"disease.dur_inf.dist": "gamma", "disease.dur_inf.sd_days": 2.4} or {"run.n_replicates": 5}. Applied with the fields above and validated once; a CONFIG ERROR names the path. Interventions are not set here.',
          additionalProperties: true,
        },
        start_new_scenario: { type: ["boolean", "null"], description: "True to begin a new scenario from scratch (a different disease or country) instead of editing the current one. Earlier scenarios are kept for comparison." },
      },
```

- [ ] **Step 11: Run the tool tests, the typecheck and the lint**

Run (from `web/`): `npx vitest run tests/tools tests/sim tests/client tests/chat tests/report && npm run typecheck && npm run lint`
Expected: all pass. The `web/tests/client/*` and `web/tests/chat/*` config fixtures use the `config` view (`disease_type`, `dur_inf`), which is unchanged.

- [ ] **Step 12: Commit**

```bash
git add web/lib/sim/paths.ts web/lib/tools/advanced.ts web/lib/tools/configureSimulation.ts web/lib/tools/types.ts web/lib/tools/index.ts web/tests/sim/paths.test.ts web/tests/tools/configureSimulation.test.ts web/tests/tools/fetchTools.test.ts web/tests/tools/registry.test.ts
git commit -m "feat(web): configure_simulation takes the spec's field names, an advanced patch by registry path, and reports changed"
```

---

### Task 6: `describe_parameters`

**Files:**
- Create: `web/lib/tools/sources.ts`
- Create: `web/lib/tools/describeParameters.ts`
- Modify: `web/lib/tools/index.ts` (the tool definition after `remember`, the registry entry)
- Modify: `web/lib/client/toolLine.ts:5-30` (the label and the status line)
- Test: `web/tests/tools/describeParameters.test.ts` (new), `web/tests/tools/registry.test.ts`, `web/tests/client/toolLine.test.ts`

**Interfaces:**
- Consumes: `PARAM_REGISTRY`, `applicableSpecs`, `ParamSpec` (`web/lib/sim/registry.ts`); `flattenParams` (`web/lib/sim/paths.ts`); `lookup`, `detectDisease`, `DiseaseEntry` (`web/lib/disease/db.ts`); `DEFAULT_BETA`, `approxR0` (`web/lib/sim/params.ts`); `illustrativeSd` (`./durations`); `Scenario.dataSources`.
- Produces:
  - `type ParamSource = "user" | "database" | "fetch" | "default" | "illustrative"`, `type DbRange = { min, max, typical, unit, source }`, `dbRange(entry, dbField): DbRange | null`, `near(a, b): boolean`, `valueSources(params, scenario, disease): Record<string, ParamSource>` in `sources.ts` (Task 7's option matching uses `near`).
  - `DescribeParametersInput`, `describeParameters(input, deps)`, `MODULES`, `TIERS`, `DescribedParam` in `describeParameters.ts`.
  - The tool `describe_parameters` with `{ module?, tier? }`, last in `TOOLS`.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/tools/describeParameters.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { configureSimulation } from "@/lib/tools/configureSimulation";
import { describeParameters, type DescribedParam } from "@/lib/tools/describeParameters";
import { fetchDemographics } from "@/lib/tools/fetchDemographics";
import { valueSources } from "@/lib/tools/sources";
import { emptyScenario } from "@/lib/tools/types";
import { makeDeps, params, rf } from "./helpers";

type Body = { note: string; model: string; disease: string | null; interventions: string[]; parameters: DescribedParam[] };
const configure = (deps: ReturnType<typeof makeDeps>, input: Record<string, unknown>) => configureSimulation(input as never, deps);
const describe_ = async (deps: ReturnType<typeof makeDeps>, input: Record<string, unknown> = {}): Promise<Body> => JSON.parse((await describeParameters(input as never, deps)).content);
const byPath = (body: Body) => Object.fromEntries(body.parameters.map((p) => [p.path, p]));

describe("describe_parameters", () => {
  it("lists the sir defaults and says no scenario exists", async () => {
    const body = await describe_(makeDeps());
    expect(body.note).toMatch(/^No scenario is configured yet/);
    expect(body.note).toContain("configure_simulation's own fields");
    expect(body.model).toBe("sir");
    const p = byPath(body);
    expect(p["disease.dur_exp.mean_days"]).toBeUndefined();
    expect(p["run.n_agents"]).toMatchObject({ label: "Agents", current: 10000, source: null, tier: "core", bounds: [10, 1000000], db_range: null, affects: ["stochasticity"] });
    expect(p["disease.dur_inf.dist"]).toMatchObject({ current: "constant", choices: ["constant", "lognormal", "gamma"], requires: ["disease.dur_inf.sd_days"] });
    expect(p["interventions[].coverage"]).toBeUndefined();
    expect(body.interventions).toEqual([]);
    expect(body.parameters.map((x) => x.path)).toEqual(body.parameters.map((x) => x.path).filter((x) => !x.startsWith("interventions")));
  });

  it("attributes each value to the user, the database, a default or an illustrative spread", async () => {
    const deps = makeDeps();
    await configure(deps, { disease: "measles", r0: 15, dur_inf_days: 8, n_agents: 50000, treatment_capacity: 20 });
    const body = await describe_(deps);
    expect(body.note).toMatch(/^Parameters of the current sir scenario \(measles\)/);
    expect(body.disease).toBe("measles");
    expect(body.interventions).toEqual(["treatment"]);
    const p = byPath(body);
    expect(p["disease.beta"].source).toBe("database"); // R0 15 is the measles consensus
    expect(p["disease.dur_inf.mean_days"]).toMatchObject({ current: 8, source: "database", db_range: { min: 8, max: 8, typical: 8, unit: "days" } });
    expect(p["disease.dur_inf.sd_days"]).toMatchObject({ current: 2.4, source: "illustrative" });
    expect(p["disease.dur_inf.dist"]).toMatchObject({ current: "gamma", source: "illustrative" });
    expect(p["run.n_agents"].source).toBe("user");
    expect(p["run.sim_dur_years"].source).toBe("default");
    expect(p["disease.p_death"]).toMatchObject({ current: 0, source: "default" });
    expect(p["disease.p_death"].db_range).toMatchObject({ unit: "fraction" });
    expect(p["disease.p_death"].db_range?.min).toBeCloseTo(0.005, 9);
    expect(p["disease.p_death"].db_range?.max).toBeCloseTo(0.06, 9);
    expect(p["disease.p_death"].db_range?.typical).toBeCloseTo(0.015, 9);
    await configure(deps, { r0: 12, advanced: { "disease.dur_inf.sd_days": 1 } });
    const again = byPath(await describe_(deps));
    expect(again["disease.beta"].source).toBe("user");
    expect(again["disease.dur_inf.sd_days"].source).toBe("user");
    expect(again["disease.dur_inf.dist"].source).toBe("user");
  });

  it("marks fetched values as fetch until the user changes them, and filters by module and tier", async () => {
    const kenya = [
      rf("age_distribution_pct", { "0-17": 38.6, "18-64": 57.6, "65+": 3.8 }, "UN WPP"),
      rf("total_population", 55_000_000, "UN WPP"),
      rf("birth_rate", 27.3, "UN WPP"),
      rf("death_rate", 7.2, "UN WPP"),
    ];
    const deps = makeDeps({ unWpp: kenya });
    await configure(deps, { disease: "measles", r0: 15, dur_inf_days: 8 });
    await fetchDemographics({ country_iso3: "KEN" }, deps);
    let p = byPath(await describe_(deps, { module: "demographics" }));
    expect(p["demographics.birth_rate"]).toMatchObject({ current: 27.3, source: "fetch" });
    expect(p["demographics.use_demographics"].source).toBe("fetch");
    expect(p["demographics.age_pct_under18"]).toMatchObject({ current: 38.6, source: "fetch" });
    expect(p["demographics.country"]).toMatchObject({ current: "KEN", source: "user" });
    expect(p["disease.beta"]).toBeUndefined();
    expect(byPath(await describe_(deps, { module: "network" }))["network.network_type"]).toMatchObject({ current: "age_structured", source: "fetch" });
    await configure(deps, { advanced: { "demographics.birth_rate": 30 } });
    p = byPath(await describe_(deps));
    expect(p["demographics.birth_rate"].source).toBe("user");
    expect(p["demographics.death_rate"].source).toBe("fetch");
    expect(Object.keys(byPath(await describe_(deps, { tier: "expert" })))).toEqual(["demographics.auto_demographics", "demographics.demographics_year", "demographics.demographics_source", "run.rand_seed"]);
    expect((await describe_(deps, { module: "interventions" })).parameters).toEqual([]);
  });

  it("handles a migrated v1 scenario with an unknown disease", async () => {
    const deps = makeDeps({ scenario: { ...emptyScenario(), params: params({ disease_type: "seir", dur_exp: 5, dur_inf: 7, beta: 50, n_agents: 2000 }), disease: "mystery pox" } });
    const body = await describe_(deps);
    expect(body.disease).toBe("mystery pox");
    expect(body.model).toBe("seir");
    const p = byPath(body);
    expect(p["disease.dur_exp.mean_days"]).toMatchObject({ current: 5, source: "user", db_range: null });
    expect(p["disease.dur_exp.dist"]).toMatchObject({ current: "constant", source: "default" });
    expect(p["disease.beta"]).toMatchObject({ current: 50, source: "user", db_range: null });
    expect(p["run.n_agents"].source).toBe("user");
    expect(p["run.rand_seed"]).toMatchObject({ current: null, source: "default" });
    expect(body.parameters.every((x) => x.db_range === null)).toBe(true);
  });

  it("valueSources covers every set path", () => {
    const p = params({ disease_type: "sirs", dur_immune: 200, dur_inf: 10 });
    const sources = valueSources(p, { ...emptyScenario(), params: p }, null);
    expect(sources["disease.dur_immune.mean_days"]).toBe("user");
    expect(sources["disease.sis_waning"]).toBe("default");
    expect(sources["demographics.country"]).toBe("default");
    expect(sources["disease.initial_immune_frac"]).toBe("default");
    expect(sources["disease.beta"]).toBe("default");
    expect(sources["disease.dur_exp.mean_days"]).toBeUndefined();
  });
});
```

In `web/tests/tools/registry.test.ts`, change the first test's name to `"declares the nine tools in the agent's order with streaming on and no extra properties"`, its expected name list to end with `"remember", "describe_parameters"`, and add after the `remember` assertions:

```ts
    const describe = TOOLS[8].input_schema as { required: string[]; properties: { module: { enum: unknown[] }; tier: { enum: unknown[] } } };
    expect(describe.required).toEqual([]);
    expect(describe.properties.module.enum).toEqual(["disease", "network", "demographics", "interventions", "run", null]);
    expect(describe.properties.tier.enum).toEqual(["core", "advanced", "expert", null]);
```

In `web/tests/client/toolLine.test.ts`, add inside its first describe:

```ts
  it("labels the parameter list", () => {
    expect(toolLabel("describe_parameters")).toBe("📋 Parameter list");
    expect(statusLabel("describe_parameters")).toBe("Listing the parameters…");
  });
```

(import `statusLabel` and `toolLabel` from `@/lib/client/toolLine` if the file does not already).

- [ ] **Step 2: Run them and watch them fail**

Run (from `web/`): `npx vitest run tests/tools/describeParameters.test.ts tests/tools/registry.test.ts tests/client/toolLine.test.ts`
Expected: the new file fails to import `@/lib/tools/describeParameters`; the registry test fails on the tool list; the label test gets `🔧 describe_parameters`.

- [ ] **Step 3: Write `sources.ts`**

Create `web/lib/tools/sources.ts`:

```ts
/**
 * Where a scenario's values came from (spec 9.2), derived as section 19
 * says: a fetched data source that still carries the value, the database
 * consensus, an illustrative spread the configure tool computed, the
 * registry default, or else the user.
 */
import { lookup, type DiseaseEntry } from "@/lib/disease/db";
import { DEFAULT_BETA, approxR0, type SimParams } from "@/lib/sim/params";
import { flattenParams } from "@/lib/sim/paths";
import { PARAM_REGISTRY } from "@/lib/sim/registry";
import { illustrativeSd } from "./durations";
import type { Scenario } from "./types";

export type ParamSource = "user" | "database" | "fetch" | "default" | "illustrative";
export type DbRange = { min: number | null; max: number | null; typical: number | null; unit: string | null; source: string };

const DAYS_PER_UNIT: Record<string, number> = { days: 1, weeks: 7, months: 30.44, years: 365.25 };
/** How close a configured R0 must be to the database typical to count as the database's. */
const R0_TOLERANCE = 0.01;

/** The database consensus for a registry db_field in simulation units: fractions of 1 and days. */
export function dbRange(entry: DiseaseEntry | null, dbField: string | null): DbRange | null {
  const flat = dbField && entry ? entry.flat[dbField] : null;
  if (!flat) return null;
  let factor = 1;
  let unit = flat.unit;
  if ((dbField === "fatality_rate" || dbField === "asymptomatic_fraction") && flat.unit === "percentage") {
    factor = 0.01;
    unit = "fraction";
  } else if (dbField === "immunity_duration") {
    factor = DAYS_PER_UNIT[flat.unit ?? "days"] ?? 1;
    unit = "days";
  }
  const scale = (v: number | null) => (v === null ? null : v * factor);
  return { min: scale(flat.min), max: scale(flat.max), typical: scale(flat.typical), unit, source: flat.source };
}

/** Equal, with a relative tolerance for numbers (a patch value and a stored value must compare as the same). */
export function near(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  return a === b;
}

const sourceValue = (scenario: Scenario, field: string) => scenario.dataSources.find((f) => f.field === field)?.value;
const ages = (scenario: Scenario) => sourceValue(scenario, "age_distribution_pct") as Record<string, number> | undefined;

/** What each fetch tool writes, by path (lib/tools/fetch*.ts): the value is a fetch only while it still equals what was fetched. */
const FETCHED: Record<string, (scenario: Scenario) => unknown> = {
  "demographics.birth_rate": (s) => sourceValue(s, "birth_rate"),
  "demographics.death_rate": (s) => sourceValue(s, "death_rate"),
  "demographics.use_demographics": (s) => (sourceValue(s, "birth_rate") === undefined ? undefined : true),
  "demographics.age_pct_under18": (s) => ages(s)?.["0-17"],
  "demographics.age_pct_18_64": (s) => ages(s)?.["18-64"],
  "demographics.age_pct_over65": (s) => ages(s)?.["65+"],
  "network.network_type": (s) => (ages(s) === undefined ? undefined : "age_structured"),
  "disease.initial_immune_frac": (s) => {
    const coverage = s.dataSources.find((f) => f.field.endsWith("_coverage"));
    return coverage ? Math.min(0.99, Number(coverage.value) / 100) : undefined;
  },
};

const DURATIONS = ["dur_exp", "dur_inf", "dur_immune"] as const;

/** One source per set path of the scenario's parameters. */
export function valueSources(p: SimParams, scenario: Scenario, disease: string | null): Record<string, ParamSource> {
  const entry = disease ? lookup(disease) : null;
  const flat = flattenParams(p as unknown as Record<string, unknown>);
  const out: Record<string, ParamSource> = {};
  for (const spec of PARAM_REGISTRY) {
    if (!(spec.path in flat)) continue;
    const value = flat[spec.path];
    const fetched = FETCHED[spec.path]?.(scenario);
    if (fetched !== undefined && near(value, fetched)) {
      out[spec.path] = "fetch";
      continue;
    }
    const typical = dbRange(entry, spec.db_field)?.typical ?? null;
    if (typical !== null && near(value, typical)) {
      out[spec.path] = "database";
      continue;
    }
    out[spec.path] = near(value, spec.default) ? "default" : "user";
  }
  // beta is set from an R0, so it is attributed by the R0 it implies.
  const r0Typical = dbRange(entry, "r0")?.typical ?? null;
  const r0 = approxR0(p);
  out["disease.beta"] = near(p.disease.beta, DEFAULT_BETA) ? "default" : r0Typical !== null && Math.abs(r0 - r0Typical) <= R0_TOLERANCE * r0Typical ? "database" : "user";
  // A spread the configure tool computed, and the gamma it came with, are an illustrative assumption (spec 7.3).
  for (const name of DURATIONS) {
    const d = p.disease[name];
    if (d && d.sd_days !== null && d.dist !== "constant" && near(d.sd_days, illustrativeSd(name, d.mean_days, disease))) {
      out[`disease.${name}.sd_days`] = "illustrative";
      out[`disease.${name}.dist`] = "illustrative";
    }
  }
  return out;
}
```

- [ ] **Step 4: Write `describeParameters.ts`**

Create `web/lib/tools/describeParameters.ts`:

```ts
import { z } from "zod";
import { detectDisease, lookup } from "@/lib/disease/db";
import { flattenParams } from "@/lib/sim/paths";
import { applicableSpecs, type ParamSpec } from "@/lib/sim/registry";
import { dbRange, valueSources, type DbRange, type ParamSource } from "./sources";
import type { ToolDeps, ToolOutcome } from "./types";

export const MODULES = ["disease", "network", "demographics", "interventions", "run"] as const;
export const TIERS = ["core", "advanced", "expert"] as const;
export const DescribeParametersInput = z.strictObject({ module: z.enum(MODULES).nullish(), tier: z.enum(TIERS).nullish() });
export type DescribeParametersArgs = z.infer<typeof DescribeParametersInput>;

export type DescribedParam = {
  path: string;
  label: string;
  description: string;
  unit: string | null;
  bounds: [number, number] | null;
  choices: string[] | null;
  tier: ParamSpec["tier"];
  current: unknown;
  source: ParamSource | null;
  affects: string[];
  requires: string[];
  db_range: DbRange | null;
};

export const INTERVENTIONS_NOTE = "Interventions (vaccine, treatment, seasonality) are set through configure_simulation's own fields and listed in its config.";

/** Spec 9.2: the registry for the current model, each parameter with its value and where it came from. */
export async function describeParameters(input: DescribeParametersArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  const params = scenario.params;
  const model = params?.disease.model ?? "sir";
  const disease = scenario.disease ?? detectDisease(deps.contextText || "");
  const entry = disease ? lookup(disease) : null;
  const flat = params ? flattenParams(params as unknown as Record<string, unknown>) : null;
  const sources = params ? valueSources(params, scenario, disease) : null;
  const parameters: DescribedParam[] = applicableSpecs(model)
    .filter((s) => s.module !== "interventions" && (!input.module || s.module === input.module) && (!input.tier || s.tier === input.tier))
    .map((s) => ({
      path: s.path,
      label: s.label,
      description: s.description,
      unit: s.unit,
      bounds: s.bounds,
      choices: s.choices,
      tier: s.tier,
      current: flat ? (flat[s.path] ?? null) : s.default,
      source: sources ? (sources[s.path] ?? null) : null,
      affects: s.affects,
      requires: s.requires,
      db_range: dbRange(entry, s.db_field),
    }));
  const note = params
    ? `Parameters of the current ${model} scenario${disease ? ` (${disease})` : ""}: current values with their source (user, database, fetch, default, illustrative). ${INTERVENTIONS_NOTE}`
    : `No scenario is configured yet: these are the registry defaults for the ${model} model. Call configure_simulation to start one. ${INTERVENTIONS_NOTE}`;
  const interventions = params ? params.interventions.map((i) => i.type) : [];
  return { content: JSON.stringify({ note, model, disease, interventions, parameters }) };
}
```

- [ ] **Step 5: Register the tool and label it**

In `web/lib/tools/index.ts`, import `DescribeParametersInput, MODULES, TIERS, describeParameters` from `./describeParameters`, append this entry to `TOOLS` after `remember`:

```ts
  {
    name: "describe_parameters",
    description:
      "List the simulation parameters of the current model (or the defaults before a scenario exists): for each one its path, label, meaning, unit, bounds, current value and where that value came from (user, database, fetch, default, illustrative), what it affects, and the literature range when the disease is known. Call it when the user asks what can be changed or what a parameter means, or when a diagnostic names a parameter, instead of answering from memory. Every path it lists can be set through configure_simulation's fields or its advanced patch.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        module: { type: ["string", "null"], enum: [...MODULES, null], description: "Only this module: disease, network, demographics, interventions, or run." },
        tier: { type: ["string", "null"], enum: [...TIERS, null], description: "Only this tier: core, advanced, or expert." },
      },
      required: [],
      additionalProperties: false,
    },
  },
```

and this line to `REGISTRY`:

```ts
  describe_parameters: { schema: DescribeParametersInput, run: describeParameters },
```

In `web/lib/client/toolLine.ts`, add `describe_parameters: "📋 Parameter list",` to `TOOL_LABELS` (after `remember`) and `describe_parameters: "Listing the parameters…",` to `TOOL_STATUS`.

- [ ] **Step 6: Run the tests, the typecheck and the lint**

Run (from `web/`): `npx vitest run tests/tools tests/client tests/chat && npm run typecheck && npm run lint`
Expected: all pass. The prompt test's "for (const tool of TOOLS) expect(SYSTEM_PROMPT).toContain(tool.name)" fails until Task 8 adds the Parameters section: that one failure is expected here and is listed in the pre-flight (see the executor's ledger); every other test passes. If you prefer a green run, do Task 8's prompt text first and come back; the plan order keeps the tool and its prompt guidance in separate commits for the reviewer.

- [ ] **Step 7: Commit**

```bash
git add web/lib/tools/sources.ts web/lib/tools/describeParameters.ts web/lib/tools/index.ts web/lib/client/toolLine.ts web/tests/tools/describeParameters.test.ts web/tests/tools/registry.test.ts web/tests/client/toolLine.test.ts
git commit -m "feat(web): describe_parameters lists the registry for the current model with each value's source"
```

---

### Task 7: Diagnostics and the comparison in `run_simulation`; `diagnostic_shown` and `option_chosen`

**Files:**
- Create: `web/lib/tools/options.ts`
- Modify: `web/lib/tools/types.ts` (`RunCompare`, `RunPayload.diagnostics/compare`, `ToolDeps.previousRun/onOptionChosen`)
- Modify: `web/lib/tools/runSimulation.ts`
- Modify: `web/lib/tools/configureSimulation.ts` (the marked line from Task 5)
- Modify: `web/lib/chat/handleChat.ts:171-190` (`onRun`), plus the two new deps
- Test: `web/tests/tools/helpers.ts`, `web/tests/tools/runSimulation.test.ts`, `web/tests/tools/configureSimulation.test.ts`, `web/tests/chat/handleChat.test.ts`

**Interfaces:**
- Consumes: `PreviousRun`, `RunStore.latest` (Task 4); `Diagnostic`, `SimSuccess.diagnostics`, `simulate(…, disease)` (Task 4); `changedPaths`, `PathChange` (Task 5); `near` (Task 6); `detectDisease`.
- Produces:
  - `type RunCompare = { previous_run_id: string; changed: PathChange[]; stats_delta: { peak_infections: number; peak_day: number; total_infected: number; total_deaths: number } }`.
  - `RunPayload.diagnostics?: Diagnostic[]`, `RunPayload.compare?: RunCompare | null`; the run tool's content JSON gains `diagnostics` and `compare`.
  - `ToolDeps.previousRun(): Promise<PreviousRun | null>` and `ToolDeps.onOptionChosen(runId: string, diagnosticId: string, patch: Record<string, unknown>): void`.
  - `matchedLevers(previous: PreviousRun | null, changed: PathChange[]): { diagnosticId: string; patch: Record<string, unknown> }[]` in `options.ts`.
  - Step events `diagnostic_shown { run_id, ids }` (ids comma-joined) and `option_chosen { run_id, diagnostic_id, patch }` (patch as a JSON string); `StepEventJson.meta` holds scalars only.

- [ ] **Step 1: Extend the test helpers**

In `web/tests/tools/helpers.ts`:
- import `type PreviousRun` from `@/lib/db/runs`;
- add to `FakeDeps`: `simulated: { popScale: number; contextText: string; disease: string | null }[]; options: { runId: string; diagnosticId: string; patch: Record<string, unknown> }[]; previousReads: number;`
- add to `makeDeps`'s `over` type: `previousRun: PreviousRun | null;`
- change the fake `simulate` to record its arguments: `async simulate(_params, popScale, contextText, disease) { deps.simulated.push({ popScale, contextText, disease: disease ?? null }); if (over.simulate instanceof Error) throw over.simulate; if (!over.simulate) throw new Error("no simulate result configured"); return over.simulate; },` (declare `deps` before `sim` with `let deps: FakeDeps;` or move `sim` after, as the file's structure allows; the existing `answer` closure already references `deps` lazily, so defining `sim` with the same lazy reference works);
- initialise `simulated: [], options: [], previousReads: 0,` in `deps`;
- add the two deps: `async previousRun() { deps.previousReads++; return over.previousRun ?? null; }, onOptionChosen(runId, diagnosticId, patch) { deps.options.push({ runId, diagnosticId, patch }); },`.

- [ ] **Step 2: Write the failing run tests**

Append to `web/tests/tools/runSimulation.test.ts`:

```ts
describe("run_simulation: diagnostics and the comparison", () => {
  const diagnostics = [{
    id: "unfinished", severity: "warning" as const, title: "The run ended before the epidemic did", evidence: { last_infectious: 40 },
    levers: [{ patch: { "run.sim_dur_years": 2 }, current: { "run.sim_dur_years": 1 }, direction: "increase" as const, rationale: "r", basis: "rule" as const }],
  }];

  it("passes the diagnostics and the disease along, and compares with the previous run", async () => {
    const previous = { id: "run-8", effectiveParams: params({ n_agents: 50000, dur_inf: 10 }), stats: { ...STATS, peak_infections: 800 * 4260, peak_day: 35, total_infected: 5000 * 4260, total_deaths: 10 * 4260 }, diagnostics: [] };
    const deps = makeDeps({ simulate: success({ diagnostics, effective_params: params({ n_agents: 50000, dur_inf: 8 }) }), previousRun: previous });
    await configureSimulation({ disease: "dengue", n_agents: 50000 } as never, deps);
    deps.scenario.hasRun = true;
    const out = await runSimulation({}, deps);
    const body = JSON.parse(out.content);
    expect(deps.simulated).toEqual([{ popScale: 1, contextText: "", disease: "dengue" }]);
    expect(body.diagnostics).toEqual(diagnostics);
    expect(body.compare).toEqual({
      previous_run_id: "run-8",
      changed: [{ path: "disease.dur_inf.mean_days", from: 10, to: 8 }],
      stats_delta: { peak_infections: 100 * 4260, peak_day: 5, total_infected: 1000 * 4260, total_deaths: 2 * 4260 },
    });
    expect(out.payload).toMatchObject({ kind: "run", diagnostics, compare: { previous_run_id: "run-8" } });
  });

  it("has no compare before the first run, reads the previous run only after one, and detects the disease from the text", async () => {
    const deps = makeDeps({ simulate: success(), previousRun: null, contextText: "whooping cough in Kenya" });
    await configureSimulation({ n_agents: 50000 } as never, deps);
    const body = JSON.parse((await runSimulation({}, deps)).content);
    expect(body.compare).toBeNull();
    expect(body.diagnostics).toEqual([]);
    expect(deps.previousReads).toBe(0);
    expect(deps.simulated[0].disease).toBe("pertussis");
    await runSimulation({}, deps);
    expect(deps.previousReads).toBe(1);
    expect(JSON.parse((await runSimulation({}, deps)).content).compare).toBeNull(); // the store had no previous run
  });
});
```

- [ ] **Step 3: Write the failing configure tests**

Append to `web/tests/tools/configureSimulation.test.ts`:

```ts
describe("configure_simulation records a taken option", () => {
  const lever = { patch: { "disease.dur_inf.dist": "gamma", "disease.dur_inf.sd_days": 2.4 }, current: {}, direction: "change" as const, rationale: "r", basis: "rule" as const };
  const previous = () => ({
    id: "run-3", effectiveParams: params({}), stats: { peak_infections: 1, peak_day: 1, total_infected: 1, total_deaths: 0, n_agents: 10000, sim_days: 366 },
    diagnostics: [
      { id: "sharp_curve", severity: "info" as const, title: "t", evidence: {}, levers: [lever] },
      { id: "unfinished", severity: "warning" as const, title: "u", evidence: {}, levers: [{ ...lever, patch: { "run.sim_dur_years": 2 } }] },
    ],
  });

  it("matches a lever on every path of its patch, once per diagnostic", async () => {
    const deps = makeDeps({ previousRun: previous() });
    await run(deps, { disease: "measles", advanced: { "disease.dur_inf.dist": "constant", "disease.dur_inf.sd_days": null } });
    deps.scenario.hasRun = true;
    await run(deps, { advanced: { "disease.dur_inf.dist": "gamma", "disease.dur_inf.sd_days": 2.4 }, sim_dur_years: 2 });
    expect(deps.options).toEqual([
      { runId: "run-3", diagnosticId: "sharp_curve", patch: lever.patch },
      { runId: "run-3", diagnosticId: "unfinished", patch: { "run.sim_dur_years": 2 } },
    ]);
    expect(deps.previousReads).toBe(1);
  });

  it("records nothing for a partial match, a failed patch, an unchanged call, or before any run", async () => {
    const deps = makeDeps({ previousRun: previous() });
    await run(deps, { disease: "measles", advanced: { "disease.dur_inf.dist": "constant", "disease.dur_inf.sd_days": null } });
    await run(deps, { advanced: { "disease.dur_inf.dist": "gamma", "disease.dur_inf.sd_days": 2.4 } }); // no run yet
    expect(deps.previousReads).toBe(0);
    deps.scenario.hasRun = true;
    await run(deps, { advanced: { "disease.dur_inf.dist": "lognormal", "disease.dur_inf.sd_days": 3 } }); // a different value
    const failed = await run(deps, { advanced: { "run.sim_dur_years": 2, "run.n_replicates": 9 } }); // out of bounds: nothing applied
    expect(failed.isError).toBe(true);
    await run(deps, { n_agents: 10000 }); // unchanged: nothing to match
    expect(deps.options).toEqual([]);
    expect(deps.previousReads).toBe(1);
  });
});
```

- [ ] **Step 4: Write the failing handler test**

Append to `web/tests/chat/handleChat.test.ts` (inside the main describe) and extend `setup`: add `previous?: PreviousRun | null;` to `Over` (import `type PreviousRun` from `@/lib/db/runs`), and make the fake run store's `latest` return `over.previous ?? null`:

```ts
  it("records diagnostic_shown with the run id and option_chosen when the next configuration applies a lever", async () => {
    const diagnostics = [{ id: "unfinished", severity: "warning" as const, title: "t", evidence: {}, levers: [{ patch: { "run.sim_dur_years": 2 }, current: { "run.sim_dur_years": 1 }, direction: "increase" as const, rationale: "r", basis: "rule" as const }] }];
    const withDiagnostics: SimResult = { ...SUCCESS, diagnostics };
    const { run, finished, emitted } = setup([{ message: RUN }, { message: message([textBlock("Still going at the end.")]) }], { history: HISTORY, scenario: configured(), simulate: withDiagnostics });
    await run({ conversationId: CONVERSATION, text: "Run it" });
    expect(finished[0].step_events.map((e) => e.kind)).toEqual(["stage_reached", "run_completed", "diagnostic_shown", "tool_called", "stage_reached", "turn"]);
    expect(finished[0].step_events[2]).toMatchObject({ tool: "run_simulation", stage: "run", meta: { run_id: "run-1", ids: "unfinished" } });
    expect(emitted[2]).toMatchObject({ type: "tool_result", payload: { kind: "run", diagnostics, compare: null } });

    const previous: PreviousRun = { id: "run-1", effectiveParams: params({ n_agents: 10000 }), stats: STATS, diagnostics };
    const option = setup(
      [{ message: message([toolUse("tu_3", "configure_simulation", { sim_dur_years: 2 })], "tool_use") }, { message: message([textBlock("Two years it is.")]) }],
      { history: HISTORY, scenario: { ...configured(), hasRun: true, stage: "interpret", stageReached: "interpret" }, previous },
    );
    await option.run({ conversationId: CONVERSATION, text: "Run it for two years" });
    const chosen = option.finished[0].step_events.find((e) => e.kind === "option_chosen");
    expect(chosen).toMatchObject({ tool: "configure_simulation", meta: { run_id: "run-1", diagnostic_id: "unfinished", patch: JSON.stringify({ "run.sim_dur_years": 2 }) } });
  });
```

- [ ] **Step 5: Run the three files and watch the new tests fail**

Run (from `web/`): `npx vitest run tests/tools/runSimulation.test.ts tests/tools/configureSimulation.test.ts tests/chat/handleChat.test.ts`
Expected: typecheck-level failures first (`previousRun` is not in `ToolDeps`); after the helper compiles, the new tests fail on `diagnostics`/`compare` being undefined and `options` staying empty.

- [ ] **Step 6: The types**

In `web/lib/tools/types.ts`:

```ts
import type { PreviousRun } from "@/lib/db/runs";
import type { Diagnostic, RepairRecord, SimClient, SimResult, SimStats } from "@/lib/sim/client";
```

(extend the existing `@/lib/sim/client` import with `Diagnostic`), then:

```ts
/** Spec 11: this run against the scenario's previous successful run. */
export type RunCompare = {
  previous_run_id: string;
  changed: PathChange[];
  stats_delta: { peak_infections: number; peak_day: number; total_infected: number; total_deaths: number };
};
```

In `RunPayload`, after `replicates?`:

```ts
  /** Spec 10: what the run's shape suggests about the configuration; absent on payloads stored before phase 4. */
  diagnostics?: Diagnostic[];
  /** Spec 11: against the previous run, or null for the scenario's first run. */
  compare?: RunCompare | null;
```

In `ToolDeps`, after `onScenarioStart`:

```ts
  /** The scenario's latest successful run (this turn's included), for the comparison and the option matching; null when there is none or the read failed. */
  previousRun: () => Promise<PreviousRun | null>;
  /** The next configuration applied a diagnostic's lever (spec 11); the handler records option_chosen. */
  onOptionChosen: (runId: string, diagnosticId: string, patch: Record<string, unknown>) => void;
```

- [ ] **Step 7: `options.ts`**

Create `web/lib/tools/options.ts`:

```ts
import type { PreviousRun } from "@/lib/db/runs";
import type { PathChange } from "@/lib/sim/paths";
import { near } from "./sources";

export type MatchedLever = { diagnosticId: string; patch: Record<string, unknown> };

/** Spec 11: a lever was taken when every path of its patch was applied with its value; the first matching lever per diagnostic. */
export function matchedLevers(previous: PreviousRun | null, changed: PathChange[]): MatchedLever[] {
  if (!previous || changed.length === 0) return [];
  const applied = new Map(changed.map((c) => [c.path, c.to]));
  const out: MatchedLever[] = [];
  for (const diagnostic of previous.diagnostics) {
    const lever = diagnostic.levers.find((l) => {
      const paths = Object.keys(l.patch);
      return paths.length > 0 && paths.every((p) => applied.has(p) && near(applied.get(p), l.patch[p]));
    });
    if (lever) out.push({ diagnosticId: diagnostic.id, patch: lever.patch });
  }
  return out;
}
```

- [ ] **Step 8: The run tool**

Replace `web/lib/tools/runSimulation.ts` with:

```ts
import { z } from "zod";
import { detectDisease } from "@/lib/disease/db";
import type { PreviousRun } from "@/lib/db/runs";
import type { SimSuccess } from "@/lib/sim/client";
import { changedPaths } from "@/lib/sim/paths";
import { pyRound } from "@/lib/sim/pyformat";
import { errorOutcome, paramWarnings, runNotes } from "./shared";
import type { RunCompare, RunPayload, ToolDeps, ToolOutcome } from "./types";

export const RunSimulationInput = z.strictObject({});
export type RunSimulationArgs = z.infer<typeof RunSimulationInput>;

type Obj = Record<string, unknown>;

/** Spec 11: what changed since the previous run, by path, and the difference in the headline numbers (population-scaled, like stats). */
export function compareRuns(previous: PreviousRun, result: SimSuccess): RunCompare {
  const delta = (key: keyof RunCompare["stats_delta"]) => result.stats[key] - previous.stats[key];
  return {
    previous_run_id: previous.id,
    changed: changedPaths(previous.effectiveParams as unknown as Obj, result.effective_params as unknown as Obj),
    stats_delta: { peak_infections: delta("peak_infections"), peak_day: delta("peak_day"), total_infected: delta("total_infected"), total_deaths: delta("total_deaths") },
  };
}

/** Ported from epichat/agent.py run_simulation; the executor is the simulation service, which also answers the diagnostics of spec 10. */
export async function runSimulation(_input: RunSimulationArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome("Call configure_simulation first to establish the simulation before running.");
  const params = scenario.params;
  const popScale = scenario.totalPopulation && params.run.n_agents > 0 ? scenario.totalPopulation / params.run.n_agents : 1.0;
  const disease = scenario.disease ?? detectDisease(deps.contextText || "");
  // Read before this run is inserted, so it is never its own previous run; the first run has none to read.
  const previous = scenario.hasRun ? await deps.previousRun() : null;
  const result = await deps.sim.simulate(params, popScale, deps.contextText, disease);
  const warnings = [...paramWarnings(scenario, params, deps.contextText), ...runNotes(params)];
  const dataSources = [...scenario.dataSources];
  const runId = await deps.onRun({ params, popScale, result, warnings, dataSources });

  if (!result.ok) {
    const detail = result.kind === "timeout" ? `${result.detail} Fewer agents or a shorter duration usually fixes this.` : result.detail;
    let message = `SIMULATION ERROR: ${detail}`;
    if (result.repairs.length > 0) message += `\nRepair log: ${JSON.stringify(result.repairs, null, 1)}`;
    return errorOutcome(message);
  }

  scenario.hasRun = true;
  scenario.reportCurrent = false; // the report, if any, no longer covers this run
  const agents = result.stats_agents;
  const n = agents.n_agents || params.run.n_agents || 1;
  // Agent counts: the scaled total over the real population is the same ratio.
  const attack_rate_pct = pyRound((agents.total_infected / n) * 100, 1);
  const pop_scale = pyRound(popScale, 2);
  const sources = dataSources.map((f) => ({ field: f.field, value: f.value, citation: f.citation }));
  // The per-replicate stats travel; the per-day bands wait for the workspace follow-up that draws them.
  const replicates = result.replicates ? { n: result.replicates.n, seeds: result.replicates.seeds, representative: result.replicates.representative, stats: result.replicates.stats } : undefined;
  const diagnostics = result.diagnostics ?? [];
  const compare = previous ? compareRuns(previous, result) : null;
  const payload: RunPayload = {
    kind: "run",
    run_id: runId,
    stats: result.stats,
    stats_agents: agents,
    attack_rate_pct,
    pop_scale,
    population: result.population,
    effective_params: result.effective_params,
    warnings,
    repairs: result.repairs,
    data_sources: dataSources,
    duration_ms: result.duration_ms,
    cold_start: result.cold_start,
    series: result.series,
    diagnostics,
    compare,
    ...(replicates ? { replicates } : {}),
  };
  return {
    content: JSON.stringify({
      stats: result.stats, attack_rate_pct, pop_scale, effective_params: result.effective_params,
      warnings, repairs: result.repairs, data_sources: sources, diagnostics, compare, ...(replicates ? { replicates } : {}),
    }),
    payload,
  };
}
```

- [ ] **Step 9: The option matching in the configure tool**

In `web/lib/tools/configureSimulation.ts`, import `matchedLevers` from `./options` and replace the line `// Task 7 records a taken option here, from \`changed\` and the previous run's levers.` with:

```ts
  if (scenario.hasRun && changed.length > 0) {
    // Spec 11: a lever is taken when the applied patch carries every one of its paths with its value.
    const previous = await deps.previousRun();
    for (const match of matchedLevers(previous, changed)) deps.onOptionChosen(previous!.id, match.diagnosticId, match.patch);
  }
```

- [ ] **Step 10: The handler**

In `web/lib/chat/handleChat.ts`, replace the `onRun` member of `toolDeps` with:

```ts
    async onRun(record) {
      // A run is a fact: counted and inserted as soon as it finishes, whatever the turn does later.
      for (const repair of record.result.repairs) if (repair.usage) repairCost += repairCostUsd(repair.usage);
      if (record.result.ok) {
        step("run_completed", { tool: "run_simulation", meta: { duration_ms: record.result.duration_ms, cold_start: record.result.cold_start, n_agents: record.params.run.n_agents, sim_dur_years: record.params.run.sim_dur_years, repairs: record.result.repairs.length } });
      } else {
        step("run_failed", { tool: "run_simulation", meta: { kind: record.result.kind, repairs: record.result.repairs.length } });
      }
      let id: string | null = null;
      try {
        id = await deps.runs.insert({ conversationId, userId: user.id, turnId, scenarioId: scenario.id, record });
      } catch (error) {
        console.error("runs insert failed", failureText(error));
      }
      const shown = record.result.ok ? (record.result.diagnostics ?? []).map((d) => d.id) : [];
      if (shown.length > 0) step("diagnostic_shown", { tool: "run_simulation", meta: { run_id: id, ids: shown.join(",") } });
      return id;
    },
    async previousRun() {
      try {
        return await deps.runs.latest(conversationId, scenario.id, turnId);
      } catch (error) {
        console.error("runs read failed", failureText(error));
        return null;
      }
    },
    onOptionChosen(runId, diagnosticId, patch) {
      step("option_chosen", { tool: "configure_simulation", meta: { run_id: runId, diagnostic_id: diagnosticId, patch: JSON.stringify(patch) } });
    },
```

- [ ] **Step 11: Run the tests, the typecheck and the lint**

Run (from `web/`): `npx vitest run tests/tools tests/chat tests/client tests/db && npm run typecheck && npm run lint`
Expected: all pass (the prompt test's tool-name check still waits for Task 8).

- [ ] **Step 12: Commit**

```bash
git add web/lib/tools/options.ts web/lib/tools/types.ts web/lib/tools/runSimulation.ts web/lib/tools/configureSimulation.ts web/lib/chat/handleChat.ts web/tests/tools/helpers.ts web/tests/tools/runSimulation.test.ts web/tests/tools/configureSimulation.test.ts web/tests/chat/handleChat.test.ts
git commit -m "feat(web): run_simulation carries the diagnostics and the comparison with the previous run; diagnostic_shown and option_chosen are recorded"
```

---

### Task 8: The prompt's parameter and option guidance

**Files:**
- Modify: `web/lib/chat/prompt.ts` (`ADDITIONS`, after the `## Repairs` section)
- Test: `web/tests/chat/prompt.test.ts`

**Interfaces:**
- Consumes: the tool names `describe_parameters`, `configure_simulation` (its `advanced` field), `run_simulation` (its `diagnostics` and `compare`).
- Produces: two prompt sections, `## Parameters` and `## Diagnostics and options`; the prompt stays dateless and deterministic.

- [ ] **Step 1: Write the failing test**

Append to the `describe("system prompt")` block in `web/tests/chat/prompt.test.ts`:

```ts
  it("tells the assistant to use describe_parameters, the advanced patch, and the diagnostics' options", () => {
    expect(SYSTEM_PROMPT.indexOf("## Repairs")).toBeLessThan(SYSTEM_PROMPT.indexOf("## Parameters"));
    expect(SYSTEM_PROMPT.indexOf("## Parameters")).toBeLessThan(SYSTEM_PROMPT.indexOf("## Diagnostics and options"));
    for (const phrase of [
      "call describe_parameters rather than answering from memory",
      "Never say a parameter cannot be changed",
      "advanced patch by path",
      "at most three options",
      "keeps the configuration as it is",
      "what it changes, the suggested value, and its basis",
      "before interpreting the new run",
      "apply the lever's whole patch",
    ]) {
      expect(SYSTEM_PROMPT).toContain(phrase);
    }
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run (from `web/`): `npx vitest run tests/chat/prompt.test.ts`
Expected: the new test fails on `## Parameters` (index −1); the existing "keeps the phrases the Python tests pin" test fails on `describe_parameters` since Task 6.

- [ ] **Step 3: Add the two sections**

In `web/lib/chat/prompt.ts`, append to the `ADDITIONS` template string, after the `## Repairs` bullet:

```ts

## Parameters

- When the user asks what can be changed, which parameters exist, or what a parameter means, or when a diagnostic names a parameter, call describe_parameters rather than answering from memory: it lists every parameter of the current model with its bounds, unit, current value and where that value came from (the user, the database, a fetch, a default, or an illustrative assumption).
- Never say a parameter cannot be changed without checking describe_parameters. Anything it lists can be set: the common ones through configure_simulation's own fields, the rest through its advanced patch by path (for example {"disease.dur_inf.dist": "gamma", "disease.dur_inf.sd_days": 2.4}); a change that needs two paths together is one call.
- When you present options, say for each one what it changes, the suggested value, and its basis: the database range, the user's own input, or an illustrative assumption.

## Diagnostics and options

- run_simulation returns diagnostics: what the run's shape suggests about the configuration (an early fade-out, a peak that is only the seeding, a run that ended before the epidemic did, a fatality ratio outside the literature, and so on), each with levers: a patch of parameter paths with suggested values, the current values, and the basis. After interpreting the results, offer at most three options, from the highest-severity diagnostic first, and always one that keeps the configuration as it is. Put the options among the suggested replies, each naming the change in plain words ("Use a gamma infectious period (sd 2.4) and rerun"). When the user takes one, apply the lever's whole patch with configure_simulation (its fields where they exist, advanced for the other paths) and run again.
- run_simulation also returns compare when the scenario had an earlier run: the parameters that changed and the difference in peak, peak day, total infections and deaths. Report what changed and by how much before interpreting the new run.
```

(The `{"disease.dur_inf.dist": …}` example sits inside a template literal: braces need no escaping there; only backticks and `${` do, and the text has neither.)

- [ ] **Step 4: Run the prompt and tool tests**

Run (from `web/`): `npx vitest run tests/chat tests/tools`
Expected: PASS, including "keeps the phrases the Python tests pin" (every tool name is now in the prompt) and "is deterministic, dateless".

- [ ] **Step 5: Commit**

```bash
git add web/lib/chat/prompt.ts web/tests/chat/prompt.test.ts
git commit -m "feat(web): the prompt sends the model to describe_parameters and tells it how to offer a run's options"
```

---

### Task 9: Registry labels in the run panel and the report, the dead vaccine branch, and the owner's verification section

**Files:**
- Modify: `web/lib/client/format.ts:118-135` (`effectiveParameterRows`, `interventionLines`)
- Modify: `web/lib/report/compose.ts:133-138` (the effective-parameters table)
- Modify: `web/lib/tools/durations.ts:9` (one comment)
- Modify: `web/docs/DEPLOY.md` (new section 6i before section 7)
- Test: `web/tests/client/format.test.ts`, `web/tests/report/compose.test.ts`, `web/tests/app/deploy.test.ts`

**Interfaces:**
- Consumes: `specFor` (`web/lib/sim/registry.ts`).
- Produces: `effectiveParameterLabel(path): string` in `format.ts`; `effectiveParameterRows` returns `[label, value]` pairs; the report appendix's first column is the label. `RunsSection.tsx` needs no change: it renders whatever the first element is, and the labels are unique.

- [ ] **Step 1: Write the failing tests**

In `web/tests/client/format.test.ts`, replace the "effective parameter rows" test with:

```ts
describe("effective parameter rows", () => {
  it("lists the v2 paths a run used by their registry labels, skipping unset ones", () => {
    const rows = effectiveParameterRows(params({ disease_type: "seir", dur_exp: 11, rand_seed: 4 }));
    expect(rows).toContainEqual(["Model", "seir"]);
    expect(rows).toContainEqual(["Latent period (mean)", "11"]);
    expect(rows).toContainEqual(["Random seed", "4"]);
    expect(rows).toContainEqual(["Agents", "10,000"]);
    expect(rows.map(([k]) => k)).not.toContain("Immunity duration (mean)");
    expect(rows.map(([k]) => k)).not.toContain("disease.model");
    expect(effectiveParameterLabel("disease.p_death")).toBe("Case fatality ratio");
    expect(effectiveParameterLabel("not.a.path")).toBe("not.a.path");
  });
});
```

(import `effectiveParameterLabel` beside `effectiveParameterRows`.) In the intervention-lines test of the same file, add:

```ts
    expect(interventionLines(params({ interventions: [{ type: "vaccine", coverage: 0.8, start_day: 60 }] }))).toEqual(["Vaccination: 80% coverage from day 60"]);
    expect(interventionLines(params({ interventions: [{ type: "vaccine", coverage: 0.5, start_day: 0 }] }))).toEqual([]); // day 0 is initial immunity, never a line
```

In `web/tests/report/compose.test.ts`, change the appendix row expectation on line 63 to `expect(appendix.blocks[0].rows.find((r) => r[0] === "Agents")).toEqual(["Agents", "10,000", "10,000", "10,000"]);` and add `expect(appendix.blocks[0].rows.map((r) => r[0])).not.toContain("run.n_agents");`.

- [ ] **Step 2: Run them and watch them fail**

Run (from `web/`): `npx vitest run tests/client/format.test.ts tests/report/compose.test.ts`
Expected: the label expectations fail (rows are keyed by path); `effectiveParameterLabel` is not exported.

- [ ] **Step 3: Labels and the dead branch**

In `web/lib/client/format.ts`, import `specFor` from `@/lib/sim/registry`, and replace `effectiveParameterRows` and the vaccine line of `interventionLines`:

```ts
/** The registry's label for a v2 path, or the path itself for one the registry does not know. */
export function effectiveParameterLabel(path: string): string {
  return specFor(path)?.label ?? path;
}

export function effectiveParameterRows(p: SimParams): [string, string][] {
  const obj = p as unknown as Record<string, unknown>;
  return EFFECTIVE_PARAM_PATHS.flatMap((path) => {
    const value = getPath(obj, path);
    return value === null || value === undefined ? [] : [[effectiveParameterLabel(path), fmtValue(value)] as [string, string]];
  });
}
```

```ts
    // A day-0 vaccine is disease.initial_immune_frac after validation (spec 18), so a listed vaccine always has a start day.
    if (i.type === "vaccine") return `Vaccination: ${coverage} from day ${fmtValue(i.start_day)}`;
```

In `web/lib/report/compose.ts`, import `effectiveParameterLabel` from `@/lib/client/format` (beside the existing imports from it) and change the table's rows to `rows: present.map((path) => [effectiveParameterLabel(path), ...runs.map((run) => fmtValue(at(run, path) ?? null))])`.

In `web/lib/tools/durations.ts`, change the comment `Capped at the mean so the gamma stays valid (section 18).` to `Capped at the mean so the spread stays sensible (the schema allows up to twice the mean).`

- [ ] **Step 4: Run the tests**

Run (from `web/`): `npx vitest run tests/client tests/report tests/tools/durations.test.ts`
Expected: PASS.

- [ ] **Step 5: The owner's verification section**

In `web/docs/DEPLOY.md`, insert before `## 7. Simulation service (`sim/`)`:

```
## 6i. Parameters verification

Done after the sim-parameters phases 3 and 4 are pushed, with migration
0007 applied first (section 1.2). One browser; a phone is enough.

1. New conversation: "Model measles in Kenya for a year." Configure as
   usual, then ask "What can I change?": the activity shows a Parameter
   list call, and the reply names parameters with their current values and
   where each came from (database, default, …), not from memory.
2. "Use five replicates." The panel's Parameters section shows "Replicates:
   5" and the configured card's line carries `advanced`.
3. "Seed 3% of the population and run it." After the run the reply says
   the peak is the seeding itself and offers at most three options, one of
   them keeping things as they are. Press the option that reduces the
   seeds: the configure call that follows sets a seed count of 10, and the
   next run's reply reports what changed against the previous run (the
   seeds, the peak day) before interpreting.
4. In the SQL editor:

       select kind, tool, meta from step_events
       where kind in ('diagnostic_shown', 'option_chosen') order by at desc limit 5;
       select id, jsonb_array_length(diagnostics) from runs order by created_at desc limit 3;

   The first shows a `diagnostic_shown` row whose `ids` names
   `instant_peak` and an `option_chosen` row carrying the patch; the second
   shows the run rows with their diagnostics.
5. Open a conversation from before this deploy and say "run it again": the
   run completes and the reply reports what changed against that earlier
   run (nothing, or the seeds), then interprets.
```

If `web/tests/app/deploy.test.ts` pins the section headings, add `## 6i. Parameters verification` beside them.

- [ ] **Step 6: Run the whole web suite, the typecheck and the lint**

Run (from `web/`): `npx vitest run && npm run typecheck && npm run lint`
Expected: every test passes.

- [ ] **Step 7: Run the Python suites once more**

Run: `.venv/Scripts/python.exe -m pytest tests -q -x --ignore=tests/test_r0_calibration.py` then `sim/.venv/Scripts/python.exe -m pytest sim/tests -q`
Expected: all pass (the calibration file takes about 72 s and nothing here touches it; run it too if time allows).

- [ ] **Step 8: Commit**

```bash
git add web/lib/client/format.ts web/lib/report/compose.ts web/lib/tools/durations.ts web/docs/DEPLOY.md web/tests/client/format.test.ts web/tests/report/compose.test.ts web/tests/app/deploy.test.ts
git commit -m "feat(web): registry labels in the run panel and the report appendix; the owner's parameters verification"
```

---

## Self-review

**Spec coverage.** 9.1 core field names, `advanced` with its five checks, `changed`: Task 5. 9.2 `describe_parameters` with the value source and the database range: Task 6. 9.3 prompt additions: Task 8. 10 `diagnose` with the nine rules, the named thresholds and the clamping: Task 2; its `seeds` input: Task 1; run by the service after every successful run: Task 3. 11 diagnostics on the run payload and tool result, the options through the `next` block (17), the comparison, the `runs.diagnostics` column (migration 0007 per 17), the two step events: Tasks 4, 7, 8. 13 Python: diagnostics rules and the normal run (Task 2), service `diagnostics` on 200 (Task 3); TypeScript: `advanced` accepted and rejected, two-path patch, missing partner, applicability, exclusive seed fields (Task 5), `describe_parameters` with and without a scenario and the attribution (Task 6), `compare` from a fake previous run (Task 7). 15 no rendering: no component changes beyond the label text the run panel already shows. 19's carried minors: labels (Task 9), the clamp warning (Task 5), the cap pin (Task 3), the 422 (Task 3). The evals of phase 5 are not here.

**Placeholders.** None: every step carries its code or its exact edit.

**Type consistency.** `PathChange { path, from, to }` is defined once in `paths.ts` (Task 5) and used by `ConfigPayload.changed` (Task 5), `RunCompare.changed` and `matchedLevers` (Task 7). `Diagnostic`/`Lever` live in `client.ts` (Task 4) and are reused by `PreviousRun` (Task 4), `RunPayload` (Task 7) and the fixtures; their field names match the Python dataclasses (`id, severity, title, evidence, levers` and `patch, current, direction, rationale, basis`). `PreviousRun` is defined in `runs.ts` (Task 4) and consumed by `ToolDeps.previousRun`, `compareRuns` and `matchedLevers` (Task 7). `near` is defined in `sources.ts` (Task 6) and used by `options.ts` (Task 7). `SimClient.simulate`'s fourth argument (Task 4) is what `runSimulation` passes (Task 7) and what both test fakes record. The Python `stats["seeds"]` (Task 1) is what `realized_seeds` reads (Task 2) and `scale_stats` scales (Task 1).

**Review Focus.** 1 → Task 7's "records nothing for … a failed patch". 2 → Task 4's "reads a row without diagnostics as having none". 3 → Task 3's "diagnostics computed on the full series". 4 → Task 5's `"5"` and `2.5` cases. 5 → Task 6's "migrated v1 scenario with an unknown disease".

## After the merge (owner)

- Apply `web/supabase/migrations/0007_run_diagnostics.sql` in the SQL editor, twice, before pushing `main`.
- Push `main`; then section 6i of `web/docs/DEPLOY.md`.
