import json
from unittest.mock import MagicMock, patch

from epichat.parser import (
    IntentResult,
    _apply_age_distribution,
    _apply_vaccination_coverage,
    _apply_surveillance,
    _apply_population_scale,
    _llm_call_1,
    _llm_call_2,
    parse_query,
)
from epichat.resolver import ResolvedField
from epichat.schema import SimParams


def _mock_llm(response_text: str):
    """Return a mock anthropic client whose messages.create() returns response_text."""
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=response_text)]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_msg
    return mock_client


_PRELIM_JSON = json.dumps({
    "disease_type": "sir",
    "n_agents": 10000,
    "n_contacts": 4,
    "network_type": "random",
    "network_beta": 1.0,
    "beta": 22.8125,
    "init_prev": 0.01,
    "dur_inf": 10.0,
    "p_death": 0.0,
    "sim_dur_years": 1.0,
    "interventions": [],
})

_INTENT_WITH_QUERIES = json.dumps({
    "preliminary_params": json.loads(_PRELIM_JSON),
    "data_queries": [
        {
            "source": "un_wpp",
            "indicators": [55, 59, 71],
            "location_id": 404,
            "start_year": 2020,
            "end_year": 2024,
        }
    ],
})

_INTENT_NO_QUERIES = json.dumps({
    "preliminary_params": json.loads(_PRELIM_JSON),
    "data_queries": [],
})


def test_llm_call_1_parses_intent_with_queries():
    client = _mock_llm(_INTENT_WITH_QUERIES)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = _llm_call_1("simulate measles in Kenya")
    assert isinstance(result, IntentResult)
    assert isinstance(result.preliminary_params, SimParams)
    assert len(result.data_queries) == 1
    assert result.data_queries[0].source == "un_wpp"
    assert result.data_queries[0].location_id == 404


def test_llm_call_1_parses_intent_no_queries():
    client = _mock_llm(_INTENT_NO_QUERIES)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = _llm_call_1("run a default SIR model")
    assert isinstance(result, IntentResult)
    assert result.data_queries == []


def test_llm_call_1_handles_legacy_format():
    """LLM returns raw SimParams JSON (old format) — should still parse."""
    client = _mock_llm(_PRELIM_JSON)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = _llm_call_1("run a default SIR model")
    assert isinstance(result, IntentResult)
    assert result.data_queries == []
    assert isinstance(result.preliminary_params, SimParams)


_REFINED_JSON = json.dumps({
    "disease_type": "sir",
    "n_agents": 10000,
    "n_contacts": 4,
    "network_type": "random",
    "network_beta": 1.0,
    "beta": 22.8125,
    "init_prev": 0.01,
    "dur_inf": 10.0,
    "p_death": 0.0,
    "sim_dur_years": 1.0,
    "use_demographics": True,
    "birth_rate": 28.5,
    "death_rate": 6.2,
    "interventions": [],
})


def test_llm_call_2_passthrough_when_no_resolved():
    prelim = SimParams(beta=22.8125, birth_rate=20.0, death_rate=10.0)
    result = _llm_call_2("query", prelim, [])
    assert result is prelim  # exact same object — no LLM call made


def test_llm_call_2_calls_llm_when_resolved_present():
    prelim = SimParams(beta=22.8125, birth_rate=20.0, death_rate=10.0)
    resolved = [
        ResolvedField(field="birth_rate", value=28.5, citation="UN WPP 2024, KEN, 2023"),
        ResolvedField(field="death_rate", value=6.2, citation="UN WPP 2024, KEN, 2023"),
    ]
    client = _mock_llm(_REFINED_JSON)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = _llm_call_2("simulate in Kenya", prelim, resolved)
    assert isinstance(result, SimParams)
    assert abs(result.birth_rate - 28.5) < 0.01
    assert abs(result.death_rate - 6.2) < 0.01


def test_llm_call_2_formats_resolved_fields_in_prompt():
    prelim = SimParams(beta=22.8125)
    resolved = [ResolvedField(field="birth_rate", value=28.5, citation="UN WPP 2024, KEN, 2023")]
    client = _mock_llm(_REFINED_JSON)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        _llm_call_2("simulate in Kenya", prelim, resolved)
    call_args = client.messages.create.call_args
    user_content = call_args[1]["messages"][0]["content"]
    assert "birth_rate: 28.5" in user_content
    assert "UN WPP 2024, KEN, 2023" in user_content


def test_parse_query_skips_resolver_when_no_queries():
    """End-to-end: no geography → single LLM call, no resolver."""
    client = _mock_llm(_INTENT_NO_QUERIES)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = parse_query("run a default SIR model")
    assert isinstance(result, SimParams)
    # Only one LLM call was made (LLM-1 only)
    assert client.messages.create.call_count == 1


def test_parse_query_uses_resolver_when_queries_present():
    """End-to-end: geography present → resolver runs → LLM-2 refines."""
    mock_resolver = MagicMock()
    mock_resolver.resolve.return_value = [
        ResolvedField(field="birth_rate", value=28.5, citation="UN WPP 2024, KEN, 2023"),
        ResolvedField(field="death_rate", value=6.2, citation="UN WPP 2024, KEN, 2023"),
    ]

    client = MagicMock()
    lm1_msg = MagicMock()
    lm1_msg.content = [MagicMock(text=_INTENT_WITH_QUERIES)]
    lm2_msg = MagicMock()
    lm2_msg.content = [MagicMock(text=_REFINED_JSON)]
    client.messages.create.side_effect = [lm1_msg, lm2_msg]

    with patch("epichat.parser._resolver", mock_resolver), \
         patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = parse_query("simulate measles in Kenya")

    assert isinstance(result, SimParams)
    assert client.messages.create.call_count == 2


def test_apply_age_distribution_no_op_when_absent():
    params = SimParams(beta=22.8125)
    resolved = [ResolvedField(field="birth_rate", value=28.5, citation="x")]
    result = _apply_age_distribution(params, resolved)
    assert result is params  # exact same object — untouched


def test_apply_age_distribution_sets_fields_and_network_type():
    params = SimParams(beta=22.8125)
    resolved = [
        ResolvedField(
            field="age_distribution_pct",
            value={"0-17": 42.1, "18-64": 54.8, "65+": 3.1},
            citation="UN WPP 2024, Kenya (KEN), 2023",
        )
    ]
    result = _apply_age_distribution(params, resolved)
    assert result.network_type == "age_structured"
    assert abs(result.age_pct_under18 - 42.1) < 0.01
    assert abs(result.age_pct_18_64   - 54.8) < 0.01
    assert abs(result.age_pct_over65  -  3.1) < 0.01


def test_apply_age_distribution_returns_new_simparams_object():
    params = SimParams(beta=22.8125, network_type="random")
    resolved = [
        ResolvedField(
            field="age_distribution_pct",
            value={"0-17": 20.0, "18-64": 70.0, "65+": 10.0},
            citation="x",
        )
    ]
    result = _apply_age_distribution(params, resolved)
    assert result is not params
    assert params.network_type == "random"   # original unchanged


def test_parse_query_applies_age_distribution_end_to_end():
    """parse_query() sets network_type=age_structured when resolver returns age data."""
    mock_resolver = MagicMock()
    mock_resolver.resolve.return_value = [
        ResolvedField(field="birth_rate", value=28.5, citation="x"),
        ResolvedField(
            field="age_distribution_pct",
            value={"0-17": 42.0, "18-64": 55.0, "65+": 3.0},
            citation="y",
        ),
    ]

    lm1_msg = MagicMock()
    lm1_msg.content = [MagicMock(text=_INTENT_WITH_QUERIES)]
    lm2_msg = MagicMock()
    lm2_msg.content = [MagicMock(text=_REFINED_JSON)]
    client = MagicMock()
    client.messages.create.side_effect = [lm1_msg, lm2_msg]

    with patch("epichat.parser._resolver", mock_resolver), \
         patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = parse_query("simulate measles in Kenya")

    assert result.network_type == "age_structured"
    assert result.age_pct_under18 == 42.0


# ── _apply_vaccination_coverage ───────────────────────────────────────────────

def test_apply_vaccination_coverage_no_op_when_no_coverage_field():
    params = SimParams(beta=22.8125)
    resolved = [ResolvedField(field="birth_rate", value=28.5, citation="x")]
    result = _apply_vaccination_coverage(params, resolved)
    assert result is params


def test_apply_vaccination_coverage_no_op_when_llm_already_set_vaccine():
    from epichat.schema import Intervention
    vaccine = Intervention(type="vaccine", coverage=0.5, start_day=0)
    params = SimParams(beta=22.8125, interventions=[vaccine])
    resolved = [ResolvedField(field="mcv1_coverage", value=76.0, citation="WHO GHO, KEN, 2022")]
    result = _apply_vaccination_coverage(params, resolved)
    # LLM set vaccine → post-processor must not override it
    assert result is params


def test_apply_vaccination_coverage_adds_vaccine_intervention():
    params = SimParams(beta=22.8125)
    resolved = [ResolvedField(field="mcv1_coverage", value=76.0, citation="WHO GHO, KEN, 2022")]
    result = _apply_vaccination_coverage(params, resolved)
    assert result is not params
    vaccine = result.get_vaccine()
    assert vaccine is not None
    assert abs(vaccine.coverage - 0.76) < 1e-9
    assert vaccine.start_day == 0


def test_apply_vaccination_coverage_returns_new_simparams_via_model_validate():
    """model_validate must be used (not model_copy) so validators run."""
    params = SimParams(beta=22.8125)
    resolved = [ResolvedField(field="dtp3_coverage", value=85.0, citation="WHO GHO, KEN, 2022")]
    result = _apply_vaccination_coverage(params, resolved)
    assert isinstance(result, SimParams)
    assert result.get_vaccine() is not None
    assert abs(result.get_vaccine().coverage - 0.85) < 1e-9


# ── _apply_surveillance ───────────────────────────────────────────────────────

def test_apply_surveillance_no_op_when_no_cases_field():
    params = SimParams(beta=22.8125, init_prev=0.01)
    resolved = [ResolvedField(field="total_population", value=54000000, citation="x")]
    result = _apply_surveillance(params, resolved)
    assert result is params


def test_apply_surveillance_no_op_when_no_population_field():
    params = SimParams(beta=22.8125, init_prev=0.01)
    resolved = [ResolvedField(field="measles_cases", value=4810, citation="x")]
    result = _apply_surveillance(params, resolved)
    assert result is params


def test_apply_surveillance_sets_init_prev():
    # Use enough cases that computed init_prev exceeds the 0.0001 floor
    # 300_000 / 54027487 / 365 * 8 ≈ 0.000122 > 0.0001
    params = SimParams(beta=22.8125, init_prev=0.01, dur_inf=8.0)
    resolved = [
        ResolvedField(field="measles_cases", value=300_000.0, citation="WHO GHO, KEN, 2023"),
        ResolvedField(field="total_population", value=54027487, citation="UN WPP, KEN, 2023"),
    ]
    result = _apply_surveillance(params, resolved)
    assert result is not params
    expected = (300_000.0 / 54027487 / 365) * 8.0
    assert abs(result.init_prev - expected) < 1e-12


def test_apply_surveillance_enforces_minimum_init_prev():
    """Very sparse case counts must not produce init_prev below 0.01%."""
    params = SimParams(beta=22.8125, init_prev=0.01, dur_inf=8.0)
    resolved = [
        ResolvedField(field="polio_cases", value=1.0, citation="x"),   # near-eliminated disease
        ResolvedField(field="total_population", value=54_000_000, citation="x"),
    ]
    result = _apply_surveillance(params, resolved)
    assert result.init_prev == 0.0001


def test_apply_surveillance_caps_at_0_5():
    params = SimParams(beta=22.8125, init_prev=0.01)
    resolved = [
        ResolvedField(field="measles_cases", value=99999999, citation="x"),
        ResolvedField(field="total_population", value=100, citation="x"),
    ]
    result = _apply_surveillance(params, resolved)
    assert result.init_prev == 0.5


def test_apply_surveillance_no_op_when_population_is_zero():
    params = SimParams(beta=22.8125, init_prev=0.01)
    resolved = [
        ResolvedField(field="measles_cases", value=4810, citation="x"),
        ResolvedField(field="total_population", value=0, citation="x"),
    ]
    result = _apply_surveillance(params, resolved)
    assert result is params


def test_apply_surveillance_no_op_when_zero_cases():
    """Zero cases → init_prev=0 would fail Pydantic gt=0 constraint; must skip."""
    params = SimParams(beta=22.8125, init_prev=0.01)
    resolved = [
        ResolvedField(field="polio_cases", value=0, citation="x"),
        ResolvedField(field="total_population", value=54000000, citation="x"),
    ]
    result = _apply_surveillance(params, resolved)
    assert result is params


def test_apply_vaccination_coverage_clamps_above_100_percent():
    """WHO GHO occasionally reports coverage > 100%; must clamp to 1.0."""
    params = SimParams(beta=22.8125)
    resolved = [ResolvedField(field="mcv1_coverage", value=102.0, citation="WHO GHO, KEN, 2022")]
    result = _apply_vaccination_coverage(params, resolved)
    vaccine = result.get_vaccine()
    assert vaccine is not None
    assert vaccine.coverage == 1.0


# ── _apply_population_scale ───────────────────────────────────────────────────

def test_apply_population_scale_no_op_when_no_population_field():
    params = SimParams(beta=22.8125, n_agents=10000)
    resolved = [ResolvedField(field="birth_rate", value=28.5, citation="x")]
    result = _apply_population_scale(params, resolved)
    assert result is params


def test_apply_population_scale_caps_at_100k_for_large_population():
    params = SimParams(beta=22.8125, n_agents=10000)
    resolved = [ResolvedField(field="total_population", value=54_000_000, citation="x")]
    result = _apply_population_scale(params, resolved)
    assert result.n_agents == 100_000


def test_apply_population_scale_uses_actual_count_for_small_population():
    params = SimParams(beta=22.8125, n_agents=10000)
    resolved = [ResolvedField(field="total_population", value=50_000, citation="x")]
    result = _apply_population_scale(params, resolved)
    assert result.n_agents == 50_000


def test_apply_population_scale_enforces_minimum_1000():
    params = SimParams(beta=22.8125, n_agents=10000)
    resolved = [ResolvedField(field="total_population", value=500, citation="x")]
    result = _apply_population_scale(params, resolved)
    assert result.n_agents == 1_000


def test_apply_population_scale_no_op_when_already_correct():
    params = SimParams(beta=22.8125, n_agents=100_000)
    resolved = [ResolvedField(field="total_population", value=54_000_000, citation="x")]
    result = _apply_population_scale(params, resolved)
    assert result is params


def test_parse_query_applies_all_post_processors_in_order():
    """parse_query() chains all post-processors including the prevalence-incidence correction."""
    mock_resolver = MagicMock()
    # Use enough cases that init_prev stays above the 0.0001 floor
    # (4810 / 54M / 365 * 10 = 2.4e-6, below floor; use 500K cases instead)
    mock_resolver.resolve.return_value = [
        ResolvedField(field="mcv1_coverage", value=76.0, citation="WHO GHO, KEN, 2022"),
        ResolvedField(field="measles_cases", value=500_000.0, citation="WHO GHO, KEN, 2023"),
        ResolvedField(field="total_population", value=54027487, citation="UN WPP, KEN, 2023"),
    ]

    lm1_msg = MagicMock()
    lm1_msg.content = [MagicMock(text=_INTENT_WITH_QUERIES)]
    lm2_msg = MagicMock()
    lm2_msg.content = [MagicMock(text=_REFINED_JSON)]
    client = MagicMock()
    client.messages.create.side_effect = [lm1_msg, lm2_msg]

    with patch("epichat.parser._resolver", mock_resolver), \
         patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = parse_query("simulate measles in Kenya")

    vaccine = result.get_vaccine()
    assert vaccine is not None
    assert abs(vaccine.coverage - 0.76) < 1e-9
    # init_prev = (cases / population / 365) * dur_inf
    dur_inf = result.dur_inf
    expected_prev = (500_000.0 / 54027487 / 365) * dur_inf
    assert abs(result.init_prev - expected_prev) < 1e-12
