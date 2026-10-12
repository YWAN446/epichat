"""Country-driven demographics on schema v2 (the v2 port of
generator.resolve_demographics). Values still at their defaults are filled
from country data; when the contact count changes, beta is re-solved for the
R0 the scenario had, with the exact formula (spec 7.4)."""
from __future__ import annotations

import logging

from .r0 import R0Unreachable, approx_r0, calibrate_beta, clamp_beta
from .schema_v2 import DemographicsParams, NetworkParams, SimParamsV2

logger = logging.getLogger(__name__)


def resolve_demographics(params: SimParamsV2) -> SimParamsV2:
    d = params.demographics
    if not d.country or not d.auto_demographics:
        return params
    p = params.model_copy(deep=True)
    defaults = DemographicsParams()
    try:
        from epichat.data_loaders.demographics import get_country_demographics
        demo = get_country_demographics(d.country, d.demographics_year)
        if p.demographics.birth_rate == defaults.birth_rate:
            p.demographics.birth_rate = demo["birth_rate"]
        if p.demographics.death_rate == defaults.death_rate:
            p.demographics.death_rate = demo["death_rate"]
        p.demographics.use_demographics = True
        p.demographics.demographics_source = demo["source"]
    except ValueError as e:
        logger.warning("Demographics lookup failed for %s: %s — keeping the defaults", d.country, e)

    if p.network.n_contacts == NetworkParams().n_contacts:
        try:
            from epichat.data_loaders.contact_matrices import get_mean_contacts
            n = get_mean_contacts(d.country)
        except Exception:
            logger.debug("Contact matrix lookup failed for %s", d.country, exc_info=True)
            n = None
        if n is not None and int(round(n)) != p.network.n_contacts:
            r0_before = approx_r0(p)
            p.network.n_contacts = int(round(n))
            try:
                p.disease.beta = clamp_beta(calibrate_beta(p, r0_before))
            except R0Unreachable as e:
                logger.warning("n_contacts set to %d for %s but %s; beta kept", p.network.n_contacts, d.country, e)
    return SimParamsV2.model_validate(p.model_dump())
