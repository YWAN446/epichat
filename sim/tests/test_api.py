import importlib

import pytest
from fastapi.testclient import TestClient

from epichat.schema import SimParams
from service import Outcome

GOOD_SERIES = {"day": list(range(5)), "n_infected": [1.0, 4.0, 3.0, 2.0, 1.0],
               "cum_infections": [1.0, 5.0, 8.0, 10.0, 11.0], "cum_deaths": [0.0, 0.0, 0.0, 1.0, 1.0]}
PARAMS = {"disease_type": "sir", "beta": 0.05, "n_agents": 1000, "sim_dur_years": 0.1, "rand_seed": 1}
AUTH = {"Authorization": "Bearer test"}


@pytest.fixture
def main(monkeypatch):
    monkeypatch.setenv("SIM_SHARED_SECRET", "test")
    import main as module
    importlib.reload(module)
    return module


@pytest.fixture
def client(main):
    return TestClient(main.app)


def _fake_simulate(outcome: Outcome):
    calls = []

    def fake(params, context_text, settings, run=None, repair=None):
        calls.append((params, context_text, settings))
        return outcome

    fake.calls = calls
    return fake


def _success(params: SimParams) -> Outcome:
    from series import stats_from
    return Outcome(True, 200, params, stats=stats_from(GOOD_SERIES, params.n_agents), series=GOOD_SERIES, attempts=1)


def test_health_needs_no_bearer_and_reports_versions(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["starsim_version"] == "3.3.2"
    assert body["python_version"].startswith("3.") and body["cold_start"] is True


def test_simulate_rejects_missing_and_wrong_bearer(client):
    assert client.post("/simulate", json={"params": PARAMS}).status_code == 401
    r = client.post("/simulate", json={"params": PARAMS}, headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401
    assert r.json() == {"ok": False, "error": {"kind": "unauthorized"}}


def test_demographics_rejects_missing_bearer(client):
    assert client.get("/demographics/KEN").status_code == 401


def test_missing_secret_fails_closed(monkeypatch):
    monkeypatch.delenv("SIM_SHARED_SECRET", raising=False)
    import main as module
    importlib.reload(module)
    r = TestClient(module.app).post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r.status_code == 500
    assert r.json() == {"ok": False, "error": {"kind": "misconfigured"}}


def test_invalid_params_is_422_with_field_errors(client):
    r = client.post("/simulate", json={"params": {"disease_type": "seir", "beta": 0.05}}, headers=AUTH)
    assert r.status_code == 422
    body = r.json()
    assert body["ok"] is False and body["error"]["kind"] == "invalid_params"
    assert any("dur_exp" in e["msg"] for e in body["error"]["detail"])
    r2 = client.post("/simulate", json={"params": "not an object"}, headers=AUTH)
    assert r2.status_code == 422 and r2.json()["error"]["kind"] == "invalid_params"
    r3 = client.post("/simulate", json={"params": PARAMS, "pop_scale": 0.5}, headers=AUTH)
    assert r3.status_code == 422


def test_too_large_is_422_naming_the_cap(client, monkeypatch, main):
    monkeypatch.setenv("SIM_MAX_AGENT_YEARS", "1000")
    r = client.post("/simulate", json={"params": {**PARAMS, "n_agents": 2000, "sim_dur_years": 1.0}}, headers=AUTH)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["kind"] == "too_large" and err["cap"] == 1000 and err["agent_years"] == 2000
    assert "reduce n_agents or sim_dur_years" in err["detail"]


def test_success_scales_thins_and_flips_cold_start(client, main, monkeypatch):
    params = SimParams(**PARAMS)
    fake = _fake_simulate(_success(params))
    monkeypatch.setattr(main, "simulate", fake)
    monkeypatch.setenv("SIM_SERIES_MAX_POINTS", "3")
    r = client.post("/simulate", json={"params": PARAMS, "pop_scale": 100, "context_text": "hi"}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] and body["cold_start"] is True and body["attempts"] == 1
    assert body["population"] == 100000 and body["pop_scale"] == 100
    assert body["stats_agents"]["total_infected"] == 11 and body["stats"]["total_infected"] == 1100
    assert body["stats"]["peak_day"] == 1 and body["stats"]["sim_days"] == 5
    assert body["series"]["day"] == [0, 2, 4] and body["series"]["cum_infections"] == [100, 800, 1100]
    assert body["effective_params"]["n_agents"] == 1000 and body["repairs"] == []
    assert body["starsim_version"] == "3.3.2" and body["duration_ms"] >= 0
    assert fake.calls[0][1] == "hi"
    assert client.get("/health").json()["cold_start"] is False
    r2 = client.post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r2.json()["cold_start"] is False


def test_execution_failed_and_timeout_bodies(client, main, monkeypatch):
    params = SimParams(**PARAMS)
    repairs = [{"attempt": 1, "error": "e1", "changes": [], "usage": {"model": "m", "input_tokens": 1, "output_tokens": 1}}]
    monkeypatch.setattr(main, "simulate", _fake_simulate(Outcome(False, 500, params, repairs=repairs, attempts=2, error="e2")))
    r = client.post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r.status_code == 500
    assert r.json() == {"ok": False, "error": {"kind": "execution_failed", "detail": "e2", "repairs": repairs, "attempts": 2}}
    monkeypatch.setattr(main, "simulate", _fake_simulate(Outcome(False, 504, params, attempts=1, error="t", timed_out=True)))
    r = client.post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r.status_code == 504
    assert r.json() == {"ok": False, "error": {"kind": "timeout", "seconds": 120, "repairs": [], "attempts": 1}}


def test_context_text_is_capped(client):
    r = client.post("/simulate", json={"params": PARAMS, "context_text": "x" * 6001}, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["kind"] == "invalid_params"


def test_demographics_from_the_csv_with_cache_redirected(client, monkeypatch, tmp_path):
    monkeypatch.setenv("EPICHAT_CACHE_DIR", str(tmp_path / "cache"))
    r = client.get("/demographics/ken", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] and body["iso3"] == "KEN"
    assert 20 < body["birth_rate"] < 40 and 3 < body["death_rate"] < 15
    assert "WPP" in body["source"]
    assert list((tmp_path / "cache").glob("KEN_*.json"))


def test_demographics_unknown_code_is_404(client, monkeypatch, tmp_path):
    monkeypatch.setenv("EPICHAT_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr("epichat.data_loaders.demographics._fetch_data360", lambda *a, **k: None)
    r = client.get("/demographics/XXX", headers=AUTH)
    assert r.status_code == 404
    assert r.json() == {"ok": False, "error": {"kind": "not_found"}}
