import pytest
from pydantic import ValidationError

from epichat.schema import OutbreakContext


def test_all_fields_default_to_none():
    ctx = OutbreakContext(input_type="query")
    assert ctx.disease_name is None
    assert ctx.location is None
    assert ctx.total_cases is None
    assert ctx.total_deaths is None
    assert ctx.case_fatality_rate is None
    assert ctx.r0_estimate is None
    assert ctx.incubation_period_days is None
    assert ctx.infectious_period_days is None
    assert ctx.affected_population is None
    assert ctx.source_url is None
    assert ctx.pathogen_type is None
    assert ctx.geographic_scale is None
    assert ctx.outbreak_start_date is None
    assert ctx.outbreak_end_date is None
    assert ctx.interventions_mentioned == []
    assert ctx.confidence == "low"


def test_partial_fields_validate():
    ctx = OutbreakContext(
        input_type="report",
        disease_name="Mpox",
        location="Nigeria",
        total_cases=1240,
        total_deaths=38,
        confidence="high",
    )
    assert ctx.case_fatality_rate is None
    assert ctx.interventions_mentioned == []


def test_invalid_input_type_raises():
    with pytest.raises(ValidationError):
        OutbreakContext(input_type="unknown_type")


def test_invalid_geographic_scale_raises():
    with pytest.raises(ValidationError):
        OutbreakContext(input_type="query", geographic_scale="continent")


def test_negative_counts_raise():
    with pytest.raises(ValidationError):
        OutbreakContext(input_type="query", total_cases=-1)
    with pytest.raises(ValidationError):
        OutbreakContext(input_type="query", total_deaths=-1)
