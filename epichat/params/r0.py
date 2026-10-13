"""R0 and beta on schema v2 (spec 7.4, revised by section 18).

Starsim transmits per contact per day with probability
p = network_beta × (1 − exp(−beta / 365)); an agent transmits on D_eff days
(7.4). On the random network R0 = n_contacts × p × D_eff × asymp_factor; on
the age-structured MixingPools network the next-generation matrix is similar
to the contact matrix, so R0 = rho(C) × p × D_eff × asymp_factor whatever the
age shares (section 18). The v1 functions in epichat/schema.py and parser.py
keep the linear approximation for the frozen Python agent."""
from __future__ import annotations

import math

import numpy as np

from .registry import LATENT_MODELS
from .schema_v2 import DiseaseParams, SimParamsV2

CONTACT_MATRIX = np.array([[7.0, 2.5, 0.5], [2.5, 9.0, 1.5], [0.5, 1.5, 3.5]])
CONTACT_SPECTRAL_RADIUS = float(np.linalg.eigvals(CONTACT_MATRIX).real.max())
RANDOM_LEVERS = ("network.n_contacts", "disease.dur_inf.mean_days")
AGE_LEVERS = ("network.network_beta", "disease.dur_inf.mean_days")
DEFAULT_AGE_SHARES = (0.3, 0.7, 0.0)      # Starsim's default ages are uniform on 0 to 60: no elderly


def age_shares(p: SimParamsV2) -> tuple[float, float, float]:
    """The share of agents in each age group: the fetched shares when all three are set, else the default ages'."""
    g = p.demographics
    if g.age_pct_under18 is not None and g.age_pct_18_64 is not None and g.age_pct_over65 is not None:
        return (g.age_pct_under18 / 100.0, g.age_pct_18_64 / 100.0, g.age_pct_over65 / 100.0)
    return DEFAULT_AGE_SHARES


def exposed_days(d: DiseaseParams) -> float:
    """Days an exposed agent can transmit on a daily step, by the same offsets as the infectious period (0 outside the latent models)."""
    if d.model not in LATENT_MODELS or d.dur_exp is None:
        return 0.0
    exp = d.dur_exp
    days = math.ceil(exp.mean_days) - 1 if exp.dist == "constant" else exp.mean_days - 0.5
    return max(0.0, float(days))


class R0Unreachable(ValueError):
    def __init__(self, target: float, maximum: float, levers: tuple[str, ...]):
        self.target, self.maximum, self.levers = target, maximum, levers
        super().__init__(f"R0 {target:g} is not reachable: the most the contacts and infectious period can carry is "
                         f"{maximum:.2f}; raise {' or '.join(levers)}")


def per_contact_prob(beta: float) -> float:
    return 1.0 - math.exp(-beta / 365.0)


def asymp_factor(d: DiseaseParams) -> float:
    return 1.0 - d.p_asymp * (1.0 - d.rel_trans_asymp) if d.model == "seiar" else 1.0


def effective_days(d: DiseaseParams) -> float:
    inf = d.dur_inf
    if d.model in LATENT_MODELS:
        exp = d.dur_exp
        if exp.dist == "constant" and inf.dist == "constant":
            days = math.ceil(exp.mean_days + inf.mean_days) - math.ceil(exp.mean_days)
        elif exp.dist == "constant":
            days = inf.mean_days + 0.5
        else:
            days = inf.mean_days
    elif inf.dist == "constant":
        days = math.ceil(inf.mean_days) - 1
    else:
        days = inf.mean_days - 0.5
    return max(0.0, float(days)) + d.rel_trans_exposed * exposed_days(d)


def contact_scale(p: SimParamsV2) -> float:
    n = p.network
    r = p.disease.rel_sus_age.as_tuple()
    if n.network_type == "age_structured":
        # Each target group's row of the next-generation matrix scales by its susceptibility: rho(C · diag(r)) (Part 2, 4.4).
        contacts = float(np.linalg.eigvals(CONTACT_MATRIX @ np.diag(r)).real.max()) if r != (1.0, 1.0, 1.0) else CONTACT_SPECTRAL_RADIUS
    else:
        s = age_shares(p)
        contacts = n.n_contacts * sum(si * ri for si, ri in zip(s, r))
    return contacts * n.network_beta * effective_days(p.disease) * asymp_factor(p.disease)


def weighted_cfr(p: SimParamsV2) -> float:
    """The population case fatality ratio: the groups' values weighted by their shares (the scalar where a group has none)."""
    return float(sum(s * q for s, q in zip(age_shares(p), p.disease.death_probabilities())))


def approx_r0(p: SimParamsV2) -> float:
    return contact_scale(p) * per_contact_prob(p.disease.beta)


def max_r0(p: SimParamsV2) -> float:
    return contact_scale(p)


def calibrate_beta(p: SimParamsV2, target_r0: float) -> float:
    scale = contact_scale(p)
    if scale <= 0 or target_r0 >= scale:
        raise R0Unreachable(target_r0, scale, AGE_LEVERS if p.network.network_type == "age_structured" else RANDOM_LEVERS)
    return -365.0 * math.log(1.0 - target_r0 / scale)


def clamp_beta(beta: float) -> float:
    return round(min(1000.0, max(0.001, beta)), 6)


def with_r0(p: SimParamsV2, target_r0: float) -> SimParamsV2:
    out = p.model_copy(deep=True)
    out.disease.beta = clamp_beta(calibrate_beta(p, target_r0))
    return out


def recalibrate_beta(p: SimParamsV2, r0_before: float, before: SimParamsV2) -> SimParamsV2:
    """After a change, hold the R0 the user confirmed; a changed beta means a new
    intended R0, read on the network it was set on (so the beta comes back unchanged)."""
    target = approx_r0(p) if abs(p.disease.beta - before.disease.beta) > 1e-4 else r0_before
    try:
        return with_r0(p, target)
    except R0Unreachable:
        return p
