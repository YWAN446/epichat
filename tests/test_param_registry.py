"""Spec 5.1: one ParamSpec per leaf, consistent with the disease database."""
import json
from pathlib import Path

import pytest

from epichat.params import registry as reg

ROOT = Path(__file__).resolve().parent.parent
DB_PARAMS = ("r0", "incubation_days", "infectious_days", "fatality_rate",
             "average_contacts_daily", "immunity_duration", "asymptomatic_fraction")


def test_paths_are_unique_and_in_module_order():
    paths = [s.path for s in reg.REGISTRY]
    assert len(paths) == len(set(paths))
    modules = [s.module for s in reg.REGISTRY]
    assert modules == sorted(modules, key=["disease", "network", "demographics", "interventions", "run"].index)
    assert paths[0] == "disease.model" and paths[-1] == "run.fit.lever"


def test_every_db_field_exists_in_the_database():
    db = json.loads((ROOT / "epichat" / "data" / "disease_parameters.json").read_text(encoding="utf-8"))
    fields = {f for entry in db["diseases"].values() for f in entry.get("parameters", {})}
    for s in reg.REGISTRY:
        if s.db_field is not None:
            assert s.db_field in DB_PARAMS and s.db_field in fields, s.path


def test_bounds_contain_defaults_and_choices_contain_enum_defaults():
    for s in reg.REGISTRY:
        if s.default is None:
            continue
        if s.bounds is not None:
            lo, hi = s.bounds
            assert lo <= s.default <= hi, s.path
        if s.kind == "enum":
            assert s.choices and s.default in s.choices, s.path


def test_requires_name_registered_paths_and_models_are_known():
    for s in reg.REGISTRY:
        for path in s.requires:
            assert path in reg.REGISTRY_BY_PATH, (s.path, path)
        for m in s.models:
            assert m in reg.MODELS, (s.path, m)


def test_disease_entries_follow_section_7_2():
    assert reg.spec_for("disease.beta").bounds == (0.001, 1000.0) and reg.spec_for("disease.beta").unit == "per year"
    assert reg.spec_for("disease.dur_inf.mean_days").default == 10.0 and reg.spec_for("disease.dur_inf.mean_days").tier == "core"
    assert reg.spec_for("disease.dur_inf.dist").tier == "advanced" and reg.spec_for("disease.dur_inf.sd_days").tier == "advanced"
    assert reg.spec_for("disease.dur_exp.mean_days").models == reg.LATENT_MODELS
    assert reg.spec_for("disease.dur_immune.mean_days").models == reg.WANING_MODELS
    assert reg.spec_for("disease.p_death").models == reg.DEATH_MODELS and reg.spec_for("disease.p_death").db_field == "fatality_rate"
    assert reg.spec_for("disease.sis_waning").default == 0.0 and reg.spec_for("disease.sis_waning").models == ("sis",)
    assert reg.spec_for("disease.seed.mode").choices == ("fraction", "count")
    assert reg.spec_for("disease.initial_immune_frac").bounds == (0.0, 0.99)
    assert reg.spec_for("run.n_replicates").bounds == (1, 5) and reg.spec_for("run.rand_seed").tier == "expert"
    assert reg.spec_for("disease.dur_inf.dist").requires == ("disease.dur_inf.sd_days",)
    with pytest.raises(KeyError):
        reg.spec_for("disease.nope")


def test_applicable_filters_by_model():
    sir = {s.path for s in reg.applicable("sir")}
    seiar = {s.path for s in reg.applicable("seiar")}
    assert "disease.dur_exp.mean_days" not in sir and "disease.dur_exp.mean_days" in seiar
    assert "disease.p_asymp" in seiar and "disease.p_asymp" not in sir
    assert "disease.sis_waning" not in sir and "disease.p_death" not in {s.path for s in reg.applicable("sis")}
    assert "run.n_agents" in sir and "network.n_contacts" in sir


def test_export_is_a_plain_json_document_in_registry_order():
    out = reg.export()
    assert out["version"] == 4 and [p["path"] for p in out["params"]] == [s.path for s in reg.REGISTRY]
    text = json.dumps(out)
    assert json.loads(text) == out
    first = out["params"][0]
    assert set(first) == {"path", "module", "label", "description", "kind", "unit", "default", "bounds", "choices", "models", "tier", "db_field", "starsim_target", "affects", "requires"}
    assert first["choices"] == list(reg.MODELS) and first["models"] == []


def test_registry_bounds_admit_every_database_consensus_value():
    """A disease the database describes must be configurable from its own numbers (tuberculosis
    incubates 14 to 730 days)."""
    db = json.loads((ROOT / "epichat" / "data" / "disease_parameters.json").read_text(encoding="utf-8"))
    checks = {"incubation_days": "disease.dur_exp.mean_days", "infectious_days": "disease.dur_inf.mean_days",
              "immunity_duration": "disease.dur_immune.mean_days"}
    for name, entry in db["diseases"].items():
        for field, path in checks.items():
            consensus = (entry.get("parameters", {}).get(field) or {}).get("consensus") or {}
            lo, hi = reg.spec_for(path).bounds
            for key in ("min", "max", "typical"):
                value = consensus.get(key)
                if value is not None:
                    assert lo <= value <= hi, (name, field, key, value, (lo, hi))


AGE_GROUPS = ("children", "adults", "elderly")


def test_the_age_specific_leaves_and_the_exposed_transmissibility_are_registered():
    for group in AGE_GROUPS:
        sus = reg.spec_for(f"disease.rel_sus_age.{group}")
        assert sus.default == 1.0 and sus.bounds == (0.0, 10.0) and sus.models == () and sus.tier == "advanced"
        death = reg.spec_for(f"disease.p_death_age.{group}")
        assert death.default is None and death.bounds == (0.0, 1.0) and death.models == reg.DEATH_MODELS and death.tier == "advanced"
    exposed = reg.spec_for("disease.rel_trans_exposed")
    assert exposed.default == 0.0 and exposed.bounds == (0.0, 1.0) and exposed.models == reg.LATENT_MODELS
    assert reg.export()["version"] == 4


def test_phase_2b_adds_the_network_demographics_and_run_leaves():
    paths = {s.path for s in reg.REGISTRY}
    for p in ("network.contacts_dist", "network.contact_duration_days", "network.contacts.children_children", "network.contacts.elderly_adults",
              "network.contacts_source", "network.household_size", "network.school_contacts", "network.work_contacts", "network.community_contacts",
              "network.layer_beta.household", "network.layer_beta.community", "network.school_age_min", "network.school_age_max",
              "network.work_age_min", "network.work_age_max", "demographics.age_source", "run.calibrate_r0"):
        assert p in paths, p
    assert reg.spec_for("network.network_type").choices == ("random", "age_structured", "hybrid")
    assert reg.spec_for("network.contacts.adults_adults").default == 9.0 and reg.spec_for("network.contacts.children_elderly").default == 0.5
    assert reg.spec_for("network.contacts.children_adults").bounds == (0.0, 50.0) and reg.spec_for("network.contacts.children_adults").tier == "advanced"
    assert reg.spec_for("network.household_size").tier == "core" and reg.spec_for("network.layer_beta.school").default == 0.6
    assert reg.spec_for("network.contacts_dist").choices == ("constant", "poisson") and reg.spec_for("demographics.age_source").choices == ("default", "shares", "un_wpp")
    assert reg.spec_for("run.calibrate_r0").default is True and reg.spec_for("run.calibrate_r0").kind == "bool"
    assert "no effect on the age-structured" in reg.spec_for("network.n_contacts").description
    assert reg.CONTACT_DEFAULTS == ((7.0, 2.5, 0.5), (2.5, 9.0, 1.5), (0.5, 1.5, 3.5))
    assert reg.export()["version"] == 4


def test_phase_2c_adds_the_intervention_and_fit_leaves():
    paths = {s.path for s in reg.REGISTRY}
    for p in ("interventions[].kind", "interventions[].end_day", "interventions[].efficacy", "interventions[].leaky", "interventions[].age_min",
              "interventions[].age_max", "interventions[].protection_days", "interventions[].delay_days", "interventions[].rel_trans_treated",
              "interventions[].symptomatic_only", "interventions[].layer", "run.fit.target", "run.fit.value", "run.fit.lever"):
        assert p in paths, p
    assert reg.spec_for("interventions[].type").choices == ("vaccine", "treatment", "seasonality", "contact_reduction", "transmission_reduction")
    assert reg.spec_for("interventions[].layer").choices == ("all", "household", "school", "work", "community")
    assert reg.spec_for("interventions[].efficacy").bounds == (0.0, 1.0) and reg.spec_for("interventions[].efficacy").default == 1.0
    assert reg.spec_for("run.fit.target").choices == ("attack_rate", "peak_day", "peak_infections") and reg.spec_for("run.fit.lever").default == "disease.beta"
    assert "contact_reduction" in reg.spec_for("interventions[].scale").description
    assert reg.export()["version"] == 4
