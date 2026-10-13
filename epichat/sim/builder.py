"""build_sim: a validated SimParamsV2 -> an initialised Starsim 3.7 Sim
(spec 8, revised by 17 and 18).

Numeric day-based time (start 0, dt one day, dur round(365 × years) days).
Every duration is ss.days and every rate ss.peryear. Durations become
distributions (8.2), seeds are fractions or counts on day 0 or later (8.3),
initial immunity and delayed seeds are interventions, the transmissibility
connector always runs (8.4), and the carried-over v1 pieces (treatment, routine
vaccine) keep their semantics (8.5). Part 2 adds the three networks with their
options (section 5), the UN pyramid ages and the yearly birth series (section 6)
and the infection log the measured R0 reads (5.6). ss.Sim copies its inputs: read modules back through sim.*."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import starsim as ss

from epichat.params import tables
from epichat.params.migrate import coerce_params
from epichat.params.r0 import CONTACT_MATRIX
from epichat.params.registry import LATENT_MODELS, WANING_MODELS
from epichat.params.schema_v2 import Duration, Seed, SimParamsV2, sim_days

from .connectors import TransmissionModifiers
from .demographics import AgedPeople, YearlyBirths
from .interventions import ContactReduction, InitialImmunity, SeedInfections, SimpleTreatment, TreatmentDelivery, VaccineDelivery
from .models import MODELS
from .products import Treatment, Vaccine

__all__ = ["CONTACT_MATRIX", "LATENT_MODELS", "WANING_MODELS", "SimpleTreatment", "sim_days", "resolve_seed", "age_groups",
           "to_dist", "seed_dist", "disease_kwargs", "build_network", "build_people", "build_demographics", "age_eligibility", "vaccine_delivery",
           "build_interventions", "build_sim"]


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
    kw = dict(init_prev=seed_dist(d.seed), beta=ss.peryear(d.beta), dur_inf=to_dist(d.dur_inf), rel_sus_age=d.rel_sus_age.as_tuple())
    if d.model == "sis":
        kw.update(waning=ss.peryear(d.sis_waning), imm_boost=d.sis_imm_boost)     # 0 and 0 reproduce v1
    else:
        kw["p_death"] = ss.bernoulli(p=age_fatality(d.p_death, d.p_death_age))
    if d.model in LATENT_MODELS:
        kw["dur_exp"] = to_dist(d.dur_exp)
        kw["rel_trans_exposed"] = d.rel_trans_exposed
    if d.model in WANING_MODELS:
        kw["dur_immune"] = to_dist(d.dur_immune)
    if d.model == "seiar":
        kw.update(p_asymp=ss.bernoulli(p=d.p_asymp), rel_trans_asymp=d.rel_trans_asymp)
    return kw


def age_fatality(p_death: float, by_age):
    """p_death for ss.bernoulli: the scalar, or a callable of the agents' ages when any group has its own value (Part 2, 4.1)."""
    if not by_age.any_set():
        return p_death
    children, adults, elderly = (v if v is not None else p_death for v in (by_age.children, by_age.adults, by_age.elderly))

    def probability(sim, uids):
        age = np.asarray(sim.people.age[uids])
        return np.select([age < 18, age < 65], [children, adults], default=elderly)

    return probability


def build_network(params: SimParamsV2):
    """Part 2, section 5: the random network with its options, the age-structured MixingPools on the configured matrix, or Covasim's
    hybrid layers (household, school, workplace, community) with the layer transmissibilities scaled by network_beta."""
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


def age_eligibility(age_min: int | None, age_max: int | None):
    """Starsim's eligibility callable: the alive agents inside the age range (None means everyone, Starsim's default)."""
    if age_min is None and age_max is None:
        return None

    def eligible(sim):
        age = np.asarray(sim.people.age.raw)                                    # raw: every uid, so the positions are uids (review C1)
        keep = np.asarray(sim.people.alive.raw, dtype=bool).copy()
        if age_min is not None:
            keep &= age >= age_min
        if age_max is not None:
            keep &= age < age_max
        return ss.uids(np.flatnonzero(keep))

    return eligible


def vaccine_delivery(entry, run_days: int):
    """Part 2, 7.1: a v1-shaped routine vaccine (full efficacy, no window, no ages, no waning) keeps Starsim's routine_vx, whose yearly
    probability the parity baseline pins; every other entry runs through VaccineDelivery with a per-day probability over its window:
    routine coverage is a yearly probability (1 − (1 − c)^(1/365) a day), a campaign reaches its coverage uniformly over the window
    (1 − (1 − c)^(1/days)). A day-0 vaccine with efficacy below 1 (never folded into initial immunity) is a one-day campaign at day 0."""
    coverage = entry.coverage or 0.0
    v1_shaped = (entry.kind == "routine" and entry.end_day is None and entry.efficacy >= 1.0 and entry.leaky
                 and entry.age_min is None and entry.age_max is None and entry.protection_days is None)
    if v1_shaped:
        return ss.routine_vx(product=Vaccine(efficacy=1.0), prob=coverage, start_year=entry.start_day / 365)
    kind, end_day = entry.kind, entry.end_day
    if entry.start_day == 0 and end_day is None and kind == "routine":        # not folded (an efficacy, ages, waning, all-or-nothing): day-0 protection
        kind, end_day = "campaign", 0
    end_day = run_days if end_day is None else min(end_day, run_days)
    product = Vaccine(efficacy=entry.efficacy, leaky=entry.leaky, protection_days=entry.protection_days)
    if kind == "campaign":
        days = max(1, end_day - entry.start_day + 1)
        prob = 1 - (1 - coverage) ** (1 / days)
    else:
        prob = 1 - (1 - coverage) ** (1 / 365)
    return VaccineDelivery(product, prob, entry.start_day, end_day, age_eligibility(entry.age_min, entry.age_max))


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


def _draw_ages(params: SimParamsV2, n: int, seed: int) -> np.ndarray:
    """v1's age assignment: uniform ages within each share, shuffled (numpy, seed + 1; the interventions spec owns it)."""
    g = params.demographics
    n_children = round(g.age_pct_under18 / 100 * n)
    n_elderly = round(g.age_pct_over65 / 100 * n)
    n_adults = max(0, n - n_children - n_elderly)
    rng = np.random.default_rng(seed + 1)
    ages = np.concatenate([rng.uniform(0, 18, n_children), rng.uniform(18, 65, n_adults), rng.uniform(65, 95, n_elderly)])
    rng.shuffle(ages)
    return ages[:n]


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


def build_sim(params, seed: int | None = None) -> ss.Sim:
    """params: a SimParamsV2, or anything coerce_params accepts (a v1 dict or object)."""
    params = coerce_params(params)
    name = params.disease.model
    disease = MODELS[name](**disease_kwargs(params))
    seasonality = next((i for i in params.interventions if i.type == "seasonality"), None)
    reductions = [(i.start_day, i.end_day, i.scale) for i in params.interventions if i.type == "transmission_reduction"]
    connector = TransmissionModifiers(name, seasonality.scale if seasonality else 0.0, seasonality.shift if seasonality else 0.0, reductions)
    rand_seed = resolve_seed(params, seed)
    n = params.run.n_agents
    sim = ss.Sim(n_agents=n, people=build_people(params, n, rand_seed), networks=build_network(params), diseases=disease,
                 demographics=build_demographics(params), interventions=build_interventions(params) or None, connectors=[connector],
                 analyzers=[ss.infection_log()],        # Part 2, 5.6: the measured R0 reads it
                 start=ss.days(0), dur=ss.days(sim_days(params.run.sim_dur_years)), dt=ss.days(1), verbose=0, rand_seed=rand_seed)
    sim.init()
    sim.seeds_day0 = int(sim.diseases[0].infected.count())      # the realized day-0 seeds, for the outputs (8.6)
    return sim
