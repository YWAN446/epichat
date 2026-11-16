# EpiChat Agent — Tool-Calling Chat Design

**Date:** 2026-08-07
**Status:** Approved (design discussed and accepted in session)

## Problem

The chat flow routes user intent through rule-based triggers (`detect_run_intent`,
`detect_new_scenario` regexes, a hand-built stage machine) and dedicated LLM
calls for extraction, refinement, language detection, and translation. These
are brittle (a "run it" phrasing the classifier misses stalls the flow) and
duplicative (five separate LLM call sites doing what one agent can do).

## Goals

1. Replace rule-based routing with a Claude tool-calling agent that owns the
   conversation: understand → confirm settings → fetch data → parameterize →
   confirm → run simulation → report.
2. Keep all epidemiological logic deterministic inside tools (validation,
   beta calibration, data application, simulation execution). The agent
   orchestrates; it never invents or transcribes epidemiological values.
3. Native multilingual conversation (agent answers in the user's language),
   removing detect_language/translate from this path.
4. Preserve the transparent-tool-use UX: each tool call is a persistent 🔧
   chat line; results, plots, and source attributions render as today.
5. Instant rollback: `EPICHAT_AGENT=0` restores the current staged pipeline.

## Non-goals

- No change to the CLI (`parse_query` path) or to `epichat.py`.
- No Managed Agents / server-side sandbox — tools run in-process.
- No removal of the staged pipeline yet (that happens after the agent proves
  itself; the fallback stays intact this iteration).

## Design

### Module: `epichat/agent.py`

- `AgentState` dataclass: `params: SimParams | None`, `data_sources:
  list[ResolvedField]`, `total_population: int | None`, `plot_path`,
  `stats: dict`, `executor` (the session's `EpiChat` instance),
  `events: list[dict]` (UI events emitted by tools).
- `build_tools(state) -> list` — `@beta_tool`-decorated closures over the
  state (SDK generates schemas from signatures):

| Tool | Behavior (all deterministic) |
|---|---|
| `configure_simulation(...)` | Merge user-specified settings into `state.params` via SimParams validation; if `r0` given, compute beta with `parser._calibrate_beta`; return validated config + `check_params` literature warnings. Validation errors return as tool errors the agent can fix. |
| `lookup_disease(disease_name)` | disease_db lookup: R0/incubation/infectious/fatality with citations; detection of canonical name. |
| `fetch_demographics(country_iso3)` | UN WPP adapter (via the registered resolver; location_id resolved from the adapter's iso3 table), falling back to the offline WPP CSV loader. **Auto-applies** age structure to `state.params` and records `total_population`; appends ResolvedFields to `state.data_sources`. Returns what was fetched and applied. |
| `fetch_health_system(country_iso3)` | WB Data360 adapter; auto-applies treatment capacity to a treatment intervention if one exists; records sources. |
| `fetch_vaccination_coverage(country_iso3, disease)` | WHO GHO adapter; auto-adds a vaccine intervention at reported coverage when none exists; records sources. |
| `run_simulation()` | Requires `state.params`; computes pop_scale from `total_population`; runs generator+executor (`EpiChat._execute_with_retry`); stores stats + plot_path; returns stats. |

  Auto-apply keeps numbers flowing DB→params without LLM transcription,
  matching the existing deterministic post-processing philosophy.

- `EpiChatAgent` class: holds `history` (Messages-API message list) and
  `state`; `handle(user_text, on_event) -> None` runs one turn with
  `client.beta.messages.tool_runner`, mirroring history per the SDK pattern
  (append assistant content, then `generate_tool_call_response()`).
  `on_event(kind, payload)` callbacks surface text messages, tool calls,
  tool results, and the plot to the UI as they happen.
- Request shape: `model="claude-opus-5"`, `max_tokens=16000`, thinking left
  at default (on), system prompt as a list with a `cache_control` breakpoint
  (tools+system cached as the stable prefix), `stop_reason == "refusal"`
  handled with a user-facing message before reading content.
- System prompt encodes the workflow policy: present understood settings and
  get confirmation before fetching; fetch before parameterizing; confirm
  before running; answer in the user's language; cite sources; never state
  epidemiological values that didn't come from a tool result.

### App integration (`app.py`)

- `EPICHAT_AGENT` env flag (default on). On: `_process_pending` routes every
  chat message to the session's `EpiChatAgent` (created per conversation,
  reset on New Chat) inside a live `st.status` panel; agent events map to
  the existing chat primitives (`_add_msg`, 🔧 tool lines via a new
  `format_agent_tool_line`, plot attachment, `format_data_sources` block
  after a run). Off: the current staged pipeline runs unchanged.
- Exports and conversation history work unchanged (same message list).

### Environment

- Requires an `anthropic` SDK version with `client.beta.messages.tool_runner`
  and `@beta_tool`; upgrade and pin in requirements.txt if the installed
  version lacks them.

## Error handling

- Tool exceptions → `is_error` tool results (the runner handles this); the
  agent sees the message and adapts; the UI shows a ⚠ line.
- API refusal (`stop_reason == "refusal"`) → polite user-facing message.
- API/network errors → caught in `handle`, logged with traceback, surfaced
  as a chat error message; conversation state stays intact for retry.

## Testing

- Unit: every tool against a fake `AgentState` (mocked adapters/executor,
  no network, no LLM) — validation merging, calibration, auto-apply,
  source recording, error paths.
- Unit: `EpiChatAgent.handle` with a mocked runner/client — history
  mirroring, event callbacks, refusal handling.
- Existing suite stays green (flag-off path untouched).
- Live browser verification: full dengue-in-Brazil flow in English; one
  Portuguese query answered in Portuguese; `EPICHAT_AGENT=0` regression
  check of the staged pipeline.

## Future work

### Citation-backed seasonality field in `disease_parameters.json`

Gap found in live testing (2026-08-12): asked for dengue in Brazil, the agent
added a `seasonality` intervention on its own initiative. `configure_simulation`
exposes `seasonality_scale` (0–1), but nothing in the data or the system prompt
governs *when* to use it or *what amplitude* — the LLM chose both from general
knowledge. Every other epidemiological number originates in
`disease_parameters.json` and is range-checked by `check_params`; the
seasonality amplitude is the single exception to "the model orchestrates but
never invents parameter values". Today it is guarded only by the user
confirmation step and the schema's 0–1 bound.

Proposed fix — extend the per-disease schema with a `seasonality` parameter in
the same consensus format as the rest:

```json
"seasonality": {
  "unit": "dimensionless",
  "consensus": {
    "min": 0.1, "max": 0.4, "typical": 0.25,
    "notes": "e.g. transmission peaks in the rainy season",
    "source": "<citation URL>"
  }
}
```

Wiring once the data exists:

1. `disease_db.load_db()` — `_flatten_param` is generic over `parameters.*`;
   verify the new key flows through to the flat view.
2. `lookup_disease` (`epichat/agent.py`) — add `"seasonality"` to the
   parameter allow-list so the agent receives it with the other literature
   values.
3. `check_params` (`epichat/disease_db.py`) — warn when a configured
   seasonality scale falls outside the literature range.
4. System prompt — propose seasonal forcing only when the database provides a
   value or the user asks for it; cite the source at the confirm step.
5. Populate entries for well-characterized seasonal diseases first (dengue,
   influenza, RSV, measles); leave the field absent elsewhere — absence means
   no unsolicited seasonality.

Data curation follows the same citation-backed workflow as the rest of the
disease database.
