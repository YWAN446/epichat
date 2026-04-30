import json
from unittest.mock import MagicMock, patch

from epichat.parser import IntentResult, _llm_call_1
from epichat.resolver import DataQuery
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
