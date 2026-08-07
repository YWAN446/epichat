# Staged Chat Pipeline — Design

**Date:** 2026-08-07
**Status:** Approved (design discussed and accepted in session)

## Problem

The chat flow runs the entire parse pipeline — enrichment, intent extraction,
all resolver fetches, refinement, post-processing — behind a single opaque
spinner ("Searching available data…") that can take 90+ seconds. The user
cannot see what is being fetched, cannot correct a misunderstanding until
everything finishes, and serial API calls (notably the World Bank adapter's
sequential indicator fetches with 10s timeouts) dominate the wait.

Separately, `detect_language` misidentifies English queries that mention
foreign places/diseases ("Model a dengue epidemic in Brazil" → Portuguese),
so the whole conversation switches language.

## Goals

1. Split the chat flow into three visible stages: understand → confirm →
   fetch (as labeled per-tool steps) → summary.
2. Cut data-fetch wall time to roughly the slowest single call by
   parallelizing independent fetches.
3. Persist a per-tool trace in the chat transcript showing which source
   produced which numbers.
4. Answer in the language the user wrote in, regardless of the location
   being simulated.

## Non-goals

- No agentic/tool-calling LLM rewrite (future direction).
- No change to the CLI one-shot flow (`parse_query`) or its callers.
- No change to the run/modify/export stages of the chat.

## Design

### Stage 1 — Understand & confirm

On a user message in the `collecting` stage:

- `detect_language` (hardened prompt, below), `enrich_input`, and intent
  extraction (`extract_intent`, wrapping today's `_llm_call_1` +
  `ClarificationNeeded` handling) run as today.
- Ambiguous query → the LLM's clarifying question is shown (existing
  behavior from the ClarificationNeeded fix).
- Otherwise the assistant posts an **understanding card**: disease,
  location, model type, agents, duration, interventions, plus the fetch
  plan derived from `IntentResult.data_queries` (source name + what it
  will provide + for where). Ends by asking: change anything, or proceed?
- New conversation stage `confirm` stores the `IntentResult` in session
  state.
- Reply handling in `confirm`:
  - Affirmative ("go", "yes", "proceed", "fetch", …; via the existing
    affirmation detection used for run intent) → Stage 2.
  - Anything else → treated as a correction: appended to context,
    intent re-extracted, updated card shown, stay in `confirm`.

### Stage 2 — Fetch (parallel, visible)

- Each `DataQuery` runs in a `ThreadPoolExecutor`; adapters are
  requests-based and independent.
- The World Bank Data360 adapter additionally parallelizes its per-indicator
  calls internally (they are serial today and are the dominant cost).
- While running, a live status container lists each tool in flight.
- As each future completes, a permanent chat message is appended (completion
  order): `🔧 <Source> — <key values with units>`; failures append
  `⚠ <Source> — <reason>, skipped`.
- After all fetches: refinement (`finalize_params` = today's `_llm_call_2` +
  the `_apply_*` chain) runs with one final step line
  (`🧮 Parameters calibrated …`), then the flow enters today's summary path.

### Stage 3 — Summary

Unchanged: `build_summary` with parameter warnings and the run question.

### Parser staged API (parser.py)

- `extract_intent(user_input, context) -> IntentResult` — LLM-1 +
  clarification handling.
- `fetch_query(query: DataQuery) -> list[ResolvedField]` — resolve one query.
- `finalize_params(user_input, intent, resolved) -> SimParams` — LLM-2 +
  deterministic post-processing (age distribution, vaccination, surveillance,
  prevalence, health system, population scale, disease-DB R0, country).
- `parse_query` remains the one-shot composition of the above three —
  CLI behavior and existing tests unchanged.

### Chat formatting (chat_controller.py)

Pure, unit-testable functions:

- `format_understanding_card(intent, lang) -> str`
- `format_tool_result(query, fields) -> str` and
  `format_tool_failure(query, reason) -> str`
- `describe_query(query) -> str` (human name for a DataQuery: source,
  scope, target location)

`app.py` keeps only stage orchestration.

### Language detection fix (language.py)

Harden the system prompt: identify the language the text is *written in*;
mentioned countries, diseases, and loanwords do not count. Include the
few-shot example `"Model a dengue epidemic in Brazil" → English`.

## Error handling

- A failed/timed-out fetch never blocks the flow: the failure line is
  shown, remaining fields fall back to defaults, and the summary's
  warnings note missing sources where relevant.
- `ClarificationNeeded` and parse retry/logging behavior from the previous
  fix are preserved at every LLM step.
- If the user abandons the `confirm` stage with a brand-new scenario,
  existing `detect_new_scenario` behavior resets the conversation.

## Testing

- Unit: staged parser API with mocked LLM/adapters (extract/fetch/finalize
  and their composition equals `parse_query`); understanding-card and
  tool-line formatting; confirm-stage transition logic.
- Existing suite must stay green (CLI path untouched).
- Live browser verification of the dengue-in-Brazil query end-to-end:
  card → confirm → parallel tool lines → summary, in English.
