"""Real Starsim runs through the app. Slow (the child imports Starsim) but the
only proof that the builder, the runner, and the response assembly agree."""
import importlib

import pytest
from fastapi.testclient import TestClient

AUTH = {"Authorization": "Bearer test"}
THIRTY_DAYS = 30 / 365


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SIM_SHARED_SECRET", "test")
    import main as module
    importlib.reload(module)
    return TestClient(module.app)


def _params(**over) -> dict:
    base = {"disease_type": "sir", "beta": 0.05, "n_agents": 1000, "sim_dur_years": THIRTY_DAYS, "rand_seed": 1}
    base.update(over)
    return base


@pytest.mark.parametrize("params, expected_extra", [
    (_params(), set()),
    (_params(disease_type="seir", dur_exp=3.0), {"n_exposed"}),
    (_params(disease_type="seiar", dur_exp=3.0), {"n_exposed", "n_asymptomatic"}),
])
def test_real_run_returns_consistent_stats_and_series(client, params, expected_extra):
    r = client.post("/simulate", json={"params": params, "pop_scale": 1}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    series = body["series"]
    base_keys = {"day", "n_susceptible", "n_infectious", "n_infected", "n_recovered", "new_infections", "cum_infections",
                 "new_deaths", "cum_deaths"}
    assert set(series) == base_keys | expected_extra
    lengths = {len(v) for v in series.values()}
    assert lengths == {31}
    assert series["day"][0] == 0 and series["day"][-1] == 30
    assert body["stats"]["sim_days"] == 31
    assert body["stats_agents"]["total_infected"] == round(series["cum_infections"][-1])
    assert body["stats"] == body["stats_agents"]
    assert body["repairs"] == [] and body["attempts"] == 1
    assert body["effective_params"]["run"]["rand_seed"] == 1 and body["effective_params"]["schema_version"] == 2
    assert body["duration_ms"] > 0


def test_pop_scale_scales_stats_but_not_agent_counts(client):
    r = client.post("/simulate", json={"params": _params(), "pop_scale": 100}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["population"] == 100000
    assert body["stats"]["total_infected"] == body["stats_agents"]["total_infected"] * 100
    assert body["stats"]["peak_day"] == body["stats_agents"]["peak_day"]
    assert abs(body["series"]["cum_infections"][-1] - body["stats"]["total_infected"]) <= 50     # an ODE's counts are fractional: each is rounded once


def test_same_seed_is_deterministic(client):
    a = client.post("/simulate", json={"params": _params()}, headers=AUTH).json()
    b = client.post("/simulate", json={"params": _params()}, headers=AUTH).json()
    assert a["stats_agents"] == b["stats_agents"]


def test_demographics_add_the_all_causes_deaths_and_keep_disease_deaths_apart(client):
    """Background mortality (ss.Deaths) is not a disease outcome: with p_death 0 the
    death series and the total stay at zero; the all-causes pair carries the rest (spec 8.6)."""
    params = _params(use_demographics=True, birth_rate=20.0, death_rate=500.0, p_death=0.0)
    body = client.post("/simulate", json={"params": params, "pop_scale": 1}, headers=AUTH).json()
    assert body["stats"]["total_deaths"] == 0 and body["series"]["cum_deaths"][-1] == 0
    assert max(body["series"]["new_deaths"]) == 0
    assert body["series"]["cum_deaths_all"][-1] > 0


def test_an_ode_run_runs_once_and_reports_starsims_r0(client):
    body = client.post("/simulate", json={"params": {"schema_version": 2, "disease": {"seed": {"mode": "count", "value": 20}}, "run": {"n_agents": 1000, "sim_dur_years": THIRTY_DAYS, "rand_seed": 1, "n_replicates": 3}}, "pop_scale": 10}, headers=AUTH).json()
    assert body["replicates"] is None and body["stats"]["solver"] == "ode"
    assert body["stats"]["r0_model"] == body["stats_agents"]["r0_model"] == pytest.approx(2.5)          # a ratio: never scaled


def test_two_hybrid_replicates_run_for_real_as_agents(client):
    params = {"schema_version": 2, "disease": {"seed": {"mode": "count", "value": 20}}, "network": {"network_type": "hybrid"},
              "run": {"n_agents": 1000, "sim_dur_years": THIRTY_DAYS, "rand_seed": 1, "n_replicates": 2}}
    r = client.post("/simulate", json={"params": params, "pop_scale": 1}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    rep = body["replicates"]
    assert body["stats"]["solver"] == "abm" and body["effective_params"]["network"]["network_type"] == "hybrid"
    assert rep["seeds"] == [1, 2] and len(rep["stats"]) == 2 and rep["representative"] in (1, 2)
    assert len(rep["bands"]["cum_infections"]["p90"]) == len(body["series"]["day"]) == 31
    assert body["stats"]["total_infected"] == min(s["total_infected"] for s in rep["stats"])
    assert "r0_calibration" not in body["stats"] and "r0_measured" not in body["stats"]


def test_a_fitted_run_reports_the_fit_and_the_fitted_beta(client):
    params = {"schema_version": 2, "disease": {"seed": {"mode": "count", "value": 20}},           # the default 0.05% of 2,000 seeds nobody here
              "run": {"n_agents": 2000, "sim_dur_years": 0.5, "rand_seed": 1, "fit": {"target": "attack_rate", "value": 0.4}}}
    r = client.post("/simulate", json={"params": params, "pop_scale": 1}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stats"]["fit"]["runs"] <= 8 and abs(body["stats"]["fit"]["achieved"] - 0.4) <= 0.02
    assert body["effective_params"]["disease"]["beta"] == body["stats"]["fit"]["value"]
