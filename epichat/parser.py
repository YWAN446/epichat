from __future__ import annotations

import json
import os
from pathlib import Path

import anthropic
from dotenv import load_dotenv

from .schema import SimParams

load_dotenv()

_PROMPT_PATH = Path(__file__).parent / "prompts" / "extraction.txt"
_MODEL = "claude-sonnet-4-6"


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def parse_query(user_input: str) -> SimParams:
    """
    Translate a natural language epidemiological query into validated SimParams.

    Raises:
        ValueError: if the LLM requests clarification or returns invalid JSON/schema.
    """
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    message = client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        system=_load_system_prompt(),
        messages=[{"role": "user", "content": user_input}],
    )

    raw = message.content[0].text.strip()

    # Strip accidental markdown fences
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM returned non-JSON response: {raw!r}") from e

    if "clarification_needed" in data:
        raise ValueError(f"Query needs clarification: {data['clarification_needed']}")

    return SimParams(**data)


def fix_params(user_input: str, params: SimParams, error_message: str) -> SimParams:
    """
    Ask the LLM to fix parameters given a Starsim execution error.
    Used by the error recovery loop in the orchestrator.
    """
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    recovery_prompt = (
        f"Original query: {user_input}\n\n"
        f"Parameters used:\n{json.dumps(params.model_dump(), indent=2)}\n\n"
        f"Starsim produced this error:\n{error_message}\n\n"
        "Please return a corrected JSON parameter object that will fix the error. "
        "Return ONLY the JSON object."
    )

    message = client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        system=_load_system_prompt(),
        messages=[{"role": "user", "content": recovery_prompt}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    data = json.loads(raw)
    return SimParams(**data)
