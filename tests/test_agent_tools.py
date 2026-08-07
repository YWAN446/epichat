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
