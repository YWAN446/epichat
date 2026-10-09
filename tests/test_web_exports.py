"""The web app's data files are produced by Python and committed. These tests
prove the scripts are deterministic and that the committed files are fresh,
so a change on the Python side cannot leave the TypeScript side stale."""
import importlib.util
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _same(generated: Path, committed: Path):
    assert committed.exists(), f"{committed} is missing: run `npm --prefix web run sync-data`"
    assert generated.read_text(encoding="utf-8") == committed.read_text(encoding="utf-8"), (
        f"{committed.relative_to(ROOT)} is stale: run `npm --prefix web run sync-data`")


def test_export_web_data_is_deterministic_and_fresh(tmp_path):
    mod = _load("export_web_data")
    mod.main(tmp_path)
    mod.main(tmp_path / "again")
    for name in ("disease_db.json", "system_prompt.json", "disease_refs.json"):
        assert (tmp_path / "data" / name).read_bytes() == (tmp_path / "again" / "data" / name).read_bytes()
        _same(tmp_path / "data" / name, WEB / "data" / name)


def test_disease_db_export_shape(tmp_path):
    mod = _load("export_web_data")
    mod.main(tmp_path)
    db = json.loads((tmp_path / "data" / "disease_db.json").read_text(encoding="utf-8"))
    keys = list(db["diseases"])
    assert keys[:2] == ["measles", "covid19"] and len(keys) == 16
    measles = db["diseases"]["measles"]
    assert measles["summaries"]["r0"]["status"] == "ok"
    assert measles["flat"]["r0"]["range_text"] == "12–18"
    assert db["diseases"]["dengue"]["flat"]["r0"]["range_text"] == "1.0–103.0"
    assert db["diseases"]["dengue"]["flat"]["fatality_rate"] is None
    assert measles["summaries"]["immunity_duration"]["status"] == "estimates_only"
    prompt = json.loads((tmp_path / "data" / "system_prompt.json").read_text(encoding="utf-8"))
    assert prompt["system"].startswith("You are EpiChat") and "—" in prompt["system"]


def test_export_parity_fixtures_is_deterministic_and_fresh(tmp_path):
    mod = _load("export_parity_fixtures")
    mod.main(tmp_path)
    mod.main(tmp_path / "again")
    fixtures = tmp_path / "tests" / "fixtures"
    for rel in sorted(p.relative_to(fixtures) for p in fixtures.rglob("*") if p.is_file()):
        assert (fixtures / rel).read_bytes() == (tmp_path / "again" / "tests" / "fixtures" / rel).read_bytes()
        _same(fixtures / rel, WEB / "tests" / "fixtures" / rel)
    parity = json.loads((fixtures / "parity.json").read_text(encoding="utf-8"))
    assert len(parity["params"]) >= 200
    assert len(parity["warnings"]) >= 300
    assert all(len(case["calibrate"]) == 3 for case in parity["params"])
    assert any(case["warnings"] for case in parity["warnings"])
    assert parity["adapters"]["un_wpp"] and parity["adapters"]["who_gho"] and parity["adapters"]["wb_data360"]


def test_un_locations_table_is_committed():
    table = json.loads((WEB / "data" / "un_locations.json").read_text(encoding="utf-8"))
    assert len(table) >= 200
    assert table["KEN"] == 404 and table["USA"] == 840 and table["BRA"] == 76
    assert list(table) == sorted(table)


@pytest.mark.skipif(not os.environ.get("EPICHAT_TEST_LIVE"), reason="Set EPICHAT_TEST_LIVE=1 to refresh from the UN API")
def test_un_locations_export_matches_the_committed_table(tmp_path):
    mod = _load("export_un_locations")
    mod.main(tmp_path)
    _same(tmp_path / "data" / "un_locations.json", WEB / "data" / "un_locations.json")


def test_disease_refs_export_shape(tmp_path):
    """Every literature estimate behind a parameter, with its citation, for the panel's reference list."""
    mod = _load("export_web_data")
    mod.main(tmp_path)
    refs = json.loads((tmp_path / "data" / "disease_refs.json").read_text(encoding="utf-8"))
    assert list(refs["diseases"]) == list(json.loads((tmp_path / "data" / "disease_db.json").read_text(encoding="utf-8"))["diseases"])
    r0 = refs["diseases"]["measles"]["parameters"]["r0"]
    assert r0["source"] == "https://pubmed.ncbi.nlm.nih.gov/28757186/"
    assert len(r0["estimates"]) == 11
    first = r0["estimates"][0]
    assert first["title"] == "The basic reproduction number (R0) of measles: a systematic review"
    assert first["value"] == 15 and first["year"] == 2017 and first["doi"] == "10.1016/S1473-3099(17)30307-9"
    assert "notes" in first and "range" in first
    assert refs["diseases"]["dengue"]["parameters"]["fatality_rate"] == {"source": None, "estimates": []}
    total = sum(len(p["estimates"]) for d in refs["diseases"].values() for p in d["parameters"].values())
    assert total >= 150


def test_country_names_table_is_committed():
    table = json.loads((WEB / "data" / "country_names.json").read_text(encoding="utf-8"))
    assert len(table) >= 200
    assert table["KEN"] == "Kenya" and table["BRA"] == "Brazil"
    assert list(table) == sorted(table)
