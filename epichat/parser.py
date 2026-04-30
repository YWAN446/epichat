from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import anthropic
from dotenv import load_dotenv

from .resolver import DataQuery, ResolvedField, Resolver, SourceAdapter
from .schema import SimParams

load_dotenv()

_PROMPT_PATH = Path(__file__).parent / "prompts" / "extraction.txt"
_REFINEMENT_PROMPT_PATH = Path(__file__).parent / "prompts" / "refinement.txt"
_MODEL = "claude-sonnet-4-6"


@dataclass
class IntentResult:
    preliminary_params: SimParams
    data_queries: list[DataQuery]


_resolver: Resolver = Resolver()
_LOCATION_TABLE: str = ""


def configure_resolver(adapter: SourceAdapter) -> None:
    global _LOCATION_TABLE
    _resolver.register(adapter)
    from .adapters.un_wpp import UNWPPAdapter
    if isinstance(adapter, UNWPPAdapter):
        _LOCATION_TABLE = json.dumps(adapter.iso3_table(), separators=(",", ":"))


def _load_system_prompt() -> str:
    text = _PROMPT_PATH.read_text(encoding="utf-8")
    return text.replace("{location_table}", _LOCATION_TABLE or "{}")


def _parse_json(raw: str) -> dict:
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    brace = raw.find("{")
    if brace > 0:
        raw = raw[brace:]
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM returned non-JSON response: {raw!r}") from e


def _llm_call_1(user_input: str) -> IntentResult:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    message = client.messages.create(
        model=_MODEL,
        max_tokens=1500,
        system=_load_system_prompt(),
        messages=[{"role": "user", "content": user_input}],
    )
    raw = message.content[0].text.strip()
    data = _parse_json(raw)

    if "clarification_needed" in data:
        raise ValueError(f"Query needs clarification: {data['clarification_needed']}")

    if "preliminary_params" in data:
        prelim = data["preliminary_params"]
        prelim = {k: v for k, v in prelim.items() if v is not None or k in ("dur_exp", "dur_immune", "rand_seed", "capacity")}
        params = SimParams(**prelim)
        queries = [DataQuery(**q) for q in data.get("data_queries", [])]
        return IntentResult(preliminary_params=params, data_queries=queries)

    # Legacy format: raw SimParams JSON
    data = {k: v for k, v in data.items() if v is not None or k in ("dur_exp", "dur_immune", "rand_seed", "capacity")}
    return IntentResult(preliminary_params=SimParams(**data), data_queries=[])


def _llm_call_2(user_input: str, prelim: SimParams, resolved: list[ResolvedField]) -> SimParams:
    if not resolved:
        return prelim

    resolved_text = "\n".join(
        f"- {rf.field}: {rf.value} — {rf.citation}" for rf in resolved
    )
    user_message = (
        _REFINEMENT_PROMPT_PATH.read_text(encoding="utf-8")
        .replace("{user_input}", user_input)
        .replace("{preliminary_params}", json.dumps(prelim.model_dump(), indent=2))
        .replace("{resolved_fields}", resolved_text)
    )

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    message = client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        system="You are an epidemiological parameter assistant. Return only valid JSON.",
        messages=[{"role": "user", "content": user_message}],
    )
    raw = message.content[0].text.strip()
    data = _parse_json(raw)
    data = {k: v for k, v in data.items() if v is not None or k in ("dur_exp", "dur_immune", "rand_seed", "capacity")}
    return SimParams(**data)


def _run_resolver(queries: list[DataQuery]) -> list[ResolvedField]:
    if not queries:
        return []
    return _resolver.resolve(queries)


def parse_query(user_input: str) -> SimParams:
    """
    Translate a natural language epidemiological query into validated SimParams.

    Three-step process:
      1. LLM-1 extracts intent (preliminary params + optional data queries).
      2. If data queries exist, the resolver fetches real-world values.
      3. LLM-2 refines preliminary params using resolved data (skipped when no queries).

    Raises:
        ValueError: if the LLM requests clarification or returns invalid JSON/schema.
    """
    intent = _llm_call_1(user_input)
    resolved = _run_resolver(intent.data_queries)
    return _llm_call_2(user_input, intent.preliminary_params, resolved)


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
    data = {k: v for k, v in data.items() if v is not None or k in ("dur_exp", "dur_immune", "rand_seed", "capacity")}
    return SimParams(**data)
