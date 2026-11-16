# The Pilot and the Measured R0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the measured R0 an unbiased estimate and the pilot that calibrates beta to it a clean first-generation experiment, so a run on the hybrid network (or with lasting contacts) carries the R0 that was configured.

**Architecture:** The estimator in `epichat/sim/outputs.py` counts, for each day-0 seed, the infections of its first infectious episode, weighted for the depletion of susceptibles. The pilot in `epichat/sim/calibrate.py` runs the scenario with a connector flag under which only the seeds transmit, and not on step 0, so a seed transmits on exactly the steps an ordinary case would and nothing else spreads. The seeds are sized to the target, and beta is corrected only beyond the measurement's own noise. A live run cannot be made sterile, so its displayed `r0_measured` drops the seeds' step-0 transmissions and is withheld when the population was exhausted while the seeds were infectious.

**Tech Stack:** Python 3.12, Starsim 3.7.2 (`ss.infection_log`, `rel_trans`), numpy, pandas; a type and a prompt sentence in the web app.

**Spec:** `docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md`, sections 5.6 (measured R0), 5.7 (calibration to the measured R0) and 5.8 (`r0_gap`), which this plan amends as shipped. It is a defect fix found while planning `docs/superpowers/specs/2026-10-13-limits-suggestions-parameters-design.md`, whose phases build on the pilot.

## The defect, measured on 2026-10-13

On the exact random network, where the configured R0 is the truth (20,000 agents, several random seeds):

| Case | Configured | Shipped `r0_measured` | Cause |
|---|---|---|---|
| SIR, 10-day infectious period | 2.5 | 2.60 | a day-0 seed transmits on one more step than an ordinary case |
| SIR, 4-day infectious period | 2.5 | 3.01 | the same, larger for a short period |
| SIR, 8-day period, 2% seeded | 12 | 5.87 | the seeds' descendants exhaust the population while the seeds are still infectious |
| SIS, 10-day period | 2.5 | 5.93 | a seed's later reinfections are counted |

What the shipped pilot then does to beta on the hybrid network (10,000 agents):

| Case | Target | Beta after the pilot, against the formula's |
|---|---|---|
| 10-day infectious period | 2.5 | +12% (about right, by errors that cancel) |
| 4-day infectious period (flu-like) | 1.5 | −9% (it should rise by about 18%) |
| 8-day period (measles-like) | 12 | +638% after three corrections |

The design below, tried as a throwaway on the same cases: 2.510 ± 0.021 for 2.5, 1.516 ± 0.033 for 1.5, 11.66 ± 0.47 for 12, 2.498 ± 0.057 for SIS; on the hybrid network 2.26, 1.29 and 8.16 at the formula's beta for targets 2.5, 1.5 and 12.

## Global Constraints

- Starsim stays pinned at 3.7.2; no requirement file changes; no new npm dependency (`npm --prefix web ci` only); no database migration.
- A run that is not a pilot is untouched: the connector's flag defaults to off, `build_sim`'s new argument defaults to off, and `tests/test_sim_parity.py` (captured on Starsim 3.3.2, never re-captured) passes unchanged.
- `stats.r0_calibration` keeps `target`, `measured` and `corrections` and gains `se` and `reached`; stored runs without the two new keys still read.
- Interpreters: the root `.venv/Scripts/python.exe` for `tests/` from the worktree root; the main checkout's `sim/.venv/Scripts/python.exe` for `sim/tests`; `npx vitest run` from `web/`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UL6ToyEthpP1X8yxArZE6g`. Never print a secret.

## Review Focus

1. **A run that is not a pilot.** Its dynamics must not change: the first-generation flag is off, no state is added, and the parity suite is the proof. Pinned by Task 2's parity run and by `test_a_run_that_is_not_a_pilot_spreads_past_the_seeds`.
2. **A pilot whose seeds infect nobody** (beta near zero): no division by zero, no correction, `measured` 0, `reached` false. Pinned by the existing `test_a_pilot_that_measures_nothing_stops_cleanly`, kept green.
3. **A correction that would break the joint rule** `network_beta × (1 − e^(−β/365)) ≤ 1` or pass the registry bound of beta: the loop stops with the last valid beta instead of raising. Pinned in Task 2.
4. **A correction that does not improve the measurement** (a network that cannot carry the target): the loop keeps the better beta and reports `reached: false`; it never multiplies beta three times on a measurement that does not move. Pinned in Task 2.
5. **A model with reinfection** (SIS, SIRS): a seed that is infected again must not have its second episode counted, in the pilot or in a live run. Pinned in Task 1.

---

## File Structure

- Modify `epichat/sim/outputs.py` (`Measurement`, `measure_r0`, `measured_r0`), `epichat/sim/connectors.py` (`first_generation`), `epichat/sim/builder.py` (`build_sim`'s argument), `epichat/sim/calibrate.py` (the seeds, the measurement, the loop).
- Modify `web/lib/sim/client.ts` (the type), `web/lib/chat/prompt.ts` (one sentence), `web/docs/DEPLOY.md` and `README.md` (one sentence each), the Part 2 spec (5.6, 5.7).
- Tests: `tests/test_sim_outputs.py`, `tests/test_sim_calibrate.py`, `tests/test_sim_connectors.py`, `web/tests/chat/prompt.test.ts`.

---

### Task 1: An estimator that measures R0

**Files:**
- Modify: `epichat/sim/outputs.py`
- Test: `tests/test_sim_outputs.py`

**Interfaces:**
- Produces: `Measurement(mean: float, se: float, seeds: int, weight: float)` (a frozen dataclass); `measure_r0(sim, count_day0: bool) -> Measurement | None`; `measured_r0(sim) -> float | None` (unchanged signature); `MEASURED_MAX_WEIGHT = 1.25`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_sim_outputs.py`, replace `test_measured_r0_counts_the_seeds_secondary_infections` with the tests below (the two cases it also covered, seeds that infect nobody and no day-0 seeds, move into the last one), and keep `test_measured_r0_is_unknown_on_the_age_structured_network` as it is:

```python
def _live(model: str, target: float, dur: dict, seeds: int, n: int = 20000, days: int = 60, seed: int = 1):
    from epichat.params.r0 import with_r0
    p = with_r0(SimParamsV2.model_validate({"disease": {"model": model, "dur_inf": dur, "seed": {"mode": "count", "value": seeds}},
                                            "run": {"n_agents": n, "sim_dur_years": days / 365, "rand_seed": seed}}), target)
    sim = build_sim(p, seed=seed)
    sim.run()
    return sim


def test_the_measured_r0_is_unbiased_for_a_short_infectious_period():
    # a day-0 seed transmits on one more step than an ordinary case: with a 4-day period the raw count read 20% high
    from epichat.sim.outputs import measured_r0
    values = [measured_r0(_live("sir", 1.5, {"mean_days": 4.0, "dist": "gamma", "sd_days": 1.5}, 300, seed=s)) for s in (1, 2, 3)]
    assert abs(sum(values) / 3 - 1.5) / 1.5 < 0.06


def test_the_measured_r0_counts_only_a_seeds_first_episode():
    # in sis a seed recovers and is infected again; the infections of its later episodes are not its reproduction number
    from epichat.sim.outputs import measured_r0
    values = [measured_r0(_live("sis", 2.5, {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}, 100, days=40, seed=s)) for s in (1, 2, 3)]
    assert all(v is not None for v in values) and abs(sum(values) / 3 - 2.5) / 2.5 < 0.10


def test_the_measured_r0_is_withheld_when_the_seeds_exhaust_the_population():
    # 2% seeded at R0 12: the seeds' descendants infect everyone while the seeds are still infectious; the raw count read 5.9
    from epichat.sim.outputs import measure_r0, measured_r0, MEASURED_MAX_WEIGHT
    sim = _live("sir", 12.0, {"mean_days": 8.0, "dist": "gamma", "sd_days": 3.0}, 200, n=10000, days=40)
    assert measured_r0(sim) is None and measure_r0(sim, count_day0=False).weight > MEASURED_MAX_WEIGHT


def test_a_measurement_carries_its_standard_error_and_the_edge_cases_hold():
    from epichat.sim.outputs import measure_r0, measured_r0
    m = measure_r0(_live("sir", 2.5, {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}, 100), count_day0=False)
    assert m.seeds == 100 and 0 < m.se < 0.5 and 1.0 <= m.weight < 1.25 and abs(m.mean - 2.5) < 4 * m.se + 0.15
    quiet = SimParamsV2.model_validate({"disease": {"beta": 0.001, "seed": {"mode": "count", "value": 20}}, "run": {"n_agents": 2000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(quiet)
    sim.run()
    assert measured_r0(sim) == 0.0 and measure_r0(sim, count_day0=False).se == 0.0             # seeds, but they infected nobody
    assert extract(sim, 2000, sim.seeds_day0, False)["stats"]["r0_measured"] == 0.0
    later = SimParamsV2.model_validate({"disease": {"seed": {"mode": "count", "value": 20, "day": 5}}, "run": {"n_agents": 2000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(later)
    sim.run()
    assert measured_r0(sim) is None and measure_r0(sim, count_day0=False) is None             # no day-0 seeds
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_outputs.py -q -p no:cacheprovider -k "measured or measurement"`
Expected: FAIL, the first on the 6% assertion (the shipped estimator reads about 20% high), the others on `ImportError: cannot import name 'measure_r0'`.

- [ ] **Step 3: Implement**

In `epichat/sim/outputs.py` (add `import math` and `from dataclasses import dataclass`):

```python
MEASURED_MAX_WEIGHT = 1.25       # a live run's seeds were no longer in a susceptible population above this mean depletion weight


@dataclass(frozen=True)
class Measurement:
    mean: float          # infections per seed, depletion-weighted
    se: float            # the standard error of that mean over the seeds
    seeds: int
    weight: float        # the mean of alive / susceptible over the infections counted; 1.0 when none were


def measure_r0(sim: ss.Sim, count_day0: bool) -> Measurement | None:
    """Part 2, 5.6 as amended: for each day-0 seed, the infections it caused in its first infectious episode (before it was infected
    again), each weighted by alive / susceptible at the step before, which corrects the depletion of susceptibles to first order.
    count_day0 False leaves out what the seeds transmitted on step 0: a seed is infectious from step 0, an ordinary case from the step
    after its infection, so a seed transmits on one more step. True counts everything (the pilot keeps its seeds quiet on step 0).
    None without day-0 seeds or on a network that records no per-agent sources (the age-structured MixingPools)."""
    log = infection_log(sim)
    if log is None or len(log) == 0:
        return None
    df = log.to_df()
    source = pd.to_numeric(df["source"], errors="coerce").to_numpy(dtype=float)
    t = np.array([float(getattr(x, "value", x)) for x in df["t"]])        # the log stores TimePars (days) on the numeric day axis
    targets = df["target"].to_numpy()
    seeded = (t == 0) & (np.isnan(source) | (source < 0))
    seeds = np.sort(targets[seeded].astype(np.int64))
    if len(seeds) == 0:
        return None
    later = ~seeded
    if later.any() and not (source[later] >= 0).any():
        return None                     # the network records no per-agent sources (ss.MixingPools writes -999999): unknown, not zero
    again = np.full(len(seeds), np.inf)                                    # the step each seed was infected again, if it was
    hit = later & np.isin(targets, seeds)
    np.minimum.at(again, np.searchsorted(seeds, targets[hit].astype(np.int64)), t[hit])
    by_seed = later & np.isin(source, seeds) & (t >= (0 if count_day0 else 1))
    index = np.searchsorted(seeds, source[by_seed].astype(np.int64))
    first = t[by_seed] < again[index]
    index, when = index[first], np.maximum(t[by_seed][first].astype(int) - 1, 0)
    name = list(sim.diseases.keys())[0]
    susceptible = np.asarray(sim.results[name]["n_susceptible"].values, dtype=float)
    alive = np.asarray(sim.results["n_alive"].values, dtype=float)
    weights = alive[when] / np.maximum(susceptible[when], 1.0)
    per_seed = np.bincount(index, weights=weights, minlength=len(seeds))
    se = float(per_seed.std(ddof=1) / math.sqrt(len(seeds))) if len(seeds) > 1 else 0.0
    return Measurement(float(per_seed.mean()), se, int(len(seeds)), float(weights.mean()) if len(weights) else 1.0)


def measured_r0(sim: ss.Sim) -> float | None:
    """The R0 a live run shows: measure_r0 without the seeds' step-0 transmissions, withheld (None) when the population was already
    depleted while the seeds were infectious (too many seeds for the R0), where no weighting recovers what the seeds would have done."""
    m = measure_r0(sim, count_day0=False)
    if m is None or m.weight > MEASURED_MAX_WEIGHT:
        return None
    return m.mean
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_outputs.py -q -p no:cacheprovider`
Expected: all pass. If a tolerance fails on real data, do not widen it blindly: print the three values, decide whether the estimator or the test's scenario is at fault, and ledger the ruling.

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/outputs.py tests/test_sim_outputs.py
git commit -m "fix(sim): the measured R0 counts a seed's first episode, without its extra first step, weighted for depletion"
```

---

### Task 2: A pilot that is a first-generation experiment

**Files:**
- Modify: `epichat/sim/connectors.py`, `epichat/sim/builder.py` (`build_sim`), `epichat/sim/calibrate.py`
- Test: `tests/test_sim_connectors.py`, `tests/test_sim_calibrate.py`

**Interfaces:**
- Consumes: `measure_r0`, `Measurement` (Task 1).
- Produces: `TransmissionModifiers(..., first_generation: bool = False)`; `build_sim(params, seed=None, first_generation=False)`; `calibrate.pilot_seeds(p, target) -> int`; `calibrate.measure(p, seed) -> Measurement | None`; `calibrate_by_measurement` returning `{target, measured, se, corrections, reached}`; constants `PILOT_DIRECT_SHARE = 0.05`, `NOISE_SIGMAS = 1`, `MAX_STEP = 2.0`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_sim_connectors.py`:

```python
def test_in_a_first_generation_run_only_the_seeds_transmit_and_not_on_step_zero():
    import pandas as pd
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    from epichat.sim.outputs import infection_log
    p = SimParamsV2.model_validate({"disease": {"beta": 60.0, "seed": {"mode": "count", "value": 30}}, "run": {"n_agents": 3000, "sim_dur_years": 40 / 365, "rand_seed": 1}})
    sim = build_sim(p, first_generation=True)
    sim.run()
    df = infection_log(sim).to_df()
    source = pd.to_numeric(df["source"], errors="coerce").to_numpy(dtype=float)
    t = np.array([float(getattr(x, "value", x)) for x in df["t"]])
    seeds = df["target"].to_numpy()[(t == 0) & ~(source >= 0)]
    caused = source >= 0
    assert len(seeds) == 30 and caused.sum() > 30                           # the seeds did infect
    assert np.isin(source[caused], seeds).all()                             # and nobody else did
    assert not (caused & (t == 0)).any()                                    # nothing on step 0


def test_a_run_that_is_not_a_pilot_spreads_past_the_seeds():
    import pandas as pd
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    from epichat.sim.outputs import infection_log
    p = SimParamsV2.model_validate({"disease": {"beta": 60.0, "seed": {"mode": "count", "value": 30}}, "run": {"n_agents": 3000, "sim_dur_years": 40 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    df = infection_log(sim).to_df()
    source = pd.to_numeric(df["source"], errors="coerce").to_numpy(dtype=float)
    t = np.array([float(getattr(x, "value", x)) for x in df["t"]])
    seeds = df["target"].to_numpy()[(t == 0) & ~(source >= 0)]
    assert not np.isin(source[source >= 0], seeds).all() and ((source >= 0) & (t == 0)).any()
```

In `tests/test_sim_calibrate.py`:

(a) In `test_pilot_params_are_short_bare_and_well_seeded`, after the last line add:

```python
    measles = r0.with_r0(SimParamsV2.model_validate({"disease": {"dur_inf": {"mean_days": 8.0, "dist": "gamma", "sd_days": 3.0}},
                                                     "run": {"n_agents": 10000, "rand_seed": 1}}), 12.0)
    assert calibrate.pilot_params(measles, 1).disease.seed.value == 42          # 5% of the agents over the target: the seeds stay few at a high R0
```

(b) Replace `test_hybrid_calibration_lands_within_five_percent_in_at_most_three_corrections` with:

```python
def test_hybrid_calibration_reaches_the_target_within_its_noise_in_at_most_three_corrections():
    p = hybrid(50_000, 2.5)
    calibrated, info = calibrate.calibrate_by_measurement(p, 1)
    assert info["target"] == pytest.approx(2.5, abs=1e-3) and info["corrections"] <= calibrate.MAX_CORRECTIONS and info["reached"] is True
    assert abs(info["measured"] - 2.5) <= max(calibrate.TOLERANCE * 2.5, calibrate.NOISE_SIGMAS * info["se"])
    fresh = calibrate.measure(calibrated, 2)                                     # another random seed, the same sterile experiment
    assert abs(fresh.mean - 2.5) / 2.5 < 0.10
```

(c) In `test_run_replicates_reports_the_calibration_and_the_corrected_beta` change the key set to `{"target", "measured", "se", "corrections", "reached"}`.

(d) Append:

```python
def _plain(target: float, dur: dict, n: int = 20000) -> SimParamsV2:
    return r0.with_r0(SimParamsV2.model_validate({"disease": {"dur_inf": dur, "p_death": 0.0}, "run": {"n_agents": n, "rand_seed": 1}}), target)


def test_the_pilot_measures_the_configured_r0_where_it_is_known():
    # the random network's formula is exact, so the sterile first-generation experiment must return it, at a low and at a high R0
    ten = [calibrate.measure(_plain(2.5, {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}), s).mean for s in (1, 2, 3)]
    assert abs(sum(ten) / 3 - 2.5) / 2.5 < 0.04
    high = [calibrate.measure(_plain(12.0, {"mean_days": 8.0, "dist": "gamma", "sd_days": 3.0}, n=10000), s).mean for s in (1, 2, 3)]
    assert abs(sum(high) / 3 - 12.0) / 12.0 < 0.10                              # the shipped pilot read 5.9 here


def test_a_short_infectious_period_on_the_hybrid_network_raises_beta():
    # flu-like: the shipped pilot lowered beta by 9% (its seeds' extra first step); the layers' saturation needs it raised
    body = hybrid(10_000, 1.5).model_dump()
    body["disease"]["dur_inf"] = {"mean_days": 4.0, "dist": "gamma", "sd_days": 1.5}
    p = r0.with_r0(SimParamsV2.model_validate(body), 1.5)
    calibrated, info = calibrate.calibrate_by_measurement(p, 1)
    assert calibrated.disease.beta > p.disease.beta * 1.05 and info["corrections"] >= 1
    assert abs(calibrate.measure(calibrated, 2).mean - 1.5) / 1.5 < 0.12


def test_a_high_r0_on_the_hybrid_network_is_corrected_not_exploded():
    # measles-like: the shipped pilot multiplied beta by 7.4 on a measurement that could not move
    body = hybrid(10_000, 2.5).model_dump()
    body["disease"]["dur_inf"] = {"mean_days": 8.0, "dist": "gamma", "sd_days": 3.0}
    p = r0.with_r0(SimParamsV2.model_validate(body), 12.0)
    calibrated, info = calibrate.calibrate_by_measurement(p, 1)
    assert 1.2 < calibrated.disease.beta / p.disease.beta < 3.0 and info["reached"] is True


def test_a_correction_stops_at_a_bound_or_when_it_does_not_help(monkeypatch):
    from epichat.sim.outputs import Measurement
    p = hybrid(2000, 2.5)
    # a network that cannot carry the target: the measurement never moves, whatever beta is
    monkeypatch.setattr(calibrate, "measure", lambda q, seed: Measurement(1.0, 0.01, 40, 1.0))
    stuck, info = calibrate.calibrate_by_measurement(p, 1)
    assert stuck.disease.beta == p.disease.beta and info["corrections"] == 0 and info["reached"] is False and info["measured"] == 1.0
    # a correction that would break network_beta × (1 − e^(−β/365)) ≤ 1 is not taken
    body = p.model_dump()
    body["network"]["network_beta"] = 10.0
    body["disease"]["beta"] = 38.0                                               # 10 × (1 − e^(−38/365)) = 0.99
    tight = SimParamsV2.model_validate(body)
    monkeypatch.setattr(calibrate, "measure", lambda q, seed: Measurement(approx := 0.5 * r0.approx_r0(tight), 0.01, 40, 1.0))
    held, info = calibrate.calibrate_by_measurement(tight, 1)
    assert held.disease.beta == tight.disease.beta and info["reached"] is False
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_connectors.py tests/test_sim_calibrate.py -q -p no:cacheprovider`
Expected: FAIL on `build_sim() got an unexpected keyword argument 'first_generation'`, on the seed count 42, on the `se` and `reached` keys, and on `calibrate.measure(...).mean` (the shipped `measure` returns a float).

- [ ] **Step 3: Implement**

`epichat/sim/connectors.py`: the constructor gains `first_generation: bool = False`, stored as `self.first_generation`, with `self.seed_uids = None`; `step` becomes:

```python
    def step(self):
        disease = self.sim.diseases[self.disease_name]
        factor = self.factor()
        disease.rel_trans[:] = np.asarray(disease.rel_trans_base) * np.asarray(disease.treatment_factor) * factor
        self.factors.append(factor)
        if self.first_generation:
            # The R0 pilot (Part 2, 5.7 as amended): only the day-0 seeds transmit, and not on step 0, so each transmits on exactly the
            # steps an ordinary case would and nothing spreads beyond their own infections.
            if self.seed_uids is None:
                self.seed_uids = np.array(disease.infected.uids, copy=True)
                disease.rel_trans[:] = 0.0
            else:
                others = np.ones(len(disease.rel_trans.raw), dtype=bool)
                others[self.seed_uids] = False
                disease.rel_trans.raw[others] = 0.0
```

Extend the module docstring with one sentence saying so.

`epichat/sim/builder.py`: `def build_sim(params, seed: int | None = None, first_generation: bool = False) -> ss.Sim:` and pass `first_generation=first_generation` to `TransmissionModifiers(...)`.

`epichat/sim/calibrate.py` (replace the constants, `pilot_params`, `measure` and `calibrate_by_measurement`; rewrite the module docstring to describe the sterile experiment, the seeds and the noise rule):

```python
from pydantic import ValidationError

from .outputs import Measurement, measure_r0

PILOT_SEEDS = 300
PILOT_SEED_FLOOR = 20
PILOT_DIRECT_SHARE = 0.05       # the seeds' expected direct infections as a share of the agents: few enough to stay in a susceptible population
PILOT_WINDOW_MULTIPLE = 4
TOLERANCE = 0.05
NOISE_SIGMAS = 1                # no correction within this many standard errors of the measurement
MAX_STEP = 2.0                  # one correction multiplies beta by at most this, or divides it
MAX_CORRECTIONS = 3


def pilot_seeds(p: SimParamsV2, target: float) -> int:
    wanted = round(PILOT_DIRECT_SHARE * p.run.n_agents / max(target, 1.0))
    return int(min(p.run.n_agents, max(PILOT_SEED_FLOOR, min(PILOT_SEEDS, wanted))))


def pilot_params(p: SimParamsV2, seed: int) -> SimParamsV2:
    d = p.disease
    window = PILOT_WINDOW_MULTIPLE * (d.dur_inf.mean_days + (d.dur_exp.mean_days if d.dur_exp is not None else 0.0))
    days = max(1, min(sim_days(p.run.sim_dur_years), math.ceil(window)))
    body = p.model_dump()
    body["disease"].update(seed={"mode": "count", "value": pilot_seeds(p, approx_r0(p)), "day": 0}, initial_immune_frac=0.0)
    body["interventions"] = []
    body["run"].update(sim_dur_years=days / 365, n_replicates=1, rand_seed=seed, calibrate_r0=False, fit=None)
    return SimParamsV2.model_validate(body)


def measure(p: SimParamsV2, seed: int) -> Measurement | None:
    sim = build_sim(pilot_params(p, seed), seed=seed, first_generation=True)
    sim.run()
    return measure_r0(sim, count_day0=True)


def _off(m: Measurement, target: float) -> bool:
    return abs(m.mean - target) > max(TOLERANCE * target, NOISE_SIGMAS * m.se)


def calibrate_by_measurement(p: SimParamsV2, seed: int) -> tuple[SimParamsV2, dict | None]:
    """The parameters to run (beta corrected when a pilot ran) and {target, measured, se, corrections, reached}, or (p, None) with no
    pilot. A correction is kept only when it brings the measurement nearer the target; it never leaves the registry's bounds or the
    joint rule of network_beta and beta."""
    if not needs_calibration(p):
        return p, None
    target = approx_r0(p)
    if target <= 0:
        return p, None
    current, m, corrections = p, measure(p, seed), 0
    while m is not None and m.mean > 0 and corrections < MAX_CORRECTIONS and _off(m, target):
        beta = clamp_beta(current.disease.beta * min(MAX_STEP, max(1.0 / MAX_STEP, target / m.mean)))
        if beta == current.disease.beta:
            break                                                    # at the registry's bound
        body = current.model_dump()
        body["disease"]["beta"] = beta
        try:
            trial = SimParamsV2.model_validate(body)
        except ValidationError:
            break                                                    # the joint rule: this network cannot take more
        tried = measure(trial, seed)
        if tried is None or abs(tried.mean - target) >= abs(m.mean - target):
            break                                                    # no nearer: keep the better beta
        current, m, corrections = trial, tried, corrections + 1
    return current, {"target": round(target, 4), "measured": None if m is None else round(m.mean, 4),
                     "se": None if m is None else round(m.se, 4), "corrections": corrections,
                     "reached": bool(m is not None and m.mean > 0 and not _off(m, target))}
```

(`fit=None` in the pilot's run block: a pilot never fits; today the dump carries the fit along harmlessly, and the phases that follow let a fit run after the pilot.)

- [ ] **Step 4: Run the tests and watch them pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_sim_connectors.py tests/test_sim_calibrate.py tests/test_sim_outputs.py tests/test_sim_parity.py tests/test_sim_replicates.py tests/test_sim_fit.py tests/test_sim_diagnostics.py -q -p no:cacheprovider`
Expected: all pass; the parity suite unchanged. A tolerance that fails on real data is examined (print the values) and ruled on in the ledger, not widened silently.

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/connectors.py epichat/sim/builder.py epichat/sim/calibrate.py tests/test_sim_connectors.py tests/test_sim_calibrate.py
git commit -m "fix(sim): the R0 pilot is a first-generation experiment with seeds sized to the target and corrections beyond its noise"
```

---

### Task 3: The web's type and sentence, the documents as shipped, the full suites

**Files:**
- Modify: `web/lib/sim/client.ts`, `web/lib/chat/prompt.ts`, `web/docs/DEPLOY.md`, `README.md`, `docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md` (5.6, 5.7)
- Test: `web/tests/chat/prompt.test.ts`

- [ ] **Step 1: Write the failing test** — in `web/tests/chat/prompt.test.ts`, in the test that lists the "Contact networks" phrases, add `"reached"` and `"could not be brought"` to the phrases expected in `SYSTEM_PROMPT`.

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run tests/chat/prompt.test.ts` from `web/`; expected: FAIL on `reached`.

- [ ] **Step 3: Implement**

- `web/lib/sim/client.ts`: `r0_calibration?: { target: number; measured: number | null; corrections: number; se?: number | null; reached?: boolean } | null`.
- `web/lib/chat/prompt.ts`, in the "Contact networks" bullet about the pilot, after the sentence about `stats.r0_calibration`, add: "The pilot lets only its seeds transmit and counts their infections. When stats.r0_calibration.reached is false the network could not be brought to the R0 you set: say so, and give the measured value instead of the configured one. A run's r0_measured is null when so many were seeded that the population was exhausted while the seeds were still infectious; that is expected at a high R0 with the default seeding."
- `README.md`, the Networks bullet: replace "(the day-0 seeds' mean secondary infections; null on the age-structured network," with "(the infections a day-0 seed causes in its first infectious period, corrected for depletion; null on the age-structured network," and keep the rest of the sentence.
- `web/docs/DEPLOY.md`, section 6j step 6: after "mixing pools do not log the source" add ", or on a run seeded so heavily that the population was exhausted while the seeds were infectious".
- The Part 2 spec, 5.6: replace the definition of the measured R0 with the amended one (first episode; without the seeds' step-0 transmissions in a live run; depletion weights; withheld above a mean weight of 1.25). 5.7: the pilot is a first-generation experiment (only the seeds transmit, and not on step 0); the seeds are `clamp(5% of the agents / target, 20, 300)`; a correction is taken only beyond `max(5%, one standard error)`, multiplies beta by at most 2, is kept only when it brings the measurement nearer, and never leaves the registry bound or the joint rule; `stats.r0_calibration` carries `se` and `reached`. Add the two tables of this plan's "The defect" section as the reason.

- [ ] **Step 4: Run everything**

`.venv/Scripts/python.exe -m pytest tests -q -p no:cacheprovider --ignore=tests/test_r0_calibration.py`, then `tests/test_r0_calibration.py` on its own, `sim/tests` with the service interpreter, and from `web/`: `npx vitest run`, `npm run typecheck`, `npm run lint`. Expected: all green; the ledger gets each count. Run the Python suites one at a time: the machine is short of memory when two run together.

- [ ] **Step 5: Commit**

```bash
git add web/lib/sim/client.ts web/lib/chat/prompt.ts web/tests/chat/prompt.test.ts web/docs/DEPLOY.md README.md docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md
git commit -m "docs: the measured R0 and the pilot as shipped; the agent says when a network could not carry the R0"
```

---

## Self-review

**Spec coverage.** 5.6 (the measured R0): Task 1, amended in Task 3. 5.7 (the pilot): Task 2, amended in Task 3. 5.8 (`r0_gap`) reads `r0_measured` and the calibration's target as before; it needs no change, and its false alarms at short infectious periods go with the bias.

**Placeholders.** None: every step carries its code or its exact sentence.

**Type consistency.** `Measurement` (Task 1) is what `calibrate.measure` returns and what Task 2's monkeypatched tests construct. `build_sim(..., first_generation=...)` (Task 2) is what `calibrate.measure` and the connector test call. The five keys of `stats.r0_calibration` (Task 2) are the web type's (Task 3).

**Review Focus.** 1 → the parity run and `test_a_run_that_is_not_a_pilot_spreads_past_the_seeds`. 2 → `test_a_pilot_that_measures_nothing_stops_cleanly`. 3 and 4 → `test_a_correction_stops_at_a_bound_or_when_it_does_not_help`. 5 → `test_the_measured_r0_counts_only_a_seeds_first_episode`.

## After the merge (owner)

- No migration. Push `main`: every hybrid-network run, and every run with lasting contacts, is calibrated differently from before; a flu-like scenario on the hybrid network spreads more than it did, a measles-like one far less explosively.
- Known and not addressed here: on the random network the SEIR formula reads about 5% above a direct first-generation measurement (2.37 for a configured 2.5).
