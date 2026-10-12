"""Spec 6: nested parameters with bounds generated from the registry, and the
dotted-path helpers the service and the tools use."""
import pytest
from pydantic import ValidationError

from epichat.params import paths
from epichat.params.registry import REGISTRY, REGISTRY_BY_PATH
from epichat.params.schema_v2 import Duration, Seed, SimParamsV2, sim_days


def v2(**over) -> SimParamsV2:
    return SimParamsV2.model_validate(over)


def test_defaults_match_the_registry_on_every_leaf():
    dumped = paths.flatten(v2().model_dump())
    for spec in REGISTRY:
        if spec.path.startswith("interventions[]") or spec.path not in dumped:   # optional blocks (dur_exp, dur_immune) are unset by default
            continue
        assert dumped[spec.path] == spec.default, spec.path
    assert dumped["disease.dur_inf.mean_days"] == 10.0 and dumped["disease.dur_inf.dist"] == "constant"
    assert dumped["disease.seed.value"] == 0.01 and dumped["schema_version"] == 2


def test_every_leaf_has_exactly_one_param_spec():
    full = v2(disease={"model": "seirs", "dur_exp": {"mean_days": 3}, "dur_immune": {"mean_days": 90}},
              interventions=[{"type": "treatment", "capacity": 5}]).model_dump()
    leaves = {p for p in paths.flatten(full) if not p.startswith("interventions")} - {"schema_version"}
    registered = {p for p in REGISTRY_BY_PATH if not p.startswith("interventions[]")}
    assert leaves == registered
    assert {p.split(".", 1)[1] for p in REGISTRY_BY_PATH if p.startswith("interventions[]")} == {"type", "coverage", "start_day", "capacity", "scale", "shift"}


def test_bounds_come_from_the_registry():
    with pytest.raises(ValidationError, match="disease.dur_inf.mean_days must be between 0.5 and 365 days"):
        v2(disease={"dur_inf": {"mean_days": 400}})
    with pytest.raises(ValidationError, match="n_agents"):
        v2(run={"n_agents": 5})
    with pytest.raises(ValidationError):
        v2(disease={"beta": 0.0001})
    assert v2(disease={"beta": 1000}).disease.beta == 1000


def test_duration_validators():
    assert Duration(mean_days=10).dist == "constant" and Duration(mean_days=10).sd_days is None
    with pytest.raises(ValidationError, match="sd_days is required when dist is 'gamma'"):
        Duration(mean_days=10, dist="gamma")
    with pytest.raises(ValidationError, match="at most 2"):
        Duration(mean_days=10, dist="gamma", sd_days=25)
    assert Duration(mean_days=10, dist="lognormal", sd_days=4).sd_days == 4


def test_seed_validators():
    assert Seed(value=0.05).mode == "fraction" and Seed(value=0.05).day == 0
    with pytest.raises(ValidationError, match="between 0 and 1"):
        Seed(value=1.0)
    with pytest.raises(ValidationError, match="integer count"):
        Seed(mode="count", value=2.5)
    assert Seed(mode="count", value=20).value == 20
    with pytest.raises(ValidationError, match="disease.seed.value .* run.n_agents"):
        v2(disease={"seed": {"mode": "count", "value": 500}}, run={"n_agents": 100})
    with pytest.raises(ValidationError, match="disease.seed.day"):
        v2(disease={"seed": {"value": 0.01, "day": 400}}, run={"sim_dur_years": 0.5})


def test_model_requirements_name_the_path():
    with pytest.raises(ValidationError, match="disease.dur_exp is required when disease.model is 'seir', 'seirs', or 'seiar'"):
        v2(disease={"model": "seir"})
    with pytest.raises(ValidationError, match="disease.dur_immune is required"):
        v2(disease={"model": "sirs"})
    p = v2(disease={"model": "seirs", "dur_exp": {"mean_days": 3}, "dur_immune": {"mean_days": 90}})
    assert p.disease.dur_exp.mean_days == 3 and p.disease.dur_immune.dist == "constant"


def test_day_zero_vaccine_becomes_initial_immunity():
    p = v2(interventions=[{"type": "vaccination", "coverage": 0.6, "start_day": 0}, {"type": "treatment", "capacity": 5}])
    assert p.disease.initial_immune_frac == 0.6 and [i.type for i in p.interventions] == ["treatment"]
    assert v2(interventions=[{"type": "vaccine", "coverage": 1.0}]).disease.initial_immune_frac == 0.99
    later = v2(interventions=[{"type": "vaccine", "coverage": 0.6, "start_day": 30}])
    assert later.disease.initial_immune_frac == 0.0 and later.interventions[0].start_day == 30
    assert v2(disease={"initial_immune_frac": 0.6}, interventions=[{"type": "vaccine", "coverage": 0.6}]).disease.initial_immune_frac == 0.6
    with pytest.raises(ValidationError, match="initial_immune_frac"):
        v2(disease={"initial_immune_frac": 0.3}, interventions=[{"type": "vaccine", "coverage": 0.6}])


def test_per_contact_probability_cannot_exceed_one():
    with pytest.raises(ValidationError, match="network.network_beta"):
        v2(disease={"beta": 1000}, network={"network_beta": 10})
    assert v2(disease={"beta": 1000}, network={"network_beta": 1.0}).network.network_beta == 1.0


def test_demographics_keep_the_v1_rules():
    with pytest.raises(ValidationError, match="sum to 100"):
        v2(demographics={"age_pct_under18": 10, "age_pct_18_64": 10, "age_pct_over65": 10})
    assert v2(demographics={"country": "ken"}).demographics.country == "KEN"
    assert v2(demographics={"country": "Brazil"}).demographics.country is None


def test_sim_days_rounds_years_to_whole_days():
    assert sim_days(1.0) == 365 and sim_days(30 / 365) == 30 and sim_days(0.001) == 1 and sim_days(2.0) == 730


def test_dumps_round_trip():
    p = v2(disease={"model": "seiar", "dur_exp": {"mean_days": 5, "dist": "gamma", "sd_days": 2}}, run={"n_replicates": 3})
    assert SimParamsV2.model_validate(p.model_dump()) == p
    assert p.model_dump(mode="json")["disease"]["dur_exp"] == {"mean_days": 5.0, "dist": "gamma", "sd_days": 2.0}


def test_path_helpers():
    d = {"a": {"b": 1, "c": {"d": [1, 2]}}, "e": None}
    assert paths.flatten(d) == {"a.b": 1, "a.c.d": [1, 2], "e": None}
    assert paths.get_path(d, "a.c.d") == [1, 2] and paths.get_path(d, "a.x") is None
    paths.set_path(d, "a.c.f", 3)
    paths.set_path(d, "g.h", 4)
    assert d["a"]["c"]["f"] == 3 and d["g"] == {"h": 4}
    assert paths.diff({"a": {"b": 1}, "x": 2}, {"a": {"b": 5}, "x": 2, "y": [1]}) == [
        {"field": "a.b", "from": 1, "to": 5}, {"field": "y", "from": None, "to": [1]}]
