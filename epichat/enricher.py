from __future__ import annotations

import json
import os
from pathlib import Path

import anthropic
from dotenv import load_dotenv

from .schema import OutbreakContext

load_dotenv()

_ENRICHMENT_MODEL = "claude-haiku-4-5-20251001"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "enrichment.txt"


def enrich_input(user_input: str) -> OutbreakContext:
    """Extract structured outbreak context from any input type.

    Uses the Anthropic web_search tool for URL and search inputs.
    Returns OutbreakContext(input_type="query") on any failure.
    """
    try:
        return _call_enrichment_llm(user_input)
    except Exception:
        return OutbreakContext(input_type="query")


def _call_enrichment_llm(user_input: str) -> OutbreakContext:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    system = _PROMPT_PATH.read_text(encoding="utf-8")
    messages: list[dict] = [{"role": "user", "content": user_input}]

    for _ in range(10):
        response = client.messages.create(
            model=_ENRICHMENT_MODEL,
            max_tokens=2048,
            system=system,
            tools=[{"type": "web_search_20250305", "name": "web_search"}],
            messages=messages,
        )
        text_blocks = [b.text for b in response.content if b.type == "text"]

        if response.stop_reason == "end_turn":
            raw = text_blocks[-1] if text_blocks else "{}"
            return _parse_context(raw)

        if response.stop_reason == "tool_use":
            messages = messages + [
                {"role": "assistant", "content": response.content},
                {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": b.id, "content": ""}
                        for b in response.content
                        if b.type == "tool_use"
                    ],
                },
            ]
            continue

        raw = text_blocks[-1] if text_blocks else "{}"
        return _parse_context(raw)

    return OutbreakContext(input_type="query")


def _parse_context(raw: str) -> OutbreakContext:
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    brace = raw.find("{")
    if brace > 0:
        raw = raw[brace:]
    data = json.loads(raw)
    return OutbreakContext.model_validate(data)
