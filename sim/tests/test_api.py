import importlib

import pytest
from fastapi.testclient import TestClient

from epichat.params.migrate import coerce_params
from epichat.params.schema_v2 import SimParamsV2
from service import Outcome

GOOD_SERIES = {"day": list(range(5)), "n_infectious": [1.0, 4.0, 3.0, 2.0, 1.0], "n_infected": [1.0, 4.0, 3.0, 2.0, 1.0],
               "cum_infections": [1.0, 5.0, 8.0, 10.0, 11.0], "cum_deaths": [0.0, 0.0, 0.0, 1.0, 1.0]}
GOOD_STATS = {"peak_infections": 4, "peak_day": 1, "total_infected": 11, "total_deaths": 1, "n_agents": 1000, "sim_days": 5, "seeds_day0": 1}
PARAMS = {"disease_type": "sir", "beta": 0.05, "n_agents": 1000, "sim_dur_years": 0.1, "rand_seed": 1}
V2 = {"schema_version": 2, "disease": {"beta": 0.05}, "run": {"n_agents": 1000, "sim_dur_years": 0.1, "rand_seed": 1}}
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


def _success(params: SimParamsV2) -> Outcome:
    return Outcome(True, 200, params, stats={**GOOD_STATS, "n_agents": params.run.n_agents}, series=GOOD_SERIES, attempts=1)


def test_health_needs_no_bearer_and_reports_versions(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["starsim_version"] == "3.7.2"
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
    assert "reduce n_agents, sim_dur_years or n_replicates" in err["detail"]


def test_success_scales_thins_and_flips_cold_start(client, main, monkeypatch):
    params = coerce_params(PARAMS)
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
    assert body["effective_params"]["run"]["n_agents"] == 1000 and body["repairs"] == [] and body["replicates"] is None
    assert body["starsim_version"] == "3.7.2" and body["duration_ms"] >= 0
    assert fake.calls[0][1] == "hi"
    assert client.get("/health").json()["cold_start"] is False
    r2 = client.post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r2.json()["cold_start"] is False


def test_execution_failed_and_timeout_bodies(client, main, monkeypatch):
    params = coerce_params(PARAMS)
    repairs = [{"attempt": 1, "error": "e1", "changes": [], "usage": {"model": "m", "input_tokens": 1, "output_tokens": 1}}]
    monkeypatch.setattr(main, "simulate", _fake_simulate(Outcome(False, 500, params, repairs=repairs, attempts=2, error="e2")))
    r = client.post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r.status_code == 500
    assert r.json() == {"ok": False, "error": {"kind": "execution_failed", "detail": "e2", "repairs": repairs, "attempts": 2}}
    monkeypatch.setattr(main, "simulate", _fake_simulate(Outcome(False, 504, params, attempts=1, error="t", timed_out=True)))
    r = client.post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r.status_code == 504
    assert r.json() == {"ok": False, "error": {"kind": "timeout", "seconds": 120, "repairs": [], "attempts": 1}}


def test_v2_body_is_accepted_and_the_answer_is_v2(client, main, monkeypatch):
    params = coerce_params(V2)
    fake = _fake_simulate(_success(params))
    monkeypatch.setattr(main, "simulate", fake)
    r = client.post("/simulate", json={"params": V2}, headers=AUTH)
    assert r.status_code == 200 and r.json()["effective_params"]["schema_version"] == 2
    assert fake.calls[0][0] == params
    r2 = client.post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r2.json()["effective_params"]["disease"]["model"] == "sir"


def test_invalid_v2_body_names_the_path(client):
    r = client.post("/simulate", json={"params": {**V2, "disease": {"seed": {"mode": "count", "value": 5000}}}}, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["kind"] == "invalid_params"
    assert any("disease.seed.value" in e["msg"] for e in r.json()["error"]["detail"])
    assert all(e["loc"][0] == "params" for e in r.json()["error"]["detail"])


def test_too_large_counts_replicates(client, monkeypatch):
    monkeypatch.setenv("SIM_MAX_AGENT_YEARS", "1000")
    r = client.post("/simulate", json={"params": {**V2, "run": {"n_agents": 300, "sim_dur_years": 1.0, "n_replicates": 5}}}, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["agent_years"] == 1500
    assert "n_replicates" in r.json()["error"]["detail"]


def test_replicates_are_scaled_like_the_stats_and_thinned_like_the_series(client, main, monkeypatch):
    params = coerce_params({**V2, "run": {**V2["run"], "n_replicates": 2}})
    outcome = _success(params)
    outcome.replicates = {"n": 2, "seeds": [1, 2], "representative": 2, "stats": [outcome.stats] * 2,
                          "bands": {"n_infectious": {"p10": [1.0, 2.0, 3.0, 2.0, 1.0], "p90": [1.0, 4.0, 3.0, 2.0, 1.0]}, "cum_infections": {"p10": [1.0] * 5, "p90": [2.0] * 5}}}
    monkeypatch.setattr(main, "simulate", _fake_simulate(outcome))
    monkeypatch.setenv("SIM_SERIES_MAX_POINTS", "3")
    body = client.post("/simulate", json={"params": PARAMS, "pop_scale": 100}, headers=AUTH).json()
    assert body["replicates"]["n"] == 2 and body["replicates"]["stats"][0]["total_infected"] == 1100    # people, like stats
    assert body["replicates"]["stats"][0]["seeds_day0"] == 100 and body["stats"]["seeds_day0"] == 100
    assert body["replicates"]["bands"]["n_infectious"]["p10"] == [100, 300, 100]                         # scaled, thinned like the series


def test_context_text_is_capped(client):
    r = client.post("/simulate", json={"params": PARAMS, "context_text": "x" * 6001}, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["kind"] == "invalid_params"


def test_unexpected_exception_keeps_the_json_error_contract(client, main, monkeypatch):
    def exploding(params, context_text, settings, run=None, repair=None):
        raise KeyError("n_infected")

    monkeypatch.setattr(main, "simulate", exploding)
    # Starlette re-raises unhandled exceptions into the test client after the handler answers;
    # the client here must behave like a real client and only see the response.
    r = TestClient(main.app, raise_server_exceptions=False).post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r.status_code == 500
    assert r.headers["content-type"].startswith("application/json")
    body = r.json()
    assert body["ok"] is False and body["error"]["kind"] == "execution_failed"
    assert "KeyError" in body["error"]["detail"]


def test_absurd_pop_scale_is_rejected(client):
    r = client.post("/simulate", content='{"params": %s, "pop_scale": 1e999}' % __import__("json").dumps(PARAMS),
                    headers={**AUTH, "content-type": "application/json"})
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


def test_success_carries_diagnostics_computed_on_the_full_series(client, main, monkeypatch):
    params = coerce_params(PARAMS)
    monkeypatch.setattr(main, "simulate", _fake_simulate(_success(params)))
    monkeypatch.setenv("SIM_SERIES_MAX_POINTS", "3")
    body = client.post("/simulate", json={"params": PARAMS, "pop_scale": 100}, headers=AUTH).json()
    assert [d["id"] for d in body["diagnostics"]] == ["unfinished", "sharp_curve"]
    unfinished = body["diagnostics"][0]
    assert unfinished["severity"] == "warning" and unfinished["evidence"] == {"last_infectious": 1.0, "peak": 4.0, "still_rising": False}
    assert unfinished["levers"] == [{"patch": {"run.sim_dur_years": 0.2}, "current": {"run.sim_dur_years": 0.1}, "direction": "increase",
                                     "rationale": "The epidemic was still going when the run ended; a longer run shows how it ends.", "basis": "rule"}]
    # three of the five full days sit at or above half the peak; the thinned series the client gets has one
    assert body["diagnostics"][1]["evidence"] == {"days_at_half_peak": 3, "dur_inf_mean_days": 10.0}
    assert body["series"]["day"] == [0, 2, 4]


def test_the_disease_reaches_the_diagnostics(client, main, monkeypatch):
    fatal = {**PARAMS, "p_death": 0.2}
    monkeypatch.setattr(main, "simulate", _fake_simulate(_success(coerce_params(fatal))))
    with_disease = client.post("/simulate", json={"params": fatal, "disease": "measles"}, headers=AUTH).json()
    cfr = next(d for d in with_disease["diagnostics"] if d["id"] == "cfr_out_of_range")
    assert cfr["levers"][0]["basis"] == "disease_db" and cfr["levers"][0]["patch"] == {"disease.p_death": 0.015}
    without = client.post("/simulate", json={"params": fatal}, headers=AUTH).json()
    assert "cfr_out_of_range" not in [d["id"] for d in without["diagnostics"]]
    assert client.post("/simulate", json={"params": PARAMS, "disease": "x" * 81}, headers=AUTH).status_code == 422


def test_a_malformed_v1_body_is_422_not_500(client):
    body = {"params": {**PARAMS, "interventions": [{"type": "vaccine", "coverage": 0.5, "start_day": "soon"}]}}
    r = client.post("/simulate", json=body, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["kind"] == "invalid_params"
    detail = r.json()["error"]["detail"]
    assert detail[0]["loc"] == ["params"] and "soon" in detail[0]["msg"]


def test_a_request_exactly_at_the_cap_is_accepted(client, main, monkeypatch):
    """Pins the strict comparison (spec 19); a pin passes before any change, which is its point."""
    monkeypatch.setenv("SIM_MAX_AGENT_YEARS", "1000")
    at_cap = {**PARAMS, "n_agents": 1000, "sim_dur_years": 1.0}
    monkeypatch.setattr(main, "simulate", _fake_simulate(_success(coerce_params(at_cap))))
    assert client.post("/simulate", json={"params": at_cap}, headers=AUTH).status_code == 200
