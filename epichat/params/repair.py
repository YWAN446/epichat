"""Ask the model to repair a v2 parameter set after a failed run (spec 8.8).
The prompt is parser.repair_params's; the answer may come back in either
shape and is coerced to v2."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass

import anthropic

from .migrate import coerce_params
from .schema_v2 import SimParamsV2


@dataclass
class RepairResult:
    params: SimParamsV2
    model: str
    input_tokens: int
    output_tokens: int


def _token_count(usage, name: str) -> int:
    value = getattr(usage, name, None) if usage is not None else None
    return value if isinstance(value, int) else 0


def _strip_fence(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


def repair_params(user_input: str, params: SimParamsV2, error_message: str, model: str) -> RepairResult:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    prompt = (
        f"Original query: {user_input}\n\n"
        f"Parameters used (schema v2, nested):\n{json.dumps(params.model_dump(mode='json'), indent=2)}\n\n"
        f"Starsim produced this error:\n{error_message}\n\n"
        "Please return a corrected JSON parameter object with the same nested shape that will fix the error. "
        "Return ONLY the JSON object."
    )
    message = client.messages.create(
        model=model,
        max_tokens=1024,
        system="You are an epidemiological parameter assistant. Return only valid JSON matching the parameter schema you were given.",
        messages=[{"role": "user", "content": prompt}],
    )
    data = json.loads(_strip_fence(message.content[0].text))
    usage = getattr(message, "usage", None)
    return RepairResult(params=coerce_params(data), model=model,
                        input_tokens=_token_count(usage, "input_tokens"), output_tokens=_token_count(usage, "output_tokens"))
