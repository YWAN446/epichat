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
              interventions=[{"type": "treatment", "capacity": 5}], run={"fit": {"target": "attack_rate", "value": 0.3}}).model_dump()
    leaves = {p for p in paths.flatten(full) if not p.startswith("interventions")} - {"schema_version"}
    registered = {p for p in REGISTRY_BY_PATH if not p.startswith("interventions[]")}
    assert leaves == registered
    assert {p.split(".", 1)[1] for p in REGISTRY_BY_PATH if p.startswith("interventions[]")} == {"type", "coverage", "start_day", "capacity", "scale", "shift", "end_day", "kind", "efficacy", "leaky", "age_min", "age_max", "protection_days", "delay_days", "rel_trans_treated", "symptomatic_only", "layer"}


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


def test_age_multipliers_fatality_by_age_and_exposed_transmissibility_default_and_validate():
    p = SimParamsV2()
    assert p.disease.rel_sus_age.model_dump() == {"children": 1.0, "adults": 1.0, "elderly": 1.0}
    assert p.disease.p_death_age.model_dump() == {"children": None, "adults": None, "elderly": None}
    assert p.disease.rel_trans_exposed == 0.0
    q = SimParamsV2.model_validate({"disease": {"model": "seir", "dur_exp": {"mean_days": 5}, "p_death": 0.01,
                                                "rel_sus_age": {"children": 1.5, "elderly": 0.7}, "p_death_age": {"elderly": 0.1},
                                                "rel_trans_exposed": 0.5}})
    assert q.disease.rel_sus_age.adults == 1.0 and q.disease.rel_sus_age.elderly == 0.7
    assert q.disease.death_probabilities() == (0.01, 0.01, 0.1)
    with pytest.raises(ValidationError):
        SimParamsV2.model_validate({"disease": {"rel_sus_age": {"children": 11}}})
    with pytest.raises(ValidationError):
        SimParamsV2.model_validate({"disease": {"p_death_age": {"adults": 1.5}}})
    with pytest.raises(ValidationError):
        SimParamsV2.model_validate({"disease": {"model": "seir", "dur_exp": {"mean_days": 5}, "rel_trans_exposed": -0.1}})


def test_network_leaves_default_and_round_trip():
    from epichat.params.schema_v2 import ContactMatrix
    p = v2()
    n = p.network
    assert n.network_type == "random" and n.contacts_dist == "constant" and n.contact_duration_days == 0.0 and n.contacts_source == "polymod_default"
    assert n.contacts.as_rows() == [[7.0, 2.5, 0.5], [2.5, 9.0, 1.5], [0.5, 1.5, 3.5]]
    assert (n.household_size, n.school_contacts, n.work_contacts, n.community_contacts) == (2.0, 20, 16, 20)
    assert (n.layer_beta.household, n.layer_beta.school, n.layer_beta.work, n.layer_beta.community) == (3.0, 0.6, 0.6, 0.3)
    assert (n.school_age_min, n.school_age_max, n.work_age_min, n.work_age_max) == (6, 22, 22, 65)
    assert p.demographics.age_source == "default" and p.run.calibrate_r0 is True
    hybrid = v2(network={"network_type": "hybrid", "household_size": 4.5, "contacts": {"adults_adults": 12.0}})
    assert hybrid.network.household_size == 4.5 and hybrid.network.contacts.adults_adults == 12.0 and hybrid.network.contacts.children_children == 7.0
    assert ContactMatrix.from_rows([[1, 2, 3], [4, 5, 6], [7, 8, 9]]).as_rows() == [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [7.0, 8.0, 9.0]]


def test_network_bounds_and_age_ranges_are_checked():
    with pytest.raises(ValidationError):
        v2(network={"household_size": 0.5})
    with pytest.raises(ValidationError):
        v2(network={"contacts": {"adults_adults": 60.0}})
    with pytest.raises(ValidationError, match="school_age_min"):
        v2(network={"school_age_min": 22, "school_age_max": 22})
    with pytest.raises(ValidationError, match="work_age_min"):
        v2(network={"work_age_min": 70, "work_age_max": 65})
    with pytest.raises(ValidationError):
        v2(network={"network_type": "cluster"})
    with pytest.raises(ValidationError):
        v2(demographics={"age_source": "census"})


def test_intervention_entries_gain_their_fields_with_defaults():
    p = v2(interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 30}, {"type": "treatment", "coverage": 0.8, "capacity": 20},
                          {"type": "contact_reduction", "layer": "school", "scale": 0.0, "start_day": 30, "end_day": 72},
                          {"type": "transmission_reduction", "scale": 0.3, "start_day": 0, "end_day": 90},
                          {"type": "seasonality", "scale": 0.2, "peak_day": 365 // 4}],
           network={"network_type": "hybrid"})
    vaccine, treatment, closure, masks, season = p.interventions
    assert (vaccine.kind, vaccine.end_day, vaccine.efficacy, vaccine.leaky, vaccine.age_min, vaccine.age_max, vaccine.protection_days) == ("routine", None, 1.0, True, None, None, None)
    assert (treatment.delay_days, treatment.rel_trans_treated, treatment.symptomatic_only, treatment.efficacy) == (0, 1.0, False, 1.0)
    assert treatment.is_v1_treatment() and not v2(interventions=[{"type": "treatment", "delay_days": 2}]).interventions[0].is_v1_treatment()
    assert (closure.layer, closure.scale, closure.start_day, closure.end_day) == ("school", 0.0, 30, 72)
    assert (masks.scale, masks.end_day) == (0.3, 90)
    assert season.shift == pytest.approx((365 // 4) / 365)
    assert p.run.fit is None


def test_a_day_zero_vaccine_folds_into_initial_immunity_only_at_full_efficacy():
    folded = v2(interventions=[{"type": "vaccine", "coverage": 0.4, "start_day": 0}])
    assert folded.disease.initial_immune_frac == 0.4 and folded.interventions == []
    leaky = v2(interventions=[{"type": "vaccine", "coverage": 0.4, "start_day": 0, "efficacy": 0.6}])
    assert leaky.disease.initial_immune_frac == 0.0 and leaky.interventions[0].efficacy == 0.6 and leaky.interventions[0].start_day == 0
    assert not leaky.interventions[0].is_day0_immunity()


def test_layers_belong_to_the_hybrid_network_and_windows_are_ordered():
    with pytest.raises(ValidationError, match="layer"):
        v2(interventions=[{"type": "contact_reduction", "layer": "school", "scale": 0.5}])          # random network has no school layer
    v2(interventions=[{"type": "contact_reduction", "layer": "all", "scale": 0.5}])
    with pytest.raises(ValidationError, match="end_day"):
        v2(interventions=[{"type": "transmission_reduction", "scale": 0.5, "start_day": 40, "end_day": 10}])
    with pytest.raises(ValidationError):
        v2(interventions=[{"type": "vaccine", "coverage": 0.5, "start_day": 1, "efficacy": 1.5}])
    with pytest.raises(ValidationError):
        v2(interventions=[{"type": "contact_reduction", "layer": "roads", "scale": 0.5}], network={"network_type": "hybrid"})


def test_the_fit_validates_its_target_value_and_lever():
    from epichat.params.schema_v2 import Fit
    p = v2(run={"fit": {"target": "attack_rate", "value": 0.3}})
    assert p.run.fit == Fit(target="attack_rate", value=0.3, lever="disease.beta")
    assert v2(run={"fit": {"target": "peak_day", "value": 60, "lever": "network.network_beta"}}).run.fit.lever == "network.network_beta"
    with pytest.raises(ValidationError):
        v2(run={"fit": {"target": "deaths", "value": 10}})
    with pytest.raises(ValidationError):
        v2(run={"fit": {"target": "attack_rate", "value": 1.5}})
    with pytest.raises(ValidationError):
        v2(run={"fit": {"target": "peak_day", "value": 0}})


def test_the_day_zero_fold_keeps_only_the_v1_shaped_vaccine():
    # review I4: ages, a window, waning and all-or-nothing were lost by the fold; those entries stay (and run as a day-0 campaign)
    for extra in ({"age_min": 5, "age_max": 18}, {"kind": "campaign", "end_day": 30}, {"protection_days": 100}, {"leaky": False}, {"kind": "campaign"}):
        p = v2(interventions=[{"type": "vaccine", "coverage": 0.9, "start_day": 0, **extra}])
        assert p.disease.initial_immune_frac == 0.0 and len(p.interventions) == 1 and not p.interventions[0].is_day0_immunity(), extra
    assert v2(interventions=[{"type": "vaccine", "coverage": 0.9, "start_day": 0}]).disease.initial_immune_frac == 0.9
