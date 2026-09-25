"""Server-side web tools: events, citations, errors, and paused turns.

No API calls — the runner is scripted, exactly as in test_agent_loop.py.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock

from epichat.agent import AgentState, EpiChatAgent


def _text(text):
    return SimpleNamespace(type="text", text=text)


def _server_tool_use(name, tool_input, block_id="srvtoolu_1"):
    return SimpleNamespace(type="server_tool_use", name=name,
                           input=tool_input, id=block_id)


def _search_result(urls, tool_use_id="srvtoolu_1"):
    hits = [SimpleNamespace(type="web_search_result", url=u, title=f"Title for {u}")
            for u in urls]
    return SimpleNamespace(type="web_search_tool_result",
                           tool_use_id=tool_use_id, content=hits)


def _fetch_result(url, title="A fetched page", tool_use_id="srvtoolu_2"):
    return SimpleNamespace(
        type="web_fetch_tool_result", tool_use_id=tool_use_id,
        content=SimpleNamespace(
            type="web_fetch_result", url=url,
            content=SimpleNamespace(type="document", title=title)))


def _error_result(code="unavailable", tool_use_id="srvtoolu_3",
                  kind="web_fetch_tool_result"):
    """A server-tool failure: HTTP 200 with an error object, not an exception."""
    return SimpleNamespace(type=kind, tool_use_id=tool_use_id,
                           content=SimpleNamespace(type="web_fetch_tool_error",
                                                   error_code=code))


def _message(blocks, stop_reason="end_turn"):
    return SimpleNamespace(content=blocks, stop_reason=stop_reason)


class _FakeRunner:
    def __init__(self, turns):
        self._turns = list(turns)
        self._responses = []

    def __iter__(self):
        for message, response in self._turns:
            self._responses.append(response)
            yield message

    def generate_tool_call_response(self):
        return self._responses.pop(0)


def _agent(*runners):
    agent = EpiChatAgent.__new__(EpiChatAgent)
    agent.state = AgentState()
    agent.history = []
    agent.tools = []
    agent.client = MagicMock()
    agent.client.beta.messages.tool_runner.side_effect = list(runners)
    return agent


def _run(agent, text="what is happening with measles in Texas?"):
    events = []
    agent.handle(text, lambda kind, payload: events.append((kind, payload)))
    return events


def test_web_tools_are_declared_with_the_documented_types():
    from epichat.agent import _WEB_TOOLS

    by_name = {t["name"]: t for t in _WEB_TOOLS}
    assert by_name["web_search"]["type"] == "web_search_20260209"
    assert by_name["web_search"]["max_uses"] == 5
    assert by_name["web_fetch"]["type"] == "web_fetch_20260209"
    assert by_name["web_fetch"]["max_uses"] == 3
    assert by_name["web_fetch"]["citations"] == {"enabled": True}
    assert not any(t["type"].startswith("code_execution") for t in _WEB_TOOLS), \
        "the _20260209 variants run code execution internally"


def test_search_surfaces_as_a_tool_use_event():
    runner = _FakeRunner([
        (_message([_server_tool_use("web_search", {"query": "measles Texas 2026"}),
                   _search_result(["https://who.int/a", "https://cdc.gov/b"])]), None),
    ])
    events = _run(_agent(runner))
    uses = [p for k, p in events if k == "tool_use"]
    assert uses and uses[0]["name"] == "web_search"
    assert uses[0]["input"]["query"] == "measles Texas 2026"


def test_search_hits_do_not_become_citations():
    """Up to 5 searches x 10 hits would swamp the sources block."""
    agent = _agent(_FakeRunner([
        (_message([_server_tool_use("web_search", {"query": "q"}),
                   _search_result(["https://who.int/a", "https://cdc.gov/b"])]), None),
    ]))
    _run(agent)
    assert agent.state.data_sources == []


def test_a_fetched_page_becomes_a_citation():
    agent = _agent(_FakeRunner([
        (_message([_server_tool_use("web_fetch", {"url": "https://who.int/sitrep"}),
                   _fetch_result("https://who.int/sitrep", "Measles situation report")]),
         None),
    ]))
    _run(agent)
    assert len(agent.state.data_sources) == 1
    source = agent.state.data_sources[0]
    assert source.citation == "https://who.int/sitrep"
    assert source.value == "Measles situation report"


def test_the_same_page_is_not_cited_twice():
    agent = _agent(_FakeRunner([
        (_message([_fetch_result("https://who.int/sitrep"),
                   _fetch_result("https://who.int/sitrep")]), None),
    ]))
    _run(agent)
    assert len(agent.state.data_sources) == 1


def test_a_failed_fetch_is_reported_and_the_turn_continues():
    """Review Focus 1: paywalled, 404, or oversized pages are data, not exceptions."""
    agent = _agent(_FakeRunner([
        (_message([_server_tool_use("web_fetch", {"url": "https://paywalled.example/x"}),
                   _error_result("unavailable"),
                   _text("I could not read that page, so here is what I do know.")]),
         None),
    ]))
    events = _run(agent)
    errors = [p for k, p in events if k == "tool_result" and p.get("is_error")]
    assert errors and "unavailable" in errors[0]["content"]
    assert any(k == "text" for k, _ in events), "the turn must still produce a reply"
    assert agent.state.data_sources == [], "a failed fetch is not a source"


def test_a_failed_search_is_reported_and_the_turn_continues():
    agent = _agent(_FakeRunner([
        (_message([_error_result("max_uses_exceeded", kind="web_search_tool_result"),
                   _text("Search is unavailable; continuing without it.")]), None),
    ]))
    events = _run(agent)
    assert any(k == "tool_result" and p.get("is_error") for k, p in events)
    assert any(k == "text" for k, _ in events)


def test_a_paused_turn_resumes_on_a_fresh_runner():
    """Review Focus 2: the SDK runner does not auto-resume pause_turn."""
    paused = _FakeRunner([
        (_message([_server_tool_use("web_search", {"query": "q"})],
                  stop_reason="pause_turn"), None),
    ])
    resumed = _FakeRunner([
        (_message([_text("Here is the summary.")]), None),
    ])
    agent = _agent(paused, resumed)
    events = _run(agent)
    assert agent.client.beta.messages.tool_runner.call_count == 2
    assert [p["text"] for k, p in events if k == "text"] == ["Here is the summary."]
    second = agent.client.beta.messages.tool_runner.call_args_list[1].kwargs
    assert second["messages"] is agent.history, "resume from the accumulated history"


def test_endless_pausing_stops_rather_than_looping():
    runners = [_FakeRunner([(_message([_text("…")], stop_reason="pause_turn"), None)])
               for _ in range(12)]
    agent = _agent(*runners)
    _run(agent)
    assert agent.client.beta.messages.tool_runner.call_count <= 6


def test_sandbox_internals_are_not_shown_to_the_user():
    """The _20260209 web tools run via an internal code sandbox; that is
    implementation detail, and it reaches exported reports."""
    agent = _agent(_FakeRunner([
        (_message([_server_tool_use("code_execution", {"code": "import json"}),
                   _server_tool_use("web_search", {"query": "measles Texas"}),
                   _search_result(["https://who.int/a"]),
                   _text("Here is what I found.")]), None),
    ]))
    events = _run(agent)
    names = [p["name"] for k, p in events if k == "tool_use"]
    assert names == ["web_search"], f"code_execution leaked into the UI: {names}"


def test_a_reply_split_by_citations_arrives_as_one_message():
    """With citations enabled the model's prose comes back in fragments;
    the user should see one answer, not five bubbles."""
    agent = _agent(_FakeRunner([
        (_message([_text("Measles cases rose in "), _text("Texas this year"),
                   _text(", per the state health department.")]), None),
    ]))
    events = _run(agent)
    texts = [p["text"] for k, p in events if k == "text"]
    assert texts == ["Measles cases rose in Texas this year, per the state health department."]


def test_text_around_a_tool_call_keeps_its_order():
    """Coalescing must not merge across a tool call or reorder the events."""
    agent = _agent(_FakeRunner([
        (_message([_text("Let me check "), _text("the latest figures."),
                   _server_tool_use("web_search", {"query": "measles Texas"}),
                   _search_result(["https://who.int/a"]),
                   _text("Here is what I found.")]), None),
    ]))
    events = _run(agent)
    assert [k for k, _ in events] == ["text", "tool_use", "tool_result", "text"]
    texts = [p["text"] for k, p in events if k == "text"]
    assert texts == ["Let me check the latest figures.", "Here is what I found."]


def test_local_tool_calls_still_work_alongside_web_tools():
    tool_response = {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "toolu_1",
         "content": '{"applied": {}}', "is_error": False}]}
    runner = _FakeRunner([
        (_message([SimpleNamespace(type="tool_use", name="lookup_disease",
                                   input={"disease_name": "measles"}, id="toolu_1")]),
         tool_response),
        (_message([_text("Measles R0 is 12–18.")]), None),
    ])
    events = _run(_agent(runner))
    assert [k for k, _ in events] == ["tool_use", "tool_result", "text"]
