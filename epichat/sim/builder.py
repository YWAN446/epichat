"""build_sim: a validated v1 SimParams -> an initialised Starsim 3.7 Sim with
the behaviour of the v1 templates (spec 8, as revised by 17).

Time is numeric and day-based (start 0, dt one day, dur round(365 × years)
days), which gives v1's point count. Every duration is ss.days and every rate
ss.peryear. The carried-over pieces (treatment, routine vaccine, the day-0
vaccine move, age assignment, demographics, seasonality) keep their v1
semantics; the day-0 move and the age assignment keep v1's numpy generators
until phase 2 replaces them.
"""
from __future__ import annotations

import numpy as np
import starsim as ss

from epichat.schema import SimParams

from .models import MODELS

CONTACT_MATRIX = np.array([[7.0, 2.5, 0.5], [2.5, 9.0, 1.5], [0.5, 1.5, 3.5]])
LATENT_MODELS = ("seir", "seirs", "seiar")
WANING_MODELS = ("sirs", "seirs")


def sim_days(sim_dur_years: float) -> int:
    return max(1, int(round(365 * sim_dur_years)))


def resolve_seed(params: SimParams, seed: int | None) -> int | None:
    return seed if seed is not None else params.rand_seed


def age_groups() -> dict:
    return {"children": ss.AgeGroup(0, 18), "adults": ss.AgeGroup(18, 65), "elderly": ss.AgeGroup(65, None)}


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


def disease_kwargs(params: SimParams) -> dict:
    kw = dict(init_prev=ss.bernoulli(p=params.init_prev), beta=ss.peryear(params.beta),
              dur_inf=ss.constant(ss.days(params.dur_inf)))
    if params.disease_type == "sis":
        kw.update(waning=ss.peryear(0), imm_boost=0)       # v1 sis: no immunity, no deaths
    else:
        kw["p_death"] = ss.bernoulli(p=params.p_death)
    if params.disease_type in LATENT_MODELS:
        kw["dur_exp"] = ss.constant(ss.days(params.dur_exp))
    if params.disease_type in WANING_MODELS:
        kw["dur_immune"] = ss.constant(ss.days(params.dur_immune))
    if params.disease_type == "seiar":
        kw.update(p_asymp=ss.bernoulli(p=params.p_asymp), rel_trans_asymp=params.rel_trans_asymp)
    return kw


def build_network(params: SimParams):
    if params.network_type == "age_structured":
        return ss.MixingPools(src=age_groups(), dst=age_groups(), n_contacts=CONTACT_MATRIX * params.network_beta, beta=1.0)
    return ss.RandomNet(n_contacts=params.n_contacts, beta=params.network_beta)


def _move_to_immune(sim: ss.Sim, coverage: float, seed: int | None) -> None:
    """v1's day-0 vaccine: coverage × susceptibles become immune before the run."""
    disease = sim.diseases[0]
    susceptible = np.asarray(disease.susceptible.uids)
    n_vax = int(coverage * len(susceptible))
    rng = np.random.default_rng(seed) if seed is not None else np.random.default_rng()
    chosen = ss.uids(rng.choice(susceptible, size=n_vax, replace=False)) if n_vax > 0 else ss.uids()
    if hasattr(disease, "recovered"):
        disease.susceptible[chosen] = False
        disease.recovered[chosen] = True
    else:                                               # sis: immune through full immunity (waning is 0)
        disease.immunity[chosen] = 1.0
        disease.rel_sus[chosen] = 0.0


def _assign_ages(sim: ss.Sim, params: SimParams, seed: int | None) -> None:
    """v1's age assignment: uniform ages within each share, shuffled."""
    n = len(sim.people)
    n_children = round(params.age_pct_under18 / 100 * n)
    n_elderly = round(params.age_pct_over65 / 100 * n)
    n_adults = max(0, n - n_children - n_elderly)
    rng = np.random.default_rng(seed + 1) if seed is not None else np.random.default_rng()
    ages = np.concatenate([rng.uniform(0, 18, n_children), rng.uniform(18, 65, n_adults), rng.uniform(65, 95, n_elderly)])
    rng.shuffle(ages)
    sim.people.age[:] = ages[:n]


def build_sim(params: SimParams, seed: int | None = None) -> ss.Sim:
    name = params.disease_type
    disease = MODELS[name](**disease_kwargs(params))
    interventions, connectors = [], []
    seasonality = params.get_seasonality()
    if seasonality:
        connectors.append(ss.seasonality(diseases=name, scale=seasonality.scale, shift=seasonality.shift))
    treatment = params.get_treatment()
    if treatment:
        interventions.append(SimpleTreatment(prob=treatment.coverage if treatment.coverage is not None else 1.0,
                                             max_capacity=treatment.capacity, start_day=treatment.start_day))
    vaccine = params.get_vaccine()
    if vaccine and vaccine.start_day > 0:
        interventions.append(ss.routine_vx(product=ss.simple_vx(efficacy=1.0), prob=vaccine.coverage or 0.0,
                                           start_year=vaccine.start_day / 365))
    demographics = None
    if params.use_demographics:
        demographics = [ss.Births(birth_rate=ss.peryear(params.birth_rate)), ss.Deaths(death_rate=ss.peryear(params.death_rate))]
    rand_seed = resolve_seed(params, seed)
    seed_kw = {"rand_seed": rand_seed} if rand_seed is not None else {}
    sim = ss.Sim(n_agents=params.n_agents, networks=build_network(params), diseases=disease, demographics=demographics,
                 interventions=interventions or None, connectors=connectors or None,
                 start=ss.days(0), dur=ss.days(sim_days(params.sim_dur_years)), dt=ss.days(1), verbose=0, **seed_kw)
    sim.init()
    if vaccine and vaccine.start_day <= 0:
        _move_to_immune(sim, vaccine.coverage or 0.0, rand_seed)
    if params.network_type == "age_structured" and params.age_pct_under18 is not None:
        _assign_ages(sim, params, rand_seed)
    return sim
