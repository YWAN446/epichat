"""R0 and beta on schema v2.

beta is a rate per contact per year, scaled by network_beta, so each contact transmits at
network_beta × beta / 365 per day. An infection transmits for D_eff days: the mean infectious period scaled
by the asymptomatic factor, plus the mean latent period at rel_trans_exposed. With well-mixed contacts
R0 = n_contacts × rate × D_eff; with the age-structured contact matrix R0 = rho(C · diag(rel_sus)) × rate × D_eff.
Both are exact for the compartmental run Starsim chooses for these networks (its own R0() agrees). On the
hybrid network, or with lasting contacts, the run is agents on a network and the formula is an approximation."""
from __future__ import annotations


import numpy as np

from .registry import CONTACT_DEFAULTS, LATENT_MODELS
from .schema_v2 import DiseaseParams, SimParamsV2

CONTACT_MATRIX = np.array(CONTACT_DEFAULTS)          # the POLYMOD-like default (Part 1, section 18); the parameters may carry another
CONTACT_SPECTRAL_RADIUS = float(np.linalg.eigvals(CONTACT_MATRIX).real.max())
RANDOM_LEVERS = ("network.n_contacts", "disease.dur_inf.mean_days")
AGE_LEVERS = ("network.network_beta", "disease.dur_inf.mean_days")
HYBRID_LEVERS = ("network.household_size", "network.community_contacts", "disease.dur_inf.mean_days")
AGE_BANDS = ((0.0, 18.0), (18.0, 65.0), (65.0, 95.0))    # the shares path draws ages uniformly within these bands (builder)
DEFAULT_AGE_SHARES = (0.29, 0.61, 0.10)   # Starsim's default ages: the world's population


def age_shares(p: SimParamsV2) -> tuple[float, float, float]:
    """The share of agents in each age group: the fetched shares when all three are set, else the default ages'."""
    g = p.demographics
    if g.age_pct_under18 is not None and g.age_pct_18_64 is not None and g.age_pct_over65 is not None:
        return (g.age_pct_under18 / 100.0, g.age_pct_18_64 / 100.0, g.age_pct_over65 / 100.0)
    return DEFAULT_AGE_SHARES


def exposed_days(d: DiseaseParams) -> float:
    """The mean latent period (0 outside the latent models)."""
    if d.model not in LATENT_MODELS or d.dur_exp is None:
        return 0.0
    return float(d.dur_exp.mean_days)


class R0Unreachable(ValueError):
    def __init__(self, target: float, maximum: float, levers: tuple[str, ...]):
        self.target, self.maximum, self.levers = target, maximum, levers
        super().__init__(f"R0 {target:g} is not reachable: the most the contacts and infectious period can carry is "
                         f"{maximum:.2f}; raise {' or '.join(levers)}")


def per_contact_rate(beta: float) -> float:
    """Transmissions per contact per day at network_beta 1."""
    return beta / 365.0


def asymp_factor(d: DiseaseParams) -> float:
    return 1.0 - d.p_asymp * (1.0 - d.rel_trans_asymp) if d.model == "seiar" else 1.0


def infectious_days(d: DiseaseParams) -> float:
    """The mean infectious period."""
    return float(d.dur_inf.mean_days)


def effective_days(d: DiseaseParams) -> float:
    """The transmission-weighted days of one infection: the infectious days scaled by the asymptomatic factor
    (seiar) plus the exposed days at rel_trans_exposed, whatever the agent's track (Part 2, 4.3 and 4.4)."""
    return infectious_days(d) * asymp_factor(d) + d.rel_trans_exposed * exposed_days(d)


def contact_matrix(p: SimParamsV2) -> np.ndarray:
    """The age-structured network's matrix as configured: rows source, columns target (Part 2, 5.3)."""
    return np.array(p.network.contacts.as_rows(), dtype=float)


def age_range_share(shares, lo: float, hi: float) -> float:
    """The share of agents aged lo to hi (hi excluded) when ages are uniform within the three bands."""
    total = 0.0
    for s, (a, b) in zip(shares, AGE_BANDS):
        total += s * max(0.0, min(hi, b) - max(lo, a)) / (b - a)
    return total


def hybrid_contacts(p: SimParamsV2) -> float:
    """Part 2, 5.5: sum over the four layers of beta_l × c_l, c_l the agent-weighted mean daily contacts of layer l: the household size
    itself for households (a member of a Poisson(λ) household has λ other members on average), the layer's contacts times the share of
    agents in its age range for schools and workplaces, the community contacts as given."""
    n, s, lb = p.network, age_shares(p), p.network.layer_beta
    return (lb.household * n.household_size
            + lb.school * n.school_contacts * age_range_share(s, n.school_age_min, n.school_age_max)
            + lb.work * n.work_contacts * age_range_share(s, n.work_age_min, n.work_age_max)
            + lb.community * n.community_contacts)


def r0_is_approximate(p: SimParamsV2) -> bool:
    """No closed form holds with lasting contacts or on the hybrid network: those run as agents on a network."""
    return p.network.network_type == "hybrid" or p.network.contact_duration_days > 0


def contact_scale(p: SimParamsV2) -> float:
    n = p.network
    r = p.disease.rel_sus_age.as_tuple()
    s = age_shares(p)
    mean_r = sum(si * ri for si, ri in zip(s, r))
    if n.network_type == "age_structured":
        # Each target group's column of the next-generation matrix scales by its susceptibility: rho(C · diag(r)) (Part 2, 4.4).
        contacts = float(np.linalg.eigvals(contact_matrix(p) @ np.diag(r)).real.max())
    elif n.network_type == "hybrid":
        contacts = hybrid_contacts(p) * mean_r
    else:
        contacts = n.n_contacts * mean_r
    return contacts * n.network_beta * effective_days(p.disease)


def weighted_cfr(p: SimParamsV2) -> float:
    """The population case fatality ratio: the groups' values weighted by their shares (the scalar where a group has none)."""
    return float(sum(s * q for s, q in zip(age_shares(p), p.disease.death_probabilities())))


BETA_MAX = 1000.0      # the registry's upper bound on disease.beta


def approx_r0(p: SimParamsV2) -> float:
    return contact_scale(p) * per_contact_rate(p.disease.beta)


def max_r0(p: SimParamsV2) -> float:
    return contact_scale(p) * per_contact_rate(BETA_MAX)


def calibrate_beta(p: SimParamsV2, target_r0: float) -> float:
    scale = contact_scale(p)
    if scale <= 0 or target_r0 > max_r0(p):
        levers = {"hybrid": HYBRID_LEVERS, "age_structured": AGE_LEVERS}.get(p.network.network_type, RANDOM_LEVERS)
        raise R0Unreachable(target_r0, max_r0(p), levers)
    return 365.0 * target_r0 / scale


def clamp_beta(beta: float) -> float:
    return round(min(BETA_MAX, max(0.001, beta)), 6)


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
