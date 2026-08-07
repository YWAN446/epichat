"""Unit tests for the agent's deterministic tools (no LLM, no network)."""
import json

import pytest

from epichat.agent import AgentState, build_tools


def _tool(state, name):
    tools = build_tools(state)
    for t in tools:
        if getattr(t, "name", None) == name:
            return t
    raise AssertionError(f"tool {name} not found in {[getattr(t, 'name', t) for t in tools]}")


def _call(state, name, **kwargs):
    return _tool(state, name).call(kwargs)


class TestConfigureSimulation:
    def test_creates_params_from_scratch(self):
        state = AgentState()
        out = json.loads(_call(state, "configure_simulation",
                               disease="dengue", country_iso3="BRA",
                               disease_type="sir", n_agents=50_000))
        assert state.params is not None
        assert state.params.n_agents == 50_000
        assert state.params.country == "BRA"
        assert out["applied"]["n_agents"] == 50_000

    def test_merges_without_losing_prior_fields(self):
        state = AgentState()
        _call(state, "configure_simulation", disease="dengue",
              country_iso3="BRA", n_agents=50_000)
        _call(state, "configure_simulation", n_agents=100_000)
        assert state.params.n_agents == 100_000
        assert state.params.country == "BRA"

    def test_invalid_value_returns_error_and_preserves_state(self):
        state = AgentState()
        _call(state, "configure_simulation", n_agents=50_000)
        before = state.params
        result = _call(state, "configure_simulation", n_agents=-5)
        assert result.startswith("CONFIG ERROR")
        assert state.params is before

    def test_r0_calibrates_beta(self):
        state = AgentState()
        out = json.loads(_call(state, "configure_simulation",
                               disease="measles", disease_type="sir",
                               r0=15.0, dur_inf=8.0))
        assert abs(out["approx_r0"] - 15.0) < 0.5
        assert abs(state.params.approx_r0() - 15.0) < 0.5

    def test_out_of_range_values_produce_warnings(self):
        state = AgentState()
        out = json.loads(_call(state, "configure_simulation",
                               disease="measles", r0=100.0, dur_inf=8.0))
        assert any("literature" in w for w in out["warnings"])

    def test_vaccine_coverage_adds_intervention(self):
        state = AgentState()
        _call(state, "configure_simulation", disease="measles",
              vaccine_coverage=0.8)
        vax = state.params.get_vaccine()
        assert vax is not None and vax.coverage == 0.8


class _FakeAdapter:
    def __init__(self, name, fields, locations=None):
        self.source_name = name
        self._fields = fields
        self._locations = locations or {}

    def location_id(self, key):
        return self._locations.get(key)

    def iso3_table(self):
        return dict(self._locations)

    def fetch(self, query):
        return list(self._fields)


def _rf(field, value, citation="test source"):
    from epichat.resolver import ResolvedField
    return ResolvedField(field=field, value=value, citation=citation)


def _with_adapter(adapter):
    """Register a fake adapter; return a restore function."""
    from epichat.parser import _resolver
    _resolver.register(adapter)
    return lambda: _resolver._adapters.pop(adapter.source_name, None)


class TestFetchDemographics:
    def test_applies_age_structure_population_and_vitals(self):
        state = AgentState()
        _call(state, "configure_simulation", disease="dengue", n_agents=50_000)
        restore = _with_adapter(_FakeAdapter(
            "un_wpp",
            [_rf("age_distribution_pct", {"0-17": 24.0, "18-64": 65.0, "65+": 11.0},
                 "UN WPP 2024, Brazil (BRA), 2024"),
             _rf("total_population", 213_000_000, "UN WPP 2024"),
             _rf("birth_rate", 12.3, "UN WPP 2024"),
             _rf("death_rate", 7.1, "UN WPP 2024")],
            locations={"BRA": 76},
        ))
        try:
            out = json.loads(_call(state, "fetch_demographics", country_iso3="BRA"))
        finally:
            restore()
        assert state.params.age_pct_under18 == 24.0
        assert state.params.network_type == "age_structured"
        assert state.total_population == 213_000_000
        assert state.params.birth_rate == 12.3
        assert state.params.use_demographics is True
        assert len(state.data_sources) == 4
        assert "UN WPP" in out["citations"][0]

    def test_offline_fallback_when_no_adapter(self, monkeypatch):
        from epichat.parser import _resolver
        monkeypatch.setattr(_resolver, "_adapters", {})
        state = AgentState()
        _call(state, "configure_simulation", disease="dengue")
        monkeypatch.setattr(
            "epichat.data_loaders.demographics.get_country_demographics",
            lambda iso3, year=2022: {"birth_rate": 27.3, "death_rate": 7.2,
                                     "source": "UN WPP 2024 — KEN (2022)"},
        )
        out = json.loads(_call(state, "fetch_demographics", country_iso3="KEN"))
        assert state.params.birth_rate == 27.3
        assert any("KEN" in c for c in out["citations"])

    def test_requires_configuration_first(self):
        state = AgentState()
        result = _call(state, "fetch_demographics", country_iso3="BRA")
        assert "configure_simulation" in result


class TestFetchHealthSystem:
    def test_applies_capacity_to_existing_treatment(self):
        state = AgentState()
        _call(state, "configure_simulation", disease="dengue", n_agents=100_000,
              treatment_capacity=1)
        restore = _with_adapter(_FakeAdapter(
            "wb_data360", [_rf("treatment_capacity", 2.52, "WB WDI 2021")]))
        try:
            json.loads(_call(state, "fetch_health_system", country_iso3="BRA"))
        finally:
            restore()
        treat = state.params.get_treatment()
        assert treat.capacity == round(2.52 * 100_000 / 1000)

    def test_no_treatment_intervention_records_only(self):
        state = AgentState()
        _call(state, "configure_simulation", disease="dengue", n_agents=100_000)
        restore = _with_adapter(_FakeAdapter(
            "wb_data360", [_rf("treatment_capacity", 2.52, "WB WDI 2021")]))
        try:
            _call(state, "fetch_health_system", country_iso3="BRA")
        finally:
            restore()
        assert state.params.get_treatment() is None
        assert len(state.data_sources) == 1


class TestFetchVaccination:
    def test_adds_vaccine_intervention_once(self):
        state = AgentState()
        _call(state, "configure_simulation", disease="measles")
        restore = _with_adapter(_FakeAdapter(
            "who_gho", [_rf("mcv1_coverage", 88.0, "WHO GHO 2023")]))
        try:
            _call(state, "fetch_vaccination_coverage",
                  country_iso3="BRA", disease="measles")
            _call(state, "fetch_vaccination_coverage",
                  country_iso3="BRA", disease="measles")
        finally:
            restore()
        vaxes = [i for i in state.params.interventions if i.type == "vaccine"]
        assert len(vaxes) == 1
        assert vaxes[0].coverage == 0.88

    def test_adapter_error_returns_fetch_error(self):
        class Boom(_FakeAdapter):
            def fetch(self, query):
                raise RuntimeError("api down")
        state = AgentState()
        _call(state, "configure_simulation", disease="measles")
        restore = _with_adapter(Boom("who_gho", []))
        try:
            result = _call(state, "fetch_vaccination_coverage",
                           country_iso3="BRA", disease="measles")
        finally:
            restore()
        assert result.startswith("FETCH ERROR")


class _FakeExecutor:
    def __init__(self, result=None):
        self.calls = []
        self.result = result or {
            "error": None,
            "stats": {"n_agents": 50_000, "peak_infections": 9_000,
                      "peak_day": 41, "total_infected": 38_000,
                      "total_deaths": 120},
            "plot_path": "results/sim_test.png",
        }

    def _execute_with_retry(self, context, params, plot_path, pop_scale=1.0):
        self.calls.append({"params": params, "pop_scale": pop_scale})
        return self.result


class TestRunSimulation:
    def test_runs_and_stores_stats_and_plot(self):
        executor = _FakeExecutor()
        state = AgentState(executor=executor)
        _call(state, "configure_simulation", disease="dengue", n_agents=50_000)
        state.total_population = 213_000_000
        out = json.loads(_call(state, "run_simulation"))
        assert out["stats"]["peak_infections"] == 9_000
        assert state.stats["total_infected"] == 38_000
        assert state.plot_path == "results/sim_test.png"
        assert executor.calls[0]["pop_scale"] == pytest.approx(213_000_000 / 50_000)

    def test_error_path(self):
        executor = _FakeExecutor(result={"error": "starsim exploded",
                                         "stats": {}, "plot_path": None})
        state = AgentState(executor=executor)
        _call(state, "configure_simulation", disease="dengue")
        result = _call(state, "run_simulation")
        assert result.startswith("SIMULATION ERROR")
        assert state.stats == {}

    def test_requires_params(self):
        state = AgentState(executor=_FakeExecutor())
        assert "configure_simulation" in _call(state, "run_simulation")


class TestLookupDisease:
    def test_measles_entry(self):
        state = AgentState()
        out = json.loads(_call(state, "lookup_disease", disease_name="measles"))
        assert out["canonical_name"] == "measles"
        assert out["r0"]["min"] == 12 and out["r0"]["max"] == 18
        assert "http" in out["r0"]["source"]

    def test_alias_resolves(self):
        state = AgentState()
        out = json.loads(_call(state, "lookup_disease", disease_name="german measles"))
        assert out["canonical_name"] == "rubella"

    def test_unknown_disease(self):
        state = AgentState()
        result = _call(state, "lookup_disease", disease_name="unicorn fever")
        assert "UNKNOWN DISEASE" in result
