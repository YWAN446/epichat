"""build_sim: a validated SimParamsV2 -> a Starsim 4 Sim.

Time runs in days from day 0. The disease is declared (model.py), so Starsim runs it as an ODE unless something needs agents: the
hybrid network, a random network with lasting contacts or Poisson contact counts, or a treatment with a delay. Every intervention is
a Starsim delivery or modifier, so it works under either solver."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import starsim as ss
import starsim.library as ssl

from epichat.params import tables
from epichat.params.migrate import coerce_params
from epichat.params.schema_v2 import SimParamsV2, sim_days

from .model import AGE_EDGES, age_edges, make_disease

LAYERS = {"household": "h", "school": "s", "work": "w", "community": "c"}


def resolve_seed(params: SimParamsV2, seed: int | None) -> int:
    """The explicit seed, else the scenario's, else 1."""
    if seed is not None:
        return int(seed)
    return int(params.run.rand_seed) if params.run.rand_seed is not None else 1


def well_mixed(params: SimParamsV2) -> bool:
    """The random network with fresh, fixed contacts each day is well-mixed contact at n_contacts a day: no network needed."""
    n = params.network
    return n.network_type == "random" and n.contact_duration_days == 0 and n.contacts_dist == "constant"


def build_network(params: SimParamsV2):
    """The contact matrix by age, Covasim's hybrid layers, a random network for lasting contacts, or nothing for well-mixed contact."""
    n = params.network
    if n.network_type == "age_structured":
        # EpiChat's rows are sources and columns targets; Starsim's matrix[i, j] is the contacts a person in i has with people in j
        return ss.contacts(ages=list(AGE_EDGES), matrix=np.array(n.contacts.as_rows()).T, name="contacts")
    if n.network_type == "hybrid":
        return ssl.HybridNet(household_size=ss.poisson(mean=n.household_size),
                             n_contacts=dict(s=n.school_contacts, w=n.work_contacts, c=n.community_contacts),
                             school_ages=[n.school_age_min, n.school_age_max], work_ages=[n.work_age_min, n.work_age_max])
    if well_mixed(params):
        return None
    contacts = ss.poisson(mean=n.n_contacts) if n.contacts_dist == "poisson" else ss.constant(n.n_contacts)
    return ss.RandomNet(n_contacts=contacts, dur=ss.days(n.contact_duration_days), name="random")


def needs_agents(params: SimParamsV2) -> bool:
    return (params.network.network_type == "hybrid" or (params.network.network_type == "random" and not well_mixed(params))
            or any(i.type == "treatment" and i.delay_days > 0 for i in params.interventions))


def build_people(params: SimParamsV2, n: int):
    """For a run as agents with a known country, people drawn from its UN pyramid; otherwise Starsim's (or the strata's) ages."""
    g = params.demographics
    if g.age_source == "un_wpp" and g.country:
        hist = tables.age_histogram(g.country, g.demographics_year)
        if hist is not None:
            return ss.People(n, age_data=pd.DataFrame({"age": list(range(tables.MAX_AGE + 1)), "value": list(hist)}))
    return None


def build_demographics(params: SimParamsV2) -> list | None:
    """Crude birth and death rates per 1,000 a year; with a known country, births follow WPP's projected series after the first year."""
    g = params.demographics
    if not g.use_demographics:
        return None
    rates = [g.birth_rate]
    if g.country and params.run.sim_dur_years > 1:
        series = tables.birth_rate_series(g.country, g.demographics_year, math.ceil(params.run.sim_dur_years))
        if series:
            rates += series[1:]
    births = ss.peryear(rates[0] / 1000) if len(rates) == 1 else ss.timeseries({ss.days(365 * y): ss.peryear(r / 1000) for y, r in enumerate(rates)})
    return [ss.birth(rate=births), ss.death(rate=ss.peryear(g.death_rate / 1000))]


def window(i, run_days: int) -> dict:
    """An intervention's start and stop, in days (end_day is inclusive; None is the run's end)."""
    out = dict(start=ss.days(i.start_day))
    if i.end_day is not None and i.end_day < run_days:
        out["stop"] = ss.days(i.end_day + 1)
    return out


def per_day(share: float, days: float) -> ss.Rate:
    """The constant daily rate that reaches this share of people over this many days."""
    return ss.perday(-math.log(max(1e-12, 1 - min(share, 0.999999))) / max(days, 1.0))


def age_condition(age_min: int | None, age_max: int | None):
    cond = None
    if age_min is not None:
        cond = ss.person.age >= age_min
    if age_max is not None:
        upper = ss.person.age < age_max
        cond = upper if cond is None else cond & upper
    return cond


def behavior_multiplier(disease: str, scale: float, half_prevalence: float, memory_days: int):
    """1 − scale × P / (half_prevalence + P), P the mean share of people infectious over the last memory_days days."""
    def multiplier(sim):
        res = sim.results[disease]
        ti = sim.ti
        lo = max(0, ti - memory_days + 1)
        window = lambda key: np.asarray(res[key].values[lo:ti + 1], dtype=float) if key in res else 0.0
        infectious = window("I") + window("A")
        alive = np.maximum(sum(window(key) for key in "SEIAR"), 1.0)
        share = float(np.mean(infectious / alive))
        return 1.0 - scale * share / (half_prevalence + share)
    return multiplier


def build_interventions(params: SimParamsV2, disease: ss.Disease) -> list:
    d = params.disease
    run_days = sim_days(params.run.sim_dur_years)
    S, I = disease.S, disease.I
    A = getattr(disease, "A", None)
    out = []
    if d.seed.day > 0:
        how = dict(capacity=int(d.seed.value)) if d.seed.mode == "count" else dict(coverage=float(d.seed.value))
        out.append(ss.Delivery(S >> I, when=ss.days(d.seed.day), name="seed", **how))
    for k, i in enumerate(params.interventions):
        name = f"{i.type}_{k}"
        if i.type == "vaccine":
            waning = ss.boxcar(plateau=ss.days(i.protection_days)) if i.protection_days else None
            product = ss.Vaccine(efficacy=i.efficacy, leaky=i.leaky, waning=waning, name=f"{name}_vaccine")
            who = age_condition(i.age_min, i.age_max)
            coverage = i.coverage or 0.0
            # a day-0 routine entry not folded into initial immunity (ages, waning, a partial efficacy) is protection from the start
            day0 = i.kind == "routine" and i.start_day == 0 and i.end_day is None
            if day0 or (i.kind == "campaign" and i.end_day is not None and i.end_day <= i.start_day):
                out.append(ss.vaccinate(product, coverage=coverage, when=ss.days(i.start_day), who=who, name=name))
            else:                       # routine: the coverage a year; campaign: the coverage over its window (unset: the run's end)
                end = run_days if i.end_day is None else min(i.end_day, run_days)
                days = (end - i.start_day + 1) if i.kind == "campaign" else 365
                out.append(ss.vaccinate(product, coverage=per_day(coverage, days), who=who, name=name, **window(i, run_days)))
        elif i.type == "treatment":
            prob = i.coverage if i.coverage is not None else 1.0
            capacity = ss.perday(i.capacity) if i.capacity is not None else None
            if i.delay_days > 0:           # a delay from becoming infectious: Starsim runs this as agents
                trigger = disease.onset if hasattr(disease, "onset") else disease.infection
                out.append(ss.treat(ss.Treatment(cure=i.efficacy, name=f"{name}_product"), when=ss.on(trigger, delay=ss.days(i.delay_days)), coverage=prob, capacity=capacity, name=name,
                                    **window(i, run_days)))
            else:
                who = I if (i.symptomatic_only or A is None) else I | A
                out.append(ss.treat(ss.Treatment(cure=i.efficacy, name=f"{name}_product"), who=who, coverage=per_day(prob, 1), capacity=capacity, name=name, **window(i, run_days)))
            if i.rel_trans_treated < 1:    # while infectious during the program, as if isolated until treated
                out.append(ss.modify(disease.rel_trans, multiply=i.rel_trans_treated, who=I, name=f"{name}_isolation", **window(i, run_days)))
        elif i.type == "seasonality":
            out.append(ss.modify(disease.pars.beta, multiply=ss.seasonal(amplitude=i.scale, peak=i.shift), name=name))
        elif i.type == "transmission_reduction":
            out.append(ss.modify(disease.pars.beta, multiply=1 - i.scale, name=name, **window(i, run_days)))
        elif i.type == "contact_reduction":
            network = dict(network=LAYERS[i.layer]) if i.layer != "all" else {}
            out.append(ss.modify(disease.pars.beta, multiply=1 - i.scale, name=name, **network, **window(i, run_days)))
        elif i.type == "behavior_response":
            multiply = behavior_multiplier(disease.name, i.scale, i.half_prevalence, i.memory_days)
            out.append(ss.modify(disease.pars.beta, multiply=multiply, name=name, **window(i, run_days)))
    return out


def build_sim(params, seed: int | None = None) -> ss.Sim:
    """params: a SimParamsV2, or anything coerce_params accepts (a v1 dict or object)."""
    params = coerce_params(params)
    n = params.run.n_agents
    network = build_network(params)
    disease = make_disease(params, contacts_per_day=params.network.n_contacts if network is None and params.network.network_type == "random" else 1.0)
    agents = needs_agents(params)
    kw = dict(n_agents=n, people=build_people(params, n)) if agents else dict(total_pop=n)
    return ss.Sim(disease, networks=network, demographics=build_demographics(params), interventions=build_interventions(params, disease) or None,
                  start=ss.days(0), stop=ss.days(sim_days(params.run.sim_dur_years)), dt=ss.days(1), aging=params.demographics.use_demographics,
                  rand_seed=resolve_seed(params, seed), verbose=0, **kw)


__all__ = ["build_sim", "build_network", "build_people", "build_demographics", "build_interventions", "resolve_seed", "needs_agents",
           "well_mixed", "age_edges"]
