"""The demographics loader must write its cache where the environment says
and must not fail when it cannot write at all (Vercel's filesystem is
read-only outside the temp directory)."""
import json

from epichat.data_loaders import demographics


def _stub_sources(monkeypatch):
    monkeypatch.setattr(demographics, "_fetch_unwpp", lambda iso3, year: {
        "birth_rate": 20.5, "death_rate": 6.1, "life_expectancy": 70.0,
        "fertility_rate": 2.9, "infant_mortality": 30.0, "source": "stub WPP",
    })
    monkeypatch.setattr(demographics, "_fetch_who_mortality", lambda iso3, year=None: None)
    monkeypatch.setattr(demographics, "_fetch_data360", lambda *a, **k: None)


def test_cache_dir_comes_from_the_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("EPICHAT_CACHE_DIR", str(tmp_path / "cache"))
    assert demographics.cache_dir() == tmp_path / "cache"


def test_cache_dir_defaults_next_to_the_data(monkeypatch):
    monkeypatch.delenv("EPICHAT_CACHE_DIR", raising=False)
    assert demographics.cache_dir() == demographics.DATA_PATH / "cache"


def test_lookup_writes_the_cache_where_told(monkeypatch, tmp_path):
    _stub_sources(monkeypatch)
    monkeypatch.setenv("EPICHAT_CACHE_DIR", str(tmp_path / "cache"))
    result = demographics.get_country_demographics("ZZZ", 2022)
    assert result["birth_rate"] == 20.5
    written = json.loads((tmp_path / "cache" / "ZZZ_2022.json").read_text())
    assert written["death_rate"] == 6.1


def test_lookup_survives_an_unwritable_cache(monkeypatch, tmp_path):
    _stub_sources(monkeypatch)
    blocker = tmp_path / "blocker"
    blocker.write_text("not a directory")
    monkeypatch.setenv("EPICHAT_CACHE_DIR", str(blocker / "cache"))  # mkdir will fail: parent is a file
    result = demographics.get_country_demographics("ZZY", 2022)
    assert result["birth_rate"] == 20.5
    assert not (blocker / "cache").exists()
