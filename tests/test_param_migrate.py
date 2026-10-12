"""Spec 6.1: v1 flat params become v2 with constant durations and the day-0
vaccine folded into initial_immune_frac; the result builds and runs (Task 10)."""
import pytest
from pydantic import ValidationError

from epichat.params.migrate import coerce_params, is_v1, migrate_v1
from epichat.params.schema_v2 import SimParamsV2
from template_cases import cases


def test_is_v1_means_no_schema_version():
    assert is_v1({"beta": 1.0}) and not is_v1({"schema_version": 2})


def test_durations_become_constant_and_seed_keeps_init_prev():
    p = coerce_params({"disease_type": "seirs", "beta": 12.5, "dur_inf": 7.0, "dur_exp": 4.0, "dur_immune": 90.0, "init_prev": 0.02,
                       "n_agents": 2000, "sim_dur_years": 0.5, "rand_seed": 9, "p_death": 0.1})
    assert p.disease.model == "seirs" and p.disease.beta == 12.5
    assert p.disease.dur_inf.model_dump() == {"mean_days": 7.0, "dist": "constant", "sd_days": None}
    assert p.disease.dur_exp.mean_days == 4.0 and p.disease.dur_immune.mean_days == 90.0
    assert p.disease.seed.model_dump() == {"mode": "fraction", "value": 0.02, "day": 0}
    assert p.run.model_dump() == {"n_agents": 2000, "sim_dur_years": 0.5, "rand_seed": 9, "n_replicates": 1}
    assert p.disease.p_death == 0.1 and p.disease.sis_waning == 0.0 and p.disease.initial_immune_frac == 0.0


def test_missing_optional_v1_fields_take_v2_defaults():
    p = coerce_params({"beta": 22.8125})
    assert p.disease.dur_inf.mean_days == 10.0 and p.disease.seed.value == 0.01 and p.run.n_agents == 10000
    assert p.disease.dur_exp is None and p.network.n_contacts == 4 and p.demographics.use_demographics is False


@pytest.mark.parametrize("name", sorted(cases()))
def test_every_template_case_migrates(name):
    v1 = cases()[name].model_dump()
    p = coerce_params(v1)
    assert p.disease.model == name
    types = [i.type for i in p.interventions]
    vaccine = next(i for i in v1["interventions"] if i["type"] == "vaccine")
    if vaccine["start_day"] == 0:
        assert p.disease.initial_immune_frac == 0.3 and "vaccine" not in types
    else:
        assert p.disease.initial_immune_frac == 0.0 and "vaccine" in types
    assert "treatment" in types and "seasonality" in types
    if name == "seiar":
        assert p.network.network_type == "age_structured" and p.demographics.age_pct_under18 == 30.0
        assert p.demographics.use_demographics and p.demographics.birth_rate == 25.0


def test_day_zero_vaccine_with_full_coverage_is_clamped_not_rejected():
    p = coerce_params({"beta": 5.0, "interventions": [{"type": "vaccination", "coverage": 1.0, "start_day": 0}]})
    assert p.disease.initial_immune_frac == 0.99 and p.interventions == []


def test_v2_input_passes_through_and_invalid_input_raises():
    v2 = SimParamsV2().model_dump()
    assert coerce_params(v2) == SimParamsV2()
    assert coerce_params(SimParamsV2()) == SimParamsV2()
    with pytest.raises(ValidationError):
        coerce_params({"beta": "ten"})
    with pytest.raises(ValidationError):
        coerce_params({"schema_version": 2, "run": {"n_agents": 1}})


def test_a_v1_pydantic_object_is_migrated_too():
    from epichat.schema import SimParams
    assert coerce_params(SimParams(beta=5.0, disease_type="sir")).disease.beta == 5.0


def test_migrate_v1_is_a_pure_dict_transform():
    out = migrate_v1({"disease_type": "sir", "beta": 1.0, "interventions": [{"type": "vaccine", "coverage": 0.4, "start_day": 0}], "country": "KEN"})
    assert out["schema_version"] == 2 and out["disease"]["initial_immune_frac"] == 0.4 and out["interventions"] == []
    assert out["demographics"] == {"country": "KEN"} and out["network"] == {} and out["run"] == {}
