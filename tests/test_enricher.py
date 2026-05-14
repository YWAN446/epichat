from unittest.mock import MagicMock, patch

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

    # Phase 1: enrichment returns source facts (search type → triggers intent revision)
    source_payload = '{"input_type":"search","disease_name":"Mpox","location":"DRC","confidence":"medium"}'
    source_resp = _mock_response(source_payload)

    # Phase 2: intent revision — source location unchanged (user didn't request a different place)
    intent_payload = '{"input_type":"search","disease_name":"Mpox","location":"DRC","confidence":"medium"}'
    intent_resp = _mock_response(intent_payload)

    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [tool_resp, source_resp, intent_resp]
        from epichat.enricher import enrich_input
        ctx = enrich_input("search for mpox in DRC")
    assert ctx.input_type == "search"
    assert ctx.disease_name == "Mpox"
    assert ctx.location == "DRC"


def test_enrich_search_intent_overrides_location():
    """For search inputs, the intent revision step must override the source location."""
    tool_block = MagicMock()
    tool_block.type = "tool_use"
    tool_block.id = "tu_456"
    tool_resp = MagicMock()
    tool_resp.stop_reason = "tool_use"
    tool_resp.content = [tool_block]

    # Phase 1: search finds outbreak in DRC
    source_payload = (
        '{"input_type":"search","disease_name":"Hantavirus","location":"DRC",'
        '"r0_estimate":1.3,"incubation_period_days":14.0,'
        '"interventions_mentioned":["case isolation"],"confidence":"high"}'
    )
    source_resp = _mock_response(source_payload)

    # Phase 2: intent revision sees "what if this hit Kenya" and sets location=Kenya
    intent_payload = (
        '{"input_type":"search","disease_name":"Hantavirus","location":"Kenya",'
        '"r0_estimate":1.3,"incubation_period_days":14.0,'
        '"interventions_mentioned":["case isolation"],"confidence":"high"}'
    )
    intent_resp = _mock_response(intent_payload)

    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [tool_resp, source_resp, intent_resp]
        from epichat.enricher import enrich_input
        ctx = enrich_input(
            "Search for recent Hantavirus news and simulate what if this hit Kenya"
        )
    assert ctx.location == "Kenya"
    assert ctx.disease_name == "Hantavirus"
    assert ctx.r0_estimate == 1.3
    assert ctx.incubation_period_days == 14.0


def test_enrich_query_skips_intent_revision():
    """Plain query inputs (input_type='query') must NOT trigger a second API call."""
    payload = '{"input_type":"query","disease_name":"Ebola","location":"Kenya","confidence":"low"}'
    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response(payload)
        from epichat.enricher import enrich_input
        ctx = enrich_input("Simulate Ebola in Kenya")
    # Only one API call: enrichment. Intent revision is skipped.
    assert mock_client.messages.create.call_count == 1
    assert ctx.location == "Kenya"


def test_enrich_url_prefetched_no_web_search_tool():
    """When the article was pre-fetched, web_search tool must NOT be passed to the LLM."""
    source_payload = '{"input_type":"url","disease_name":"Measles","location":"Sierra Leone","confidence":"high"}'
    source_resp = _mock_response(source_payload)
    intent_resp = _mock_response(source_payload)

    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [source_resp, intent_resp]
        from epichat.enricher import enrich_input
        enrich_input(
            "[Fetched article from https://example.com/measles]\n"
            "Measles outbreak in Sierra Leone...\n\n"
            "[User request]\n读一下这篇报道 https://example.com/measles 然后模拟三个月"
        )

    # First call is the enrichment call; check its tools argument
    first_call_kwargs = mock_client.messages.create.call_args_list[0].kwargs
    assert first_call_kwargs.get("tools") == [], (
        "web_search tool must not be passed when article content is pre-fetched"
    )


def test_enrich_search_passes_web_search_tool():
    """For pure search inputs (no pre-fetched content), web_search tool must be passed."""
    tool_block = MagicMock()
    tool_block.type = "tool_use"
    tool_block.id = "tu_789"
    tool_resp = MagicMock()
    tool_resp.stop_reason = "tool_use"
    tool_resp.content = [tool_block]

    source_payload = '{"input_type":"search","disease_name":"Mpox","location":"DRC","confidence":"medium"}'
    source_resp = _mock_response(source_payload)
    intent_resp = _mock_response(source_payload)

    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [tool_resp, source_resp, intent_resp]
        from epichat.enricher import enrich_input
        enrich_input("search for latest Mpox outbreak news")

    first_call_kwargs = mock_client.messages.create.call_args_list[0].kwargs
    tools = first_call_kwargs.get("tools", [])
    assert any(t.get("type") == "web_search_20250305" for t in tools), (
        "web_search tool must be passed for search inputs"
    )


def test_enrich_intent_revision_falls_back_on_parse_error():
    """If the intent revision response is unparseable, return the source context."""
    source_payload = (
        '{"input_type":"url","disease_name":"Cholera","location":"Haiti",'
        '"confidence":"medium"}'
    )
    source_resp = _mock_response(source_payload)
    bad_intent_resp = _mock_response("I cannot process this request.")

    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [source_resp, bad_intent_resp]
        from epichat.enricher import enrich_input
        ctx = enrich_input("Read https://example.com/cholera and simulate in Haiti")
    # Falls back to source context
    assert ctx.disease_name == "Cholera"
    assert ctx.location == "Haiti"
    assert ctx.input_type == "url"


def test_enrich_falls_back_on_schema_validation_error():
    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response(
            '{"input_type": "unknown_type", "confidence": "high"}'
        )
        from epichat.enricher import enrich_input
        ctx = enrich_input("anything")
    assert isinstance(ctx, OutbreakContext)
    assert ctx.input_type == "query"
