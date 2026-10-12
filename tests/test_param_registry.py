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
    assert paths[0] == "disease.model" and paths[-1] == "run.rand_seed"


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
    assert out["version"] == 1 and [p["path"] for p in out["params"]] == [s.path for s in reg.REGISTRY]
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
