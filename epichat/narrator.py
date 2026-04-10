from __future__ import annotations

import json
import os
from pathlib import Path

import anthropic
from dotenv import load_dotenv

from .schema import SimParams

load_dotenv()

_PROMPT_PATH = Path(__file__).parent / "prompts" / "narration.txt"
_MODEL = "claude-sonnet-4-6"


def narrate(user_input: str, params: SimParams, stats: dict) -> dict:
    """
    Generate a plain-language interpretation of simulation results.

    Returns:
        {'summary': str, 'key_findings': list[str]}
    """
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    system_prompt = _PROMPT_PATH.read_text(encoding="utf-8")

    pct_infected = (
        stats.get("total_infected", 0) / stats.get("n_agents", 1) * 100
        if stats.get("n_agents")
        else 0
    )

    user_message = (
        f"Original query: {user_input}\n\n"
        f"Parameters used:\n{json.dumps(params.model_dump(), indent=2)}\n\n"
        f"Simulation statistics:\n"
        f"  Peak infections:  {stats.get('peak_infections', 'N/A'):,} (day {stats.get('peak_day', 'N/A')})\n"
        f"  Total infected:   {stats.get('total_infected', 'N/A'):,} ({pct_infected:.1f}% of population)\n"
        f"  Total deaths:     {stats.get('total_deaths', 0):,}\n"
        f"  Population size:  {stats.get('n_agents', 'N/A'):,}\n"
        f"  Simulation days:  {stats.get('sim_days', 'N/A')}\n"
        f"  Approx R0:        {params.approx_r0():.1f}\n"
    )

    message = client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Graceful fallback: return raw text as summary
        return {"summary": raw, "key_findings": []}
