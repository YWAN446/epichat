"""The v2 repair loop: same prompt as parser.repair_params, v2 schema, and a
v1-shaped answer is migrated rather than rejected."""
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from epichat.params.repair import RepairResult, repair_params
from epichat.params.schema_v2 import SimParamsV2


def _client(answer: str):
    message = SimpleNamespace(content=[SimpleNamespace(text=answer)], usage=SimpleNamespace(input_tokens=120, output_tokens=30))
    calls = []

    class Messages:
        def create(self, **kw):
            calls.append(kw)
            return message

    client = SimpleNamespace(messages=Messages())
    client.calls = calls
    return client


def test_repair_returns_v2_params_and_the_usage(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    p = SimParamsV2()
    fixed = p.model_dump(mode="json")
    fixed["disease"]["dur_inf"]["mean_days"] = 12.0
    client = _client("```json\n" + json.dumps(fixed) + "\n```")
    with patch("epichat.params.repair.anthropic.Anthropic", return_value=client):
        out = repair_params("measles in Kenya", p, "Traceback: ValueError", "claude-opus-5-5")
    assert isinstance(out, RepairResult) and out.params.disease.dur_inf.mean_days == 12.0
    assert out.model == "claude-opus-5-5" and out.input_tokens == 120 and out.output_tokens == 30
    prompt = client.calls[0]["messages"][0]["content"]
    assert "measles in Kenya" in prompt and "Traceback: ValueError" in prompt and '"schema_version": 2' in prompt
    assert client.calls[0]["model"] == "claude-opus-5-5"


def test_a_v1_shaped_answer_is_migrated(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    client = _client(json.dumps({"disease_type": "seir", "beta": 5.0, "dur_exp": 3.0}))
    with patch("epichat.params.repair.anthropic.Anthropic", return_value=client):
        out = repair_params("x", SimParamsV2(), "err", "m")
    assert out.params.disease.model == "seir" and out.params.disease.dur_exp.mean_days == 3.0


def test_an_invalid_answer_raises_validation_error(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    client = _client(json.dumps({"schema_version": 2, "run": {"n_agents": 1}}))
    with patch("epichat.params.repair.anthropic.Anthropic", return_value=client), pytest.raises(ValidationError):
        repair_params("x", SimParamsV2(), "err", "m")
