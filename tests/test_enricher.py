from unittest.mock import MagicMock, patch

import pytest

from epichat.schema import OutbreakContext


def _mock_response(text: str, stop_reason: str = "end_turn"):
    block = MagicMock()
    block.type = "text"
    block.text = text
    resp = MagicMock()
    resp.stop_reason = stop_reason
    resp.content = [block]
    return resp


def test_enrich_simple_query():
    payload = '{"input_type":"query","disease_name":"COVID-19","location":"Kenya","confidence":"low"}'
    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response(payload)
        from epichat.enricher import enrich_input
        ctx = enrich_input("Simulate COVID-19 in Kenya")
    assert isinstance(ctx, OutbreakContext)
    assert ctx.input_type == "query"
    assert ctx.disease_name == "COVID-19"
    assert ctx.location == "Kenya"


def test_enrich_falls_back_on_api_error():
    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = Exception("network error")
        from epichat.enricher import enrich_input
        ctx = enrich_input("anything")
    assert isinstance(ctx, OutbreakContext)
    assert ctx.input_type == "query"
    assert ctx.disease_name is None


def test_enrich_falls_back_on_invalid_json():
    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response("not valid json")
        from epichat.enricher import enrich_input
        ctx = enrich_input("anything")
    assert isinstance(ctx, OutbreakContext)
    assert ctx.input_type == "query"


def test_enrich_handles_tool_use_then_end_turn():
    tool_block = MagicMock()
    tool_block.type = "tool_use"
    tool_block.id = "tu_123"
    tool_resp = MagicMock()
    tool_resp.stop_reason = "tool_use"
    tool_resp.content = [tool_block]

    final_payload = '{"input_type":"search","disease_name":"Mpox","location":"DRC","confidence":"medium"}'
    final_resp = _mock_response(final_payload)

    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [tool_resp, final_resp]
        from epichat.enricher import enrich_input
        ctx = enrich_input("search for mpox in DRC")
    assert ctx.input_type == "search"
    assert ctx.disease_name == "Mpox"
    assert ctx.location == "DRC"
