"""One real Starsim run per model family through the app. Slow (about 3 s
each: the child imports Starsim) but the only proof that the template's json
branch, the runner, and the response assembly agree."""
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
    base_keys = {"day", "n_susceptible", "n_infected", "n_recovered", "new_infections", "cum_infections",
                 "new_deaths", "cum_deaths"}
    assert set(series) == base_keys | expected_extra
    lengths = {len(v) for v in series.values()}
    assert lengths == {31}
    assert series["day"][0] == 0 and series["day"][-1] == 30
    assert body["stats"]["sim_days"] == 31
    assert body["stats_agents"]["total_infected"] == round(series["cum_infections"][-1])
    assert body["stats"] == body["stats_agents"]
    assert body["repairs"] == [] and body["attempts"] == 1
    assert body["effective_params"]["rand_seed"] == 1
    assert body["duration_ms"] > 0


def test_pop_scale_scales_stats_but_not_agent_counts(client):
    r = client.post("/simulate", json={"params": _params(), "pop_scale": 100}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["population"] == 100000
    assert body["stats"]["total_infected"] == body["stats_agents"]["total_infected"] * 100
    assert body["stats"]["peak_day"] == body["stats_agents"]["peak_day"]
    assert body["series"]["cum_infections"][-1] == body["stats"]["total_infected"]


def test_same_seed_is_deterministic(client):
    a = client.post("/simulate", json={"params": _params()}, headers=AUTH).json()
    b = client.post("/simulate", json={"params": _params()}, headers=AUTH).json()
    assert a["stats_agents"] == b["stats_agents"]


def test_deaths_count_only_the_disease(client):
    """Background mortality (ss.Deaths) is not a disease outcome: with p_death 0 the
    death series and the total stay at zero however many agents die of other causes."""
    params = _params(use_demographics=True, birth_rate=20.0, death_rate=500.0, p_death=0.0)
    r = client.post("/simulate", json={"params": params, "pop_scale": 1}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stats"]["total_deaths"] == 0
    assert body["series"]["cum_deaths"][-1] == 0
    assert max(body["series"]["new_deaths"]) == 0
