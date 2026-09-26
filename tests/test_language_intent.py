"""Offline tests for run-intent detection (no API calls, no key needed)."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from epichat.chat_controller import detect_run_intent


@pytest.fixture(autouse=True)
def _fake_key(monkeypatch):
    """detect_run_intent_llm reads the key before the client is built."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-never-used")


def _client_replying(text):
    client = MagicMock()
    client.messages.create.return_value = SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)]
    )
    return client


@pytest.mark.parametrize("reply", ["yes", "Yes", "YES", "yes.", " yes\n"])
def test_affirmative_reply_is_run_intent(reply):
    with patch("anthropic.Anthropic", return_value=_client_replying(reply)):
        assert detect_run_intent("go ahead") is True


@pytest.mark.parametrize("reply", ["no", "No", "no.", "", "not yet"])
def test_other_reply_is_not_run_intent(reply):
    with patch("anthropic.Anthropic", return_value=_client_replying(reply)):
        assert detect_run_intent("change duration to 5 years") is False


def test_api_error_never_starts_a_run():
    """An outage must not be read as consent to run the simulation."""
    client = MagicMock()
    client.messages.create.side_effect = RuntimeError("api down")
    with patch("anthropic.Anthropic", return_value=client):
        assert detect_run_intent("yes") is False


def test_missing_api_key_never_starts_a_run(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert detect_run_intent("yes") is False
