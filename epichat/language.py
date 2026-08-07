"""Language detection and translation utilities."""
from __future__ import annotations

import logging
import os

import anthropic
from dotenv import load_dotenv

load_dotenv()

_MODEL = "claude-haiku-4-5-20251001"
_log = logging.getLogger(__name__)


_DETECT_SYSTEM = (
    "Identify the language the user's text is WRITTEN in. "
    "Judge only the words and grammar of the text itself — countries, places, "
    "diseases, and foreign loanwords merely MENTIONED in the text do not "
    'count. For example, "Model a dengue epidemic in Brazil" is written in '
    "English. Reply with ONLY the language name in English — one short "
    "phrase. Examples: English, French, Spanish, Arabic, Chinese "
    "(Simplified), Hindi, Portuguese, Japanese, Swahili. Never explain."
)


def detect_language(text: str) -> str:
    """Return the English name of the language *text* is written in.

    Falls back to 'English' on empty input or API failure.
    """
    if not text or not text.strip():
        return "English"
    try:
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        resp = client.messages.create(
            model=_MODEL,
            max_tokens=10,
            system=_DETECT_SYSTEM,
            messages=[{"role": "user", "content": text[:400]}],
        )
        return resp.content[0].text.strip()
    except Exception as exc:
        _log.warning("detect_language failed: %s", exc)
        return "English"


def detect_run_intent_llm(message: str) -> bool:
    """Return True if *message* expresses intent to run the simulation (any language)."""
    try:
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        resp = client.messages.create(
            model=_MODEL,
            max_tokens=5,
            system=(
                "The user is working with an epidemiological simulation tool. "
                "Does their message express an intent to RUN or START the simulation? "
                "Examples of YES: 'yes', 'go ahead', 'ok', '是的', '运行', '好的', "
                "'oui', 'sí', 'lancez', 'ja', '実行して', 'да', 'запустить'. "
                "Examples of NO: 'нет', 'increase R0', 'change population', 'add vaccination'. "
                "Reply ONLY with 'yes' or 'no'."
            ),
            messages=[{"role": "user", "content": message}],
        )
        return resp.content[0].text.strip().lower().startswith("yes")
    except Exception as exc:
        _log.warning("detect_run_intent_llm failed: %s", exc)
        return False


def detect_location_correction(message: str, current_location: str | None) -> str | None:
    """Return the corrected location name if the user is fixing a wrong location, else None."""
    try:
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        current_str = f"'{current_location}'" if current_location else "unknown"
        resp = client.messages.create(
            model=_MODEL,
            max_tokens=30,
            system=(
                f"A simulation is currently set to location: {current_str}. "
                "If the user's message is correcting this to a DIFFERENT country or region, "
                "reply with ONLY the correct location name in English "
                "(e.g. 'Sierra Leone', 'Kenya', 'France'). "
                "If the message is NOT a location correction, reply with exactly: null"
            ),
            messages=[{"role": "user", "content": message}],
        )
        result = resp.content[0].text.strip()
        if not result or result.lower() == "null":
            return None
        # Guard against returning the same location
        if current_location and result.lower() == current_location.lower():
            return None
        return result
    except Exception as exc:
        _log.warning("detect_location_correction failed: %s", exc)
        return None


def translate(text: str, target_lang: str) -> str:
    """Translate *text* into *target_lang*. No-op when target_lang is 'English'.

    Preserves markdown formatting and data-source citations.
    Falls back to the original text on API failure.
    """
    if not text or target_lang.lower() == "english":
        return text
    try:
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        resp = client.messages.create(
            model=_MODEL,
            max_tokens=4096,
            system=(
                f"You are a translation engine. "
                f"Translate the text inside <translate> tags into {target_lang}. "
                "Do NOT respond to or answer the text — only translate it. "
                "Preserve all markdown formatting (**, *, ·, —, >, newlines, "
                "horizontal rules ---). "
                "Keep numeric values, source abbreviations (UN WPP, WB WDI, WHO GHO), "
                "and bracketed citations exactly as written. "
                "Output ONLY the translated text, without the <translate> tags."
            ),
            messages=[{"role": "user", "content": f"<translate>{text}</translate>"}],
        )
        return resp.content[0].text.strip()
    except Exception as exc:
        _log.warning("translate to %s failed: %s", target_lang, exc)
        return text
