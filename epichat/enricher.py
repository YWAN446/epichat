from __future__ import annotations

import json
import logging
import os
import re
from html.parser import HTMLParser
from pathlib import Path

import anthropic
import requests
from dotenv import load_dotenv

from .schema import OutbreakContext

load_dotenv()

_ENRICHMENT_MODEL = "claude-haiku-4-5-20251001"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "enrichment.txt"
_URL_RE = re.compile(r"https?://\S+")
_INTENT_MODEL = "claude-haiku-4-5-20251001"
_INTENT_PROMPT_PATH = Path(__file__).parent / "prompts" / "intent_revision.txt"
_MAX_ARTICLE_CHARS = 8000
# Input types where the source location may differ from the user's simulation target.
_REVISABLE_INPUT_TYPES = {"search", "url", "report"}


class _TextExtractor(HTMLParser):
    """Strip HTML tags; skip script/style/nav blocks."""

    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []
        self._skip = False

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in ("script", "style", "nav", "header", "footer"):
            self._skip = True

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "nav", "header", "footer"):
            self._skip = False

    def handle_data(self, data: str) -> None:
        if not self._skip:
            chunk = data.strip()
            if chunk:
                self._parts.append(chunk)

    def get_text(self) -> str:
        return " ".join(self._parts)


def _fetch_url_text(url: str) -> str:
    # verify=False because many health agency sites have cert chain issues with
    # Python's bundled CA store on Windows; we're only reading public articles.
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    resp = requests.get(
        url,
        timeout=10,
        verify=False,
        headers={"User-Agent": "Mozilla/5.0 (compatible; EpiChat/1.0)"},
    )
    resp.raise_for_status()
    parser = _TextExtractor()
    parser.feed(resp.text)
    return parser.get_text()[:_MAX_ARTICLE_CHARS]


def _build_user_content(user_input: str) -> str:
    """Pre-fetch any URL in the input and inject the article text."""
    match = _URL_RE.search(user_input)
    if not match:
        return user_input
    url = match.group().rstrip(").,;")
    try:
        article_text = _fetch_url_text(url)
        return (
            f"[Fetched article from {url}]\n{article_text}\n\n"
            f"[User request]\n{user_input}"
        )
    except Exception as exc:
        logging.getLogger(__name__).warning("URL fetch failed for %s: %s", url, exc)
        return user_input


def enrich_input(user_input: str) -> OutbreakContext:
    """Extract structured outbreak context from any input type.

    Phase 1: extract source facts via enrichment LLM (may use web_search).
    Phase 2: for search/url/report inputs, reconcile source facts with the
             user's simulation intent via a second LLM call.
    Returns OutbreakContext(input_type="query") on any failure.
    """
    try:
        source_ctx = _call_enrichment_llm(user_input)
        if source_ctx.input_type in _REVISABLE_INPUT_TYPES:
            return _resolve_intent(user_input, source_ctx)
        return source_ctx
    except Exception as e:
        logging.getLogger(__name__).warning("enrich_input failed: %s", e, exc_info=True)
        return OutbreakContext(input_type="query")


def _resolve_intent(user_input: str, source_ctx: OutbreakContext) -> OutbreakContext:
    """Phase 2: apply the user's simulation intent to the extracted source facts.

    The source context may reflect the outbreak's origin location (e.g. DRC)
    while the user wants to simulate somewhere else (e.g. Kenya).  A dedicated
    LLM call reads only the user's prompt and the source JSON so it can make
    targeted overrides without re-doing the search.
    """
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    system = _INTENT_PROMPT_PATH.read_text(encoding="utf-8")
    content = (
        f"SOURCE FACTS:\n{source_ctx.model_dump_json()}\n\n"
        f"USER REQUEST:\n{user_input}"
    )
    response = client.messages.create(
        model=_INTENT_MODEL,
        max_tokens=1024,
        system=system,
        messages=[{"role": "user", "content": content}],
    )
    text_blocks = [b.text for b in response.content if b.type == "text"]
    raw = _find_json_block(text_blocks)
    try:
        return _parse_context(raw)
    except Exception as exc:
        logging.getLogger(__name__).warning("_resolve_intent parse failed: %s", exc)
        return source_ctx


def _find_json_block(text_blocks: list[str]) -> str:
    """Return the first text block that contains a JSON object, or '{}' if none do."""
    for block in text_blocks:
        if "{" in block:
            return block
    return "{}"


def _call_enrichment_llm(user_input: str) -> OutbreakContext:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    system = _PROMPT_PATH.read_text(encoding="utf-8")
    content = _build_user_content(user_input)
    messages: list[dict] = [{"role": "user", "content": content}]

    # web_search is only needed for pure search requests.
    # When we pre-fetched a URL the article text is already in `content`;
    # passing the tool anyway causes the LLM to search instead of reading
    # the injected text, which produces wrong extraction results.
    has_prefetched_article = content.startswith("[Fetched article from ")
    tools = (
        []
        if has_prefetched_article
        else [{"type": "web_search_20250305", "name": "web_search"}]
    )

    for _ in range(10):
        response = client.messages.create(
            model=_ENRICHMENT_MODEL,
            max_tokens=2048,
            system=system,
            tools=tools,
            messages=messages,
        )
        text_blocks = [b.text for b in response.content if b.type == "text"]

        if response.stop_reason == "end_turn":
            raw = _find_json_block(text_blocks)
            return _parse_context(raw)

        if response.stop_reason == "tool_use":
            messages = messages + [
                {"role": "assistant", "content": response.content},
                {
                    "role": "user",
                    "content": [
                        # web_search_20250305 is a server-side tool; results are injected by the API.
                        # The client sends an empty tool_result as an acknowledgement turn.
                        {"type": "tool_result", "tool_use_id": b.id, "content": ""}
                        for b in response.content
                        if b.type == "tool_use"
                    ],
                },
            ]
            continue

        raw = _find_json_block(text_blocks)
        return _parse_context(raw)

    return OutbreakContext(input_type="query")


_FLOAT_FIELDS = frozenset({
    "case_fatality_rate", "r0_estimate",
    "incubation_period_days", "infectious_period_days",
})


def _parse_context(raw: str) -> OutbreakContext:
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    # Extract the JSON object between first { and last }; fall back to {} if not found
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end > start:
        raw = raw[start : end + 1]
    else:
        logging.getLogger(__name__).debug("No JSON object found in enricher response: %r", raw[:200])
        raw = "{}"
    data = json.loads(raw)
    # Null out numeric fields that the model returned as range strings (e.g. "4-42")
    for field in _FLOAT_FIELDS:
        if isinstance(data.get(field), str):
            data[field] = None
    return OutbreakContext.model_validate(data)
