"""How a scenario runs: as agents or as a compartmental model (docs/superpowers/specs/2026-11-20-run-mode-choice-design.md).

recommend_solver reads the settings and says which mode it recommends, whether agents are required, and why. It has no Starsim
import, and web/lib/sim/solver.ts mirrors it exactly (the parity fixture compares the two, texts included)."""
from __future__ import annotations

import math

from . import r0
from .registry import WANING_MODELS
from .schema_v2 import SimParamsV2, sim_days

REQUIRED_CODES = ("hybrid_network", "lasting_contacts", "poisson_contacts", "treatment_delay")
AGENT_CODES = ("waning", "births", "temporary_measure", "early_dieout", "replicates")
EARLY_DIEOUT_CHANCE = 0.05          # early_dieout fires when at least this share of outbreaks die out early by chance
BIRTHS_FACTOR = 3.0                 # births fires when the run outlasts this many times the years births need to restore 1/R0
                                    # susceptibles: a compartmental model's next wave comes at 2.6 to 2.8 times (R0 5 to 15)
WANING_FACTOR = 2.5                 # waning fires when the run outlasts this many mean immunity periods: a compartmental model's
                                    # next wave comes after 2 (gamma, lognormal) to 2.5 (constant) of them (SIRS, R0 2.5)

TEXTS = {
    "hybrid_network": "The hybrid network puts people in households, schools and workplaces, which only agents can represent.",
    "lasting_contacts": "Contacts last for days, so who meets whom has to be followed person by person.",
    "poisson_contacts": "The number of contacts varies from person to person, which only agents can represent.",
    "treatment_delay": "The treatment starts some days after each person becomes infectious, which needs each person's own clock.",
    "waning": "Immunity wanes within the run, so infections fall low between waves: agents can die out there, while a compartmental "
              "model always comes back.",
    "births": "Births bring back enough susceptible people within the run for infections to return: agents can die out first, while "
              "a compartmental model always comes back.",
    "temporary_measure": "A temporary measure holds R below 1 for a while: agents can end the outbreak, while a compartmental model "
                         "always rebounds when the measure ends.",
    "replicates": "Several replicates are asked for, and only agents vary from run to run.",
    "same_answer": "Nothing here depends on chance, so both give the same epidemic: agents show it as individual people, a "
                   "compartmental model as its exact average curve.",
}


def well_mixed(params: SimParamsV2) -> bool:
    """The random network with fresh, fixed contacts each day is well-mixed contact at n_contacts a day: no network needed."""
    n = params.network
    return n.network_type == "random" and n.contact_duration_days == 0 and n.contacts_dist == "constant"


def required_codes(p: SimParamsV2) -> list[str]:
    n = p.network
    fired = {
        "hybrid_network": n.network_type == "hybrid",
        "lasting_contacts": n.network_type == "random" and n.contact_duration_days > 0,
        "poisson_contacts": n.network_type == "random" and n.contacts_dist == "poisson",
        "treatment_delay": any(i.type == "treatment" and i.delay_days > 0 for i in p.interventions),
    }
    return [code for code in REQUIRED_CODES if fired[code]]


def needs_agents(params: SimParamsV2) -> bool:
    """The scenarios that only agents can run: the hybrid network, a random network that is not well-mixed, a delayed treatment."""
    return bool(required_codes(params))


def escape_root(r0_value: float) -> float:
    """The root below 1 of s = exp(-R0 (1 - s)): the share left susceptible after an epidemic, and the chance that one chain of
    infection dies out by chance (Poisson offspring); 1 when R0 <= 1. The same loop as the TypeScript, so the two agree."""
    if r0_value <= 1:
        return 1.0
    s = 0.0
    for _ in range(10_000):
        nxt = math.exp(-r0_value * (1.0 - s))
        if abs(nxt - s) < 1e-12:
            return nxt
        s = nxt
    return s


def seed_count(p: SimParamsV2) -> float:
    seed = p.disease.seed
    return seed.value if seed.mode == "count" else seed.value * p.run.n_agents


def dieout_chance(p: SimParamsV2, r_start: float) -> float:
    """The chance that every seed's chain of infection dies out: s ** n for a count of seeds, and exp(-n (1 - s)) for a fraction,
    which a run as agents draws per agent (a Poisson number of seeds with mean n)."""
    s, n = escape_root(r_start), seed_count(p)
    return s ** n if p.disease.seed.mode == "count" else math.exp(-n * (1.0 - s))


def agent_reasons(p: SimParamsV2) -> list[dict]:
    R0 = r0.approx_r0(p)
    d, run_days, out = p.disease, sim_days(p.run.sim_dur_years), []
    r_start = R0 * (1 - d.initial_immune_frac)       # R at the start, for what happens early: die-out, a measure from the start
    if R0 > 1 and d.model in WANING_MODELS and d.dur_immune is not None and run_days > WANING_FACTOR * d.dur_immune.mean_days:
        out.append("waning")
    g = p.demographics
    if (R0 > 1 and g.use_demographics and p.run.sim_dur_years > 1
            and p.run.sim_dur_years > BIRTHS_FACTOR * (1 / R0 - escape_root(R0)) / (g.birth_rate / 1000)):
        out.append("births")
    if any(i.type in ("contact_reduction", "transmission_reduction") and i.end_day is not None and i.end_day < run_days
           and i.end_day - i.start_day >= d.dur_inf.mean_days and r_start > 1 and r_start * (1 - i.scale) < 1 for i in p.interventions):
        out.append("temporary_measure")
    seeds = seed_count(p)
    chance = dieout_chance(p, r_start)
    if r_start > 1 and chance >= EARLY_DIEOUT_CHANCE:
        out.append("early_dieout")
    if p.run.n_replicates > 1:
        out.append("replicates")
    texts = dict(TEXTS, early_dieout=f"With {round(seeds)} initial infections, about {round(100 * chance)} in 100 outbreaks die out "
                                     "early by chance, which only agents show.")
    return [{"code": code, "text": texts[code]} for code in out]


def recommend_solver(p: SimParamsV2) -> dict:
    """{recommended, required, reasons}: agents are recommended for every scenario (the owner's decision, 2026-11-20); the reasons
    say whether agents are required, why the choice matters here, or that both give the same epidemic."""
    required = required_codes(p)
    if required:
        return {"recommended": "abm", "required": True, "reasons": [{"code": c, "text": TEXTS[c]} for c in required]}
    reasons = agent_reasons(p) or [{"code": "same_answer", "text": TEXTS["same_answer"]}]
    return {"recommended": "abm", "required": False, "reasons": reasons}



def runs_as_agents(p: SimParamsV2) -> bool:
    """Agents when the scenario needs them, when they were chosen, or, with nothing chosen, when the rule recommends them."""
    return needs_agents(p) or p.run.solver == "abm" or (p.run.solver is None and recommend_solver(p)["recommended"] == "abm")


__all__ = ["REQUIRED_CODES", "AGENT_CODES", "well_mixed", "needs_agents", "escape_root", "recommend_solver", "runs_as_agents"]
