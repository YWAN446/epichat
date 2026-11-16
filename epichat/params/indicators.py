"""Follow-up spec 7.2: the diseases with a routine-immunization coverage indicator (WHO GHO codes), in one place the service and
the web app share. The frozen Python agent keeps its own copy (epichat/agent.py, _GHO_CODES); a test keeps the two equal."""
from __future__ import annotations

VACCINE_INDICATORS: dict[str, list[str]] = {
    "measles": ["WHS8_110", "MCV2"],
    "rubella": ["WHS8_110"],
    "pertussis": ["WHS3_41"],
    "polio": ["WHS3_43"],
    "hepatitis_a": ["WHS3_45"],
    "tuberculosis": ["WHS3_40"],
    "meningococcal": ["MENGA"],
}


def has_vaccine_indicator(disease: str | None) -> bool:
    """Whether the disease (a name as the conversation gives it) has an indicator, by its canonical name."""
    if not disease:
        return False
    from epichat.disease_db import detect_disease
    return (detect_disease(disease) or disease.lower()) in VACCINE_INDICATORS
