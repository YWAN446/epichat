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
from epichat.params.indicators import has_vaccine_indicator
from epichat.params.r0 import R0Unreachable, age_shares, approx_r0, calibrate_beta, clamp_beta, r0_is_approximate, weighted_cfr
from epichat.params.registry import DEATH_MODELS, REGISTRY_BY_PATH, WANING_MODELS
from epichat.params.schema_v2 import SimParamsV2

Severity = Literal["info", "warning"]
Direction = Literal["increase", "decrease", "change"]
Basis = Literal["disease_db", "rule", "user"]

# Section 10's thresholds; starting points, tuned from pilot data.
FADEOUT_SEED_MULTIPLE = 2            # early_fadeout and the faded-out share: total_infected < max(2 × seeds, ANCHOR_SHARE × agents)
FADEOUT_SEED_FACTOR = 5              # suggested seeds: max(5 × seeds, 10), at most n_agents
FADEOUT_SEED_FLOOR = 10
FADEOUT_REPLICATES = 5
INSTANT_PEAK_DAY = 3
INSTANT_PEAK_SEED_SHARE = 0.02       # forty times the 0.05% default; above the realized noise of a 1% seeding
INSTANT_PEAK_SEEDS = 10
UNFINISHED_TAIL_SHARE = 0.05         # n_infectious[-1] >= 0.05 × peak
UNFINISHED_WINDOW_SHARE = 0.1        # the last ceil(0.1 T) days against the ceil(0.1 T) before them
FINAL_SIZE_GAP = 0.15
SHARP_CURVE_WIDTH_MULTIPLE = 2       # days at or above half the peak below 2 × dur_inf.mean_days
ILLUSTRATIVE_SD_SHARE = 0.3          # spec 7.3: 0.3 × mean without a database range
FATALITY_ASYMP_SHARE = 0.2
HIGH_VARIANCE_SPREAD = 0.5
R0_RECHECK_TOLERANCE = 0.1           # a configured R0 within 10% of the database typical needs no recheck
WELL_MIXED_R_EFF = 2.0               # Part 2, 5.8
WELL_MIXED_ATTACK_RATE = 0.7
WELL_MIXED_CV = 1.0                  # follow-up spec 7.6: the variation it offers (illustrative)
R0_GAP = 0.25
R0_GAP_SIGMAS = 3                    # the gap must exceed three standard errors of the measured mean when the seeds are few
# Follow-up spec 7.2: the interventions what_if offers. Every size is illustrative until the database carries it.
ANCHOR_SHARE = 0.01                  # the windows start the day the cumulative infections reached this share of the agents
WHAT_IF_MIN_ATTACK = 0.05            # no offer after a run that had no epidemic
WHAT_IF_MAX_LEVERS = 4
LABEL_MAX = 80                       # a lever's label is a complete reply of at most this many characters
CAMPAIGN_COVERAGE = 0.7
CAMPAIGN_DAYS = 30
CAMPAIGN_EFFICACY = 0.9              # when the database carries no vaccine efficacy
CLOSURE_DAYS = 42                    # schools closed for six weeks
DISTANCING_SCALE = 0.3
DISTANCING_DAYS = 56                 # eight weeks
MASKS_SCALE = 0.2
MASKS_DAYS = 90
RESPONSE_SCALE = 0.5
DAYS_PER_UNIT = {"days": 1.0, "weeks": 7.0, "months": 30.44, "years": 365.25}
SIMPLE_MODELS = ("sir", "seir", "seiar")


@dataclass
class Lever:
    patch: dict[str, Any]        # registry paths -> suggested values, applied together
    current: dict[str, Any]
    direction: Direction
    rationale: str
    basis: Basis                 # disease_db values cite the field; rule values are illustrative
    # Follow-up spec 7.1: a lever may also carry intervention entries (applied with configure_simulation's interventions field)
    # and a label, a complete reply of at most LABEL_MAX characters for the button and the suggested reply.
    interventions: list[dict[str, Any]] = field(default_factory=list)
    label: str | None = None


@dataclass
class Diagnostic:
    id: str
    severity: Severity
    title: str
    evidence: dict[str, Any]     # the numbers that triggered it, in agent units
    levers: list[Lever] = field(default_factory=list)


def final_size(r: float, cv: float = 0.0) -> float:
    """The share of susceptibles an epidemic reaches: z = 1 − exp(−r z), or with gamma-distributed susceptibility of coefficient
    of variation cv (follow-up spec 4.4) z = 1 − (1 + cv² r z)^(−1/cv²); 0 at or below R 1."""
    if r <= 1:
        return 0.0
    v = cv * cv
    z = 0.99
    for _ in range(400):
        z = 1 - math.exp(-r * z) if v <= 0 else 1 - (1 + v * r * z) ** (-1 / v)
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
        calibration = self.stats.get("r0_calibration")
        # a calibrated run's beta is no longer the formula's, so its R0 is the calibration's target, not the formula on what ran
        self.r0 = float(calibration["target"]) if calibration and calibration.get("target") else approx_r0(p)
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


def _faded_out(total: float, seeds: int, n: int) -> bool:
    """The outbreak ended below twice its seeds or before ANCHOR_SHARE of the agents (the day it would have been noticed), whichever
    is larger: with the default seeding of 0.05% a handful of seeds can infect a few dozen and die out, which the seed rule alone misses."""
    return total < max(FADEOUT_SEED_MULTIPLE * seeds, ANCHOR_SHARE * n)


def _early_fadeout(run: _Run) -> Diagnostic | None:
    if not run.days or run.infectious[-1] != 0:
        return None
    nobody = run.seeds == 0 and run.total == 0          # a fraction seeding is a draw per agent: 0.05% of 10,000 gives nobody in 0.7% of runs
    if not nobody and not (run.r_eff > 1 and _faded_out(run.total, run.seeds, run.n)):
        return None
    p = run.params
    seeds_to = min(max(FADEOUT_SEED_FACTOR * run.seeds, FADEOUT_SEED_FLOOR), p.run.n_agents)
    why = (f"The seeding infected nobody: {p.disease.seed.value:g} ({p.disease.seed.mode}) reached no agent of the {p.run.n_agents}; "
           f"seed {seeds_to} agents instead." if nobody else f"More seeds make an early fade-out less likely: {seeds_to} instead of {run.seeds}.")
    levers = [
        Lever({"disease.seed.mode": "count", "disease.seed.value": seeds_to},
              {"disease.seed.mode": p.disease.seed.mode, "disease.seed.value": p.disease.seed.value}, "increase", why, "rule"),
        Lever({"run.n_replicates": FADEOUT_REPLICATES}, {"run.n_replicates": p.run.n_replicates}, "increase",
              "Several replicates show how often the outbreak takes off at all.", "rule"),
    ]
    recheck = _r0_recheck(run)
    if recheck:
        levers.append(recheck)
    return Diagnostic("early_fadeout", "warning", "The seeding infected nobody" if nobody else "The outbreak died out early",
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
    if not run.simple or unfinished or not run.n or run.stats.get("fit"):       # a fitted run's size is the user's, not the R0's (7.7)
        return None
    susceptible = 1 - run.params.disease.initial_immune_frac
    z = final_size(run.r_eff, run.params.disease.rel_sus_cv)            # the share of the susceptibles the epidemic reaches
    expected = susceptible * z           # the attack rate over everyone (section 19)
    attack = run.total / run.n
    if abs(attack - expected) <= FINAL_SIZE_GAP:
        return None
    recheck = _r0_recheck(run)
    return Diagnostic("final_size_gap", "info", "The attack rate does not match the configured R0",
                      {"attack_rate": round(attack, 3), "expected_attack_rate": round(expected, 3), "susceptible_share": round(susceptible, 3),
                       "r_eff": round(run.r_eff, 2)},
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
    cfr = weighted_cfr(run.params)                 # the population-weighted ratio when a group has its own fatality (Part 2, 4.5)
    if not rng or rng[0] <= cfr <= rng[1]:
        return None
    lo, hi, typical = rng
    levers = []
    if typical is not None:
        value, note = bounded("disease.p_death", typical, run.disease)
        levers.append(Lever({"disease.p_death": value}, {"disease.p_death": d.p_death}, "increase" if value > cfr else "decrease",
                            f"The database case fatality ratio for {run.disease} is {100 * typical:g}% (range {100 * lo:g}–{100 * hi:g}%){note}.",
                            "disease_db"))
    return Diagnostic("cfr_out_of_range", "warning", "The case fatality ratio is outside the literature range",
                      {"p_death": cfr, "db_min": lo, "db_max": hi}, levers)


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
    faded = sum(1 for t in totals if _faded_out(t, run.seeds, run.n))
    return Diagnostic("high_variance", "info", "The replicates disagree widely",
                      {"p10_total_infected": p10, "p90_total_infected": p90, "median_total_infected": median, "spread": round(spread, 2),
                       "faded_out_share": round(faded / len(totals), 2), "n_replicates": len(totals)}, [])


def _well_mixed(run: _Run) -> Diagnostic | None:
    """Part 2, 5.8 as broadened by follow-up spec 7.6: at the same R0 every network infects nearly everyone (the follow-up measured
    it), so this fires on all of them and offers the two limits on spread. The hybrid network is offered on the random one only, as
    the structure interventions act on, without promising a lower final size (at the same measured R0 the hybrid network's final
    size is close to the random one's; the review of 2B measured 0.886 against 0.893 at R0 2.5)."""
    p = run.params
    if run.r_eff < WELL_MIXED_R_EFF or run.n <= 0 or run.stats.get("fit"):
        return None                             # on a fitted run the size is the one the user gave, and a lever would be fitted away
    if p.disease.rel_sus_cv > 0 or any(i.type in ("contact_reduction", "behavior_response") for i in p.interventions):
        return None                             # a limit on spread is already set, or the contacts were already limited (Part 2, 7.5)
    attack = run.total / run.n
    if attack <= WELL_MIXED_ATTACK_RATE:
        return None
    levers = [
        Lever({"disease.rel_sus_cv": WELL_MIXED_CV}, {"disease.rel_sus_cv": p.disease.rel_sus_cv}, "change",
              "Variation between people in susceptibility: the most susceptible are infected first, so the epidemic ends smaller at the "
              f"same R0. A coefficient of variation of {WELL_MIXED_CV:g} is illustrative.", "rule",
              label=f"Add variation between people (CV {WELL_MIXED_CV:g}) and rerun"),
        Lever({}, {}, "change",
              f"A behaviour response: transmission falls by up to {RESPONSE_SCALE:.0%} as infections rise and recovers as they fall, which "
              "flattens the peak and removes the overshoot; the size is illustrative.", "rule",
              interventions=[{"type": "behavior_response", "scale": RESPONSE_SCALE}], label="Let people become careful as cases rise and rerun"),
    ]
    if p.network.network_type == "random":
        levers.append(Lever({"network.network_type": "hybrid"}, {"network.network_type": "random"}, "change",
                            "The hybrid network makes households, schools and workplaces explicit, so interventions can act on them; at the same "
                            "measured R0 its final size is close to the random network's, so the switch alone does not lower it.", "rule",
                            label="Switch to the hybrid network and rerun"))
    return Diagnostic("well_mixed", "info", "Nearly everyone was infected: only the depletion of susceptibles limits this epidemic",
                      {"attack_rate": round(attack, 3), "r_eff": round(run.r_eff, 2)}, levers)


def r0_gap_threshold(reference: float, seeds: int) -> float:
    """25%, widened to R0_GAP_SIGMAS standard errors of a mean over `seeds` Poisson-like counts when the seeds are few."""
    if reference <= 0 or seeds <= 0:
        return R0_GAP
    return max(R0_GAP, R0_GAP_SIGMAS * math.sqrt(reference / seeds) / reference)


def _r0_reference(run: _Run) -> float | None:
    """What the day-0 seeds should have passed on: R_eff (on a calibrated run the calibration's target, less the initial immunity)
    times the day-0 seasonal factor (1 + scale × cos(2π shift)); None when a treatment, a behaviour response (follow-up spec 5.4)
    or a dated contact or transmission reduction that starts while the seeds still transmit, the latent plus the infectious period,
    cuts what they pass on (what_if's windows start the day 1% were infected, which is day 0 with a 1% seeding). The pilot
    measures without interventions or initial immunity and the live run with them, so a calibrated run takes the same adjustments as
    any other."""
    p = run.params
    transmitting = p.disease.dur_inf.mean_days + (p.disease.dur_exp.mean_days if p.disease.dur_exp is not None else 0.0)
    for i in p.interventions:
        if i.type in ("treatment", "behavior_response", "contact_reduction", "transmission_reduction") and i.start_day <= transmitting:
            return None
    reference = run.r_eff
    for i in p.interventions:
        if i.type == "seasonality":
            reference *= max(0.0, 1.0 + i.scale * math.cos(2 * math.pi * i.shift))
    return reference


def _r0_gap(run: _Run) -> Diagnostic | None:
    """Part 2, 5.8: the measured R0 (the seeds' secondary infections) differs from what the configuration implies for them (R_eff, the
    day-0 seasonal factor, or the calibration's target); levers only on the exact networks (the Part 1 recheck)."""
    measured = run.stats.get("r0_measured")
    reference = _r0_reference(run)
    if measured is None or reference is None or reference <= 0 or run.stats.get("fit"):
        return None
    threshold = r0_gap_threshold(reference, run.seeds)
    if abs(float(measured) - reference) / reference <= threshold:
        return None
    calibrated = run.stats.get("r0_calibration") is not None
    levers = []
    if not calibrated and not r0_is_approximate(run.params):
        lever = _r0_recheck(run)
        if lever is not None:
            levers.append(lever)
    return Diagnostic("r0_gap", "info", "The measured R0 differs from the configured one",
                      {"approx_r0": round(run.r0, 2), "r_eff": round(run.r_eff, 2), "reference": round(reference, 2),
                       "r0_measured": round(float(measured), 2), "threshold": round(threshold, 2), "calibrated": calibrated}, levers)


def anchor_day(run: _Run) -> int | None:
    """The first day the run's cumulative infections reached ANCHOR_SHARE of the agents: when the outbreak would have been noticed.
    None when they never did."""
    cumulative = run.series.get("cum_infections")
    if not cumulative:
        cumulative = np.cumsum([float(v) for v in run.series.get("new_infections") or []]).tolist()
    threshold = ANCHOR_SHARE * run.n
    return next((t for t, value in enumerate(cumulative) if float(value) >= threshold), None)


def _campaign_efficacy(disease: str | None) -> tuple[float, Basis]:
    """The database's vaccine efficacy when it carries one (a percentage is read as one), else the illustrative constant."""
    rng = db_range(disease, "vaccine_efficacy")
    typical = rng[2] if rng else None
    if typical is not None:
        value = typical / 100.0 if typical > 1 else typical
        if 0 < value <= 1:
            return round(value, 4), "disease_db"
    return CAMPAIGN_EFFICACY, "rule"


def _what_if(run: _Run, faded: bool) -> Diagnostic | None:
    """Follow-up spec 7.2: interventions to try after a run that had an epidemic, each a lever with one entry and a ready reply.
    The candidates the scenario does not already have (by type, and by layer for a contact reduction), in the spec's order, four
    at most. Every window starts on the anchor day and never passes the run's last day."""
    p = run.params
    if faded or run.n <= 0 or run.total / run.n < WHAT_IF_MIN_ATTACK:
        return None
    anchor = anchor_day(run)
    if anchor is None:
        return None
    last = max(run.days - 1, anchor)
    has = {(i.type, i.layer if i.type == "contact_reduction" else None) for i in p.interventions}
    types = {kind for kind, _ in has}
    hybrid = p.network.network_type == "hybrid"

    def window(days: int) -> dict:
        return {"start_day": anchor, "end_day": min(anchor + days, last)}

    levers: list[Lever] = []

    def offer(entry: dict, label: str, rationale: str, basis: Basis = "rule") -> None:
        levers.append(Lever({}, {}, "change", rationale, basis, interventions=[entry], label=label))

    if has_vaccine_indicator(run.disease) and "vaccine" not in types:
        efficacy, basis = _campaign_efficacy(run.disease)
        w = window(CAMPAIGN_DAYS)
        offer({"type": "vaccine", "kind": "campaign", "coverage": CAMPAIGN_COVERAGE, "efficacy": efficacy, **w},
              f"Vaccinate {CAMPAIGN_COVERAGE:.0%} in a campaign from day {w['start_day']} to day {w['end_day']} and rerun",
              f"A campaign reaching {CAMPAIGN_COVERAGE:.0%} of the susceptible from the day 1% had been infected; "
              + ("the efficacy is the database's, the coverage is illustrative." if basis == "disease_db"
                 else f"the coverage and the efficacy ({efficacy:g}) are illustrative."), basis)
    if hybrid and age_shares(p)[0] > 0 and ("contact_reduction", "school") not in has:
        offer({"type": "contact_reduction", "layer": "school", "scale": 1.0, **window(CLOSURE_DAYS)},
              f"Close schools from day {anchor} for six weeks and rerun",
              "A full school closure for six weeks from the day 1% had been infected; the length is illustrative.")
    layer = "community" if hybrid else "all"
    where = "community " if hybrid else ""
    if ("contact_reduction", layer) not in has:
        offer({"type": "contact_reduction", "layer": layer, "scale": DISTANCING_SCALE, **window(DISTANCING_DAYS)},
              f"Cut {where}contacts by {DISTANCING_SCALE:.0%} from day {anchor} for eight weeks and rerun",
              f"Distancing: {DISTANCING_SCALE:.0%} fewer {where}contacts for eight weeks; the size is illustrative.")
    if "transmission_reduction" not in types:
        offer({"type": "transmission_reduction", "scale": MASKS_SCALE, **window(MASKS_DAYS)},
              f"Add masks ({MASKS_SCALE:.0%} less transmission) from day {anchor} for {MASKS_DAYS} days and rerun",
              f"Masks: {MASKS_SCALE:.0%} less transmission per contact for {MASKS_DAYS} days; the size is illustrative.")
    if "behavior_response" not in types:
        offer({"type": "behavior_response", "scale": RESPONSE_SCALE},
              "Let people become careful as cases rise and rerun",
              f"A behaviour response: transmission falls by up to {RESPONSE_SCALE:.0%} as infections rise and recovers as they fall; "
              "the size is illustrative.")
    if not levers:
        return None
    return Diagnostic("what_if", "info", "Interventions to try", {"anchor_day": anchor, "attack_rate": round(run.total / run.n, 3)},
                      levers[:WHAT_IF_MAX_LEVERS])


def diagnose(params: SimParamsV2, series: dict, stats: dict, replicates: dict | None, seeds: int,
             disease: str | None = None) -> list[Diagnostic]:
    """Every diagnostic the run triggers, warnings first and in the table's order within (section 10, 19)."""
    run = _Run(params, series, stats, replicates, int(seeds), disease)
    fadeout = _early_fadeout(run)
    unfinished = _unfinished(run)
    candidates = (fadeout, _instant_peak(run), unfinished,
                  None if fadeout else _final_size_gap(run, unfinished is not None),
                  _sharp_curve(run), _cfr_out_of_range(run), _fatality_on_all_infections(run),
                  _no_reinfection(run), _high_variance(run), _well_mixed(run), _r0_gap(run), _what_if(run, fadeout is not None))
    found = [c for c in candidates if c is not None]
    return sorted(found, key=lambda d: 0 if d.severity == "warning" else 1)


def as_dicts(diagnostics: list[Diagnostic]) -> list[dict]:
    """The JSON form the service sends and the web app types as Diagnostic[]. A lever without entries or without a label is sent
    without the field, as every lever was before the follow-up."""
    out = [asdict(d) for d in diagnostics]
    for diagnostic in out:
        for lever in diagnostic["levers"]:
            if not lever["interventions"]:
                del lever["interventions"]
            if lever["label"] is None:
                del lever["label"]
    return out
