"""EpiChat's six models as one declared Starsim disease.

Every model is states and transitions: S, I and (except SIS without immunity) R, with E in the latent models and A in SEIAR.
Starsim runs the declared disease as an ODE unless something in the sim needs agents (the hybrid network, lasting contacts, or a
treatment delay), in which case the same disease runs as agents. Age groups and susceptibility classes are stratifications of the
disease, and susceptibility and fatality by group are values by level (ss.by) in its rates, so they hold under either solver."""
from __future__ import annotations

import numpy as np
import starsim as ss
from scipy import stats

from epichat.params import tables
from epichat.params.r0 import AGE_BANDS, age_shares
from epichat.params.registry import DEATH_MODELS, LATENT_MODELS, WANING_MODELS
from epichat.params.schema_v2 import Duration, SimParamsV2

AGE_EDGES = (0, 18, 65)     # children, adults, elderly
SUS_LEVELS = 5              # equal-probability classes that stand for a gamma-distributed susceptibility


def to_dist(d: Duration):
    """A duration in days as a Starsim distribution (as compartments, Starsim lays non-exponential ones out as Erlang stages)."""
    mean = ss.days(d.mean_days)
    if d.dist == "constant":
        return ss.constant(mean)
    if d.dist == "lognormal":
        return ss.lognormal(mean=mean, std=ss.days(d.sd_days))
    return ss.erlang(k=max(1, round((d.mean_days / d.sd_days) ** 2)), mean=mean)


def age_edges(p: SimParamsV2) -> list[int]:
    """The lower edges of the age groups: the three bands, plus the age limits of any vaccine, so its eligibility is a group."""
    edges = set(AGE_EDGES)
    for i in p.interventions:
        if i.type == "vaccine":
            edges |= {a for a in (i.age_min, i.age_max) if a is not None}
    return sorted(edges)


def age_group_shares(p: SimParamsV2, edges: list[int]) -> dict[int, float]:
    """The share of people in each age group: from the UN pyramid when the scenario has one, else the three shares, uniform within
    each band."""
    g = p.demographics
    hist = tables.age_histogram(g.country, g.demographics_year) if g.age_source == "un_wpp" and g.country else None
    bounds = list(zip(edges, edges[1:] + [tables.MAX_AGE + 1]))
    if hist is not None:
        hist = np.asarray(hist, dtype=float) / np.sum(hist)
        shares = [hist[lo:hi].sum() for lo, hi in bounds]
    else:
        band_shares = age_shares(p)
        shares = [sum(s * max(0.0, min(hi, b) - max(lo, a)) / (b - a) for s, (a, b) in zip(band_shares, AGE_BANDS)) for lo, hi in bounds]
    total = sum(shares)
    return {lo: share / total for lo, share in zip(edges, shares)}


def band_of(age: int) -> int:
    """The index of the band (children, adults, elderly) an age group starting at this age belongs to."""
    return 0 if age < 18 else 1 if age < 65 else 2


def needs_ages(p: SimParamsV2) -> bool:
    d = p.disease
    return (p.network.network_type == "age_structured" or d.rel_sus_age.as_tuple() != (1.0, 1.0, 1.0) or d.p_death_age.any_set()
            or any(i.type == "vaccine" and (i.age_min is not None or i.age_max is not None) for i in p.interventions)
            or p.demographics.use_demographics)


def susceptibility_levels(cv: float) -> list[float]:
    """The mean of each of SUS_LEVELS equal-probability classes of a gamma with mean 1 and coefficient of variation cv."""
    a = 1.0 / cv ** 2
    edges = stats.gamma.ppf(np.linspace(0, 1, SUS_LEVELS + 1), a, scale=1 / a)
    # The mean of a gamma(a) over [x0, x1] is (a/rate) × (F_{a+1}(x1) − F_{a+1}(x0)) / (F_a(x1) − F_a(x0)); each class holds 1/SUS_LEVELS
    upper = stats.gamma.cdf(edges, a + 1, scale=1 / a)
    return list(np.diff(upper) * SUS_LEVELS)


def make_disease(p: SimParamsV2, contacts_per_day: float = 1.0) -> ss.Disease:
    """The scenario's disease. contacts_per_day multiplies beta when people mix with no network (each contact transmits at
    network_beta × beta per year)."""
    d = p.disease
    model = d.model
    latent, waning, deadly = model in LATENT_MODELS, model in WANING_MODELS, model in DEATH_MODELS
    immune_sis = model == "sis" and (d.sis_imm_boost > 0 or d.initial_immune_frac > 0)
    S, I = ss.states("S I")
    E = ss.State(name="E", label="Exposed") if latent else None
    A = ss.State(name="A", label="Asymptomatic") if model == "seiar" else None
    R = ss.State(name="R", label="Recovered") if model != "sis" or immune_sis else None

    beta = ss.par(ss.peryear(d.beta * p.network.network_beta * contacts_per_day), name="beta")
    force = I
    if A is not None and d.rel_trans_asymp > 0:
        force = force + d.rel_trans_asymp * A
    if E is not None and d.rel_trans_exposed > 0:
        force = force + d.rel_trans_exposed * E
    rate = beta
    if p.network.network_type == "hybrid":                  # each layer's transmissibility relative to beta
        lb = p.network.layer_beta
        rate = rate * dict(h=lb.household, s=lb.school, w=lb.work, c=lb.community)
    rel_sus = d.rel_sus_age.as_tuple()
    if needs_ages(p) and rel_sus != (1.0, 1.0, 1.0):      # susceptibility by age group
        rate = rate * ss.by(age=[rel_sus[band_of(a)] for a in age_edges(p)])
    if d.rel_sus_cv > 0:                                    # variation in susceptibility: SUS_LEVELS equal classes
        rate = rate * ss.by(susceptibility=susceptibility_levels(d.rel_sus_cv))
    transitions = dict(infection=S >> (I if E is None else E) @ rate * force)

    if E is not None:
        onset = {A: d.p_asymp, I: None} if A is not None else I
        transitions["onset"] = E >> onset @ to_dist(d.dur_exp)

    dur_inf = to_dist(d.dur_inf)
    if model == "sis":
        recovered = {R: d.sis_imm_boost, S: None} if immune_sis and d.sis_imm_boost > 0 else S
        transitions["recovery"] = I >> recovered @ dur_inf
    elif deadly and (d.p_death > 0 or d.p_death_age.any_set()):
        if d.p_death_age.any_set():
            groups = [band_of(a) for a in age_edges(p)]
            death = ss.by(age=[d.death_probabilities()[g] for g in groups])
            survive = ss.by(age=[1 - d.death_probabilities()[g] for g in groups])
        else:
            death, survive = d.p_death, 1 - d.p_death
        transitions["recovery"] = ss.Transition(I, R, dur=dur_inf, p=survive)
        transitions["death"] = ss.Transition(I, ss.dead, dur=dur_inf, p=death)
    else:
        transitions["recovery"] = I >> R @ dur_inf
    if A is not None:
        transitions["asymp_recovery"] = A >> R @ dur_inf
    if waning:
        transitions["waning"] = R >> S @ to_dist(d.dur_immune)
    elif immune_sis and d.sis_waning > 0:
        transitions["waning"] = R >> S @ ss.peryear(d.sis_waning)

    init, init_n = {}, {}
    seeded = 0.0                # the share seeded on day 0
    if d.seed.day == 0 and d.seed.mode == "count":
        init_n["I"] = int(d.seed.value)
        seeded = d.seed.value / p.run.n_agents
    else:                       # nobody infected at the start when the seeding is later (Starsim's default would be 1%)
        init["I"] = float(d.seed.value) if d.seed.day == 0 else 0.0
        seeded = init["I"]
    if d.initial_immune_frac > 0 and R is not None:
        init["R"] = float(d.initial_immune_frac) * (1 - seeded)      # a share of the people not seeded

    states = [s for s in (S, E, I, A, R) if s is not None]
    disease = ss.Disease(*states, **transitions, init=init or None, init_n=init_n or None, name=model)

    if needs_ages(p):
        disease.stratify(age=age_group_shares(p, age_edges(p)))
    if d.rel_sus_cv > 0:
        disease.stratify(susceptibility={f"q{i + 1}": 1 / SUS_LEVELS for i in range(SUS_LEVELS)})
    return disease
