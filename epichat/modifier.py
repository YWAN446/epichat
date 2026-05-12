"""Apply a plain-text user modification to current SimParams via LLM."""
from __future__ import annotations

import json
import os

import anthropic

from .schema import SimParams

_MODEL = "claude-sonnet-4-6"

_NULLABLE_FIELDS = frozenset({
    "dur_exp", "dur_immune", "rand_seed",
    "age_pct_under18", "age_pct_18_64", "age_pct_over65",
})


def _parse_json(raw: str) -> dict:
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    brace = raw.find("{")
    if brace > 0:
        raw = raw[brace:]
    return json.loads(raw)


def apply_modification(params: SimParams, message: str) -> SimParams:
    """
    Interpret a plain-text modification request and return updated SimParams.

    Calls the LLM with the current params + the user's message.
    Only the fields the user asked to change are modified; everything else
    is preserved from the existing params.
    """
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    prompt = (
        f"Current simulation parameters:\n{json.dumps(params.model_dump(), indent=2)}\n\n"
        f"User modification request: {message}\n\n"
        "Apply only the requested change and return the complete updated parameters "
        "as a JSON object. Return ONLY valid JSON matching the SimParams schema. "
        "Do not change any field the user did not mention."
    )
    response = client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        system="You are an epidemiological parameter assistant. Return only valid JSON.",
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    data = _parse_json(raw)
    data = {k: v for k, v in data.items() if v is not None or k in _NULLABLE_FIELDS}
    return SimParams(**data)
