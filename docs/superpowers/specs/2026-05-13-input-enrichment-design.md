# Input Enrichment Layer — Design Spec
**Date:** 2026-05-13  
**Status:** Approved

## Problem

The current first step of EpiChat (`parse_query` / `_llm_call_1`) maps a plain natural language query directly to `SimParams`. It works well for simple queries but has no ability to:
- Accept a pasted epidemiological report and extract structured facts from it
- Fetch and parse an online article or news URL
- Search the web for recent outbreak news on behalf of the user

## Solution

Add a pre-processing layer — a new `enricher.py` module — that runs **before** `parse_query()`. It produces a structured `OutbreakContext` object capturing raw epidemiological facts from any input type. `parse_query()` then receives this context alongside the original query to inform `SimParams` generation.

Simple queries fast-path through cheaply (haiku model, no tools called). Rich inputs (reports, URLs, search requests) go through the same single LLM call but may invoke the `web_search` tool.

---

## Architecture

```
user input (any type)
    ↓
enrich_input()  [enricher.py — always runs]
    LLM: claude-haiku-4-5-20251001
    Tool: web_search (Anthropic built-in)
    → OutbreakContext (structured facts, all fields nullable)
    ↓
[DEV MODE] show OutbreakContext card in UI
    ↓
parse_query(user_input, context=OutbreakContext)  [parser.py — unchanged structure]
    → SimParams  (existing pipeline)
    ↓
[existing] resolver → LLM-2 refinement → post-processing
    ↓
parameter summary + "Anything to add or change?"
```

---

## OutbreakContext Schema

New Pydantic model added to `schema.py`. Every field is `Optional` — `None` means unknown. The enrichment LLM is instructed to omit fields it is not confident about rather than guess.

```python
class OutbreakContext(BaseModel):
    input_type: Literal["query", "report", "url", "search"]
    source_url: Optional[str] = None
    disease_name: Optional[str] = None
    pathogen_type: Optional[str] = None           # "virus", "bacteria", "parasite", etc.
    location: Optional[str] = None
    geographic_scale: Optional[Literal["city", "regional", "national", "global"]] = None
    outbreak_start_date: Optional[str] = None     # ISO date or free text
    outbreak_end_date: Optional[str] = None       # None = ongoing or unknown
    total_cases: Optional[int] = None
    total_deaths: Optional[int] = None
    case_fatality_rate: Optional[float] = None    # 0.0–1.0
    r0_estimate: Optional[float] = None
    incubation_period_days: Optional[float] = None
    infectious_period_days: Optional[float] = None
    affected_population: Optional[str] = None
    interventions_mentioned: List[str] = []
    confidence: Literal["high", "medium", "low"] = "low"
```

---

## New Files

### `epichat/enricher.py`
Exports one public function:

```python
def enrich_input(user_input: str) -> OutbreakContext
```

Internally:
1. Calls `claude-haiku-4-5-20251001` with the `web_search` tool available
2. System prompt (`prompts/enrichment.txt`) instructs the model to:
   - Determine input type (query / report / URL / search request)
   - Use `web_search` if input is a URL or a search request
   - Extract only facts explicitly stated in the source — never infer
   - Omit (leave null) any field it is not confident about
   - Return a single JSON object matching `OutbreakContext`
3. Parses the JSON response into `OutbreakContext`

### `epichat/prompts/enrichment.txt`
System prompt for the enrichment LLM call. Key contract:
- Input types and how to handle each
- Anti-hallucination rule: omit uncertain fields, never guess
- Output: JSON only, matching OutbreakContext schema

---

## Modified Files

### `epichat/schema.py`
- Add `OutbreakContext` model (see schema above)

### `epichat/parser.py`
- `parse_query(user_input, context: OutbreakContext | None = None) -> SimParams`
- When `context` is not None, format its non-None fields as a labeled text block (e.g. `"Outbreak context:\n  disease: Mpox\n  location: Nigeria\n  ..."`) and prepend it to the `_llm_call_1` user message
- Add one sentence to `extraction.txt`: "If an OutbreakContext is provided, use its values to inform parameter choices — user-stated values always take precedence."
- No other changes to extraction, refinement, or resolver pipeline

### `epichat/app.py`
- `DEV_MODE = os.environ.get("EPICHAT_DEV_MODE", "false").lower() == "true"`
- New `_do_enrich()` function: calls `enrich_input()`, stores result in `st.session_state.outbreak_context`
- `_process_pending()` collecting stage: call `_do_enrich()` before `_do_parse()`
- Pass `st.session_state.outbreak_context` to `parse_query()`
- `update_collected()` in `chat_controller.py`: pre-mark collected fields using `OutbreakContext` (e.g., if `context.location` is not None → `collected["location"] = True`)
- Dev mode display: after enrichment, render an expandable `st.expander("🔬 Extracted context")` showing a table of all fields — non-None fields show their value, None fields show "unknown"
- After all fields collected (same as today): show parameter summary and ask "Anything to add or change before I run the simulation?"

### `epichat/chat_controller.py`
- `update_collected()` gains an optional `outbreak_context: OutbreakContext | None = None` parameter
- Pre-marks `collected["disease"]`, `collected["location"]`, `collected["population"]` when the corresponding OutbreakContext fields are not None

---

## Dev Mode

Controlled by env var `EPICHAT_DEV_MODE=true`. When enabled:
- After enrichment, an expandable section in the chat shows all `OutbreakContext` fields
- Non-None fields display their extracted value
- None fields display "unknown"
- No change in production (flag off by default)

---

## Error Handling

- If `enrich_input()` raises (network error, JSON parse failure, schema validation error): log the error, return a minimal `OutbreakContext(input_type="query")` and continue — the existing pipeline degrades gracefully
- If web_search tool returns no results: the LLM should still return a valid OutbreakContext with most fields as None
- URL fetch failures are handled by the web_search tool internally

---

## Testing

- Unit tests for `enrich_input()` with mocked LLM responses (query / report / URL / search)
- Test that `parse_query()` produces valid SimParams with and without context
- Test `update_collected()` with OutbreakContext pre-filling
- Dev mode rendering tested via Streamlit app (manual)

---

## Out of Scope

- Modifying the resolver, LLM-2 refinement, or post-processing steps
- Persisting OutbreakContext across sessions
- Displaying OutbreakContext in exported PDFs/DOCX
