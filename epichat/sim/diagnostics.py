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
from epichat.params.r0 import R0Unreachable, approx_r0, calibrate_beta, clamp_beta, r0_is_approximate, weighted_cfr
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
WELL_MIXED_R_EFF = 2.0               # Part 2, 5.8
WELL_MIXED_ATTACK_RATE = 0.7
R0_GAP = 0.25
R0_GAP_SIGMAS = 3                    # the gap must exceed three standard errors of the measured mean when the seeds are few
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
    susceptible = 1 - run.params.disease.initial_immune_frac
    z = final_size(run.r_eff)            # the share of the susceptibles the epidemic reaches
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
    faded = sum(1 for t in totals if t < FADEOUT_SEED_MULTIPLE * run.seeds)
    return Diagnostic("high_variance", "info", "The replicates disagree widely",
                      {"p10_total_infected": p10, "p90_total_infected": p90, "median_total_infected": median, "spread": round(spread, 2),
                       "faded_out_share": round(faded / len(totals), 2), "n_replicates": len(totals)}, [])


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


def r0_gap_threshold(reference: float, seeds: int) -> float:
    """25%, widened to R0_GAP_SIGMAS standard errors of a mean over `seeds` Poisson-like counts when the seeds are few."""
    if reference <= 0 or seeds <= 0:
        return R0_GAP
    return max(R0_GAP, R0_GAP_SIGMAS * math.sqrt(reference / seeds) / reference)


def _r0_gap(run: _Run) -> Diagnostic | None:
    """Part 2, 5.8: the measured R0 (the seeds' secondary infections, so R_eff when some agents start immune) differs from the
    configured one; levers only on the exact networks (the Part 1 recheck)."""
    measured = run.stats.get("r0_measured")
    if measured is None or run.r_eff <= 0:
        return None
    threshold = r0_gap_threshold(run.r_eff, run.seeds)
    if abs(float(measured) - run.r_eff) / run.r_eff <= threshold:
        return None
    calibrated = run.stats.get("r0_calibration") is not None
    levers = []
    if not calibrated and not r0_is_approximate(run.params):
        lever = _r0_recheck(run)
        if lever is not None:
            levers.append(lever)
    return Diagnostic("r0_gap", "info", "The measured R0 differs from the configured one",
                      {"approx_r0": round(run.r0, 2), "r_eff": round(run.r_eff, 2), "r0_measured": round(float(measured), 2),
                       "threshold": round(threshold, 2), "calibrated": calibrated}, levers)


def diagnose(params: SimParamsV2, series: dict, stats: dict, replicates: dict | None, seeds: int,
             disease: str | None = None) -> list[Diagnostic]:
    """Every diagnostic the run triggers, warnings first and in the table's order within (section 10, 19)."""
    run = _Run(params, series, stats, replicates, int(seeds), disease)
    fadeout = _early_fadeout(run)
    unfinished = _unfinished(run)
    candidates = (fadeout, _instant_peak(run), unfinished,
                  None if fadeout else _final_size_gap(run, unfinished is not None),
                  _sharp_curve(run), _cfr_out_of_range(run), _fatality_on_all_infections(run),
                  _no_reinfection(run), _high_variance(run), _well_mixed(run), _r0_gap(run))
    found = [c for c in candidates if c is not None]
    return sorted(found, key=lambda d: 0 if d.severity == "warning" else 1)


def as_dicts(diagnostics: list[Diagnostic]) -> list[dict]:
    """The JSON form the service sends and the web app types as Diagnostic[]."""
    return [asdict(d) for d in diagnostics]
