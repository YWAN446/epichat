"""Follow-up spec 7.2: the diseases with a routine-immunization coverage indicator, in one place the service and the web
app share. The codes are the sources' own: UNICEF's WHO/UNICEF estimates (IM_), and the World Bank's Pol3 (WB_HNP_),
since UNICEF publishes no Pol3 series. WHO's GHO API, which the frozen Python agent still names (epichat/agent.py,
_GHO_CODES), was retired at the end of 2025."""
from __future__ import annotations

VACCINE_INDICATORS: dict[str, list[str]] = {
    "measles": ["IM_MCV1", "IM_MCV2"],
    "rubella": ["IM_RCV1"],
    "pertussis": ["IM_DTP3"],
    "polio": ["WB_HNP_SH_IMM_POL3"],
    "tuberculosis": ["IM_BCG"],
    "meningococcal": ["IM_MENGA"],
}

# The diseases the what_if diagnostic offers a vaccination campaign for. Hepatitis A has a vaccine but no coverage series.
VACCINE_DISEASES: frozenset[str] = frozenset(VACCINE_INDICATORS) | {"hepatitis_a"}


def _canonical(disease: str) -> str:
    from epichat.disease_db import detect_disease
    return detect_disease(disease) or disease.lower()


def has_vaccine_indicator(disease: str | None) -> bool:
    """Whether the disease (a name as the conversation gives it) has an indicator, by its canonical name."""
    return bool(disease) and _canonical(disease) in VACCINE_INDICATORS


def has_vaccine(disease: str | None) -> bool:
    """Whether the disease has a routine vaccine a campaign could use, by its canonical name."""
    return bool(disease) and _canonical(disease) in VACCINE_DISEASES
