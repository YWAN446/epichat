"""Tests for EpiChatAgent.handle with a mocked tool runner (no API calls)."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from epichat.agent import EpiChatAgent


def _text_block(text):
    return SimpleNamespace(type="text", text=text)


def _tool_block(name, tool_input, block_id="toolu_1"):
    return SimpleNamespace(type="tool_use", name=name, input=tool_input, id=block_id)


def _message(blocks, stop_reason="end_turn"):
    return SimpleNamespace(content=blocks, stop_reason=stop_reason)


class _FakeRunner:
    """Yields scripted messages; returns queued tool responses in order."""

    def __init__(self, turns):
        # turns: list of (message, tool_response_or_None)
        self._turns = list(turns)
        self._responses = []

    def __iter__(self):
        for message, response in self._turns:
            self._responses.append(response)
            yield message

    def generate_tool_call_response(self):
        return self._responses.pop(0)


def _agent_with_runner(runner):
    agent = EpiChatAgent.__new__(EpiChatAgent)
    agent.state = __import__("epichat.agent", fromlist=["AgentState"]).AgentState()
    agent.history = []
    agent.tools = []
    agent.client = MagicMock()
    agent.client.beta.messages.tool_runner.return_value = runner
    return agent


def test_text_only_turn():
    runner = _FakeRunner([(_message([_text_block("Hello!")]), None)])
    agent = _agent_with_runner(runner)
    events = []
    agent.handle("hi", lambda kind, payload: events.append((kind, payload)))
    assert events == [("text", {"text": "Hello!"})]
    assert [m["role"] for m in agent.history] == ["user", "assistant"]


def test_tool_turn_mirrors_history_and_fires_events():
    tool_msg = _message([_text_block("Fetching."), _tool_block("fetch_demographics", {"country_iso3": "BRA"})])
    tool_response = {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "toolu_1",
         "content": '{"applied": {}}', "is_error": False},
    ]}
    final_msg = _message([_text_block("Done.")])
    runner = _FakeRunner([(tool_msg, tool_response), (final_msg, None)])
    agent = _agent_with_runner(runner)
    events = []
    agent.handle("go", lambda kind, payload: events.append((kind, payload)))
    kinds = [k for k, _ in events]
    assert kinds == ["text", "tool_use", "tool_result", "text"]
    assert [m["role"] for m in agent.history] == ["user", "assistant", "user", "assistant"]
    assert events[1][1]["name"] == "fetch_demographics"


def test_refusal_stops_with_friendly_message():
    runner = _FakeRunner([(_message([], stop_reason="refusal"), None)])
    agent = _agent_with_runner(runner)
    events = []
    agent.handle("hi", lambda kind, payload: events.append((kind, payload)))
    assert len(events) == 1 and events[0][0] == "text"
    assert "can't help" in events[0][1]["text"].lower() or "unable" in events[0][1]["text"].lower()


def test_plot_event_after_run():
    runner = _FakeRunner([(_message([_text_block("Results below.")]), None)])
    agent = _agent_with_runner(runner)
    agent.state.plot_path = "results/sim_x.png"
    agent.state.data_sources = ["src"]
    events = []
    agent.handle("run", lambda kind, payload: events.append((kind, payload)))
    kinds = [k for k, _ in events]
    assert kinds == ["text", "plot"]
    assert events[1][1]["path"] == "results/sim_x.png"
    assert agent.state.plot_path is None


def test_api_error_surfaces_gracefully():
    runner = MagicMock()
    runner.__iter__ = MagicMock(side_effect=RuntimeError("boom"))
    agent = _agent_with_runner(runner)
    events = []
    agent.handle("hi", lambda kind, payload: events.append((kind, payload)))
    assert events and events[-1][0] == "text"
    assert "error" in events[-1][1]["text"].lower()
