# EpiChat Agent Core — Design (sub-project 3)

Date: 2026-10-08. Parent: `docs/superpowers/specs/2026-10-07-web-agent-architecture-design.md`, sections 7, 9, 10.1, 10.2, 12, 13, 15.3. This document refines those sections for implementation and records the decisions made on 2026-10-08. Where the two disagree, this one wins for the agent core; the parent still owns everything else. The Python agent on `main` (`epichat/agent.py`, `epichat/disease_db.py`, `epichat/adapters/*`, `epichat/schema.py`, `epichat/parser.py`) is the behavioral authority for everything described as "ported"; the implementation plan carries the exact strings and rules.

## 1. Purpose

The web app's `POST /api/chat` runs the EpiChat agent on Claude Opus 5.5 with the six client tools and the two web server tools, streams events to the browser, and persists everything the usability study needs: the exact message list, one `turns` row per turn with per-call usage and the model's summarized thinking, the ordered `turn_events`, the scenario, runs, feedback, and step events. A plain chat page renders live and replayed conversations through one block model. Cards, the stage strip, the scenario panel, and the researcher view remain sub-project 4.

Success is the parent's verification points for 15.3, run on a preview deployment: a full English scenario end to end; a Portuguese one answered in Portuguese; a refusal; a `pause_turn` with web search; and `usage_daily`, `turns.api_calls`, `thinking` events, `feedback`, and `step_events` populated with sane timestamps.

## 2. Decisions made on 2026-10-08

- **Manual streaming loop, not the SDK tool runner.** CampusOtter's `runTurn` already gives per-call usage, the tool-round cap, the dropped-turn protocol, and the bad-JSON retry; the runner has none of these and does not resume `pause_turn`. The loop is extended, not replaced.
- **Suggestions and stages are built here, not in sub-project 4.** The prompt asks for a `next` block; the server parses and strips it, stores a `suggestions` event, derives the stage after every tool result and at turn end, and writes `stage_before`, `stage_after`, and `stage_reached`. The page shows plain suggestion chips; the styled strip waits.
- **The disease database is exported pre-flattened by Python.** A script writes every parameter's summary and warning range text as the Python code computes them. TypeScript resolves names and does the math; it never re-derives summaries, so the `1.0` versus `1` formatting that JavaScript cannot see cannot drift.
- **One SQL function writes a turn.** The Supabase client has no transactions; `finish_turn(jsonb)` inserts the turn, its events, the appended messages, the scenario, the conversation update, and the step events atomically.
- **The UN location table is static.** Python downloads it at start-up; on serverless that would repeat per cold instance. A script commits `web/data/un_locations.json`.
- **Tool results are not byte-identical to Python.** The model reads JSON either way. Parity is pinned where people see it: the math, the warnings, and the adapters' row mapping.
- **One price table.** `lib/models.ts` prices Opus 5.5, Opus 5, and Sonnet 5.5, and the sim's repair tokens.
- **Refusal and exhausted-pause messages are the Python agent's;** the length, empty, and tool-limit discards keep CampusOtter's wording.
- **The first user message carries the date.** `Today's date: YYYY-MM-DD.` on its first line, CampusOtter's way, so the system prompt stays byte-stable for caching. `turns.user_text` holds the typed text.
- **Soft delete of a conversation ships here**, since the list and resume do.
- **Two implementation plans under this spec.** Plan A: the libraries (parameters, disease database, adapters, tools, sim client, exports, parity). Plan B: the route, persistence, and the page. Plan A ships nothing visible and is where the port risk lives.

## 3. Contract

### 3.1 `POST /api/chat`

Node runtime, `maxDuration = 300`. Body: `{ conversationId?: uuid, sessionId: uuid, text: string }`.

Gates, in order, before any model call: signed in (401 `not_signed_in`), confirmed email on an allowed domain (403 `email_not_allowed`), current consent (403 `consent_required`). These three answer as JSON. Everything after answers as a stream with HTTP 200:

| Check | Error event code |
|---|---|
| body not JSON, or shape wrong | `bad_request` |
| empty text, or longer than `MAX_MESSAGE_CHARS` | `bad_request` / `message_too_long` |
| `conversationId` not the caller's, or deleted | `conversation_not_found` |
| `reserve_turn` says a cap is reached | `daily_turns` / `monthly_budget`, with `capMessage` |
| `reserve_turn` or any store throws before the model call | `service_unavailable` |
| the API rejects the replayed history (`BadRequestError`) | `conversation_invalid`, mid-stream |
| any other model or store failure during the turn | `service_unavailable`, mid-stream |

Stream events (`data: <json>\n\n`, no event names):

```
{ type: "text", delta }
{ type: "tool_use", id, name, input }
{ type: "tool_result", id, name, ok, payload }      payload: CardPayload (section 6)
{ type: "web_search", query }
{ type: "web_fetch", url, title }
{ type: "notice", message }                          server-tool error, length cut-off
{ type: "stage", stage }
{ type: "suggestions", items }                       1 to 3 strings
{ type: "done", turnId, conversationId, notice }     notice: string | null
{ type: "discard", message }                         the turn was dropped; nothing appended
{ type: "error", code, message }                     nothing ran, or the service failed
```

Thinking summaries are stored, never streamed. The browser folds the events into the block list of section 8; the server stores the same blocks as `turn_events`.

### 3.2 `POST /api/feedback`

Body: `{ conversationId: uuid, turnId: uuid, rating: "up" | "down", comment?: string ≤ 1000 }`. Same three gates. Verifies the turn belongs to the caller, inserts a `feedback` row, writes a `feedback_given` step event with `meta { rating, has_comment }`, answers 204.

### 3.3 `DELETE /api/conversations/[id]`

Same gates. Sets `deleted_at` on the caller's conversation; 204; 404 if not theirs. A deleted conversation cannot be resumed or chatted in.

### 3.4 Pages

`/chat` shows the composer for a new conversation and the list; `/chat/[id]` resumes one: the server loads its turns and events and renders the blocks, then the client takes over. Both are gated by `loadParticipant` as today.

## 4. Settings

Added to `lib/config.ts` and `.env.example`: `UN_API_KEY` (empty allowed; without it the UN adapter sends no bearer, and a failed live call falls back to the sim service's CSV route). Already present and used here: `CHAT_MODEL`, `CHAT_EFFORT`, `THINKING_DISPLAY`, `MAX_OUTPUT_TOKENS`, `MAX_TOOL_ROUNDS`, `MAX_PAUSE_CONTINUATIONS`, `MONTHLY_BUDGET_USD`, `DAILY_TURNS_PER_USER`, `MAX_MESSAGE_CHARS`, `UNLIMITED_EMAILS`, `REFUSAL_FALLBACK`, `SIM_INTERNAL_URL`, `SIM_SHARED_SECRET`, `ANTHROPIC_API_KEY`.

`lib/models.ts`:

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| `claude-opus-5-5` | 4 | 20 | 0.20 | 5 |
| `claude-opus-5` | 5 | 25 | 0.50 | 6.25 |
| `claude-sonnet-5-5` | 2 | 10 | 0.20 | 2.50 |

Dollars per million tokens. `costUsd(model, usage)` as CampusOtter's. The sim's repair usage `{ model, input_tokens, output_tokens }` is priced with the same table; an unknown model is priced as Opus 5.5.

## 5. Modules

```
web/lib/
  models.ts                 price table, costUsd
  chat/request.ts           zod body, limits, codes
  chat/prompt.ts            SYSTEM (Python _SYSTEM verbatim + three additions), memoized; firstMessage(date, text)
  chat/next.ts              parseNext, withoutNext (no stage line)
  chat/stages.ts            deriveStage, STAGE_ORDER
  chat/events.ts            TurnEvent union, EventSink (seq, at, forwards to the stream, keeps the stored form)
  chat/runTurn.ts           the loop (section 7)
  chat/handleChat.ts        one request end to end (section 9)
  chat/sse.ts               encodeEvent
  tools/types.ts            ToolOutcome, ToolDeps, CardPayload (section 6)
  tools/index.ts            TOOLS (fixed order, eager_input_streaming, additionalProperties false), REGISTRY, executeTool
  tools/configureSimulation.ts, lookupDisease.ts, fetchDemographics.ts, fetchHealthSystem.ts,
        fetchVaccinationCoverage.ts, runSimulation.ts
  sim/params.ts             SimParams zod schema and validators, DEFAULT_BETA, approxR0, calibrateBeta, recalibrateBeta
  sim/pyformat.ts           g4, f1, roundHalfEven, fmtValue (Python formatting parity)
  sim/client.ts             simulate(), demographicsFallback(); typed results; never throws
  disease/db.ts             load web/data/disease_db.json; lookup; detectDisease; knownDiseases
  disease/checkParams.ts    the seven literature warnings from the exported ranges
  data/types.ts             ResolvedField, DataQuery
  data/unWpp.ts, whoGho.ts, wbData360.ts   adapters: fetch(query) -> ResolvedField[]; row mapping as pure functions
  db/conversations.ts       create, get (owner-checked), list (exists), softDelete, touch
  db/messages.ts            list(conversationId) in seq order
  db/scenarios.ts           getActive, types
  db/turns.ts               finishTurn(payload) -> rpc; listForReplay(conversationId)
  db/runs.ts                insert
  db/feedback.ts            insert
  client/sse.ts, client/turn.ts (reducer), client/track.ts (+ suggestion_used, feedback_given)
web/data/
  disease_db.json           exported by scripts/export_web_data.py
  un_locations.json         exported by scripts/export_un_locations.py
web/supabase/migrations/0002_turns.sql   finish_turn
web/app/api/chat/route.ts, api/feedback/route.ts, api/conversations/[id]/route.ts
web/app/chat/page.tsx, chat/[id]/page.tsx
web/components/Chat.tsx, TurnBlocks.tsx, ToolLine.tsx, Markdown.tsx, FeedbackControl.tsx, Suggestions.tsx
scripts/export_web_data.py, export_un_locations.py, export_parity_fixtures.py
web/tests/fixtures/parity.json, adapters/*.json
```

## 6. Tools

Each tool module exports `name`, `description` (the Python docstring text, verbatim), `input` (zod, with the per-property descriptions from Python), `run(input, deps): Promise<ToolOutcome>`, and its payload type. `ToolOutcome = { content: string; isError?: boolean; payload?: CardPayload }`. `content` is what the model reads; `payload` is what the card renders and what `turn_events` stores, with `duration_ms` added by the registry. `executeTool` validates with zod before running; an unknown tool or invalid input is an error result as in CampusOtter; a thrown error becomes `{ content: "This tool failed. Tell the user this part is temporarily unavailable.", isError: true, payload: { kind: "tool_error", message } }`.

`ToolDeps = { scenario: Scenario (mutable), sim: SimClient, adapters: { unWpp, whoGho, wbData360 }, disease: DiseaseDb, contextText: string, turnId: string, onRun: (run) => Promise<void>, onScenarioStart: () => void }`.

`Scenario = { id: string | null, seq: number, params: SimParams | null, disease: string | null, countryIso3: string | null, totalPopulation: number | null, dataSources: ResolvedField[], webSources: { title, url }[], stage: Stage, stageReached: Stage }`.

`CardPayload` (discriminated by `kind`):

| kind | fields |
|---|---|
| `disease` | `canonical_name, display_name, parameters: Record<param, ParameterSummary>` |
| `config` | `applied, approx_r0, config, warnings, new_scenario: boolean` |
| `data` | `source: "un_wpp" \| "wb_data360" \| "who_gho" \| "sim_fallback", iso3, applied, citations, warnings?` |
| `run` | `run_id, stats, stats_agents, attack_rate_pct, pop_scale, population, effective_params, warnings, repairs, data_sources, duration_ms, cold_start, series` (series only on the live event; stored without it) |
| `tool_error` | `message` |

Tool behavior, ported, with these deltas:

- `configure_simulation` gains `start_new_scenario?: boolean`. When true, `deps.onScenarioStart()` replaces the scenario with an empty one (seq + 1) before merging, and the payload says `new_scenario: true`. The base when no params exist is `{ beta: 22.8125 }`. The literature warnings use `deps.scenario.disease` or `detectDisease(deps.contextText)`.
- `lookup_disease` returns the exported summaries as they are; the unknown-disease text lists the sixteen keys in file order.
- `fetch_demographics` tries the UN adapter (indicators 55, 59, 71, 49; location id from the static table) and, when it returns nothing, `deps.sim.demographicsFallback(iso3)`, which produces the two rate fields with the sim's `source` as citation. The `recalibrate_beta` rule and the `beta_recalibrated_to_hold_r0` field are kept.
- `fetch_health_system` and `fetch_vaccination_coverage` as Python, including the `NO VACCINE INDICATOR` and `FETCH ERROR` texts and the "record only" behaviors.
- `run_simulation` requires params; `pop_scale = totalPopulation / n_agents` or 1; calls `deps.sim.simulate(params, popScale, contextText)`; on success calls `deps.onRun` to insert the `runs` row (with `turn_id`), then returns `content` = JSON of `{ stats, attack_rate_pct, pop_scale, effective_params, warnings, repairs, data_sources }` and the run payload. On a sim error the content is `SIMULATION ERROR: <detail>` with the repair log appended as JSON when present, `isError: true`, and `onRun` records a run with `error`. `attack_rate_pct = round(total_infected / n_agents * 100, 1)` on the scaled stats.

`web/data/disease_db.json`: `{ "diseases": { key: { display_name, aliases, summaries: { param: ParameterSummary | null }, flat: { param: { min, max, typical, source, unit, note, range_text } | null } } } }` in file order, where `ParameterSummary` is exactly `parameter_summary`'s output and `range_text` is Python's `f"{lo}–{hi}"` for that parameter (null when the range is missing). `checkParams` uses `flat` and `range_text`; the immunity warning computes its day range itself with Python's `.4g` via `pyformat`.

`web/data/un_locations.json`: `{ iso3: id }` for every three-letter uppercase key the UN locations list returns.

Parity fixture `web/tests/fixtures/parity.json`: `{ generated_from: <git sha>, params: [ { input: SimParamsJSON, approx_r0, calibrate_beta: { target_r0, beta }, recalibrate_beta: { r0_before, before: SimParamsJSON, beta } } ], warnings: [ { disease, args, warnings: string[] } ], adapters: { un_wpp: [ { rows_file, fields } ], who_gho: [...], wb_data360: [...] } }` with at least 200 parameter sets drawn deterministically (seeded) across the six model types, both networks, and the age-share edge cases, and the recorded adapter responses under `web/tests/fixtures/adapters/`. TypeScript asserts equality within 1e-6 and string equality for warnings. A pytest regenerates the fixture to a temp path and compares it to the committed one, so CI fails when the Python side changes.

## 7. Turn loop

`runTurn(args)` where `args = { client, model, effort, thinkingDisplay, refusalFallback, system: TextBlockParam[], tools, messages, maxOutputTokens, maxToolRounds, maxPauseContinuations, executeTool, onEvent, apiCalls: ApiCall[], signal }` returns `{ appended: MessageParam[], stop: TurnStop, refusalCategory: string | null, firstTokenAt: Date | null }`, `TurnStop ∈ end_turn | max_tokens | refusal | tool_limit | empty | paused`.

Each call: `client.beta.messages.stream({ model, max_tokens, system, cache_control: { type: "ephemeral" }, tools, messages, thinking: { type: "adaptive", display }, output_config: { effort }, ...(refusalFallback ? { fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] } : {}) }, { signal })`. Tools are the six client tools (each `eager_input_streaming: true`, `additionalProperties: false`) followed by `{ type: "web_search_20260209", name: "web_search", max_uses: 5 }` and `{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, citations: { enabled: true }, max_content_tokens: 20000 }`, in that fixed order.

Event order is the content order. `stream.on("text")` emits `text` deltas; `stream.on("contentBlock")` emits, as each block completes: `thinking` (stored only, `{ summary }`), `tool_use { id, name, input }`, `server_tool_use` named `web_search` → `web_search { query }`, `web_fetch_tool_result` → `web_fetch { url, title }` (title from the document block or the URL) and a once-only append to `scenario.webSources`, and any `*_tool_result_error` → `notice { message: "WEB ERROR: <error_code>" }`. Code-execution blocks emit nothing. A listener that throws never propagates.

After `finalMessage()`: append an `ApiCall { model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, stop_reason, latency_ms, served_by }` (served by the fallback model when the usage iterations say so). Then the stop rules, in order: `refusal` → dropped with category; empty content → dropped; `max_tokens` with any `tool_use` → dropped; push the assistant message; `pause_turn` → if continuations < `maxPauseContinuations`, continue the loop without counting a tool round, else dropped `paused`; no client `tool_use` → finished (`max_tokens` or `end_turn`); otherwise run the tools in order, emitting `tool_result { id, name, ok, payload }` after each, push the results as one user message, and loop. Tools run on the first `maxToolRounds` calls; the next call gets the tool-limit error result; one more call may answer; past that, dropped `tool_limit`. A non-API stream failure (bad eager JSON) re-issues the call up to twice; API errors and aborts propagate.

## 8. Blocks and stages

The display model, live and stored: `Block = { kind: "text", text } | { kind: "tool_use", id, name, input } | { kind: "tool_result", id, name, ok, payload } | { kind: "web_search", query } | { kind: "web_fetch", url, title } | { kind: "notice", message } | { kind: "stage", stage } | { kind: "suggestions", items }` plus the stored-only `{ kind: "thinking", summary }`. The browser's reducer appends deltas to the current text block and starts a new one after any other block. `turn_events` rows are these blocks with `seq` and `at`; `text` blocks are stored whole, after `withoutNext`.

`parseNext(text)`: the last complete fenced `next` block; one to three non-empty lines, each at most 80 characters, leading list markers removed; no stage line. `withoutNext` strips a complete or arriving block as CampusOtter does, minus the email special case. The prompt's addition asks for the block; the suggestions event is emitted once at turn end from the final assistant text, and the shown text is stripped.

`deriveStage(scenario, { running })`: `running` → `run`; `scenario.hasRun` (set when `onRun` records a successful run) → `interpret`; `dataSources.length > 0` → `ground`; `params` → `configure`; else `understand`. Derived after each tool result and at turn end; a `stage` event is emitted when the value changes; `scenario.stageReached` is the furthest index reached, and a `stage_reached` step event fires when it advances. A new scenario resets both to `understand`.

## 9. Persistence

Per request (`handleChat`): parse → reserve turn → create the conversation if needed (title: the first 60 characters of the text, trimmed at a word) with a `conversation_started` step event → load messages and the active scenario (or an empty one) → generate `turnId` → run the turn with an `EventSink` → post-process (suggestions, final stage, usage totals) → `finishTurn` → `done` or `discard` → in `finally`, `record_usage` with the turn's tokens and cost plus any sim repair usage, each swallowed on failure.

`finish_turn(p jsonb) returns uuid` (migration `0002_turns.sql`), in one transaction: insert the `turns` row (every column of section 7 of the parent; `seq` = count of the conversation's turns + 1); insert `turn_events` in order; when `p.messages` is present, append them to `messages` continuing `seq`; upsert the scenario (`p.scenario`, by id or new with the next `seq`) and set `conversations.active_scenario_id`, `updated_at`, and the title when empty; insert `p.step_events`. Returns the scenario id. A failing insert rolls everything back and the route answers `error service_unavailable`; the usage already incurred is still recorded. The function is `security definer`, granted to `service_role` only, like `reserve_turn`.

What a turn writes by outcome:

| Outcome | messages | stop | step events |
|---|---|---|---|
| finished | user + appended | `end_turn` / `max_tokens` | `turn`, `tool_called` / `tool_failed` per tool, `run_completed` / `run_failed`, `web_search`, `web_fetch`, `stage_reached`, `new_scenario` |
| dropped | none | `refusal` / `tool_limit` / `max_tokens` / `empty` / `paused` | the same for what ran, plus `refusal { category }` |
| failed before or during the model call | none | `error` | what ran |
| client gone | none | `aborted` | what ran |

Runs are inserted by `onRun` as they happen, with `turn_id` set, so a run exists even when its turn later fails.

The scenario is saved whatever the outcome, as the Python agent keeps its state when a turn is rolled back: the tools that ran did run, their events are stored, and `configure_simulation` merges from the saved params next time. The model sees the change through the next tool result rather than through history.

`contextText`, used by `run_simulation` for the sim's repair prompt and by the warnings' disease fallback, is the conversation's `turns.user_text` values joined with spaces plus the current text; the date line is not part of it, matching the Python agent's `context_text`.

## 10. System prompt

`lib/chat/prompt.ts` holds the Python `_SYSTEM` verbatim (5,015 characters, U+2014 dashes), then three sections appended:

1. **Suggested replies**: end every reply with a fenced `next` block holding one to three short replies the user might send next, each a complete message, concrete to the moment, never a placeholder; the interface turns it into buttons and never shows the block.
2. **Cards**: the interface renders disease parameters, configuration, fetched data, and results as cards from tool results; do not retype those numbers in tables; interpret them.
3. **Repairs**: when `run_simulation` reports repairs, say which parameters were changed to make the run succeed and why, before interpreting the results.

The prompt is deterministic (a test pins no dates, no names), sent as one text block with `cache_control`, and longer than the cache minimum.

## 11. Page

`components/Chat.tsx`: the block list for every turn, the live turn with a status line (`Running the simulation — this usually takes 1–2 minutes…` and the other Python status labels), a composer that disables while a turn runs, suggestion chips that send their text and a `suggestion_used` client event, and under each assistant turn a thumbs control that posts to `/api/feedback`. Tool lines use the Python chat-line labels (`⚙️ Configured simulation`, `📖 Disease database`, …) and the first few payload fields formatted with `fmtValue`, 160 characters at most, `⚠` prefixed on errors. Markdown through `react-markdown` + `remark-gfm` with the app's prose styles. The header's New button starts a fresh conversation; the list shows each conversation with a delete action. The existing `SessionProvider` supplies `sessionId`.

## 12. Error handling

The parent's table in section 12 applies. Specifics: the sim's 422 `too_large` and `invalid_params` become `SIMULATION ERROR: <detail>` tool errors the model can act on; a sim 504 says the run timed out and names the agent-years cap as the likely lever; a UN adapter failure is silent when the fallback succeeds and a `FETCH ERROR` when both fail; an Anthropic `BadRequestError` on a replayed conversation answers `conversation_invalid` and the conversation stays untouched; any other model or store failure answers `service_unavailable` with the Python error text, and the turn row is kept with `stop = error`.

## 13. Testing

Web (vitest): `sim/params.ts` against the parity fixture; `disease/db.ts` and `checkParams` against the export and the fixture; each adapter's row mapping against the recorded responses; each tool with fake deps, mirroring the Python `test_agent_tools.py` cases by name; `sim/client.ts` with a fake fetch for 200, 422, 500, 504, and network failure; `runTurn` with a fake beta client (text, tool round trip, `is_error`, thinking kept and captured, refusal with category, `pause_turn` resumed and exhausted, tool limit, `max_tokens` with and without tools, stream retry, abort propagation, event order with server tools, web error notice, per-call usage, the exact request object); `handleChat` with fake stores (caps before the model, conversation creation, `finishTurn` payload by outcome, usage recorded in `finally`, run inserted on success, discard messages, `conversation_invalid`); `parseNext`/`withoutNext`; `deriveStage`; the client reducer; `finish_turn` on pglite (every row written, rollback when a step event has a bad kind, seq continuation); route gates for the three routes; static tests for the prompt and the tool list order.

Python (pytest): the three export scripts are deterministic; the committed fixture and data files match a fresh export.

## 14. Deployment and verification

No new services. `UN_API_KEY` is added to Vercel and `.env.local`. `maxDuration = 300` on `/api/chat`. The migration is applied in the SQL editor. The preview verification is section 1's list, done by the owner and the session together, followed by a query of each table for one conversation.

## 15. Out of scope

Cards and the chart, the stage strip's visuals, the scenario panel, the researcher view and exports, `GET /api/runs/[id]`, the eval bearer user, scenario compare, document export, Streamlit retirement.
