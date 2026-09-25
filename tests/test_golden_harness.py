"""The golden-set harness and its deterministic checks (no API calls)."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from evals.golden.checks import run_checks
from evals.golden.harness import StubExecutor, Trace, run_case


def _reply(text):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)],
                           stop_reason="end_turn")


class _ScriptedRunner:
    def __init__(self, message):
        self._message = message

    def __iter__(self):
        yield self._message

    def generate_tool_call_response(self):
        return None


def _patched_agent(messages):
    """Patch the SDK so run_case drives a scripted conversation."""
    client = MagicMock()
    client.beta.messages.tool_runner.side_effect = [
        _ScriptedRunner(m) for m in messages
    ]
    return patch("anthropic.Anthropic", return_value=client)


def test_run_case_captures_replies_per_turn():
    case = {"id": "t1", "turns": ["hello", "yes"]}
    with _patched_agent([_reply("Hi there."), _reply("Running now.")]):
        trace = run_case(case)
    assert isinstance(trace, Trace)
    assert trace.case_id == "t1"
    assert trace.replies == ["Hi there.", "Running now."]
    assert trace.error is None


def test_stub_executor_records_the_parameters_it_was_given():
    from epichat.schema import SimParams

    stub = StubExecutor()
    result = stub._execute_with_retry(
        "q", SimParams(n_agents=1234, beta=22.8125), "p.png", pop_scale=2.0)
    assert result["error"] is None
    assert result["stats"]["n_agents"]
    assert stub.calls[0]["params"]["n_agents"] == 1234
    assert stub.calls[0]["pop_scale"] == 2.0


def _trace(**kwargs):
    base = dict(case_id="x", replies=[], tool_calls=[], final_config=None,
                data_sources=[], ran_simulation=False, error=None, events=[])
    base.update(kwargs)
    return Trace(**base)


def test_tool_called_check_passes_and_fails():
    trace = _trace(tool_calls=[{"turn": 0, "name": "lookup_disease", "input": {}}])
    assert run_checks(trace, {"tool_called": ["lookup_disease"]}) == []
    failures = run_checks(trace, {"tool_called": ["run_simulation"]})
    assert failures and "run_simulation" in failures[0]


def test_no_tool_check_catches_an_unwanted_call():
    trace = _trace(tool_calls=[{"turn": 0, "name": "run_simulation", "input": {}}])
    failures = run_checks(trace, {"no_tool": ["run_simulation"]})
    assert failures and "run_simulation" in failures[0]


def test_config_check_resolves_a_database_reference():
    trace = _trace(final_config={"disease": "measles", "r0": 15})
    assert run_checks(trace, {"config": {"disease": "measles", "r0": "db.r0.typical"}}) == []
    failures = run_checks(trace, {"config": {"r0": "db.incubation_days.typical"}})
    assert failures


def test_confirmation_gate_catches_a_fetch_before_the_user_agreed():
    trace = _trace(tool_calls=[{"turn": 0, "name": "fetch_demographics", "input": {}}])
    failures = run_checks(trace, {"no_fetch_before_confirmation": True})
    assert failures and "fetch_demographics" in failures[0]


def test_confirmation_gate_allows_a_fetch_after_the_first_turn():
    trace = _trace(tool_calls=[{"turn": 1, "name": "fetch_demographics", "input": {}}])
    assert run_checks(trace, {"no_fetch_before_confirmation": True}) == []


def test_an_agent_error_is_recorded_not_raised():
    """handle() catches its own exceptions, so the trace carries the agent's
    message and no harness error — the harness only records what it failed at
    itself (see the next test)."""
    from epichat.agent import _ERROR_MSG

    case = {"id": "boom", "turns": ["hello"]}
    client = MagicMock()
    client.beta.messages.tool_runner.side_effect = RuntimeError("api down")
    with patch("anthropic.Anthropic", return_value=client):
        trace = run_case(case)
    assert trace.error is None
    assert trace.replies == [_ERROR_MSG]


def test_a_harness_level_failure_is_recorded_on_the_trace_and_stops_the_case():
    case = {"id": "boom2", "turns": ["hello", "and again"]}
    client = MagicMock()
    with patch("anthropic.Anthropic", return_value=client), \
            patch("epichat.agent.EpiChatAgent.handle",
                  side_effect=RuntimeError("harness broke")):
        trace = run_case(case)
    assert trace.error == "RuntimeError: harness broke"
    assert trace.replies == [""], "the second turn must not run after a harness failure"
    assert run_checks(trace, {}) == [f"harness error: {trace.error}"]
