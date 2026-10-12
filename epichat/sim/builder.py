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

from epichat.params.migrate import coerce_params
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


def build_sim(params, seed: int | None = None) -> ss.Sim:
    """params: a SimParamsV2, or anything coerce_params accepts (a v1 dict or object)."""
    params = coerce_params(params)
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
