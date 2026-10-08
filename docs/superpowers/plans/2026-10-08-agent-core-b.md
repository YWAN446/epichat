# Agent Core, Plan B (Route, Persistence, Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working chat: `POST /api/chat` runs the Plan A agent core on Claude Opus 5.5, streams events to the browser, and persists the turn, its events, the messages, the scenario, runs, and step events atomically; `POST /api/feedback` and `DELETE /api/conversations/[id]` complete the contract; `/chat` and `/chat/[id]` render live and replayed conversations through one block model with suggestion chips and feedback thumbs.

**Architecture:** CampusOtter's shape, extended: `runTurn` is a manual streaming loop over `client.beta.messages.stream` with per-call usage, thinking capture, server tools, `pause_turn` resumption, the tool-round cap, and the dropped-turn protocol; `handleChat` wraps one request (gates, caps, stores, the event sink, post-processing, `finish_turn`, usage in `finally`); the route is a thin `ReadableStream` adapter. Persistence goes through small store interfaces over the Supabase admin client, and one `security definer` SQL function writes a whole turn in a transaction. The browser folds the stream into the same `Block` list the database stores, so live and replayed turns render through one component.

**Tech Stack:** TypeScript on Next.js 16.3.8 (Node runtime), React 19, zod 4, `@anthropic-ai/sdk` 0.132.1 (beta messages), Supabase (`@supabase/supabase-js`, `@supabase/ssr`), `react-markdown` + `remark-gfm`, vitest 5 with `@electric-sql/pglite` for the SQL function.

**Spec:** `docs/superpowers/specs/2026-10-08-agent-core-design.md` sections 3, 4, 7, 8, 9, 11, 12, 13, 14 (parent: `docs/superpowers/specs/2026-10-07-web-agent-architecture-design.md`, sections 7, 9, 10, 12). Plan A (`docs/superpowers/plans/2026-10-08-agent-core-a.md`, merged at 960d0a3) supplies every library this plan wires together. The Python agent on `main` (`epichat/agent.py`, `epichat/chat_controller.py`) is the authority for the refusal, paused, and error texts and for the chat-line and status labels.

## Global Constraints

- Node 22, Next 16.3.8, React 19.2.8, zod ^4.6.5, `@anthropic-ai/sdk` ^0.132.1, vitest ^5.0.3 (all pinned already). No new runtime dependencies. No `runtime = "edge"` anywhere; `/api/chat` declares `export const maxDuration = 300`.
- Every model call: `client.beta.messages.stream({ model, max_tokens, system, cache_control: { type: "ephemeral" }, tools, messages, thinking: { type: "adaptive", display }, output_config: { effort }, ...(refusalFallback ? { fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] } : {}) }, { signal })`. Tools are Plan A's `TOOLS` (six, fixed order) followed by `{ type: "web_search_20260209", name: "web_search", max_uses: 5 }` and `{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, citations: { enabled: true }, max_content_tokens: 20000 }`, in that order.
- Stream events are `data: <json>\n\n` with no event names; the event shapes are section 3.1's, verbatim. Thinking summaries are stored, never streamed.
- Texts, verbatim: refusal `I'm unable to help with that request. Let's get back to epidemic simulations — what would you like to model?`; paused `That search ran longer than I can continue in one turn. Ask me again and I'll pick it up.`; unavailable `Something went wrong while processing that (a technical error, not a problem with your request). Please try again — the conversation is intact.`; CampusOtter's `tool_limit`, `max_tokens`, `empty`, cut-off notice, `conversation_invalid`, and tool-limit result texts (Tasks 5 and 6 carry them). Chat-line and status labels are `epichat/chat_controller.py`'s `_AGENT_TOOL_LABELS` and `_AGENT_STATUS_LABELS` (Task 8).
- `turns.stop` is one of `end_turn, max_tokens, refusal, tool_limit, empty, paused, error, aborted`; `turn_events.kind` one of `text, thinking, tool_use, tool_result, web_search, web_fetch, stage, suggestions, notice`; step-event kinds are `STEP_EVENT_KINDS` in `lib/enums.ts`. The migration must stay applicable twice and keep the 0001 grant pattern (revoke from `anon`/`authenticated`, grant to `service_role`).
- A `runs` row is inserted as soon as a simulation finishes, with `turn_id`, whatever the turn's later outcome; `onRun` never throws (Plan A ruling).
- `contextText` is the conversation's `turns.user_text` values joined with spaces plus the current text, with no date line (Plan A ruling). The date line goes only into the first user message of a conversation, through Plan A's `firstUserMessage`.
- `parseNext` returning `[]` (an empty block) means no suggestions: no event, no chips (Plan A ruling).
- Tracking never gets in a participant's way: step events, usage records, and client events are swallowed on failure with a text-free `console.error`.
- Commit messages end with the attribution lines the session provides.

## Review Focus

1. The browser disconnects mid-turn (tab closed): the model call is aborted, nothing is appended to `messages`, the turn row is kept with `stop = aborted`, a run that already finished keeps its row, and the usage is still recorded. Pinned in Task 6 (`records an aborted turn without appending messages and still records usage`).
2. A `pause_turn` message that also carries a client `tool_use`: the tool runs and its result is pushed before the loop resumes, so history never holds a `tool_use` without its `tool_result`. Pinned in Task 5 (`answers a tool call on a paused message before resuming`).
3. A reply whose prose is split around a tool call and ends with inline code: the stored text keeps the inline code, the suggestions are parsed from the final text segment only, and the earlier segment is stored unchanged. Pinned in Task 3 (`parses suggestions from the last text segment and keeps inline code`).
4. A saved scenario whose `params` no longer validate (the schema changed since it was written): the turn still runs with the params treated as absent instead of the route failing. Pinned in Task 4 (`treats unparseable saved params as absent`).
5. A `web_fetch_tool_result` whose document has no title, or a server-tool error result: the event uses the URL as the title; the error becomes a `notice` and never an exception; the fetched page is added to `scenario.webSources` once. Pinned in Task 5 (`reports web fetches by title or URL and web errors as notices`) and Task 6 (`records a fetched page once`).

---

## File structure

| Path | Responsibility |
|---|---|
| `web/lib/chat/request.ts` | zod body, limits, error codes and messages (Task 1) |
| `web/lib/chat/sse.ts`, `web/lib/client/sse.ts` | `encodeEvent`, `readEvents` (Task 1) |
| `web/lib/participant.ts`, `web/lib/participant.server.ts` | `apiRefusal`, `requireParticipant` for the three routes (Task 1) |
| `web/supabase/migrations/0002_turns.sql` | `finish_turn(jsonb)`, `scenarios.has_run`, `scenarios.stage_reached` (Task 2) |
| `web/lib/chat/events.ts` | `Block`, `StoredEvent`, `TurnEvent`, `ChatStreamEvent`, `createEventSink` (Task 3) |
| `web/lib/db/conversations.ts` | `supabaseConversationStore`, `listConversations` (moved from `lib/conversations.ts`), `titleFrom` (Task 4) |
| `web/lib/db/messages.ts`, `scenarios.ts`, `turns.ts`, `runs.ts`, `feedback.ts` | the stores (Task 4) |
| `web/lib/chat/runTurn.ts` | the loop (Task 5) |
| `web/lib/chat/handleChat.ts` | one request end to end (Task 6) |
| `web/app/api/chat/route.ts`, `api/feedback/route.ts`, `api/conversations/[id]/route.ts` | the routes (Task 7) |
| `web/next.config.ts` | tracing includes for the new routes and page (Task 7) |
| `web/lib/client/turn.ts`, `web/lib/client/toolLine.ts` | the reducer, status and chat-line labels (Task 8) |
| `web/components/Chat.tsx`, `ChatHeader.tsx`, `ConversationList.tsx`, `TurnBlocks.tsx`, `ToolLine.tsx`, `Markdown.tsx`, `FeedbackControl.tsx`, `Suggestions.tsx` | the page (Task 9) |
| `web/app/chat/page.tsx`, `web/app/chat/[id]/page.tsx` | new and resumed conversations (Task 9) |
| `web/docs/DEPLOY.md` | migration 0002, `UN_API_KEY`, verification (Task 10) |

Test files: `web/tests/chat/{request,events,runTurn,handleChat}.test.ts` and `web/tests/chat/helpers.ts`; `web/tests/db/{finishTurn,stores,conversations}.test.ts`; `web/tests/api/{chatRoute,feedbackRoute,conversationsRoute}.test.ts`; `web/tests/client/{sse,turn,toolLine,scroll}.test.ts`; appends to `web/tests/lib/participant.test.ts`, `web/tests/app/pages.test.ts`, `web/tests/app/deploy.test.ts`, `web/tests/helpers/fakeAdmin.ts`.

Spec refinements this plan makes (each is a ruling, listed here so the executor does not re-decide them):

- `sessionId` in the chat body is optional and nullable. A session that could not be opened (tracking is best-effort) must not stop a participant from chatting; `turns.session_id` is nullable for this reason.
- `scenarios` gains `has_run` and `stage_reached` columns (migration 0002) so a resumed scenario derives its stage exactly as the live one did, instead of inferring `hasRun` from the stored stage.
- `finish_turn` also sets `runs.scenario_id` for this turn's runs whose scenario had no id yet (a first run in a new scenario is inserted before the scenario row exists).
- Replay (`/chat/[id]`) shows finished turns only (`stop` in `end_turn`, `max_tokens`). A dropped or failed turn left nothing in `messages`, so showing its text would show a question the assistant never saw again; its events stay in the database for the researcher.
- `feedback_given` is written once, by `/api/feedback` (spec 3.2); the browser does not also report it through `/api/event`.
- The step events of a turn, including `conversation_started`, travel in the `finish_turn` payload. If `finish_turn` fails they are lost with the turn, which section 9 accepts.
- `first_token_at` comes from `runTurn` (its `now` at the first text delta), as section 7 says.
- The text of a turn is stored in segments: one `text` event per run of prose between other blocks, each stored after `withoutNext`, so the display order and the stored order are the same thing.

---

### Task 1: Request parsing, the SSE codec, and the API gate

**Files:**
- Create: `web/lib/chat/request.ts`, `web/lib/chat/sse.ts`, `web/lib/client/sse.ts`
- Modify: `web/lib/participant.ts`, `web/lib/participant.server.ts`
- Test: `web/tests/chat/request.test.ts`, `web/tests/client/sse.test.ts`, `web/tests/lib/participant.test.ts` (append)

**Interfaces:**
- Consumes: `Settings`, `settingsFor` (`lib/config.ts`); `ParticipantStatus`, `participantStatus` (`lib/participant.ts`); `loadParticipant` (`lib/participant.server.ts`).
- Produces:
  ```ts
  // lib/chat/request.ts
  export type ChatRequestData = { conversationId: string | null; sessionId: string | null; text: string };
  export type RequestProblem = { code: "bad_request" | "message_too_long"; message: string };
  export type ParseResult = { ok: true; request: ChatRequestData } | { ok: false; problem: RequestProblem };
  export function parseChatRequest(raw: string, limits: Pick<Settings, "maxMessageChars">): ParseResult;
  // lib/chat/sse.ts
  export function encodeEvent(event: unknown): Uint8Array;
  // lib/client/sse.ts
  export async function* readEvents<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T>;
  // lib/participant.ts
  export type ApiRefusal = { status: 401 | 403; code: "not_signed_in" | "email_not_allowed" | "consent_required"; message: string };
  export function apiRefusal(status: ParticipantStatus): ApiRefusal | null;
  // lib/participant.server.ts
  export type Gate = { ok: true; user: { id: string; email: string }; settings: Settings } | { ok: false; response: Response };
  export async function requireParticipant(): Promise<Gate>;   // the three gates, answering JSON; settings are settingsFor(the caller)
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/chat/request.test.ts
import { describe, expect, it } from "vitest";

import { parseChatRequest } from "@/lib/chat/request";

const LIMITS = { maxMessageChars: 20 };
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";

describe("parseChatRequest", () => {
  it("accepts the three fields, trims the text, and defaults the ids to null", () => {
    expect(parseChatRequest(JSON.stringify({ text: " Model measles " }), LIMITS)).toEqual({ ok: true, request: { conversationId: null, sessionId: null, text: "Model measles" } });
    expect(parseChatRequest(JSON.stringify({ conversationId: CONVERSATION, sessionId: SESSION, text: "hi" }), LIMITS)).toEqual({ ok: true, request: { conversationId: CONVERSATION, sessionId: SESSION, text: "hi" } });
    expect(parseChatRequest(JSON.stringify({ sessionId: null, text: "hi" }), LIMITS)).toMatchObject({ ok: true, request: { sessionId: null } });
  });

  it("refuses bodies that are not JSON, not the shape, or carry extra fields", () => {
    for (const raw of ["not json", "[]", JSON.stringify({ text: 5 }), JSON.stringify({ text: "hi", history: [] }), JSON.stringify({ conversationId: "c1", text: "hi" })]) {
      expect(parseChatRequest(raw, LIMITS)).toEqual({ ok: false, problem: { code: "bad_request", message: "The request could not be read. Please reload the page." } });
    }
  });

  it("refuses an empty message and one over the limit, before and after parsing", () => {
    expect(parseChatRequest(JSON.stringify({ text: "   " }), LIMITS)).toEqual({ ok: false, problem: { code: "bad_request", message: "Type a message first." } });
    expect(parseChatRequest(JSON.stringify({ text: "x".repeat(21) }), LIMITS)).toEqual({ ok: false, problem: { code: "message_too_long", message: "That message is too long. Keep it under 20 characters." } });
    expect(parseChatRequest("x".repeat(20 * 6 + 1001), LIMITS)).toMatchObject({ ok: false, problem: { code: "message_too_long" } });
  });
});
```

```ts
// web/tests/client/sse.test.ts
import { describe, expect, it } from "vitest";

import { encodeEvent } from "@/lib/chat/sse";
import { readEvents } from "@/lib/client/sse";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(chunks: Uint8Array[]): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of readEvents(streamOf(chunks))) events.push(event);
  return events;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const FIRST = { type: "text", delta: "R₀ — 日本語" };
const SECOND = { type: "tool_use", id: "tu_1", name: "configure_simulation", input: { disease: "measles" } };

describe("the event stream", () => {
  it("encodes one data line per event and reads events that arrive whole", async () => {
    expect(new TextDecoder().decode(encodeEvent(SECOND))).toBe(`data: ${JSON.stringify(SECOND)}\n\n`);
    expect(await collect([encodeEvent(FIRST), encodeEvent(SECOND)])).toEqual([FIRST, SECOND]);
  });

  it("reads several events from one chunk", async () => {
    expect(await collect([join([encodeEvent(FIRST), encodeEvent(SECOND)])])).toEqual([FIRST, SECOND]);
  });

  it("reassembles events split at every possible byte, including inside a character", async () => {
    const bytes = join([encodeEvent(FIRST), encodeEvent(SECOND)]);
    for (let cut = 1; cut < bytes.length; cut++) {
      expect(await collect([bytes.slice(0, cut), bytes.slice(cut)])).toEqual([FIRST, SECOND]);
    }
  });

  it("ignores an unfinished event at the end and lines that are not data", async () => {
    const partial = encodeEvent(SECOND).slice(0, 10);
    expect(await collect([encodeEvent(FIRST), partial])).toEqual([FIRST]);
    expect(await collect([new TextEncoder().encode(": keep-alive\n\n"), encodeEvent(FIRST)])).toEqual([FIRST]);
  });
});
```

Append to `web/tests/lib/participant.test.ts` (add `apiRefusal` to its existing import from `@/lib/participant`):

```ts
describe("apiRefusal", () => {
  it("answers each status with the spec's code and leaves an enrolled participant alone", () => {
    expect(apiRefusal("sign_in")).toEqual({ status: 401, code: "not_signed_in", message: "Please sign in." });
    expect(apiRefusal("forbidden")).toEqual({ status: 403, code: "email_not_allowed", message: "This account is not eligible for the study." });
    expect(apiRefusal("consent")).toEqual({ status: 403, code: "consent_required", message: "Please review the consent form before continuing." });
    expect(apiRefusal("ok")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/chat/request tests/client/sse tests/lib/participant`
Expected: `request` and `sse` cannot resolve their modules; `participant` fails on `apiRefusal is not a function` (or an import error).

- [ ] **Step 3: Implement**

```ts
// web/lib/chat/request.ts
import { z } from "zod";
import type { Settings } from "@/lib/config";

// Only the three fields the spec names. Anything else is refused, so no stray
// text can ride in on the request. sessionId may be missing: a visit that
// could not be opened (tracking is best-effort) must not stop a participant
// from chatting.
const ChatRequest = z.strictObject({
  conversationId: z.uuid().optional(),
  sessionId: z.uuid().nullable().optional(),
  text: z.string(),
});

export type ChatRequestData = { conversationId: string | null; sessionId: string | null; text: string };
export type RequestProblem = { code: "bad_request" | "message_too_long"; message: string };
export type ParseResult = { ok: true; request: ChatRequestData } | { ok: false; problem: RequestProblem };

const UNREADABLE = "The request could not be read. Please reload the page.";
const EMPTY = "Type a message first.";

function problem(code: RequestProblem["code"], message: string): ParseResult {
  return { ok: false, problem: { code, message } };
}

export function tooLong(maxMessageChars: number): string {
  return `That message is too long. Keep it under ${maxMessageChars} characters.`;
}

/** Read one chat request. The raw body is bounded before parsing: JSON escapes can inflate a message sixfold. */
export function parseChatRequest(raw: string, limits: Pick<Settings, "maxMessageChars">): ParseResult {
  if (raw.length > limits.maxMessageChars * 6 + 1000) return problem("message_too_long", tooLong(limits.maxMessageChars));
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return problem("bad_request", UNREADABLE);
  }
  const parsed = ChatRequest.safeParse(json);
  if (!parsed.success) return problem("bad_request", UNREADABLE);
  const text = parsed.data.text.trim();
  if (text === "") return problem("bad_request", EMPTY);
  if (text.length > limits.maxMessageChars) return problem("message_too_long", tooLong(limits.maxMessageChars));
  return { ok: true, request: { conversationId: parsed.data.conversationId ?? null, sessionId: parsed.data.sessionId ?? null, text } };
}
```

```ts
// web/lib/chat/sse.ts
const encoder = new TextEncoder();

/** One server-sent event: a `data:` line holding JSON, then a blank line. */
export function encodeEvent(event: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}
```

```ts
// web/lib/client/sse.ts
/** Decode a `text/event-stream` body into its JSON events, however the bytes are chunked. */
export async function* readEvents<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    // stream: true holds back a character whose bytes are split across chunks.
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) yield JSON.parse(line.slice(6)) as T;
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
```

Append to `web/lib/participant.ts`:

```ts
export type ApiRefusal = { status: 401 | 403; code: "not_signed_in" | "email_not_allowed" | "consent_required"; message: string };

/** How an API route answers a visitor who is not an enrolled participant, or null when they may proceed (spec 3.1). */
export function apiRefusal(status: ParticipantStatus): ApiRefusal | null {
  if (status === "sign_in") return { status: 401, code: "not_signed_in", message: "Please sign in." };
  if (status === "forbidden") return { status: 403, code: "email_not_allowed", message: "This account is not eligible for the study." };
  if (status === "consent") return { status: 403, code: "consent_required", message: "Please review the consent form before continuing." };
  return null;
}
```

Append to `web/lib/participant.server.ts` (add `settingsFor` to its import from `./config` and `apiRefusal` to its import from `./participant`):

```ts
export type Gate = { ok: true; user: { id: string; email: string }; settings: Settings } | { ok: false; response: Response };

/** The three gates every agent-core route applies, in order, answering JSON. The settings are the caller's own. */
export async function requireParticipant(): Promise<Gate> {
  const participant = await loadParticipant();
  const refusal = apiRefusal(participant.status) ?? (participant.user ? null : apiRefusal("sign_in"));
  if (refusal || !participant.user) {
    const { status, code, message } = refusal ?? apiRefusal("sign_in")!;
    return { ok: false, response: Response.json({ code, message }, { status }) };
  }
  return { ok: true, user: participant.user, settings: settingsFor(participant.settings, participant.user.email) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix web test -- tests/chat/request tests/client/sse tests/lib/participant`
Expected: PASS (3 + 4 + the file's existing tests + 1).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: no errors, no warnings.

```bash
git add web/lib/chat/request.ts web/lib/chat/sse.ts web/lib/client/sse.ts web/lib/participant.ts web/lib/participant.server.ts web/tests/chat/request.test.ts web/tests/client/sse.test.ts web/tests/lib/participant.test.ts
git commit -m "feat(chat): request parsing, the SSE codec, and the API participant gate"
```

---
### Task 2: Migration 0002: `finish_turn` and the scenario columns

**Files:**
- Create: `web/supabase/migrations/0002_turns.sql`
- Test: `web/tests/db/finishTurn.test.ts`

**Interfaces:**
- Consumes: the 0001 schema (`turns`, `turn_events`, `messages`, `scenarios`, `conversations`, `runs`, `step_events`); `createTestDb` from `web/tests/db/helpers.ts`, which applies every migration in file order.
- Produces: the SQL function `finish_turn(p jsonb) returns uuid` with this payload (Task 4's `FinishTurnPayload` is its TypeScript twin):
  ```
  { user_id, conversation_id, title,
    turn: { id, session_id, user_text, started_at, first_token_at, finished_at, stop, refusal_category, model, effort,
            api_calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, stage_before, stage_after },
    events: [ { seq, at, kind, ...payload } ],
    messages: [ { role, content } ] | null,
    scenario: { id | null, seq, params, disease, country_iso3, total_population, data_sources, web_sources, stage, stage_reached, has_run },
    step_events: [ { kind, session_id, stage, tool, meta } ] }
  ```
  and two new columns: `scenarios.has_run boolean not null default false`, `scenarios.stage_reached text` (checked against the five stages).

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/db/finishTurn.test.ts
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "./helpers";

const ALICE = "11111111-1111-1111-1111-111111111111";
const TURN_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const TURN_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const SESSION = "44444444-4444-4444-8444-444444444444";

let db: PGlite;
let conversation: string;

beforeEach(async () => {
  db = await createTestDb();
  const { rows } = await db.query<{ id: string }>("insert into conversations (user_id) values ($1) returning id", [ALICE]);
  conversation = rows[0].id;
});

function payload(over: Record<string, unknown> = {}) {
  return {
    user_id: ALICE,
    conversation_id: conversation,
    title: "Measles in Kenya",
    turn: {
      id: TURN_1, session_id: SESSION, user_text: "Model measles in Kenya", started_at: "2026-10-08T15:00:00Z", first_token_at: "2026-10-08T15:00:02Z",
      finished_at: "2026-10-08T15:00:09Z", stop: "end_turn", refusal_category: null, model: "claude-opus-5-5", effort: "medium",
      api_calls: [{ model: "claude-opus-5-5", input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 50, stop_reason: "end_turn", latency_ms: 900, served_by: "claude-opus-5-5" }],
      input_tokens: 150, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 50, cost_usd: 0.00105, stage_before: "understand", stage_after: "configure",
    },
    events: [
      { seq: 1, at: "2026-10-08T15:00:02Z", kind: "thinking", summary: "Plan the model" },
      { seq: 2, at: "2026-10-08T15:00:03Z", kind: "tool_use", id: "tu_1", name: "configure_simulation", input: { disease: "measles" } },
      { seq: 3, at: "2026-10-08T15:00:04Z", kind: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: { kind: "config", approx_r0: 12 } },
      { seq: 4, at: "2026-10-08T15:00:05Z", kind: "stage", stage: "configure" },
      { seq: 5, at: "2026-10-08T15:00:09Z", kind: "text", text: "Configured." },
    ],
    messages: [
      { role: "user", content: "Today's date: 2026-10-08.\n\nModel measles in Kenya" },
      { role: "assistant", content: [{ type: "text", text: "Configured." }] },
    ],
    scenario: { id: null, seq: 1, params: { beta: 1.5 }, disease: "measles", country_iso3: "KEN", total_population: null, data_sources: [], web_sources: [], stage: "configure", stage_reached: "configure", has_run: false },
    step_events: [
      { kind: "conversation_started", session_id: SESSION, stage: "understand", tool: null, meta: {} },
      { kind: "tool_called", session_id: SESSION, stage: "configure", tool: "configure_simulation", meta: { duration_ms: 12 } },
    ],
    ...over,
  };
}

async function finish(p: unknown): Promise<string> {
  const { rows } = await db.query<{ id: string }>("select finish_turn($1::jsonb) as id", [JSON.stringify(p)]);
  return rows[0].id;
}

async function count(table: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return rows[0].n;
}

async function one<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

describe("finish_turn", () => {
  it("writes the turn, its events, the messages, a new scenario, the pointer and title, and the step events", async () => {
    const scenarioId = await finish(payload());

    const turn = await one<Record<string, unknown>>("select * from turns where id = $1", [TURN_1]);
    expect(turn).toMatchObject({ conversation_id: conversation, session_id: SESSION, seq: 1, user_text: "Model measles in Kenya", stop: "end_turn", model: "claude-opus-5-5", effort: "medium", stage_before: "understand", stage_after: "configure" });
    expect(Number(turn.input_tokens)).toBe(150);
    expect(Number(turn.cost_usd)).toBeCloseTo(0.00105, 6);
    expect(turn.api_calls).toHaveLength(1);
    expect(new Date(turn.first_token_at as string).toISOString()).toBe("2026-10-08T15:00:02.000Z");

    const { rows: events } = await db.query<{ seq: number; kind: string; payload: Record<string, unknown> }>("select seq, kind, payload from turn_events where turn_id = $1 order by seq", [TURN_1]);
    expect(events.map((e) => e.kind)).toEqual(["thinking", "tool_use", "tool_result", "stage", "text"]);
    expect(events[1].payload).toEqual({ id: "tu_1", name: "configure_simulation", input: { disease: "measles" } });
    expect(events[4].payload).toEqual({ text: "Configured." });

    const { rows: messages } = await db.query<{ seq: number; role: string; content: unknown }>("select seq, role, content from messages where conversation_id = $1 order by seq", [conversation]);
    expect(messages.map((m) => [m.seq, m.role])).toEqual([[1, "user"], [2, "assistant"]]);
    expect(messages[0].content).toBe("Today's date: 2026-10-08.\n\nModel measles in Kenya");

    const scenario = await one<Record<string, unknown>>("select * from scenarios where id = $1", [scenarioId]);
    expect(scenario).toMatchObject({ conversation_id: conversation, seq: 1, params: { beta: 1.5 }, disease: "measles", country_iso3: "KEN", total_population: null, stage: "configure", stage_reached: "configure", has_run: false });

    expect(await one("select active_scenario_id, title from conversations where id = $1", [conversation])).toEqual({ active_scenario_id: scenarioId, title: "Measles in Kenya" });

    const { rows: steps } = await db.query("select kind, tool, stage, turn_id, session_id from step_events where conversation_id = $1 order by id", [conversation]);
    expect(steps).toEqual([
      { kind: "conversation_started", tool: null, stage: "understand", turn_id: TURN_1, session_id: SESSION },
      { kind: "tool_called", tool: "configure_simulation", stage: "configure", turn_id: TURN_1, session_id: SESSION },
    ]);
  });

  it("continues every sequence on the next turn, updates the scenario by id, rounds the population, and keeps the title", async () => {
    const scenarioId = await finish(payload());
    await finish(payload({
      title: "Something else",
      turn: { ...payload().turn, id: TURN_2, user_text: "Run it", stop: "max_tokens" },
      events: [{ seq: 1, at: "2026-10-08T15:01:00Z", kind: "text", text: "Running." }],
      messages: [{ role: "user", content: "Run it" }, { role: "assistant", content: [{ type: "text", text: "Running." }] }],
      scenario: { ...payload().scenario, id: scenarioId, has_run: true, stage: "interpret", stage_reached: "interpret", total_population: 54027487.3 },
      step_events: [],
    }));
    expect((await one<{ seq: number }>("select seq from turns where id = $1", [TURN_2])).seq).toBe(2);
    expect((await one<{ seq: number }>("select max(seq)::int as seq from messages where conversation_id = $1", [conversation])).seq).toBe(4);
    expect(await count("scenarios")).toBe(1);
    const scenario = await one<{ has_run: boolean; stage: string; total_population: string | number }>("select has_run, stage, total_population from scenarios where id = $1", [scenarioId]);
    expect(scenario.has_run).toBe(true);
    expect(scenario.stage).toBe("interpret");
    expect(Number(scenario.total_population)).toBe(54027487);
    expect((await one<{ title: string }>("select title from conversations where id = $1", [conversation])).title).toBe("Measles in Kenya");
  });

  it("appends no messages for a dropped turn but keeps the turn, its events, and the scenario", async () => {
    await finish(payload({ turn: { ...payload().turn, stop: "refusal", refusal_category: "bio" }, messages: null }));
    expect(await count("turns")).toBe(1);
    expect(await count("turn_events")).toBe(5);
    expect(await count("messages")).toBe(0);
    expect(await count("scenarios")).toBe(1);
    expect((await one<{ refusal_category: string }>("select refusal_category from turns where id = $1", [TURN_1])).refusal_category).toBe("bio");
  });

  it("claims this turn's runs for the new scenario", async () => {
    await db.query("insert into runs (conversation_id, user_id, turn_id, params) values ($1, $2, $3, '{}'::jsonb)", [conversation, ALICE, TURN_1]);
    const scenarioId = await finish(payload());
    expect((await one<{ scenario_id: string }>("select scenario_id from runs where turn_id = $1", [TURN_1])).scenario_id).toBe(scenarioId);
  });

  it("refuses a scenario id from another conversation", async () => {
    const { rows } = await db.query<{ id: string }>("insert into conversations (user_id) values ($1) returning id", [ALICE]);
    const { rows: other } = await db.query<{ id: string }>("insert into scenarios (conversation_id, seq) values ($1, 1) returning id", [rows[0].id]);
    await expect(finish(payload({ scenario: { ...payload().scenario, id: other[0].id } }))).rejects.toThrow(/not in conversation/);
    expect(await count("turns")).toBe(0);
  });

  it("rolls everything back when one row is bad", async () => {
    await expect(finish(payload({ step_events: [{ kind: "chat_text", meta: {} }] }))).rejects.toThrow();
    for (const table of ["turns", "turn_events", "messages", "scenarios", "step_events"]) expect(await count(table)).toBe(0);
    expect((await one<{ title: string }>("select title from conversations where id = $1", [conversation])).title).toBe("");
  });

  it("is callable by the server role only", async () => {
    const secured = await createTestDb({ roles: true });
    const can = async (role: string) =>
      (await secured.query<{ allowed: boolean }>("select has_function_privilege($1, 'finish_turn(jsonb)', 'execute') as allowed", [role])).rows[0].allowed;
    expect(await can("service_role")).toBe(true);
    expect(await can("anon")).toBe(false);
    expect(await can("authenticated")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix web test -- tests/db/finishTurn`
Expected: every test fails with `function finish_turn(jsonb) does not exist` (the last one with `has_function_privilege` complaining the function does not exist).

- [ ] **Step 3: Write the migration**

```sql
-- web/supabase/migrations/0002_turns.sql
-- Agent core: the scenario columns a resumed turn needs, and the one function
-- that writes a finished turn. Apply after 0001 in the SQL editor; safe to run twice.

alter table scenarios add column if not exists has_run boolean not null default false;
alter table scenarios add column if not exists stage_reached text
  check (stage_reached in ('understand', 'configure', 'ground', 'run', 'interpret'));

-- Write one turn atomically: the turns row, its events, the appended messages
-- (only when the turn finished), the scenario (updated by id, or inserted with
-- its seq), this turn's runs' scenario pointer, the conversation's pointer,
-- time, and title, and the step events. Any failure rolls everything back and
-- the route answers service_unavailable. Returns the scenario id.
--
-- p: { user_id, conversation_id, title,
--      turn: { id, session_id, user_text, started_at, first_token_at, finished_at,
--              stop, refusal_category, model, effort, api_calls, input_tokens,
--              output_tokens, cache_read_tokens, cache_write_tokens, cost_usd,
--              stage_before, stage_after },
--      events: [ { seq, at, kind, ...payload } ],
--      messages: [ { role, content } ] | null,
--      scenario: { id, seq, params, disease, country_iso3, total_population,
--                  data_sources, web_sources, stage, stage_reached, has_run },
--      step_events: [ { kind, session_id, stage, tool, meta } ] }
create or replace function finish_turn(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := (p->>'user_id')::uuid;
  v_conversation uuid := (p->>'conversation_id')::uuid;
  t jsonb := p->'turn';
  v_turn uuid := (t->>'id')::uuid;
  s jsonb := p->'scenario';
  v_scenario uuid;
  v_seq int;
  item jsonb;
begin
  select coalesce(max(seq), 0) + 1 into v_seq from turns where conversation_id = v_conversation;
  insert into turns (id, conversation_id, session_id, seq, user_text, started_at, first_token_at, finished_at,
    stop, refusal_category, model, effort, api_calls, input_tokens, output_tokens, cache_read_tokens,
    cache_write_tokens, cost_usd, stage_before, stage_after)
  values (v_turn, v_conversation, (t->>'session_id')::uuid, v_seq, coalesce(t->>'user_text', ''),
    coalesce((t->>'started_at')::timestamptz, now()), (t->>'first_token_at')::timestamptz,
    coalesce((t->>'finished_at')::timestamptz, now()), t->>'stop', t->>'refusal_category', t->>'model', t->>'effort',
    coalesce(t->'api_calls', '[]'::jsonb), coalesce((t->>'input_tokens')::bigint, 0), coalesce((t->>'output_tokens')::bigint, 0),
    coalesce((t->>'cache_read_tokens')::bigint, 0), coalesce((t->>'cache_write_tokens')::bigint, 0),
    coalesce((t->>'cost_usd')::numeric, 0), t->>'stage_before', t->>'stage_after');

  for item in select * from jsonb_array_elements(coalesce(p->'events', '[]'::jsonb)) loop
    insert into turn_events (turn_id, seq, at, kind, payload)
    values (v_turn, (item->>'seq')::int, coalesce((item->>'at')::timestamptz, now()), item->>'kind', item - 'seq' - 'at' - 'kind');
  end loop;

  if jsonb_typeof(p->'messages') = 'array' then
    select coalesce(max(seq), 0) into v_seq from messages where conversation_id = v_conversation;
    for item in select * from jsonb_array_elements(p->'messages') loop
      v_seq := v_seq + 1;
      insert into messages (conversation_id, seq, role, content) values (v_conversation, v_seq, item->>'role', item->'content');
    end loop;
  end if;

  if jsonb_typeof(s) = 'object' then
    if s->>'id' is not null then
      v_scenario := (s->>'id')::uuid;
      update scenarios set
        params = nullif(s->'params', 'null'::jsonb), disease = s->>'disease', country_iso3 = s->>'country_iso3',
        total_population = round((s->>'total_population')::numeric)::bigint,
        data_sources = coalesce(s->'data_sources', '[]'::jsonb), web_sources = coalesce(s->'web_sources', '[]'::jsonb),
        stage = s->>'stage', stage_reached = s->>'stage_reached', has_run = coalesce((s->>'has_run')::boolean, false),
        updated_at = now()
      where id = v_scenario and conversation_id = v_conversation;
      if not found then
        raise exception 'scenario % is not in conversation %', v_scenario, v_conversation;
      end if;
    else
      insert into scenarios (conversation_id, seq, params, disease, country_iso3, total_population, data_sources, web_sources,
        stage, stage_reached, has_run)
      values (v_conversation,
        coalesce((s->>'seq')::int, (select coalesce(max(seq), 0) + 1 from scenarios where conversation_id = v_conversation)),
        nullif(s->'params', 'null'::jsonb), s->>'disease', s->>'country_iso3', round((s->>'total_population')::numeric)::bigint,
        coalesce(s->'data_sources', '[]'::jsonb), coalesce(s->'web_sources', '[]'::jsonb),
        s->>'stage', s->>'stage_reached', coalesce((s->>'has_run')::boolean, false))
      returning id into v_scenario;
    end if;
    update runs set scenario_id = v_scenario where turn_id = v_turn and scenario_id is null;
    update conversations set active_scenario_id = v_scenario, updated_at = now(),
      title = case when title = '' then coalesce(p->>'title', '') else title end
    where id = v_conversation;
  else
    update conversations set updated_at = now(),
      title = case when title = '' then coalesce(p->>'title', '') else title end
    where id = v_conversation;
  end if;

  for item in select * from jsonb_array_elements(coalesce(p->'step_events', '[]'::jsonb)) loop
    insert into step_events (user_id, session_id, conversation_id, turn_id, kind, stage, tool, meta)
    values (v_user, (item->>'session_id')::uuid, v_conversation, v_turn, item->>'kind', item->>'stage', item->>'tool',
      coalesce(item->'meta', '{}'::jsonb));
  end loop;

  return v_scenario;
end;
$$;

-- The same privileges as 0001's functions: the server role only.
revoke execute on function finish_turn(jsonb) from public;
do $$
declare
  browser_role text;
begin
  foreach browser_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = browser_role) then
      execute format('revoke execute on function finish_turn(jsonb) from %I', browser_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function finish_turn(jsonb) to service_role;
  end if;
end;
$$;
```

- [ ] **Step 4: Run the tests to verify they pass, and that the whole database suite still does**

Run: `npm --prefix web test -- tests/db`
Expected: PASS, including `schema.test.ts`'s "can be applied twice" (both migrations re-applied) and `usage.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add web/supabase/migrations/0002_turns.sql web/tests/db/finishTurn.test.ts
git commit -m "feat(db): finish_turn writes a turn atomically; scenarios keep has_run and stage_reached"
```

---
### Task 3: Blocks, stream events, and the event sink

**Files:**
- Create: `web/lib/chat/events.ts`
- Test: `web/tests/chat/events.test.ts`

**Interfaces:**
- Consumes: `withoutNext` (`lib/chat/next.ts`), `Stage` (`lib/enums.ts`), `CardPayload` (`lib/tools/types.ts`).
- Produces:
  ```ts
  export type Block =
    | { kind: "text"; text: string }
    | { kind: "tool_use"; id: string; name: string; input: unknown }
    | { kind: "tool_result"; id: string; name: string; ok: boolean; payload: CardPayload }
    | { kind: "web_search"; query: string }
    | { kind: "web_fetch"; url: string; title: string }
    | { kind: "notice"; message: string }
    | { kind: "stage"; stage: Stage }
    | { kind: "suggestions"; items: string[] };
  export type ThinkingBlock = { kind: "thinking"; summary: string };
  export type SinkBlock = Block | ThinkingBlock;
  export type StoredEvent = SinkBlock & { seq: number; at: string };          // one turn_events row
  export type TurnEvent =                                                      // what runTurn reports
    | { type: "text"; delta: string } | { type: "thinking"; summary: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: "tool_result"; id: string; name: string; ok: boolean; payload: CardPayload }
    | { type: "web_search"; query: string } | { type: "web_fetch"; url: string; title: string }
    | { type: "notice"; message: string };
  export type ChatStreamEvent =                                                // spec 3.1
    | Exclude<TurnEvent, { type: "thinking" }>
    | { type: "stage"; stage: Stage } | { type: "suggestions"; items: string[] }
    | { type: "done"; turnId: string; conversationId: string; notice: string | null }
    | { type: "discard"; message: string } | { type: "error"; code: string; message: string };
  export type EventSink = { text(delta: string): void; block(block: SinkBlock): void; lastText(): string; finish(): StoredEvent[] };
  export function blockOf(event: Exclude<TurnEvent, { type: "text" }>): SinkBlock;
  export function createEventSink(emit: (event: ChatStreamEvent) => void, now: () => Date): EventSink;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/chat/events.test.ts
import { describe, expect, it } from "vitest";

import { blockOf, createEventSink, type ChatStreamEvent } from "@/lib/chat/events";
import { parseNext } from "@/lib/chat/next";
import type { ConfigPayload, RunPayload } from "@/lib/tools/types";
import { params } from "../tools/helpers";

/** A clock that moves one second per reading, from 15:00:00. */
function clock() {
  let t = Date.parse("2026-10-08T15:00:00Z");
  return () => new Date((t += 1000));
}

function sink(emit: (event: ChatStreamEvent) => void = () => {}) {
  const emitted: ChatStreamEvent[] = [];
  const s = createEventSink((event) => { emitted.push(event); emit(event); }, clock());
  return { s, emitted };
}

const CONFIG: ConfigPayload = {
  kind: "config", applied: { disease: "measles" }, approx_r0: 12,
  config: { disease: "measles", disease_type: "sir", country: null, n_agents: 10000, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] },
  warnings: [], new_scenario: false,
};
const STATS = { peak_infections: 9, peak_day: 3, total_infected: 40, total_deaths: 0, n_agents: 1000, sim_days: 365 };
const RUN: RunPayload = {
  kind: "run", run_id: "r1", stats: STATS, stats_agents: STATS, attack_rate_pct: 4, pop_scale: 1, population: 1000, effective_params: params({}),
  warnings: [], repairs: [], data_sources: [], duration_ms: 1200, cold_start: false, series: { day: [0, 1], n_infected: [1, 2] },
};
const USE = { kind: "tool_use", id: "tu_1", name: "configure_simulation", input: { disease: "measles" } } as const;
const RESULT = { kind: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: CONFIG } as const;

describe("event sink", () => {
  it("forwards text deltas at once and stores each prose segment whole, in order with the blocks between", () => {
    const { s, emitted } = sink();
    s.text("Let me ");
    s.text("configure it.");
    s.block(USE);
    s.block(RESULT);
    s.text("Done.");
    const stored = s.finish();
    expect(stored.map((e) => [e.seq, e.kind])).toEqual([[1, "text"], [2, "tool_use"], [3, "tool_result"], [4, "text"]]);
    expect(stored[0]).toMatchObject({ text: "Let me configure it.", at: "2026-10-08T15:00:01.000Z" });
    expect(stored[1]).toMatchObject({ ...USE, at: "2026-10-08T15:00:02.000Z" });
    expect(stored[3]).toMatchObject({ text: "Done.", at: "2026-10-08T15:00:04.000Z" });
    expect(emitted).toEqual([
      { type: "text", delta: "Let me " }, { type: "text", delta: "configure it." },
      { type: "tool_use", id: "tu_1", name: "configure_simulation", input: { disease: "measles" } },
      { type: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: CONFIG },
      { type: "text", delta: "Done." },
    ]);
  });

  it("stores thinking without streaming it, and streams a run payload with its series but stores it without", () => {
    const { s, emitted } = sink();
    s.block({ kind: "thinking", summary: "Plan the model" });
    s.block({ kind: "tool_result", id: "tu_2", name: "run_simulation", ok: true, payload: RUN });
    const stored = s.finish();
    expect(stored.map((e) => e.kind)).toEqual(["thinking", "tool_result"]);
    expect(stored[0]).toMatchObject({ summary: "Plan the model" });
    expect("series" in (stored[1] as { payload: object }).payload).toBe(false);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "tool_result", payload: { series: { day: [0, 1] } } });
  });

  it("parses suggestions from the last text segment and keeps inline code", () => {
    const { s } = sink();
    s.text("Use `beta` first.");
    s.block(USE);
    s.block(RESULT);
    s.text("Try `beta`.\n\n```next\nRun it\n```");
    expect(parseNext(s.lastText())).toEqual(["Run it"]);
    s.block({ kind: "suggestions", items: ["Run it"] });
    const stored = s.finish();
    expect(stored.map((e) => e.kind)).toEqual(["text", "tool_use", "tool_result", "text", "suggestions"]);
    expect(stored[0]).toMatchObject({ text: "Use `beta` first." });
    expect(stored[3]).toMatchObject({ text: "Try `beta`." });
    expect(stored[4]).toMatchObject({ items: ["Run it"] });
  });

  it("drops empty segments, survives a receiver that throws, and maps runTurn events to blocks", () => {
    const { s } = sink(() => { throw new Error("Invalid state: Controller is already closed"); });
    expect(() => s.text("hi")).not.toThrow();
    s.text("  ");
    expect(() => s.block({ kind: "notice", message: "WEB ERROR: unavailable" })).not.toThrow();
    s.text("\n");
    expect(s.finish().map((e) => e.kind)).toEqual(["text", "notice"]);
    expect(blockOf({ type: "web_fetch", url: "https://www.who.int", title: "WHO" })).toEqual({ kind: "web_fetch", url: "https://www.who.int", title: "WHO" });
    expect(blockOf({ type: "thinking", summary: "s" })).toEqual({ kind: "thinking", summary: "s" });
    expect(blockOf({ type: "tool_result", id: "tu_1", name: "lookup_disease", ok: false, payload: { kind: "tool_error", message: "x" } })).toEqual({ kind: "tool_result", id: "tu_1", name: "lookup_disease", ok: false, payload: { kind: "tool_error", message: "x" } });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix web test -- tests/chat/events`
Expected: cannot resolve `@/lib/chat/events`.

- [ ] **Step 3: Implement**

```ts
// web/lib/chat/events.ts
/**
 * The display model of a turn, live and stored (agent-core spec, section 8).
 * The browser folds stream events into Blocks; the server stores the same
 * Blocks as turn_events rows, plus the thinking summaries only the researcher
 * sees. Text is stored in segments: one event per run of prose between other
 * blocks, each stored after withoutNext, so the stored order is the shown order.
 */
import { withoutNext } from "@/lib/chat/next";
import type { Stage } from "@/lib/enums";
import type { CardPayload } from "@/lib/tools/types";

export type Block =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; id: string; name: string; ok: boolean; payload: CardPayload }
  | { kind: "web_search"; query: string }
  | { kind: "web_fetch"; url: string; title: string }
  | { kind: "notice"; message: string }
  | { kind: "stage"; stage: Stage }
  | { kind: "suggestions"; items: string[] };

export type ThinkingBlock = { kind: "thinking"; summary: string };
export type SinkBlock = Block | ThinkingBlock;

/** A turn_events row: a block with its position and time. */
export type StoredEvent = SinkBlock & { seq: number; at: string };

/** What runTurn reports as the model's content arrives, in content order. */
export type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; summary: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; payload: CardPayload }
  | { type: "web_search"; query: string }
  | { type: "web_fetch"; url: string; title: string }
  | { type: "notice"; message: string };

/** What the browser receives (spec 3.1). Thinking is never streamed. */
export type ChatStreamEvent =
  | Exclude<TurnEvent, { type: "thinking" }>
  | { type: "stage"; stage: Stage }
  | { type: "suggestions"; items: string[] }
  | { type: "done"; turnId: string; conversationId: string; notice: string | null }
  | { type: "discard"; message: string }
  | { type: "error"; code: string; message: string };

export type EventSink = {
  /** A text delta: forwarded at once, stored whole when its segment ends. */
  text(delta: string): void;
  /** Any other block: stored in order, then forwarded (thinking is stored only; a run payload is forwarded with its series and stored without). */
  block(block: SinkBlock): void;
  /** The text segment still open: where the model's ```next block ends up. */
  lastText(): string;
  /** Close the open segment and return every stored event in order. Call once. */
  finish(): StoredEvent[];
};

/** The block a runTurn event stores. Text deltas have no block of their own; they go through `text`. */
export function blockOf(event: Exclude<TurnEvent, { type: "text" }>): SinkBlock {
  switch (event.type) {
    case "thinking":
      return { kind: "thinking", summary: event.summary };
    case "tool_use":
      return { kind: "tool_use", id: event.id, name: event.name, input: event.input };
    case "tool_result":
      return { kind: "tool_result", id: event.id, name: event.name, ok: event.ok, payload: event.payload };
    case "web_search":
      return { kind: "web_search", query: event.query };
    case "web_fetch":
      return { kind: "web_fetch", url: event.url, title: event.title };
    case "notice":
      return { kind: "notice", message: event.message };
  }
}

/** The stream event for a block, or null for one that is never streamed. */
function streamEventOf(block: SinkBlock): ChatStreamEvent | null {
  if (block.kind === "thinking") return null;
  const { kind, ...rest } = block;
  return { type: kind, ...rest } as ChatStreamEvent;
}

/** The run series lives in the runs row; the event store keeps the card's numbers only. */
function storedForm(block: SinkBlock): SinkBlock {
  if (block.kind !== "tool_result" || block.payload.kind !== "run") return block;
  const payload = { ...block.payload };
  delete payload.series;
  return { ...block, payload };
}

export function createEventSink(emit: (event: ChatStreamEvent) => void, now: () => Date): EventSink {
  const stored: StoredEvent[] = [];
  let buffer = "";
  let segmentStartedAt: string | null = null;

  const send = (event: ChatStreamEvent) => {
    try {
      emit(event);
    } catch {
      // The receiver is gone. The turn still has to finish and be stored.
    }
  };
  const store = (block: SinkBlock, at: string) => {
    stored.push({ ...block, seq: stored.length + 1, at });
  };
  const closeText = () => {
    const text = withoutNext(buffer);
    if (text) store({ kind: "text", text }, segmentStartedAt ?? now().toISOString());
    buffer = "";
    segmentStartedAt = null;
  };

  return {
    text(delta) {
      if (!delta) return;
      segmentStartedAt ??= now().toISOString();
      buffer += delta;
      send({ type: "text", delta });
    },
    block(block) {
      closeText();
      store(storedForm(block), now().toISOString());
      const event = streamEventOf(block);
      if (event) send(event);
    },
    lastText() {
      return buffer;
    },
    finish() {
      closeText();
      return stored;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix web test -- tests/chat/events`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: clean.

```bash
git add web/lib/chat/events.ts web/tests/chat/events.test.ts
git commit -m "feat(chat): block model, stream event types, and the event sink"
```

---
### Task 4: The stores

**Files:**
- Create: `web/lib/db/conversations.ts`, `web/lib/db/messages.ts`, `web/lib/db/scenarios.ts`, `web/lib/db/turns.ts`, `web/lib/db/runs.ts`, `web/lib/db/feedback.ts`
- Delete: `web/lib/conversations.ts`, `web/tests/lib/conversations.test.ts` (both move under `db/`)
- Modify: `web/app/chat/page.tsx` and `web/components/ChatShell.tsx` (import `@/lib/db/conversations` instead of `@/lib/conversations`), `web/tests/helpers/fakeAdmin.ts` (add `"in"` to the recorded builder methods)
- Test: `web/tests/db/conversations.test.ts`, `web/tests/db/stores.test.ts`

**Interfaces:**
- Consumes: `Block`, `StoredEvent` (Task 3); `Scenario`, `WebSource`, `RunRecord`, `emptyScenario` (`lib/tools/types.ts`); `validateParams` (`lib/sim/params.ts`); `STAGES`, `Stage`, `StepEventKind` (`lib/enums.ts`); `ResolvedField` (`lib/data/types.ts`); `fakeAdmin`, `callOn` (`tests/helpers/fakeAdmin.ts`); `params`, `rf` (`tests/tools/helpers.ts`).
- Produces:
  ```ts
  // lib/db/conversations.ts
  export type ConversationSummary = { id: string; title: string; updatedAt: string };
  export type ConversationRow = { id: string; title: string; activeScenarioId: string | null };
  export interface ConversationStore { create(userId: string, title: string): Promise<string>; get(id: string, userId: string): Promise<ConversationRow | null>; softDelete(id: string, userId: string, now: Date): Promise<boolean> }
  export function supabaseConversationStore(admin: SupabaseClient): ConversationStore;
  export async function listConversations(admin: SupabaseClient, userId: string): Promise<ConversationSummary[]>;   // moved verbatim
  export function titleFrom(text: string): string;                                                                      // first 60 chars, cut at a word
  // lib/db/messages.ts
  export interface MessageStore { list(conversationId: string): Promise<Anthropic.Beta.BetaMessageParam[]> }
  export function supabaseMessageStore(admin: SupabaseClient): MessageStore;
  // lib/db/scenarios.ts
  export type ScenarioJson = { id: string | null; seq: number; params: unknown; disease: string | null; country_iso3: string | null; total_population: number | null; data_sources: unknown; web_sources: unknown; stage: string | null; stage_reached: string | null; has_run: boolean };
  export interface ScenarioStore { get(id: string): Promise<Scenario | null> }
  export function scenarioFromRow(row: ScenarioJson): Scenario;
  export function scenarioToJson(scenario: Scenario): ScenarioJson;
  export function supabaseScenarioStore(admin: SupabaseClient): ScenarioStore;
  // lib/db/turns.ts
  export const TURN_STOPS = ["end_turn", "max_tokens", "refusal", "tool_limit", "empty", "paused", "error", "aborted"] as const;
  export type StoredStop = (typeof TURN_STOPS)[number];
  export type ApiCall = { model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; stop_reason: string | null; latency_ms: number; served_by: string };
  export type TurnJson = { id: string; session_id: string | null; user_text: string; started_at: string; first_token_at: string | null; finished_at: string; stop: StoredStop; refusal_category: string | null; model: string; effort: string; api_calls: ApiCall[]; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_usd: number; stage_before: Stage; stage_after: Stage };
  export type StepEventJson = { kind: StepEventKind; session_id: string | null; stage: Stage | null; tool: string | null; meta: Record<string, string | number | boolean | null> };
  export type FinishTurnPayload = { user_id: string; conversation_id: string; title: string | null; turn: TurnJson; events: StoredEvent[]; messages: Anthropic.Beta.BetaMessageParam[] | null; scenario: ScenarioJson; step_events: StepEventJson[] };
  export type ReplayTurn = { id: string; seq: number; userText: string; stop: "end_turn" | "max_tokens"; blocks: Block[] };
  export interface TurnStore { finishTurn(payload: FinishTurnPayload): Promise<string | null>; userTexts(conversationId: string): Promise<string[]>; listForReplay(conversationId: string): Promise<ReplayTurn[]> }
  export function supabaseTurnStore(admin: SupabaseClient): TurnStore;
  // lib/db/runs.ts
  export type RunInsert = { conversationId: string; userId: string; turnId: string; scenarioId: string | null; record: RunRecord };
  export interface RunStore { insert(run: RunInsert): Promise<string> }
  export function runRow(run: RunInsert): Record<string, unknown>;
  export function supabaseRunStore(admin: SupabaseClient): RunStore;
  // lib/db/feedback.ts
  export interface FeedbackStore { turnBelongs(turnId: string, conversationId: string): Promise<boolean>; insert(row: { userId: string; conversationId: string; turnId: string; rating: "up" | "down"; comment: string | null }): Promise<void> }
  export function supabaseFeedbackStore(admin: SupabaseClient): FeedbackStore;
  ```

- [ ] **Step 1: Move the conversation list and write the failing tests**

Add `"in"` to the method list in `web/tests/helpers/fakeAdmin.ts` (the line `for (const method of ["insert", "upsert", ...])`). Delete `web/tests/lib/conversations.test.ts`; its two tests move into the first `describe` below.

```ts
// web/tests/db/conversations.test.ts
import { describe, expect, it } from "vitest";

import { listConversations, supabaseConversationStore, titleFrom } from "@/lib/db/conversations";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";

describe("listConversations", () => {
  it("lists the user's undeleted conversations, newest first, mapped to summaries", async () => {
    const { client, recorded } = fakeAdmin({
      conversations: [{ data: [{ id: "c1", title: "Measles in Kenya", updated_at: "2026-10-07T10:00:00Z" }] }],
    });
    expect(await listConversations(client, USER)).toEqual([{ id: "c1", title: "Measles in Kenya", updatedAt: "2026-10-07T10:00:00Z" }]);
    expect(callOn(recorded, "conversations", "eq")).toEqual(["user_id", USER]);
    expect(callOn(recorded, "conversations", "is")).toEqual(["deleted_at", null]);
    expect(callOn(recorded, "conversations", "order")).toEqual(["updated_at", { ascending: false }]);
    expect(callOn(recorded, "conversations", "limit")).toEqual([50]);
  });

  it("returns an empty list when the table cannot be read, so the page still opens", async () => {
    const { client } = fakeAdmin({ conversations: [{ data: null, error: { message: "down" } }] });
    expect(await listConversations(client, USER)).toEqual([]);
  });
});

describe("conversation store", () => {
  it("creates a conversation and returns its id", async () => {
    const { client, recorded } = fakeAdmin({ conversations: [{ data: { id: CONVERSATION } }] });
    expect(await supabaseConversationStore(client).create(USER, "Measles in Kenya")).toBe(CONVERSATION);
    expect(callOn(recorded, "conversations", "insert")).toEqual([{ user_id: USER, title: "Measles in Kenya" }]);
    const failing = fakeAdmin({ conversations: [{ data: null, error: { message: "down" } }] });
    await expect(supabaseConversationStore(failing.client).create(USER, "x")).rejects.toThrow(/down/);
  });

  it("reads only the caller's undeleted conversation", async () => {
    const { client, recorded } = fakeAdmin({ conversations: [{ data: { id: CONVERSATION, title: "T", active_scenario_id: "s1" } }, { data: null }] });
    const store = supabaseConversationStore(client);
    expect(await store.get(CONVERSATION, USER)).toEqual({ id: CONVERSATION, title: "T", activeScenarioId: "s1" });
    expect(recorded[0].calls).toEqual([
      ["select", ["id, title, active_scenario_id"]], ["eq", ["id", CONVERSATION]], ["eq", ["user_id", USER]], ["is", ["deleted_at", null]], ["maybeSingle", []],
    ]);
    expect(await store.get(CONVERSATION, USER)).toBeNull();
  });

  it("soft-deletes the caller's conversation once and reports whether a row was hidden", async () => {
    const now = new Date("2026-10-08T15:00:00Z");
    const { client, recorded } = fakeAdmin({ conversations: [{ data: [{ id: CONVERSATION }] }, { data: [] }] });
    const store = supabaseConversationStore(client);
    expect(await store.softDelete(CONVERSATION, USER, now)).toBe(true);
    expect(callOn(recorded, "conversations", "update")).toEqual([{ deleted_at: "2026-10-08T15:00:00.000Z" }]);
    expect(callOn(recorded, "conversations", "is")).toEqual(["deleted_at", null]);
    expect(await store.softDelete(CONVERSATION, USER, now)).toBe(false);
  });
});

describe("titleFrom", () => {
  it("takes the first 60 characters, cut at a word, on one line", () => {
    expect(titleFrom("Model measles in Kenya")).toBe("Model measles in Kenya");
    expect(titleFrom("Model\n measles   in Kenya ")).toBe("Model measles in Kenya");
    expect(titleFrom("Please simulate a measles outbreak in Kenya with ninety percent vaccination coverage")).toBe("Please simulate a measles outbreak in Kenya with ninety…");
    expect(titleFrom("x".repeat(80))).toBe(`${"x".repeat(60)}…`);
  });
});
```

```ts
// web/tests/db/stores.test.ts
import { describe, expect, it, vi } from "vitest";

import { supabaseFeedbackStore } from "@/lib/db/feedback";
import { supabaseMessageStore } from "@/lib/db/messages";
import { runRow, supabaseRunStore } from "@/lib/db/runs";
import { scenarioFromRow, scenarioToJson, supabaseScenarioStore } from "@/lib/db/scenarios";
import { supabaseTurnStore } from "@/lib/db/turns";
import { emptyScenario } from "@/lib/tools/types";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";
import { params, rf } from "../tools/helpers";

const USER = "11111111-1111-1111-1111-111111111111";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const TURN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const STATS = { peak_infections: 9, peak_day: 3, total_infected: 40, total_deaths: 0, n_agents: 1000, sim_days: 365 };

describe("message store", () => {
  it("lists the exact message list in order and surfaces a read failure", async () => {
    const rows = [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "Hello" }] }];
    const { client, recorded } = fakeAdmin({ messages: [{ data: rows }] });
    expect(await supabaseMessageStore(client).list(CONVERSATION)).toEqual(rows);
    expect(callOn(recorded, "messages", "eq")).toEqual(["conversation_id", CONVERSATION]);
    expect(callOn(recorded, "messages", "order")).toEqual(["seq", { ascending: true }]);
    const failing = fakeAdmin({ messages: [{ data: null, error: { message: "down" } }] });
    await expect(supabaseMessageStore(failing.client).list(CONVERSATION)).rejects.toThrow(/down/);
  });
});

describe("scenario store", () => {
  const row = {
    id: "s1", seq: 2, params: params({ n_agents: 500 }), disease: "measles", country_iso3: "KEN", total_population: 54027487,
    data_sources: [rf("birth_rate", 0.028)], web_sources: [{ title: "WHO", url: "https://www.who.int" }], stage: "ground", stage_reached: "ground", has_run: false,
  };

  it("reads a row back as the live scenario and writes it as finish_turn expects", async () => {
    const { client, recorded } = fakeAdmin({ scenarios: [{ data: row }] });
    const scenario = await supabaseScenarioStore(client).get("s1");
    expect(scenario).toEqual({
      id: "s1", seq: 2, params: params({ n_agents: 500 }), disease: "measles", countryIso3: "KEN", totalPopulation: 54027487,
      dataSources: [rf("birth_rate", 0.028)], webSources: [{ title: "WHO", url: "https://www.who.int" }], stage: "ground", stageReached: "ground", hasRun: false,
    });
    expect(callOn(recorded, "scenarios", "eq")).toEqual(["id", "s1"]);
    expect(scenarioToJson(scenario!)).toEqual(row);
    expect(scenarioToJson(emptyScenario())).toMatchObject({ id: null, seq: 1, params: null, stage: "understand", stage_reached: "understand", has_run: false });
  });

  it("treats unparseable saved params as absent", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const scenario = scenarioFromRow({ ...row, params: { beta: "not a number" }, stage: "configure", stage_reached: null });
    expect(scenario.params).toBeNull();
    expect(scenario.stage).toBe("configure");
    expect(scenario.stageReached).toBe("configure");
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
    expect(scenarioFromRow({ ...row, stage: "later", data_sources: null }).stage).toBe("understand");
    expect(scenarioFromRow({ ...row, data_sources: null }).dataSources).toEqual([]);
  });

  it("returns null for a missing row", async () => {
    const { client } = fakeAdmin({ scenarios: [{ data: null }] });
    expect(await supabaseScenarioStore(client).get("missing")).toBeNull();
  });
});

describe("turn store", () => {
  it("calls finish_turn with the payload and returns the scenario id", async () => {
    const { client, rpcCalls } = fakeAdmin({ "rpc:finish_turn": [{ data: "s9" }] });
    const payload = { user_id: USER, conversation_id: CONVERSATION } as never;
    expect(await supabaseTurnStore(client).finishTurn(payload)).toBe("s9");
    expect(rpcCalls).toEqual([["finish_turn", { p: payload }]]);
    const failing = fakeAdmin({ "rpc:finish_turn": [{ data: null, error: { message: "boom" } }] });
    await expect(supabaseTurnStore(failing.client).finishTurn(payload)).rejects.toThrow(/boom/);
  });

  it("lists the typed texts in order", async () => {
    const { client, recorded } = fakeAdmin({ turns: [{ data: [{ user_text: "Model measles" }, { user_text: "Run it" }] }] });
    expect(await supabaseTurnStore(client).userTexts(CONVERSATION)).toEqual(["Model measles", "Run it"]);
    expect(callOn(recorded, "turns", "order")).toEqual(["seq", { ascending: true }]);
  });

  it("replays finished turns as blocks, in event order, without thinking", async () => {
    const rows = [{
      id: TURN, seq: 1, user_text: "Model measles", stop: "end_turn",
      turn_events: [
        { seq: 3, kind: "text", payload: { text: "Configured." } },
        { seq: 1, kind: "thinking", payload: { summary: "secret" } },
        { seq: 2, kind: "tool_result", payload: { id: "tu_1", name: "configure_simulation", ok: true, payload: { kind: "config" } } },
      ],
    }];
    const { client, recorded } = fakeAdmin({ turns: [{ data: rows }] });
    const turns = await supabaseTurnStore(client).listForReplay(CONVERSATION);
    expect(turns).toEqual([{
      id: TURN, seq: 1, userText: "Model measles", stop: "end_turn",
      blocks: [
        { kind: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: { kind: "config" } },
        { kind: "text", text: "Configured." },
      ],
    }]);
    expect(callOn(recorded, "turns", "select")).toEqual(["id, seq, user_text, stop, turn_events(seq, kind, payload)"]);
    expect(callOn(recorded, "turns", "in")).toEqual(["stop", ["end_turn", "max_tokens"]]);
    expect(JSON.stringify(turns)).not.toContain("secret");
  });
});

describe("run store", () => {
  const success = {
    ok: true as const, effective_params: params({ n_agents: 1000 }), population: 2500, stats: STATS, stats_agents: STATS, series: { day: [0] },
    pop_scale: 2.5, repairs: [], attempts: 1, duration_ms: 900, cold_start: true, starsim_version: "3.3.2",
  };
  const record = { params: params({ n_agents: 1000 }), popScale: 2.5, warnings: ["w"], dataSources: [rf("birth_rate", 0.028)], result: success };
  const insert = { conversationId: CONVERSATION, userId: USER, turnId: TURN, scenarioId: null, record };

  it("maps a success and a failure to the runs columns and returns the new id", async () => {
    const { client, recorded } = fakeAdmin({ runs: [{ data: { id: "r1" } }] });
    expect(await supabaseRunStore(client).insert(insert)).toBe("r1");
    expect(callOn(recorded, "runs", "insert")).toEqual([runRow(insert)]);
    expect(runRow({ ...insert, scenarioId: "s1" })).toMatchObject({
      conversation_id: CONVERSATION, user_id: USER, turn_id: TURN, scenario_id: "s1", params: params({ n_agents: 1000 }), pop_scale: 2.5,
      stats: STATS, stats_agents: STATS, series: { day: [0] }, duration_ms: 900, sim_cold_start: true, error: null, warnings: ["w"], data_sources: [rf("birth_rate", 0.028)], repairs: [],
    });
    const failed = { ...record, result: { ok: false as const, status: 504, kind: "timeout" as const, detail: "The simulation timed out after 120 seconds.", repairs: [], attempts: 2, seconds: 120 } };
    expect(runRow({ ...insert, record: failed })).toMatchObject({
      effective_params: null, stats: null, stats_agents: null, series: null, duration_ms: null, sim_cold_start: null,
      error: { kind: "timeout", detail: "The simulation timed out after 120 seconds.", status: 504, attempts: 2 },
    });
  });

  it("surfaces an insert failure as an error for onRun to swallow", async () => {
    const { client } = fakeAdmin({ runs: [{ data: null, error: { message: "down" } }] });
    await expect(supabaseRunStore(client).insert(insert)).rejects.toThrow(/down/);
  });
});

describe("feedback store", () => {
  it("checks that the turn is in the conversation and inserts one row per press", async () => {
    const { client, recorded } = fakeAdmin({ turns: [{ data: { id: TURN } }, { data: null }] });
    const store = supabaseFeedbackStore(client);
    expect(await store.turnBelongs(TURN, CONVERSATION)).toBe(true);
    expect(recorded[0].calls).toEqual([["select", ["id"]], ["eq", ["id", TURN]], ["eq", ["conversation_id", CONVERSATION]], ["maybeSingle", []]]);
    expect(await store.turnBelongs(TURN, CONVERSATION)).toBe(false);
    await store.insert({ userId: USER, conversationId: CONVERSATION, turnId: TURN, rating: "down", comment: "Too slow" });
    expect(callOn(recorded, "feedback", "insert")).toEqual([{ user_id: USER, conversation_id: CONVERSATION, turn_id: TURN, rating: "down", comment: "Too slow" }]);
    const failing = fakeAdmin({ feedback: [{ data: null, error: { message: "down" } }] });
    await expect(supabaseFeedbackStore(failing.client).insert({ userId: USER, conversationId: CONVERSATION, turnId: TURN, rating: "up", comment: null })).rejects.toThrow(/down/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/db/conversations tests/db/stores`
Expected: both files fail to resolve `@/lib/db/...`.

- [ ] **Step 3: Implement**

```ts
// web/lib/db/conversations.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type ConversationSummary = { id: string; title: string; updatedAt: string };
export type ConversationRow = { id: string; title: string; activeScenarioId: string | null };

export interface ConversationStore {
  /** Open a conversation for the participant and return its id. */
  create(userId: string, title: string): Promise<string>;
  /** The participant's own, undeleted conversation, or null. */
  get(id: string, userId: string): Promise<ConversationRow | null>;
  /** Hide the conversation from the participant; the study keeps it. False when it is not theirs or already hidden. */
  softDelete(id: string, userId: string, now: Date): Promise<boolean>;
}

const LIMIT = 50;
const TITLE_CHARS = 60;

/** The first 60 characters of the first message, cut at a word, on one line. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= TITLE_CHARS) return line;
  const cut = line.slice(0, TITLE_CHARS);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > TITLE_CHARS / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

export function supabaseConversationStore(admin: SupabaseClient): ConversationStore {
  return {
    async create(userId, title) {
      const { data, error } = await admin.from("conversations").insert({ user_id: userId, title }).select("id").single();
      if (error || !data) throw new Error(`conversations insert failed: ${error?.message ?? "no row"}`);
      return (data as { id: string }).id;
    },

    async get(id, userId) {
      const { data, error } = await admin
        .from("conversations")
        .select("id, title, active_scenario_id")
        .eq("id", id)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(`conversations read failed: ${error.message}`);
      if (!data) return null;
      const row = data as { id: string; title: string; active_scenario_id: string | null };
      return { id: row.id, title: row.title, activeScenarioId: row.active_scenario_id };
    },

    async softDelete(id, userId, now) {
      const { data, error } = await admin
        .from("conversations")
        .update({ deleted_at: now.toISOString() })
        .eq("id", id)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .select("id");
      if (error) throw new Error(`conversations delete failed: ${error.message}`);
      return Array.isArray(data) && data.length > 0;
    },
  };
}

/** The participant's conversations, newest first. A list that cannot be read is shown as empty. */
export async function listConversations(admin: SupabaseClient, userId: string): Promise<ConversationSummary[]> {
  const { data, error } = await admin
    .from("conversations")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(LIMIT);
  if (error || !data) return [];
  return (data as { id: string; title: string; updated_at: string }[]).map((row) => ({
    id: row.id,
    title: row.title || "New conversation",
    updatedAt: row.updated_at,
  }));
}
```

```ts
// web/lib/db/messages.ts
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MessageStore {
  /** The exact message list, in order, as it was sent to and received from the API. */
  list(conversationId: string): Promise<Anthropic.Beta.BetaMessageParam[]>;
}

type Row = { role: "user" | "assistant"; content: Anthropic.Beta.BetaMessageParam["content"] };

export function supabaseMessageStore(admin: SupabaseClient): MessageStore {
  return {
    async list(conversationId) {
      const { data, error } = await admin.from("messages").select("role, content").eq("conversation_id", conversationId).order("seq", { ascending: true });
      if (error) throw new Error(`messages read failed: ${error.message}`);
      return ((data ?? []) as Row[]).map((row) => ({ role: row.role, content: row.content }));
    },
  };
}
```

```ts
// web/lib/db/scenarios.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedField } from "@/lib/data/types";
import { STAGES, type Stage } from "@/lib/enums";
import { validateParams } from "@/lib/sim/params";
import type { Scenario, WebSource } from "@/lib/tools/types";

/** The scenario as finish_turn's `p.scenario` and as the row reads back. */
export type ScenarioJson = {
  id: string | null;
  seq: number;
  params: unknown;
  disease: string | null;
  country_iso3: string | null;
  total_population: number | null;
  data_sources: unknown;
  web_sources: unknown;
  stage: string | null;
  stage_reached: string | null;
  has_run: boolean;
};

export interface ScenarioStore {
  get(id: string): Promise<Scenario | null>;
}

const COLUMNS = "id, seq, params, disease, country_iso3, total_population, data_sources, web_sources, stage, stage_reached, has_run";

function stageOf(value: unknown, fallback: Stage): Stage {
  return (STAGES as readonly string[]).includes(value as string) ? (value as Stage) : fallback;
}

/** A row as the tools use it. Params that no longer validate are treated as absent, so an old row cannot break a turn. */
export function scenarioFromRow(row: ScenarioJson): Scenario {
  let params: Scenario["params"] = null;
  if (row.params !== null && row.params !== undefined) {
    const result = validateParams(row.params);
    if (result.ok) params = result.params;
    else console.error(`scenario ${row.id} has unusable params: ${result.error}`);
  }
  const stage = stageOf(row.stage, "understand");
  return {
    id: row.id,
    seq: Number(row.seq),
    params,
    disease: row.disease ?? null,
    countryIso3: row.country_iso3 ?? null,
    totalPopulation: row.total_population === null || row.total_population === undefined ? null : Number(row.total_population),
    dataSources: Array.isArray(row.data_sources) ? (row.data_sources as ResolvedField[]) : [],
    webSources: Array.isArray(row.web_sources) ? (row.web_sources as WebSource[]) : [],
    stage,
    stageReached: stageOf(row.stage_reached, stage),
    hasRun: Boolean(row.has_run),
  };
}

/** The scenario as finish_turn stores it. */
export function scenarioToJson(s: Scenario): ScenarioJson {
  return {
    id: s.id, seq: s.seq, params: s.params, disease: s.disease, country_iso3: s.countryIso3, total_population: s.totalPopulation,
    data_sources: s.dataSources, web_sources: s.webSources, stage: s.stage, stage_reached: s.stageReached, has_run: s.hasRun,
  };
}

export function supabaseScenarioStore(admin: SupabaseClient): ScenarioStore {
  return {
    async get(id) {
      const { data, error } = await admin.from("scenarios").select(COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error(`scenarios read failed: ${error.message}`);
      return data ? scenarioFromRow(data as ScenarioJson) : null;
    },
  };
}
```

```ts
// web/lib/db/turns.ts
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block, StoredEvent } from "@/lib/chat/events";
import type { Stage, StepEventKind } from "@/lib/enums";
import type { ScenarioJson } from "./scenarios";

export const TURN_STOPS = ["end_turn", "max_tokens", "refusal", "tool_limit", "empty", "paused", "error", "aborted"] as const;
export type StoredStop = (typeof TURN_STOPS)[number];

/** One entry of turns.api_calls: one model call. */
export type ApiCall = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  stop_reason: string | null;
  latency_ms: number;
  /** The model that answered: the fallback when the refusal fallback rerouted the call. */
  served_by: string;
};

export type TurnJson = {
  id: string;
  session_id: string | null;
  user_text: string;
  started_at: string;
  first_token_at: string | null;
  finished_at: string;
  stop: StoredStop;
  refusal_category: string | null;
  model: string;
  effort: string;
  api_calls: ApiCall[];
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  stage_before: Stage;
  stage_after: Stage;
};

export type StepEventJson = {
  kind: StepEventKind;
  session_id: string | null;
  stage: Stage | null;
  tool: string | null;
  meta: Record<string, string | number | boolean | null>;
};

/** finish_turn's argument (migration 0002). */
export type FinishTurnPayload = {
  user_id: string;
  conversation_id: string;
  title: string | null;
  turn: TurnJson;
  events: StoredEvent[];
  /** The user message and the appended messages when the turn finished; null when it was dropped or failed. */
  messages: Anthropic.Beta.BetaMessageParam[] | null;
  scenario: ScenarioJson;
  step_events: StepEventJson[];
};

export type ReplayTurn = { id: string; seq: number; userText: string; stop: "end_turn" | "max_tokens"; blocks: Block[] };

export interface TurnStore {
  /** Write the whole turn in one transaction; returns the scenario id. Throws when the database refuses. */
  finishTurn(payload: FinishTurnPayload): Promise<string | null>;
  /** Every turn's typed text, in order: the Python agent's context_text. */
  userTexts(conversationId: string): Promise<string[]>;
  /** The finished turns with their display blocks (thinking left out), for /chat/[id]. */
  listForReplay(conversationId: string): Promise<ReplayTurn[]>;
}

type ReplayRow = {
  id: string;
  seq: number;
  user_text: string;
  stop: "end_turn" | "max_tokens";
  turn_events: { seq: number; kind: string; payload: Record<string, unknown> }[] | null;
};

export function supabaseTurnStore(admin: SupabaseClient): TurnStore {
  return {
    async finishTurn(payload) {
      const { data, error } = await admin.rpc("finish_turn", { p: payload });
      if (error) throw new Error(`finish_turn failed: ${error.message}`);
      return typeof data === "string" ? data : null;
    },

    async userTexts(conversationId) {
      const { data, error } = await admin.from("turns").select("user_text").eq("conversation_id", conversationId).order("seq", { ascending: true });
      if (error) throw new Error(`turns read failed: ${error.message}`);
      return ((data ?? []) as { user_text: string }[]).map((row) => row.user_text);
    },

    async listForReplay(conversationId) {
      const { data, error } = await admin
        .from("turns")
        .select("id, seq, user_text, stop, turn_events(seq, kind, payload)")
        .eq("conversation_id", conversationId)
        .in("stop", ["end_turn", "max_tokens"])
        .order("seq", { ascending: true });
      if (error) throw new Error(`turns read failed: ${error.message}`);
      return ((data ?? []) as ReplayRow[]).map((row) => ({
        id: row.id,
        seq: row.seq,
        userText: row.user_text,
        stop: row.stop,
        blocks: [...(row.turn_events ?? [])]
          .sort((a, b) => a.seq - b.seq)
          .filter((event) => event.kind !== "thinking")
          .map((event) => ({ kind: event.kind, ...event.payload }) as Block),
      }));
    },
  };
}
```

```ts
// web/lib/db/runs.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunRecord } from "@/lib/tools/types";

export type RunInsert = { conversationId: string; userId: string; turnId: string; scenarioId: string | null; record: RunRecord };

export interface RunStore {
  /** Insert the row and return its id. Throws when the database refuses; onRun swallows it. */
  insert(run: RunInsert): Promise<string>;
}

/** The runs columns for one simulation, finished or failed. */
export function runRow(run: RunInsert): Record<string, unknown> {
  const { record } = run;
  const result = record.result;
  const common = {
    conversation_id: run.conversationId,
    user_id: run.userId,
    turn_id: run.turnId,
    scenario_id: run.scenarioId,
    params: record.params,
    pop_scale: record.popScale,
    warnings: record.warnings,
    data_sources: record.dataSources,
    repairs: result.repairs,
  };
  if (result.ok) {
    return {
      ...common,
      effective_params: result.effective_params,
      stats: result.stats,
      stats_agents: result.stats_agents,
      series: result.series,
      duration_ms: result.duration_ms,
      sim_cold_start: result.cold_start,
      error: null,
    };
  }
  return {
    ...common,
    effective_params: null,
    stats: null,
    stats_agents: null,
    series: null,
    duration_ms: null,
    sim_cold_start: null,
    error: { kind: result.kind, detail: result.detail, status: result.status, attempts: result.attempts },
  };
}

export function supabaseRunStore(admin: SupabaseClient): RunStore {
  return {
    async insert(run) {
      const { data, error } = await admin.from("runs").insert(runRow(run)).select("id").single();
      if (error || !data) throw new Error(`runs insert failed: ${error?.message ?? "no row"}`);
      return (data as { id: string }).id;
    },
  };
}
```

```ts
// web/lib/db/feedback.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type FeedbackInsert = { userId: string; conversationId: string; turnId: string; rating: "up" | "down"; comment: string | null };

export interface FeedbackStore {
  /** True when the turn is in the conversation. The route has already checked the conversation is the caller's. */
  turnBelongs(turnId: string, conversationId: string): Promise<boolean>;
  /** One row per press. */
  insert(row: FeedbackInsert): Promise<void>;
}

export function supabaseFeedbackStore(admin: SupabaseClient): FeedbackStore {
  return {
    async turnBelongs(turnId, conversationId) {
      const { data, error } = await admin.from("turns").select("id").eq("id", turnId).eq("conversation_id", conversationId).maybeSingle();
      if (error) throw new Error(`turns read failed: ${error.message}`);
      return data !== null;
    },
    async insert(row) {
      const { error } = await admin.from("feedback").insert({
        user_id: row.userId,
        conversation_id: row.conversationId,
        turn_id: row.turnId,
        rating: row.rating,
        comment: row.comment,
      });
      if (error) throw new Error(`feedback insert failed: ${error.message}`);
    },
  };
}
```

Then delete `web/lib/conversations.ts` and change the two imports (`web/app/chat/page.tsx`, `web/components/ChatShell.tsx`) from `@/lib/conversations` to `@/lib/db/conversations`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix web test -- tests/db`
Expected: PASS (conversations 6, stores 10, plus finishTurn, schema, usage).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: clean (a leftover import of `@/lib/conversations` shows here as a typecheck error).

```bash
git add -A web/lib/db web/lib/conversations.ts web/app/chat/page.tsx web/components/ChatShell.tsx web/tests/db/conversations.test.ts web/tests/db/stores.test.ts web/tests/lib/conversations.test.ts web/tests/helpers/fakeAdmin.ts
git commit -m "feat(db): conversation, message, scenario, turn, run, and feedback stores"
```

---
### Task 5: `runTurn`, the streaming loop

**Files:**
- Create: `web/lib/chat/runTurn.ts`, `web/tests/chat/helpers.ts`
- Test: `web/tests/chat/runTurn.test.ts`

**Interfaces:**
- Consumes: `TurnEvent` (Task 3); `ApiCall` (Task 4); `ToolOutcome` (`lib/tools/types.ts`); `Effort`, `ModelId`, `ThinkingDisplay` (`lib/enums.ts`); `@anthropic-ai/sdk` beta types.
- Produces:
  ```ts
  export type TurnStop = "end_turn" | "max_tokens" | "refusal" | "tool_limit" | "empty" | "paused";
  export type TurnResult = { appended: Anthropic.Beta.BetaMessageParam[]; stop: TurnStop; refusalCategory: string | null; firstTokenAt: Date | null };
  export type TurnArgs = {
    client: Anthropic; model: ModelId; effort: Effort; thinkingDisplay: ThinkingDisplay; refusalFallback: boolean;
    system: Anthropic.Beta.BetaTextBlockParam[]; tools: Anthropic.Beta.BetaToolUnion[]; messages: Anthropic.Beta.BetaMessageParam[];
    maxOutputTokens: number; maxToolRounds: number; maxPauseContinuations: number;
    executeTool: (name: string, input: unknown) => Promise<ToolOutcome>; onEvent: (event: TurnEvent) => void;
    apiCalls: ApiCall[]; signal?: AbortSignal; now?: () => Date;
  };
  export const TOOL_LIMIT_RESULT = "Tool limit reached for this turn. Answer with what you already have.";
  export const WEB_TOOLS: Anthropic.Beta.BetaToolUnion[];                       // the two server tools, in order
  export function eventOfBlock(block: Anthropic.Beta.BetaContentBlock): TurnEvent | null;
  export async function runTurn(args: TurnArgs): Promise<TurnResult>;
  // tests/chat/helpers.ts
  export function fakeClient(script: Step[]): { client: Anthropic; requests: Record<string, unknown>[]; requestOptions: unknown[] };
  export function message(content: unknown[], stopReason?: string, extra?: Record<string, unknown>): Anthropic.Beta.BetaMessage;
  export function textBlock(text: string), toolUse(id, name, input), thinkingBlock(thinking?), serverSearch(id, query), searchResult(id, hits), searchError(id, code), fetchResult(id, url, title | null), fetchError(id, code);
  export type Step = { message?: Anthropic.Beta.BetaMessage; text?: string[]; error?: Error };
  ```

- [ ] **Step 1: Write the fake client and the failing tests**

```ts
// web/tests/chat/helpers.ts
import type Anthropic from "@anthropic-ai/sdk";

export const USAGE = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, iterations: null };

export function textBlock(text: string) {
  return { type: "text", text, citations: null };
}
export function toolUse(id: string, name: string, input: unknown) {
  return { type: "tool_use", id, name, input };
}
export function thinkingBlock(thinking = "Plan the model") {
  return { type: "thinking", thinking, signature: "sig-abc" };
}
export function serverSearch(id: string, query: string) {
  return { type: "server_tool_use", id, name: "web_search", input: { query } };
}
export function searchResult(id: string, hits: number) {
  const content = Array.from({ length: hits }, (_, i) => ({ type: "web_search_result", url: `https://example.org/${i}`, title: `Hit ${i}`, encrypted_content: "x", page_age: null }));
  return { type: "web_search_tool_result", tool_use_id: id, content };
}
export function searchError(id: string, error_code: string) {
  return { type: "web_search_tool_result", tool_use_id: id, content: { type: "web_search_tool_result_error", error_code } };
}
export function fetchResult(id: string, url: string, title: string | null) {
  const document = { type: "document", title, citations: null, source: { type: "text", media_type: "text/plain", data: "page text" } };
  return { type: "web_fetch_tool_result", tool_use_id: id, content: { type: "web_fetch_result", url, retrieved_at: null, content: document } };
}
export function fetchError(id: string, error_code: string) {
  return { type: "web_fetch_tool_result", tool_use_id: id, content: { type: "web_fetch_tool_result_error", error_code } };
}

export function message(content: unknown[], stopReason = "end_turn", extra: Record<string, unknown> = {}): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stopReason, stop_sequence: null,
    stop_details: null, container: null, usage: USAGE, ...extra,
  } as unknown as Anthropic.Beta.BetaMessage;
}

export type Step = { message?: Anthropic.Beta.BetaMessage; text?: string[]; error?: Error };

/**
 * A stand-in for the Anthropic client. Each call to beta.messages.stream()
 * plays the next step: its text deltas, then every content block of its
 * message as a completed block (what the SDK's "contentBlock" event
 * delivers), then the final message. The last step repeats if the script
 * runs out. `requestOptions` holds the second argument of each call.
 */
export function fakeClient(script: Step[]) {
  const requests: Record<string, unknown>[] = [];
  const requestOptions: unknown[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>, options?: unknown) {
          const step = script[Math.min(requests.length, script.length - 1)];
          requests.push(structuredClone(params));
          requestOptions.push(options);
          const listeners: Record<string, ((arg: unknown) => void)[]> = {};
          return {
            on(event: string, listener: (arg: unknown) => void) {
              (listeners[event] ??= []).push(listener);
              return this;
            },
            async finalMessage() {
              if (step.error) throw step.error;
              for (const delta of step.text ?? []) for (const listener of listeners.text ?? []) listener(delta);
              for (const block of (step.message?.content ?? []) as unknown[]) for (const listener of listeners.contentBlock ?? []) listener(block);
              return step.message;
            },
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, requests, requestOptions };
}
```

```ts
// web/tests/chat/runTurn.test.ts
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import type { TurnEvent } from "@/lib/chat/events";
import { TOOL_LIMIT_RESULT, WEB_TOOLS, eventOfBlock, runTurn, type TurnArgs } from "@/lib/chat/runTurn";
import type { ApiCall } from "@/lib/db/turns";
import type { ToolOutcome } from "@/lib/tools/types";
import { fakeClient, fetchError, fetchResult, message, searchError, searchResult, serverSearch, textBlock, thinkingBlock, toolUse, type Step } from "./helpers";

const SYSTEM = [{ type: "text" as const, text: "SYSTEM", cache_control: { type: "ephemeral" as const } }];
const TOOLS = [{ name: "configure_simulation", input_schema: { type: "object" } }, ...WEB_TOOLS] as unknown as Anthropic.Beta.BetaToolUnion[];
const HISTORY: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: "Model measles in Kenya" }];
const CALL = message([toolUse("tu_1", "configure_simulation", { disease: "measles" })], "tool_use");
const CONFIG = { kind: "config" as const, applied: {}, approx_r0: 12, config: { disease: "measles", disease_type: "sir", country: null, n_agents: 10000, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] }, warnings: [], new_scenario: false };

function clock() {
  let t = Date.parse("2026-10-08T15:00:00Z");
  return () => new Date((t += 250));
}

function setup(script: Step[], options: Partial<TurnArgs> & { outcome?: ToolOutcome } = {}) {
  const { client, requests, requestOptions } = fakeClient(script);
  const events: TurnEvent[] = [];
  const toolCalls: { name: string; input: unknown }[] = [];
  const apiCalls: ApiCall[] = [];
  const { outcome, ...overrides } = options;
  const run = () =>
    runTurn({
      client, model: "claude-opus-5-5", effort: "medium", thinkingDisplay: "summarized", refusalFallback: true,
      system: SYSTEM, tools: TOOLS, messages: HISTORY, maxOutputTokens: 4000, maxToolRounds: 5, maxPauseContinuations: 2,
      executeTool: async (name, input) => {
        toolCalls.push({ name, input });
        return outcome ?? { content: "RESULT", payload: CONFIG };
      },
      onEvent: (event) => events.push(event),
      apiCalls, now: clock(), ...overrides,
    });
  return { run, requests, requestOptions, events, toolCalls, apiCalls };
}

describe("runTurn", () => {
  it("returns a plain answer, streams its text, and records the model call", async () => {
    const answer = message([textBlock("Hello there")]);
    const { run, events, apiCalls } = setup([{ message: answer, text: ["Hello ", "there"] }]);
    const result = await run();
    expect(result).toEqual({ appended: [{ role: "assistant", content: answer.content }], stop: "end_turn", refusalCategory: null, firstTokenAt: new Date("2026-10-08T15:00:00.500Z") });
    expect(events).toEqual([{ type: "text", delta: "Hello " }, { type: "text", delta: "there" }]);
    expect(apiCalls).toEqual([{ model: "claude-opus-5-5", input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0, stop_reason: "end_turn", latency_ms: 500, served_by: "claude-opus-5-5" }]);
  });

  it("runs a requested tool, reports it with its payload, and sends the result back", async () => {
    const answer = message([textBlock("Configured.")]);
    const { run, requests, events, toolCalls } = setup([{ message: CALL }, { message: answer }]);
    const result = await run();
    expect(toolCalls).toEqual([{ name: "configure_simulation", input: { disease: "measles" } }]);
    expect(result.stop).toBe("end_turn");
    expect(result.appended).toEqual([
      { role: "assistant", content: CALL.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "RESULT" }] },
      { role: "assistant", content: answer.content },
    ]);
    expect(requests[1].messages).toEqual([...HISTORY, ...result.appended.slice(0, 2)]);
    expect(events).toEqual([
      { type: "tool_use", id: "tu_1", name: "configure_simulation", input: { disease: "measles" } },
      { type: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: CONFIG },
    ]);
  });

  it("marks a failed tool result as an error for the model and the event", async () => {
    const { run, events } = setup([{ message: CALL }, { message: message([textBlock("Sorry.")]) }], { outcome: { content: "CONFIG ERROR: x", isError: true, payload: { kind: "tool_error", message: "CONFIG ERROR: x" } } });
    const result = await run();
    expect(result.appended[1]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "CONFIG ERROR: x", is_error: true }] });
    expect(events[1]).toMatchObject({ type: "tool_result", ok: false, payload: { kind: "tool_error" } });
  });

  it("keeps thinking blocks in the message and reports their summaries, skipping empty ones", async () => {
    const content = [thinkingBlock("Plan the model"), thinkingBlock(""), textBlock("Hi")];
    const { run, events } = setup([{ message: message(content), text: ["Hi"] }]);
    const result = await run();
    expect(result.appended[0].content).toEqual(content);
    expect(events).toEqual([{ type: "text", delta: "Hi" }, { type: "thinking", summary: "Plan the model" }]);
  });

  it("drops the whole turn on a refusal with its category but still counts the call", async () => {
    const refusal = message([], "refusal", { stop_details: { type: "refusal", category: "bio", explanation: null } });
    const { run, apiCalls } = setup([{ message: CALL }, { message: refusal }]);
    const result = await run();
    expect(result).toMatchObject({ appended: [], stop: "refusal", refusalCategory: "bio" });
    expect(apiCalls).toHaveLength(2);
    expect(apiCalls[1].stop_reason).toBe("refusal");
  });

  it("drops a cut-off tool call, keeps a cut-off text answer, and drops an empty reply", async () => {
    const cut = message([toolUse("tu_1", "configure_simulation", { disease: "mea" })], "max_tokens");
    const { run, toolCalls } = setup([{ message: cut }]);
    expect(await run()).toMatchObject({ appended: [], stop: "max_tokens" });
    expect(toolCalls).toEqual([]);
    const long = setup([{ message: message([textBlock("A long answer that stops")], "max_tokens") }]);
    const kept = await long.run();
    expect(kept.stop).toBe("max_tokens");
    expect(kept.appended).toHaveLength(1);
    expect(await setup([{ message: message([]) }]).run()).toMatchObject({ appended: [], stop: "empty" });
  });

  it("stops running tools after the limit, gives up after two more calls, and lets the model answer in between", async () => {
    const exhausted = setup([{ message: CALL }], { maxToolRounds: 2 });
    const dropped = await exhausted.run();
    expect(exhausted.toolCalls).toHaveLength(2);
    expect(exhausted.requests).toHaveLength(4);
    expect(dropped).toMatchObject({ appended: [], stop: "tool_limit" });

    const answered = setup([{ message: CALL }, { message: CALL }, { message: CALL }, { message: message([textBlock("Here is what I have.")]) }], { maxToolRounds: 2 });
    const result = await answered.run();
    expect(result.stop).toBe("end_turn");
    expect(answered.toolCalls).toHaveLength(2);
    expect(result.appended).toHaveLength(7);
    expect(result.appended[5]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", is_error: true, content: TOOL_LIMIT_RESULT }] });
  });

  it("resumes a paused message without counting a tool round, and drops the turn when continuations run out", async () => {
    const paused = message([serverSearch("st_1", "measles Kenya"), searchResult("st_1", 3)], "pause_turn");
    const answer = message([textBlock("Found it.")]);
    const resumed = setup([{ message: paused }, { message: paused }, { message: answer }], { maxToolRounds: 1, maxPauseContinuations: 2 });
    const result = await resumed.run();
    expect(result.stop).toBe("end_turn");
    expect(result.appended).toEqual([{ role: "assistant", content: paused.content }, { role: "assistant", content: paused.content }, { role: "assistant", content: answer.content }]);
    expect(resumed.requests[2].messages).toEqual([...HISTORY, ...result.appended.slice(0, 2)]);
    expect(resumed.events.filter((e) => e.type === "web_search")).toHaveLength(2);

    const exhausted = setup([{ message: paused }], { maxPauseContinuations: 1 });
    expect(await exhausted.run()).toMatchObject({ appended: [], stop: "paused" });
    expect(exhausted.requests).toHaveLength(2);
  });

  it("answers a tool call on a paused message before resuming", async () => {
    const pausedCall = message([serverSearch("st_1", "q"), searchResult("st_1", 1), toolUse("tu_1", "configure_simulation", { disease: "measles" })], "pause_turn");
    const answer = message([textBlock("Done.")]);
    const { run, requests, toolCalls } = setup([{ message: pausedCall }, { message: answer }]);
    const result = await run();
    expect(toolCalls).toHaveLength(1);
    expect(result.appended).toEqual([
      { role: "assistant", content: pausedCall.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "RESULT" }] },
      { role: "assistant", content: answer.content },
    ]);
    expect(requests[1].messages).toEqual([...HISTORY, ...result.appended.slice(0, 2)]);
  });

  it("reports web fetches by title or URL and web errors as notices", async () => {
    const content = [
      serverSearch("st_1", "measles Kenya"), searchResult("st_1", 2),
      { type: "server_tool_use", id: "st_2", name: "web_fetch", input: { url: "https://www.who.int/measles" } }, fetchResult("st_2", "https://www.who.int/measles", "Measles"),
      fetchResult("st_3", "https://example.org/page", null),
      searchError("st_4", "max_uses_exceeded"), fetchError("st_5", "url_not_accessible"),
      { type: "server_tool_use", id: "st_6", name: "code_execution", input: { code: "1+1" } }, { type: "code_execution_tool_result", tool_use_id: "st_6", content: { type: "code_execution_result", stdout: "2", stderr: "", return_code: 0, content: [] } },
      textBlock("Found it."),
    ];
    const { run, events } = setup([{ message: message(content), text: ["Found it."] }]);
    await run();
    expect(events).toEqual([
      { type: "text", delta: "Found it." },
      { type: "web_search", query: "measles Kenya" },
      { type: "web_fetch", url: "https://www.who.int/measles", title: "Measles" },
      { type: "web_fetch", url: "https://example.org/page", title: "https://example.org/page" },
      { type: "notice", message: "WEB ERROR: max_uses_exceeded" },
      { type: "notice", message: "WEB ERROR: url_not_accessible" },
    ]);
    expect(eventOfBlock({ type: "redacted_thinking", data: "x" } as Anthropic.Beta.BetaContentBlock)).toBeNull();
  });

  it("sends the exact request object, with the fallback only when enabled, and the abort signal to every call", async () => {
    const controller = new AbortController();
    const { run, requests, requestOptions } = setup([{ message: CALL }, { message: message([textBlock("ok")]) }], { signal: controller.signal });
    await run();
    expect(requests[0]).toEqual({
      model: "claude-opus-5-5", max_tokens: 4000, system: SYSTEM, cache_control: { type: "ephemeral" }, tools: TOOLS, messages: HISTORY,
      thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "medium" }, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"],
    });
    expect(requestOptions).toEqual([{ signal: controller.signal }, { signal: controller.signal }]);
    const plain = setup([{ message: message([textBlock("ok")]) }], { refusalFallback: false, effort: "high", thinkingDisplay: "omitted" });
    await plain.run();
    expect("fallbacks" in plain.requests[0]).toBe(false);
    expect("betas" in plain.requests[0]).toBe(false);
    expect(plain.requests[0]).toMatchObject({ thinking: { type: "adaptive", display: "omitted" }, output_config: { effort: "high" } });
    expect(plain.requestOptions).toEqual([undefined]);
  });

  it("records the fallback model that served a rerouted call", async () => {
    const served = message([textBlock("ok")], "end_turn", {
      usage: { ...message([]).usage, iterations: [{ type: "fallback_message", model: "claude-opus-5", input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null }] },
    });
    const { run, apiCalls } = setup([{ message: served }]);
    await run();
    expect(apiCalls[0]).toMatchObject({ model: "claude-opus-5-5", served_by: "claude-opus-5" });
  });

  it("re-issues a call whose eager tool input could not be parsed, gives up after three, and never retries an API error", async () => {
    const broken = { error: new SyntaxError("Unexpected end of JSON input") };
    const retried = setup([broken, broken, { message: message([textBlock("ok")]) }]);
    expect((await retried.run()).stop).toBe("end_turn");
    expect(retried.requests).toHaveLength(3);
    const hopeless = setup([broken]);
    await expect(hopeless.run()).rejects.toBeInstanceOf(SyntaxError);
    expect(hopeless.requests).toHaveLength(3);
    const apiError = new Anthropic.APIError(500, undefined, "server error", new Headers());
    const failed = setup([{ error: apiError }]);
    await expect(failed.run()).rejects.toBe(apiError);
    expect(failed.requests).toHaveLength(1);
  });

  it("does not change the caller's message list, and never repeats a call because the listener threw", async () => {
    const { run, requests, apiCalls } = setup([{ message: CALL }, { message: message([textBlock("ok")], "end_turn"), text: ["ok"] }], {
      onEvent: () => {
        throw new Error("Invalid state: Controller is already closed");
      },
    });
    const result = await run();
    expect(result.stop).toBe("end_turn");
    expect(result.appended).toHaveLength(3);
    expect(requests).toHaveLength(2);
    expect(apiCalls).toHaveLength(2);
    expect(HISTORY).toEqual([{ role: "user", content: "Model measles in Kenya" }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix web test -- tests/chat/runTurn`
Expected: cannot resolve `@/lib/chat/runTurn`.

- [ ] **Step 3: Implement**

```ts
// web/lib/chat/runTurn.ts
/**
 * One turn of the agent: model calls, client tools, server tools, until the
 * model stops. CampusOtter's loop (per-call usage, the tool-round cap, the
 * dropped-turn protocol, the broken-stream retry) extended for the beta
 * messages API: adaptive thinking with stored summaries, web search and fetch
 * as events, pause_turn resumption, and the server-side refusal fallback.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ApiCall } from "@/lib/db/turns";
import type { Effort, ModelId, ThinkingDisplay } from "@/lib/enums";
import type { ToolOutcome } from "@/lib/tools/types";
import type { TurnEvent } from "./events";

type Beta = Anthropic.Beta;

export type TurnStop = "end_turn" | "max_tokens" | "refusal" | "tool_limit" | "empty" | "paused";

export type TurnResult = {
  /** Messages to append after the user's. Empty means: drop this turn. */
  appended: Beta.BetaMessageParam[];
  stop: TurnStop;
  refusalCategory: string | null;
  /** When the first text delta arrived, or null when none did. */
  firstTokenAt: Date | null;
};

export type TurnArgs = {
  client: Anthropic;
  model: ModelId;
  effort: Effort;
  thinkingDisplay: ThinkingDisplay;
  refusalFallback: boolean;
  system: Beta.BetaTextBlockParam[];
  tools: Beta.BetaToolUnion[];
  /** History plus the new user message. Not modified. */
  messages: Beta.BetaMessageParam[];
  maxOutputTokens: number;
  maxToolRounds: number;
  maxPauseContinuations: number;
  executeTool: (name: string, input: unknown) => Promise<ToolOutcome>;
  onEvent: (event: TurnEvent) => void;
  /** Filled in as each model call completes, so a turn that later throws is still billed. */
  apiCalls: ApiCall[];
  /** Aborts the model call in flight when the participant disconnects. */
  signal?: AbortSignal;
  now?: () => Date;
};

export const TOOL_LIMIT_RESULT = "Tool limit reached for this turn. Answer with what you already have.";

/** The two server tools, after the six client tools (agent-core spec, section 7). */
export const WEB_TOOLS: Beta.BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, citations: { enabled: true }, max_content_tokens: 20000 },
];

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_STREAM_RETRIES = 2;

function dropped(stop: TurnStop, firstTokenAt: Date | null, refusalCategory: string | null = null): TurnResult {
  return { appended: [], stop, refusalCategory, firstTokenAt };
}

/** The event a completed content block produces, or null for blocks nobody sees (text, search hits, code execution). */
export function eventOfBlock(block: Beta.BetaContentBlock): TurnEvent | null {
  switch (block.type) {
    case "thinking":
      return block.thinking ? { type: "thinking", summary: block.thinking } : null;
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "server_tool_use":
      return block.name === "web_search" ? { type: "web_search", query: String((block.input as { query?: unknown }).query ?? "") } : null;
    case "web_search_tool_result":
      return Array.isArray(block.content) ? null : { type: "notice", message: `WEB ERROR: ${block.content.error_code}` };
    case "web_fetch_tool_result":
      if (block.content.type === "web_fetch_tool_result_error") return { type: "notice", message: `WEB ERROR: ${block.content.error_code}` };
      // The page title lives on the nested document block; the URL is the fallback.
      return { type: "web_fetch", url: block.content.url, title: block.content.content.title || block.content.url };
    default:
      return null;
  }
}

function apiCallOf(model: string, message: Beta.BetaMessage, latency_ms: number): ApiCall {
  const usage = message.usage;
  const fallback = usage.iterations?.find((it): it is Beta.BetaFallbackMessageIterationUsage => it.type === "fallback_message");
  return {
    model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
    stop_reason: message.stop_reason,
    latency_ms,
    served_by: fallback ? String(fallback.model) : model,
  };
}

export async function runTurn(args: TurnArgs): Promise<TurnResult> {
  const now = args.now ?? (() => new Date());
  const working = [...args.messages];
  const appended: Beta.BetaMessageParam[] = [];
  const push = (message: Beta.BetaMessageParam) => {
    working.push(message);
    appended.push(message);
  };
  let firstTokenAt: Date | null = null;
  // A listener that throws inside the SDK's stream would surface as a stream
  // error and be retried as if the model call had failed. Never let it throw.
  const announce = (event: TurnEvent) => {
    try {
      args.onEvent(event);
    } catch {
      // The receiver is gone; the turn still has to finish and be billed.
    }
  };

  let rounds = 0; // model calls that carried a client tool call
  let continuations = 0; // pause_turn resumptions
  let streamRetries = 0;

  for (;;) {
    const startedAt = now();
    const stream = args.client.beta.messages.stream(
      {
        model: args.model,
        max_tokens: args.maxOutputTokens,
        system: args.system,
        cache_control: { type: "ephemeral" },
        tools: args.tools,
        messages: working,
        thinking: { type: "adaptive", display: args.thinkingDisplay },
        output_config: { effort: args.effort },
        ...(args.refusalFallback ? { fallbacks: "default" as const, betas: [FALLBACK_BETA] } : {}),
      },
      args.signal ? { signal: args.signal } : undefined,
    );
    stream.on("text", (delta) => {
      firstTokenAt ??= now();
      announce({ type: "text", delta });
    });
    stream.on("contentBlock", (block) => {
      const event = eventOfBlock(block);
      if (event) announce(event);
    });

    let message: Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
    } catch (error) {
      // API errors, including an abort, always propagate. What is left is a
      // broken stream, such as an eager tool input that is not valid JSON;
      // that is worth re-issuing a couple of times.
      if (error instanceof Anthropic.APIError || streamRetries >= MAX_STREAM_RETRIES) throw error;
      streamRetries++;
      continue;
    }
    streamRetries = 0;
    args.apiCalls.push(apiCallOf(args.model, message, Math.max(0, now().getTime() - startedAt.getTime())));

    if (message.stop_reason === "refusal") return dropped("refusal", firstTokenAt, message.stop_details?.category ?? null);
    if (message.content.length === 0) return dropped("empty", firstTokenAt);
    const toolUses = message.content.filter((block): block is Beta.BetaToolUseBlock => block.type === "tool_use");
    // A tool call cut off by the length limit can parse as a valid partial input.
    if (message.stop_reason === "max_tokens" && toolUses.length > 0) return dropped("max_tokens", firstTokenAt);

    // The response blocks go back verbatim; the param type is wider in places and narrower in others.
    push({ role: "assistant", content: message.content as unknown as Beta.BetaContentBlockParam[] });
    const paused = message.stop_reason === "pause_turn";
    if (paused && continuations >= args.maxPauseContinuations) return dropped("paused", firstTokenAt);
    if (paused) continuations++;

    if (toolUses.length === 0) {
      if (paused) continue;
      return { appended, stop: message.stop_reason === "max_tokens" ? "max_tokens" : "end_turn", refusalCategory: null, firstTokenAt };
    }

    // Tools run on the first maxToolRounds rounds. One further round tells the
    // model the limit was reached, one more lets it answer, then the turn is dropped.
    // A paused message that also called a tool is answered first, so history
    // never holds a tool_use without its result.
    rounds++;
    const overLimit = rounds > args.maxToolRounds;
    const results: Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      if (overLimit) {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: TOOL_LIMIT_RESULT });
        continue;
      }
      const outcome = await args.executeTool(use.name, use.input);
      const payload = outcome.payload ?? { kind: "tool_error" as const, message: outcome.content };
      announce({ type: "tool_result", id: use.id, name: use.name, ok: !outcome.isError, payload });
      results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) });
    }
    push({ role: "user", content: results });
    if (rounds >= args.maxToolRounds + 2) return dropped("tool_limit", firstTokenAt);
  }
}
```

If `tsc` rejects the `fallbacks`/`betas` spread or the `thinking` object against `BetaMessageStreamParams`, read `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts` for the exact field names (`fallbacks?: BetaFallbacksParam | null` where `BetaFallbacksParam = Array<BetaFallbackParam> | 'default'`; `betas?: Array<AnthropicBeta>`; `thinking: BetaThinkingConfigAdaptive = { type: 'adaptive'; display?: 'summarized' | 'omitted' | 'updates' | null }`) and adjust the literal, not the request shape.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix web test -- tests/chat/runTurn`
Expected: PASS (13 tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: clean.

```bash
git add web/lib/chat/runTurn.ts web/tests/chat/helpers.ts web/tests/chat/runTurn.test.ts
git commit -m "feat(chat): runTurn streams the beta messages loop with server tools, pauses, and per-call usage"
```

---
### Task 6: `handleChat`, one request end to end

**Files:**
- Create: `web/lib/chat/handleChat.ts`
- Test: `web/tests/chat/handleChat.test.ts`

**Interfaces:**
- Consumes: `parseChatRequest` (Task 1); `createEventSink`, `blockOf`, `ChatStreamEvent`, `TurnEvent` (Task 3); the stores and `scenarioToJson`, `titleFrom`, `FinishTurnPayload`, `StepEventJson`, `StoredStop`, `ApiCall` (Task 4); `runTurn`, `WEB_TOOLS`, `TurnStop` (Task 5); Plan A's `TOOLS`, `executeTool`, `emptyScenario`, `ToolDeps`, `systemBlocks`, `firstUserMessage`, `parseNext`, `advanceStage`; `costUsd`, `repairCostUsd` (`lib/models.ts`); `capMessage`, `UsageStore`, `TurnReservation` (`lib/usage.ts`); `easternDay`, `easternMonthStart` (`lib/time.ts`); `makeDeps` (`tests/tools/helpers.ts`) and Task 5's `tests/chat/helpers.ts`.
- Produces:
  ```ts
  export type ChatDeps = {
    settings: Settings; client: Anthropic; usage: UsageStore; conversations: ConversationStore; messages: MessageStore; scenarios: ScenarioStore;
    turns: TurnStore; runs: RunStore; sim: SimClient; adapters: Adapters; now: () => Date; newId: () => string;
  };
  export const UNAVAILABLE: string; export const CONVERSATION_INVALID: string; export const CONVERSATION_NOT_FOUND: string; export const CUT_OFF_NOTICE: string;
  export const DISCARD_MESSAGES: Record<Exclude<TurnStop, "end_turn">, string>;
  export async function handleChat(deps: ChatDeps, user: { id: string }, rawBody: string, emit: (event: ChatStreamEvent) => void, signal?: AbortSignal): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/chat/handleChat.test.ts
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatStreamEvent } from "@/lib/chat/events";
import { CONVERSATION_INVALID, CUT_OFF_NOTICE, DISCARD_MESSAGES, UNAVAILABLE, handleChat, type ChatDeps } from "@/lib/chat/handleChat";
import { systemBlocks } from "@/lib/chat/prompt";
import { loadSettings } from "@/lib/config";
import type { ConversationRow, ConversationStore } from "@/lib/db/conversations";
import type { MessageStore } from "@/lib/db/messages";
import type { RunInsert, RunStore } from "@/lib/db/runs";
import type { ScenarioStore } from "@/lib/db/scenarios";
import type { FinishTurnPayload, TurnStore } from "@/lib/db/turns";
import type { SimClient, SimResult } from "@/lib/sim/client";
import { emptyScenario, type Scenario } from "@/lib/tools/types";
import type { TurnReservation, UsageDelta, UsageStore } from "@/lib/usage";
import { makeDeps, params } from "../tools/helpers";
import { fakeClient, fetchResult, message, searchResult, serverSearch, textBlock, toolUse, type Step } from "./helpers";

const USER = { id: "11111111-1111-1111-1111-111111111111" };
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const TURN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const HISTORY: Anthropic.Beta.BetaMessageParam[] = [
  { role: "user", content: "Today's date: 2026-10-04.\n\nModel measles in Kenya" },
  { role: "assistant", content: [{ type: "text", text: "Configured." }] },
];
const STATS = { peak_infections: 9, peak_day: 40, total_infected: 400, total_deaths: 1, n_agents: 10000, sim_days: 365 };
const SUCCESS: SimResult = {
  ok: true, effective_params: params({}), population: 10000, stats: STATS, stats_agents: STATS, series: { day: [0, 1], n_infected: [1, 2] },
  pop_scale: 1, repairs: [], attempts: 1, duration_ms: 6800, cold_start: false, starsim_version: "3.3.2",
};
const HELLO = { text: "Model measles in Kenya" };
const ANSWER = message([textBlock("Sure.\n\n```next\nConfigure measles\nFetch Kenya data\n```")]);
const CONFIGURE = message([toolUse("tu_1", "configure_simulation", { disease: "measles", r0: 12 })], "tool_use");
const RUN = message([toolUse("tu_2", "run_simulation", {})], "tool_use");

function clock() {
  let t = Date.parse("2026-10-05T16:00:00Z");
  return () => new Date((t += 1000));
}

function configured(): Scenario {
  return { ...emptyScenario(), id: "s1", params: params({ n_agents: 10000 }), disease: "measles", stage: "configure", stageReached: "configure" };
}

type Over = {
  reservation?: TurnReservation; conversation?: ConversationRow | null; history?: Anthropic.Beta.BetaMessageParam[]; scenario?: Scenario | null;
  texts?: string[]; finishError?: Error; runError?: Error; loadError?: Error; simulate?: SimResult | Error;
};

function setup(script: Step[], over: Over = {}, env: Record<string, string> = {}) {
  const { client, requests, requestOptions } = fakeClient(script);
  const calls = {
    reservations: [] as unknown[][], records: [] as [string, string, UsageDelta][], created: [] as [string, string][],
    gets: [] as [string, string][], finished: [] as FinishTurnPayload[], runs: [] as RunInsert[], simulated: [] as { popScale: number; contextText: string }[],
  };
  const usage: UsageStore = {
    async reserveTurn(userId, day, monthStart, limits) { calls.reservations.push([userId, day, monthStart, limits]); return over.reservation ?? "ok"; },
    async record(userId, day, delta) { calls.records.push([userId, day, delta]); },
  };
  const conversations: ConversationStore = {
    async create(userId, title) { calls.created.push([userId, title]); return CONVERSATION; },
    async get(id, userId) {
      if (over.loadError) throw over.loadError;
      calls.gets.push([id, userId]);
      return over.conversation === undefined ? { id, title: "T", activeScenarioId: over.scenario ? "s1" : null } : over.conversation;
    },
    async softDelete() { return true; },
  };
  const messages: MessageStore = { async list() { return over.history ?? []; } };
  const scenarios: ScenarioStore = { async get() { return over.scenario ?? null; } };
  const turns: TurnStore = {
    async finishTurn(payload) { if (over.finishError) throw over.finishError; calls.finished.push(structuredClone(payload)); return "s1"; },
    async userTexts() { return over.texts ?? []; },
    async listForReplay() { return []; },
  };
  const runs: RunStore = { async insert(run) { if (over.runError) throw over.runError; calls.runs.push(run); return "run-1"; } };
  const sim: SimClient = {
    async simulate(_params, popScale, contextText) {
      calls.simulated.push({ popScale, contextText });
      if (over.simulate instanceof Error) throw over.simulate;
      return over.simulate ?? SUCCESS;
    },
    async demographicsFallback() { return null; },
  };
  const deps: ChatDeps = {
    settings: loadSettings(env), client, usage, conversations, messages, scenarios, turns, runs, sim,
    adapters: makeDeps().adapters, now: clock(), newId: () => TURN,
  };
  const emitted: ChatStreamEvent[] = [];
  const run = (body: unknown, signal?: AbortSignal) =>
    handleChat(deps, USER, typeof body === "string" ? body : JSON.stringify(body), (event) => emitted.push(event), signal);
  return { run, deps, emitted, requests, requestOptions, ...calls };
}

afterEach(() => vi.restoreAllMocks());

describe("handleChat", () => {
  it("answers a first message: creates the conversation, dates the first message, streams, stores the turn, and records usage", async () => {
    const { run, emitted, requests, created, finished, records, reservations } = setup([{ message: ANSWER, text: ["Sure.", "\n\n```next\nConfigure measles\nFetch Kenya data\n```"] }]);
    await run({ ...HELLO, sessionId: SESSION });

    expect(reservations).toEqual([[USER.id, "2026-10-05", "2026-10-01", { dailyTurns: 40, monthlyBudgetUsd: 50 }]]);
    expect(created).toEqual([[USER.id, "Model measles in Kenya"]]);
    const userMessage = { role: "user", content: "Today's date: 2026-10-05.\n\nModel measles in Kenya" };
    expect(requests[0].messages).toEqual([userMessage]);
    expect(requests[0].system).toEqual(systemBlocks());
    expect((requests[0].tools as { name: string }[]).map((tool) => tool.name)).toEqual([
      "configure_simulation", "lookup_disease", "fetch_demographics", "fetch_health_system", "fetch_vaccination_coverage", "run_simulation", "web_search", "web_fetch",
    ]);
    expect(emitted).toEqual([
      { type: "text", delta: "Sure." },
      { type: "text", delta: "\n\n```next\nConfigure measles\nFetch Kenya data\n```" },
      { type: "suggestions", items: ["Configure measles", "Fetch Kenya data"] },
      { type: "done", turnId: TURN, conversationId: CONVERSATION, notice: null },
    ]);

    expect(finished).toHaveLength(1);
    const payload = finished[0];
    expect(payload).toMatchObject({ user_id: USER.id, conversation_id: CONVERSATION, title: "Model measles in Kenya" });
    expect(payload.turn).toMatchObject({
      id: TURN, session_id: SESSION, user_text: "Model measles in Kenya", stop: "end_turn", refusal_category: null, model: "claude-opus-5-5", effort: "medium",
      input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0, stage_before: "understand", stage_after: "understand",
    });
    expect(payload.turn.started_at).toBe("2026-10-05T16:00:01.000Z");
    expect(payload.turn.first_token_at).not.toBeNull();
    expect(payload.turn.cost_usd).toBeCloseTo(0.0008, 10);
    expect(payload.turn.api_calls[0]).toMatchObject({ model: "claude-opus-5-5", input_tokens: 100, stop_reason: "end_turn", served_by: "claude-opus-5-5" });
    expect(payload.events.map((e) => e.kind)).toEqual(["text", "suggestions"]);
    expect(payload.events[0]).toMatchObject({ seq: 1, text: "Sure." });
    expect(payload.messages).toEqual([userMessage, { role: "assistant", content: ANSWER.content }]);
    expect(payload.scenario).toMatchObject({ id: null, seq: 1, params: null, stage: "understand", has_run: false });
    expect(payload.step_events.map((e) => e.kind)).toEqual(["conversation_started", "turn"]);
    expect(payload.step_events[0]).toMatchObject({ session_id: SESSION, stage: "understand" });
    expect(payload.step_events[1].meta).toMatchObject({ stop: "end_turn", api_calls: 1, tool_calls: 0 });

    expect(records).toHaveLength(1);
    expect(records[0][0]).toBe(USER.id);
    expect(records[0][1]).toBe("2026-10-05");
    expect(records[0][2]).toMatchObject({ turns: 0, inputTokens: 100, outputTokens: 20 });
    expect(records[0][2].costUsd).toBeCloseTo(0.0008, 10);
  });

  it("continues a conversation: history first, no date line, no title, no conversation_started", async () => {
    const { run, requests, gets, created, finished } = setup([{ message: message([textBlock("Running.")]) }], { history: HISTORY, texts: ["Model measles in Kenya"] });
    await run({ conversationId: CONVERSATION, text: "Run it" });
    expect(gets).toEqual([[CONVERSATION, USER.id]]);
    expect(created).toEqual([]);
    expect(requests[0].messages).toEqual([...HISTORY, { role: "user", content: "Run it" }]);
    expect(finished[0].title).toBeNull();
    expect(finished[0].step_events.map((e) => e.kind)).toEqual(["turn"]);
  });

  it("treats an empty suggestions block as no suggestions", async () => {
    const { run, emitted, finished } = setup([{ message: message([textBlock("Done.\n\n```next\n\n```")]), text: ["Done.\n\n```next\n\n```"] }]);
    await run(HELLO);
    expect(emitted.some((e) => e.type === "suggestions")).toBe(false);
    expect(finished[0].events.map((e) => e.kind)).toEqual(["text"]);
    expect(finished[0].events[0]).toMatchObject({ text: "Done." });
  });

  it("stops before the model on a cap, a bad request, an unknown or deleted conversation, and a store failure", async () => {
    const budget = setup([{ message: ANSWER }], { reservation: "monthly_budget" });
    await budget.run(HELLO);
    expect(budget.emitted).toEqual([{ type: "error", code: "monthly_budget", message: expect.stringMatching(/this month/) }]);
    expect(budget.requests).toEqual([]);
    expect(budget.records).toEqual([]);
    expect(budget.finished).toEqual([]);

    const daily = setup([{ message: ANSWER }], { reservation: "daily_turns" });
    await daily.run(HELLO);
    expect(daily.emitted[0]).toMatchObject({ type: "error", code: "daily_turns", message: expect.stringMatching(/40/) });

    const bad = setup([{ message: ANSWER }]);
    await bad.run("not json");
    expect(bad.emitted[0]).toMatchObject({ type: "error", code: "bad_request" });
    expect(bad.reservations).toEqual([]);

    const gone = setup([{ message: ANSWER }], { conversation: null });
    await gone.run({ conversationId: CONVERSATION, text: "Run it" });
    expect(gone.emitted).toEqual([{ type: "error", code: "conversation_not_found", message: expect.stringMatching(/no longer available/) }]);
    expect(gone.requests).toEqual([]);

    const noReserve = setup([{ message: ANSWER }]);
    noReserve.deps.usage.reserveTurn = async () => { throw new Error("database down"); };
    await noReserve.run(HELLO);
    expect(noReserve.emitted).toEqual([{ type: "error", code: "service_unavailable", message: UNAVAILABLE }]);

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const noLoad = setup([{ message: ANSWER }], { loadError: new Error("database down") });
    await noLoad.run({ conversationId: CONVERSATION, text: "Run it" });
    expect(noLoad.emitted).toEqual([{ type: "error", code: "service_unavailable", message: UNAVAILABLE }]);
    expect(noLoad.requests).toEqual([]);
    expect(logged).toHaveBeenCalled();
  });

  it("runs a tool round: the tool events and the stage change stream in order, the scenario is saved, the steps are counted", async () => {
    const { run, emitted, finished } = setup([{ message: CONFIGURE }, { message: message([textBlock("Configured measles.")]), text: ["Configured measles."] }]);
    await run(HELLO);
    expect(emitted.map((e) => e.type)).toEqual(["tool_use", "tool_result", "stage", "text", "done"]);
    expect(emitted[1]).toMatchObject({ type: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: { kind: "config", approx_r0: 12 } });
    expect(emitted[2]).toEqual({ type: "stage", stage: "configure" });

    const payload = finished[0];
    expect(payload.events.map((e) => e.kind)).toEqual(["tool_use", "tool_result", "stage", "text"]);
    expect((payload.events[1] as { payload: { duration_ms?: number } }).payload.duration_ms).toBe(1000);
    expect(payload.messages).toHaveLength(4);
    expect(payload.scenario).toMatchObject({ id: null, seq: 1, disease: "measles", stage: "configure", stage_reached: "configure", has_run: false });
    expect((payload.scenario.params as { n_agents: number }).n_agents).toBeGreaterThan(0);
    expect(payload.turn).toMatchObject({ stage_before: "understand", stage_after: "configure", input_tokens: 200, output_tokens: 40 });
    expect(payload.step_events.map((e) => [e.kind, e.tool, e.stage])).toEqual([
      ["conversation_started", null, "understand"], ["tool_called", "configure_simulation", "understand"], ["stage_reached", null, "configure"], ["turn", null, "configure"],
    ]);
    expect(payload.step_events[1].meta).toEqual({ duration_ms: 1000 });
    expect(payload.step_events[3].meta).toMatchObject({ tool_calls: 1, api_calls: 2 });
  });

  it("records a failed tool as tool_failed and keeps going", async () => {
    const { run, emitted, finished } = setup([{ message: RUN }, { message: message([textBlock("Configure first.")]) }]);
    await run(HELLO);
    expect(emitted[1]).toMatchObject({ type: "tool_result", ok: false, payload: { kind: "tool_error" } });
    expect(finished[0].step_events.map((e) => e.kind)).toEqual(["conversation_started", "tool_failed", "turn"]);
    expect(emitted.at(-1)?.type).toBe("done");
  });

  it("runs the simulation: the run row carries the turn id, the stage passes through run to interpret, and the context has no date line", async () => {
    const { run, emitted, finished, runs, simulated, records } = setup(
      [{ message: RUN }, { message: message([textBlock("Peak on day 40.")]), text: ["Peak on day 40."] }],
      { history: HISTORY, texts: ["Model measles in Kenya"], scenario: configured() },
    );
    await run({ conversationId: CONVERSATION, sessionId: SESSION, text: "Run it" });
    expect(simulated).toEqual([{ popScale: 1, contextText: "Model measles in Kenya Run it" }]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ conversationId: CONVERSATION, userId: USER.id, turnId: TURN, scenarioId: "s1" });
    expect(runs[0].record.result).toEqual(SUCCESS);
    expect(emitted.map((e) => e.type)).toEqual(["tool_use", "stage", "tool_result", "stage", "text", "done"]);
    expect(emitted[1]).toEqual({ type: "stage", stage: "run" });
    expect(emitted[3]).toEqual({ type: "stage", stage: "interpret" });
    expect(emitted[2]).toMatchObject({ type: "tool_result", ok: true, payload: { kind: "run", run_id: "run-1", series: { day: [0, 1] } } });

    const payload = finished[0];
    const stored = payload.events[2] as { payload: Record<string, unknown> };
    expect(stored.payload.kind).toBe("run");
    expect("series" in stored.payload).toBe(false);
    expect(payload.scenario).toMatchObject({ id: "s1", has_run: true, stage: "interpret", stage_reached: "interpret" });
    expect(payload.turn).toMatchObject({ stage_before: "configure", stage_after: "interpret" });
    expect(payload.step_events.map((e) => e.kind)).toEqual(["stage_reached", "run_completed", "tool_called", "stage_reached", "turn"]);
    expect(payload.step_events[1]).toMatchObject({ tool: "run_simulation", stage: "run", meta: { duration_ms: 6800, cold_start: false, n_agents: 10000, repairs: 0 } });
    expect(records[0][2].costUsd).toBeCloseTo(0.0016, 10);
  });

  it("adds the sim's repair tokens to the cost, and keeps the run when its row cannot be inserted", async () => {
    const repaired: SimResult = { ...SUCCESS, repairs: [{ attempt: 1, error: "beta too high", changes: [], usage: { model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 100 } }] };
    const { run, finished, records } = setup([{ message: RUN }, { message: message([textBlock("Repaired and run.")]) }], { history: HISTORY, scenario: configured(), simulate: repaired });
    await run({ conversationId: CONVERSATION, text: "Run it" });
    // 2 calls at 0.0008 each, plus 1000 × 4 + 100 × 20 per million for the repair.
    expect(records[0][2].costUsd).toBeCloseTo(0.0016 + 0.006, 10);
    expect(finished[0].turn.cost_usd).toBeCloseTo(0.0076, 10);

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const noRow = setup([{ message: RUN }, { message: message([textBlock("Ran.")]) }], { history: HISTORY, scenario: configured(), runError: new Error("down") });
    await noRow.run({ conversationId: CONVERSATION, text: "Run it" });
    expect(noRow.emitted.at(-1)?.type).toBe("done");
    expect(noRow.emitted[2]).toMatchObject({ type: "tool_result", ok: true, payload: { run_id: null } });
    expect(logged).toHaveBeenCalled();
  });

  it("records a failed simulation as run_failed with the run row's error", async () => {
    const failure: SimResult = { ok: false, status: 504, kind: "timeout", detail: "The simulation timed out after 120 seconds.", repairs: [], attempts: 1, seconds: 120 };
    const { run, emitted, finished, runs } = setup([{ message: RUN }, { message: message([textBlock("It timed out.")]) }], { history: HISTORY, scenario: configured(), simulate: failure });
    await run({ conversationId: CONVERSATION, text: "Run it" });
    expect(runs[0].record.result).toEqual(failure);
    expect(emitted[2]).toMatchObject({ type: "tool_result", ok: false, payload: { kind: "tool_error", message: expect.stringMatching(/^SIMULATION ERROR: The simulation timed out/) } });
    expect(finished[0].step_events.map((e) => e.kind)).toEqual(["stage_reached", "run_failed", "tool_failed", "turn"]);
    expect(finished[0].step_events[1].meta).toEqual({ kind: "timeout", repairs: 0 });
    expect(finished[0].scenario).toMatchObject({ has_run: false, stage: "configure" });
  });

  it("drops a refused turn with the Python message, counts the refusal, stores the turn without messages, and still bills it", async () => {
    const refusal = message([], "refusal", { stop_details: { type: "refusal", category: "bio", explanation: null } });
    const { run, emitted, finished, records } = setup([{ message: refusal }]);
    await run(HELLO);
    expect(emitted).toEqual([{ type: "discard", message: DISCARD_MESSAGES.refusal }]);
    expect(DISCARD_MESSAGES.refusal).toBe("I'm unable to help with that request. Let's get back to epidemic simulations — what would you like to model?");
    expect(finished[0].turn).toMatchObject({ stop: "refusal", refusal_category: "bio" });
    expect(finished[0].messages).toBeNull();
    expect(finished[0].step_events).toContainEqual(expect.objectContaining({ kind: "refusal", meta: { category: "bio" } }));
    expect(records).toHaveLength(1);
  });

  it("shows the paused message when continuations run out, and the other discard messages", async () => {
    const paused = setup([{ message: message([serverSearch("st_1", "q"), searchResult("st_1", 1)], "pause_turn") }], {}, { MAX_PAUSE_CONTINUATIONS: "0" });
    await paused.run(HELLO);
    expect(paused.emitted.at(-1)).toEqual({ type: "discard", message: "That search ran longer than I can continue in one turn. Ask me again and I'll pick it up." });
    expect(paused.finished[0].turn.stop).toBe("paused");
    expect(paused.finished[0].messages).toBeNull();

    const empty = setup([{ message: message([]) }]);
    await empty.run(HELLO);
    expect(empty.emitted).toEqual([{ type: "discard", message: "No reply came back. Please try again." }]);

    const limited = setup([{ message: CONFIGURE }], {}, { MAX_TOOL_ROUNDS: "1" });
    await limited.run(HELLO);
    expect(limited.emitted.at(-1)).toEqual({ type: "discard", message: "That needed more steps than one message allows. Try a narrower question." });
    expect(limited.finished[0].turn.stop).toBe("tool_limit");

    const cut = setup([{ message: message([toolUse("tu_1", "configure_simulation", { disease: "mea" })], "max_tokens") }]);
    await cut.run(HELLO);
    expect(cut.emitted.at(-1)).toEqual({ type: "discard", message: "That reply ran past the length limit before it finished. Try asking for less at once." });
  });

  it("marks a reply that hit the length limit", async () => {
    const { run, emitted } = setup([{ message: message([textBlock("Cut")], "max_tokens") }]);
    await run(HELLO);
    expect(emitted.at(-1)).toEqual({ type: "done", turnId: TURN, conversationId: CONVERSATION, notice: CUT_OFF_NOTICE });
  });

  it("records an aborted turn without appending messages and still records usage", async () => {
    const controller = new AbortController();
    controller.abort();
    const { run, emitted, finished, runs, records } = setup(
      [{ message: RUN }, { error: new Anthropic.APIUserAbortError() }],
      { history: HISTORY, scenario: configured() },
    );
    await run({ conversationId: CONVERSATION, text: "Run it" }, controller.signal);
    expect(runs).toHaveLength(1);
    expect(finished[0].turn.stop).toBe("aborted");
    expect(finished[0].messages).toBeNull();
    expect(finished[0].events.map((e) => e.kind)).toEqual(["tool_use", "stage", "tool_result", "stage"]);
    expect(emitted.map((e) => e.type)).toEqual(["tool_use", "stage", "tool_result", "stage"]);
    expect(records).toHaveLength(1);
    expect(records[0][2].inputTokens).toBe(100);
  });

  it("asks for a new conversation when the API rejects the history, and reports other failures as unavailable, keeping the turn as an error", async () => {
    const rejected = setup([{ error: new Anthropic.BadRequestError(400, undefined, "invalid history", new Headers()) }], { history: HISTORY });
    await rejected.run({ conversationId: CONVERSATION, text: "Run it" });
    expect(rejected.emitted).toEqual([{ type: "error", code: "conversation_invalid", message: CONVERSATION_INVALID }]);
    expect(rejected.finished[0].turn).toMatchObject({ stop: "error", input_tokens: 0 });
    expect(rejected.finished[0].messages).toBeNull();
    expect(rejected.records).toHaveLength(1);

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const down = setup([{ message: CONFIGURE }, { error: new Anthropic.APIError(529, undefined, "overloaded", new Headers()) }]);
    await down.run(HELLO);
    expect(down.emitted.at(-1)).toEqual({ type: "error", code: "service_unavailable", message: UNAVAILABLE });
    expect(down.finished[0].turn).toMatchObject({ stop: "error", input_tokens: 100 });
    expect(down.finished[0].events.map((e) => e.kind)).toEqual(["tool_use", "tool_result", "stage"]);
    expect(down.finished[0].scenario).toMatchObject({ disease: "measles" });
    expect(logged).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).not.toContain("measles");
  });

  it("answers service_unavailable when the turn cannot be stored, and still records usage", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { run, emitted, records } = setup([{ message: ANSWER }], { finishError: new Error("db down") });
    await run(HELLO);
    expect(emitted.at(-1)).toEqual({ type: "error", code: "service_unavailable", message: UNAVAILABLE });
    expect(records).toHaveLength(1);
  });

  it("records a fetched page once, and web events as steps", async () => {
    const content = [
      serverSearch("st_1", "measles Kenya"), searchResult("st_1", 2),
      fetchResult("st_2", "https://www.who.int/measles", "Measles"), fetchResult("st_3", "https://www.who.int/measles", null),
      textBlock("Found it."),
    ];
    const { run, emitted, finished } = setup([{ message: message(content), text: ["Found it."] }]);
    await run(HELLO);
    expect(emitted.filter((e) => e.type === "web_search" || e.type === "web_fetch")).toHaveLength(3);
    expect(finished[0].scenario.web_sources).toEqual([{ title: "Measles", url: "https://www.who.int/measles" }]);
    expect(finished[0].step_events.map((e) => e.kind)).toEqual(["conversation_started", "web_search", "web_fetch", "web_fetch", "turn"]);
  });

  it("still answers when usage cannot be recorded, and leaves a text-free log line", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { run, deps, emitted } = setup([{ message: ANSWER }]);
    deps.usage.record = async () => { throw new Error("database down"); };
    await expect(run(HELLO)).resolves.toBeUndefined();
    expect(emitted.at(-1)?.type).toBe("done");
    expect(logged).toHaveBeenCalledWith("usage record failed");
  });

  it("finishes quietly and stores the turn when the participant has gone away", async () => {
    const { client, requests } = fakeClient([{ message: ANSWER, text: ["Sure."] }]);
    const base = setup([{ message: ANSWER }]);
    const deps: ChatDeps = { ...base.deps, client };
    const closed = () => { throw new Error("Invalid state: Controller is already closed"); };
    await expect(handleChat(deps, USER, JSON.stringify(HELLO), closed)).resolves.toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(base.finished).toHaveLength(1);
    expect(base.records[0][2]).toMatchObject({ inputTokens: 100, outputTokens: 20 });
  });

  it("passes the abort signal through to the model call", async () => {
    const controller = new AbortController();
    const { run, requestOptions } = setup([{ message: ANSWER }]);
    await run(HELLO, controller.signal);
    expect(requestOptions).toEqual([{ signal: controller.signal }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix web test -- tests/chat/handleChat`
Expected: cannot resolve `@/lib/chat/handleChat`.

- [ ] **Step 3: Implement**

```ts
// web/lib/chat/handleChat.ts
/**
 * One chat request end to end (agent-core spec, section 9): parse, reserve a
 * turn against the caps, open or load the conversation, run the turn through
 * the event sink, post-process (suggestions, final stage, usage totals),
 * write everything with finish_turn, answer done or discard, and record usage
 * in `finally`. Never throws, even if `emit` does.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Settings } from "@/lib/config";
import type { Adapters } from "@/lib/data/types";
import { titleFrom, type ConversationStore } from "@/lib/db/conversations";
import type { MessageStore } from "@/lib/db/messages";
import type { RunStore } from "@/lib/db/runs";
import { scenarioToJson, type ScenarioStore } from "@/lib/db/scenarios";
import type { ApiCall, FinishTurnPayload, StepEventJson, StoredStop, TurnStore } from "@/lib/db/turns";
import type { StepEventKind } from "@/lib/enums";
import { costUsd, repairCostUsd } from "@/lib/models";
import type { SimClient } from "@/lib/sim/client";
import { easternDay, easternMonthStart } from "@/lib/time";
import { TOOLS, executeTool } from "@/lib/tools";
import { emptyScenario, type Scenario, type ToolDeps } from "@/lib/tools/types";
import { capMessage, type TurnReservation, type UsageStore } from "@/lib/usage";
import { blockOf, createEventSink, type ChatStreamEvent, type TurnEvent } from "./events";
import { parseNext } from "./next";
import { firstUserMessage, systemBlocks } from "./prompt";
import { parseChatRequest } from "./request";
import { WEB_TOOLS, runTurn, type TurnStop } from "./runTurn";
import { advanceStage } from "./stages";

export type ChatDeps = {
  settings: Settings;
  client: Anthropic;
  usage: UsageStore;
  conversations: ConversationStore;
  messages: MessageStore;
  scenarios: ScenarioStore;
  turns: TurnStore;
  runs: RunStore;
  sim: SimClient;
  adapters: Adapters;
  now: () => Date;
  newId: () => string;
};

// The Python agent's texts for a technical failure, a refusal, and an
// exhausted pause; CampusOtter's for the rest.
export const UNAVAILABLE = "Something went wrong while processing that (a technical error, not a problem with your request). Please try again — the conversation is intact.";
export const CONVERSATION_INVALID = "This conversation can no longer be continued. Please start a new one.";
export const CONVERSATION_NOT_FOUND = "That conversation is no longer available. Please start a new one.";
export const CUT_OFF_NOTICE = "This reply reached the length limit and was cut off. Ask me to continue.";
export const DISCARD_MESSAGES: Record<Exclude<TurnStop, "end_turn">, string> = {
  refusal: "I'm unable to help with that request. Let's get back to epidemic simulations — what would you like to model?",
  paused: "That search ran longer than I can continue in one turn. Ask me again and I'll pick it up.",
  tool_limit: "That needed more steps than one message allows. Try a narrower question.",
  max_tokens: "That reply ran past the length limit before it finished. Try asking for less at once.",
  empty: "No reply came back. Please try again.",
};

type Message = Anthropic.Beta.BetaMessageParam;

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleChat(
  deps: ChatDeps,
  user: { id: string },
  rawBody: string,
  emit: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const send = (event: ChatStreamEvent) => {
    try {
      emit(event);
    } catch {
      // Nobody is listening any more. Finish the bookkeeping regardless.
    }
  };

  const parsed = parseChatRequest(rawBody, deps.settings);
  if (!parsed.ok) {
    send({ type: "error", code: parsed.problem.code, message: parsed.problem.message });
    return;
  }
  const request = parsed.request;

  const startedAt = deps.now();
  const day = easternDay(startedAt);
  let reservation: TurnReservation;
  try {
    reservation = await deps.usage.reserveTurn(user.id, day, easternMonthStart(startedAt), {
      dailyTurns: deps.settings.dailyTurnsPerUser,
      monthlyBudgetUsd: deps.settings.monthlyBudgetUsd,
    });
  } catch {
    send({ type: "error", code: "service_unavailable", message: UNAVAILABLE });
    return;
  }
  if (reservation !== "ok") {
    send({ type: "error", code: reservation, message: capMessage(reservation, deps.settings) });
    return;
  }

  // The conversation and its state. A failure here is a service failure:
  // nothing has run, so nothing is written.
  const scenario: Scenario = emptyScenario();
  const stepEvents: StepEventJson[] = [];
  const step = (kind: StepEventKind, extra: Partial<StepEventJson> = {}) =>
    stepEvents.push({ kind, session_id: request.sessionId, stage: scenario.stage, tool: null, meta: {}, ...extra });
  let conversationId: string;
  let title: string | null = null;
  let history: Message[] = [];
  let earlierTexts: string[] = [];
  try {
    if (request.conversationId) {
      const found = await deps.conversations.get(request.conversationId, user.id);
      if (!found) {
        send({ type: "error", code: "conversation_not_found", message: CONVERSATION_NOT_FOUND });
        return;
      }
      conversationId = found.id;
      const saved = found.activeScenarioId ? await deps.scenarios.get(found.activeScenarioId) : null;
      if (saved) Object.assign(scenario, saved);
      [history, earlierTexts] = await Promise.all([deps.messages.list(conversationId), deps.turns.userTexts(conversationId)]);
    } else {
      title = titleFrom(request.text);
      conversationId = await deps.conversations.create(user.id, title);
      step("conversation_started");
    }
  } catch (error) {
    // These log lines carry no request content.
    console.error("chat could not load the conversation", failureText(error));
    send({ type: "error", code: "service_unavailable", message: UNAVAILABLE });
    return;
  }

  const turnId = deps.newId();
  const stageBefore = scenario.stage;
  const contextText = [...earlierTexts, request.text].join(" ").trim();
  const userMessage: Message = { role: "user", content: history.length === 0 ? firstUserMessage(day, request.text) : request.text };
  const sink = createEventSink(send, deps.now);
  const apiCalls: ApiCall[] = [];
  let repairCost = 0;

  /** Re-derive the stage; stream it when it changed, count it when it is newly reached. */
  const advance = (running = false) => {
    const { stage, changed, reached } = advanceStage(scenario, running);
    if (changed) sink.block({ kind: "stage", stage });
    if (reached) step("stage_reached", { stage: reached });
  };

  const toolDeps: ToolDeps = {
    scenario,
    sim: deps.sim,
    adapters: deps.adapters,
    contextText,
    turnId,
    async onRun(record) {
      // A run is a fact: counted and inserted as soon as it finishes, whatever the turn does later.
      for (const repair of record.result.repairs) if (repair.usage) repairCost += repairCostUsd(repair.usage);
      if (record.result.ok) {
        step("run_completed", { tool: "run_simulation", meta: { duration_ms: record.result.duration_ms, cold_start: record.result.cold_start, n_agents: record.params.n_agents, sim_dur_years: record.params.sim_dur_years, repairs: record.result.repairs.length } });
      } else {
        step("run_failed", { tool: "run_simulation", meta: { kind: record.result.kind, repairs: record.result.repairs.length } });
      }
      try {
        return await deps.runs.insert({ conversationId, userId: user.id, turnId, scenarioId: scenario.id, record });
      } catch (error) {
        console.error("runs insert failed", failureText(error));
        return null;
      }
    },
    onScenarioStart() {
      step("new_scenario");
    },
  };

  const runTool = async (name: string, input: unknown) => {
    const outcome = await executeTool(name, input, toolDeps, () => deps.now().getTime());
    step(outcome.isError ? "tool_failed" : "tool_called", { tool: name, meta: { duration_ms: outcome.payload?.duration_ms ?? 0 } });
    return outcome;
  };

  const onEvent = (event: TurnEvent) => {
    if (event.type === "text") {
      sink.text(event.delta);
      return;
    }
    sink.block(blockOf(event));
    switch (event.type) {
      case "tool_use":
        // The stage is "run" while the simulation runs; a call that cannot run (no params) never gets there.
        if (event.name === "run_simulation" && scenario.params) advance(true);
        break;
      case "tool_result":
        advance();
        break;
      case "web_search":
        step("web_search");
        break;
      case "web_fetch":
        step("web_fetch");
        if (!scenario.webSources.some((source) => source.url === event.url)) scenario.webSources.push({ title: event.title, url: event.url });
        break;
    }
  };

  let stop: StoredStop = "error";
  let refusalCategory: string | null = null;
  let firstTokenAt: Date | null = null;
  let messages: Message[] | null = null;
  // The last event, sent only once the turn is stored. Null when the participant is gone.
  let outcome: ChatStreamEvent | null = null;
  try {
    const result = await runTurn({
      client: deps.client,
      model: deps.settings.model,
      effort: deps.settings.effort,
      thinkingDisplay: deps.settings.thinkingDisplay,
      refusalFallback: deps.settings.refusalFallback,
      system: systemBlocks(),
      tools: [...TOOLS, ...WEB_TOOLS],
      messages: [...history, userMessage],
      maxOutputTokens: deps.settings.maxOutputTokens,
      maxToolRounds: deps.settings.maxToolRounds,
      maxPauseContinuations: deps.settings.maxPauseContinuations,
      executeTool: runTool,
      onEvent,
      apiCalls,
      signal,
      now: deps.now,
    });
    stop = result.stop;
    refusalCategory = result.refusalCategory;
    firstTokenAt = result.firstTokenAt;
    if (result.stop === "refusal") step("refusal", { meta: { category: result.refusalCategory ?? "unknown" } });
    if (result.appended.length > 0) {
      messages = [userMessage, ...result.appended];
      const items = parseNext(sink.lastText());
      if (items && items.length > 0) sink.block({ kind: "suggestions", items });
      outcome = { type: "done", turnId, conversationId, notice: result.stop === "max_tokens" ? CUT_OFF_NOTICE : null };
    } else {
      outcome = { type: "discard", message: DISCARD_MESSAGES[result.stop === "end_turn" ? "empty" : result.stop] };
    }
  } catch (error) {
    if (signal?.aborted) {
      stop = "aborted";
    } else if (error instanceof Anthropic.BadRequestError) {
      outcome = { type: "error", code: "conversation_invalid", message: CONVERSATION_INVALID };
    } else {
      console.error("chat turn failed", failureText(error));
      outcome = { type: "error", code: "service_unavailable", message: UNAVAILABLE };
    }
  }

  advance();
  const events = sink.finish();
  const tokens = apiCalls.reduce(
    (sum, call) => ({ input: sum.input + call.input_tokens, output: sum.output + call.output_tokens, cacheRead: sum.cacheRead + call.cache_read_tokens, cacheWrite: sum.cacheWrite + call.cache_write_tokens }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
  // Priced at the configured model; a rerouted call is recorded by served_by for the researcher.
  const modelCost = apiCalls.reduce(
    (sum, call) => sum + costUsd(deps.settings.model, { input_tokens: call.input_tokens, output_tokens: call.output_tokens, cache_read_input_tokens: call.cache_read_tokens, cache_creation_input_tokens: call.cache_write_tokens }),
    0,
  );
  const cost = modelCost + repairCost;
  step("turn", { meta: { stop, api_calls: apiCalls.length, tool_calls: events.filter((event) => event.kind === "tool_use").length } });

  const payload: FinishTurnPayload = {
    user_id: user.id,
    conversation_id: conversationId,
    title,
    turn: {
      id: turnId,
      session_id: request.sessionId,
      user_text: request.text,
      started_at: startedAt.toISOString(),
      first_token_at: firstTokenAt?.toISOString() ?? null,
      finished_at: deps.now().toISOString(),
      stop,
      refusal_category: refusalCategory,
      model: deps.settings.model,
      effort: deps.settings.effort,
      api_calls: apiCalls,
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cache_read_tokens: tokens.cacheRead,
      cache_write_tokens: tokens.cacheWrite,
      cost_usd: cost,
      stage_before: stageBefore,
      stage_after: scenario.stage,
    },
    events,
    messages,
    scenario: scenarioToJson(scenario),
    step_events: stepEvents,
  };

  try {
    await deps.turns.finishTurn(payload);
    if (outcome) send(outcome);
  } catch (error) {
    console.error("finish_turn failed", failureText(error));
    send({ type: "error", code: "service_unavailable", message: UNAVAILABLE });
  } finally {
    // The turn was counted when it was reserved. Add what the model calls and any repair cost.
    await deps.usage
      .record(user.id, day, { turns: 0, inputTokens: tokens.input + tokens.cacheRead + tokens.cacheWrite, outputTokens: tokens.output, costUsd: cost })
      .catch(() => console.error("usage record failed"));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix web test -- tests/chat/handleChat`
Expected: PASS (19 tests). If `records[0][2].costUsd` in the run test differs from 0.0016, check that the fake client's `USAGE` is 100/20 tokens and that two calls were made; the price is 100 × 4 + 20 × 20 = 800 per million per call.

- [ ] **Step 5: Run the whole web suite, typecheck, lint, commit**

Run: `npm --prefix web test && npm --prefix web run typecheck && npm --prefix web run lint`
Expected: everything green.

```bash
git add web/lib/chat/handleChat.ts web/tests/chat/handleChat.test.ts
git commit -m "feat(chat): handleChat runs one request end to end and stores the turn atomically"
```

---
### Task 7: The three routes

**Files:**
- Create: `web/app/api/chat/route.ts`, `web/app/api/feedback/route.ts`, `web/app/api/conversations/[id]/route.ts`
- Modify: `web/next.config.ts` (tracing includes for the new routes and the `/chat/[id]` page)
- Test: `web/tests/api/chatRoute.test.ts`, `web/tests/api/feedbackRoute.test.ts`, `web/tests/api/conversationsRoute.test.ts`

**Interfaces:**
- Consumes: `requireParticipant` (Task 1); `encodeEvent` (Task 1); `handleChat`, `ChatDeps` (Task 6); the stores (Task 4); `createSimClient` (`lib/sim/client.ts`); `fetchUnWpp`, `fetchWhoGho`, `fetchWbData360` (`lib/data/*`); `supabaseUsageStore` (`lib/usage.ts`); `supabaseStepEventSink` (`lib/stepEvents.ts`); `RATINGS` (`lib/enums.ts`); `adminClient` (`lib/supabase/admin.ts`).
- Produces: `POST /api/chat` (spec 3.1), `POST /api/feedback` (spec 3.2; the body also accepts an optional `sessionId` so the `feedback_given` step event can carry the visit), `DELETE /api/conversations/[id]` (spec 3.3).

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/api/chatRoute.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({ default: class FakeAnthropic {} }));
vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/chat/handleChat", () => ({ handleChat: vi.fn() }));

import { POST } from "@/app/api/chat/route";
import { handleChat, type ChatDeps } from "@/lib/chat/handleChat";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const SETTINGS = loadSettings({ UNLIMITED_EMAILS: "student@emory.edu" });

function post(body = "{}") {
  return POST(new Request("http://localhost/api/chat", { method: "POST", body }));
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.mocked(requireParticipant).mockReset();
    vi.mocked(handleChat).mockReset();
  });

  it("answers the gate's refusal as it is", async () => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: Response.json({ code: "consent_required", message: "x" }, { status: 403 }) });
    const response = await post();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "consent_required" });
    expect(handleChat).not.toHaveBeenCalled();
  });

  it("streams the handler's events as server-sent events, passing the caller, the raw body, and an abort signal", async () => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: SETTINGS });
    vi.mocked(handleChat).mockImplementation(async (_deps, _user, _body, emit) => {
      emit({ type: "text", delta: "Hi" });
      emit({ type: "done", turnId: "t1", conversationId: "c1", notice: null });
    });
    const response = await post('{"text":"hello"}');
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(await response.text()).toBe('data: {"type":"text","delta":"Hi"}\n\ndata: {"type":"done","turnId":"t1","conversationId":"c1","notice":null}\n\n');

    const [deps, user, body, , signal] = vi.mocked(handleChat).mock.calls[0] as [ChatDeps, { id: string }, string, unknown, AbortSignal];
    expect(user).toEqual({ id: USER.id });
    expect(body).toBe('{"text":"hello"}');
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(deps.settings).toBe(SETTINGS);
    expect(deps.newId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(deps.now()).toBeInstanceOf(Date);
    for (const key of ["usage", "conversations", "messages", "scenarios", "turns", "runs", "sim", "adapters", "client"] as const) expect(deps[key]).toBeTruthy();
  });

  it("closes the stream even when the handler throws", async () => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: SETTINGS });
    vi.mocked(handleChat).mockRejectedValue(new Error("unexpected"));
    const response = await post();
    await expect(response.text()).rejects.toThrow(/unexpected/);
  });
});
```

```ts
// web/tests/api/feedbackRoute.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { POST } from "@/app/api/feedback/route";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const TURN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SESSION = "44444444-4444-4444-8444-444444444444";
let admin: ReturnType<typeof fakeAdmin>;

function withDb(conversation: Record<string, unknown> | null, turn: Record<string, unknown> | null) {
  admin = fakeAdmin({ conversations: [{ data: conversation }], turns: [{ data: turn }] });
  vi.mocked(adminClient).mockReturnValue(admin.client);
}

function post(body: unknown) {
  return POST(new Request("http://localhost/api/feedback", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
}

describe("POST /api/feedback", () => {
  beforeEach(() => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({}) });
    withDb({ id: CONVERSATION, title: "T", active_scenario_id: null }, { id: TURN });
  });

  it("inserts one row per press and mirrors it as a step event", async () => {
    const response = await post({ conversationId: CONVERSATION, turnId: TURN, rating: "down", comment: "  Too slow  ", sessionId: SESSION });
    expect(response.status).toBe(204);
    expect(callOn(admin.recorded, "feedback", "insert")).toEqual([{ user_id: USER.id, conversation_id: CONVERSATION, turn_id: TURN, rating: "down", comment: "Too slow" }]);
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "feedback_given", session_id: SESSION, conversation_id: CONVERSATION, turn_id: TURN, meta: { rating: "down", has_comment: true } });
  });

  it("stores an empty comment as null and no session as null", async () => {
    await post({ conversationId: CONVERSATION, turnId: TURN, rating: "up", comment: "   " });
    expect(callOn(admin.recorded, "feedback", "insert")).toEqual([{ user_id: USER.id, conversation_id: CONVERSATION, turn_id: TURN, rating: "up", comment: null }]);
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ session_id: null, meta: { rating: "up", has_comment: false } });
  });

  it("answers 404 when the conversation is not the caller's or the turn is not in it, and writes nothing", async () => {
    withDb(null, { id: TURN });
    expect((await post({ conversationId: CONVERSATION, turnId: TURN, rating: "up" })).status).toBe(404);
    withDb({ id: CONVERSATION, title: "T", active_scenario_id: null }, null);
    expect((await post({ conversationId: CONVERSATION, turnId: TURN, rating: "up" })).status).toBe(404);
    expect(callOn(admin.recorded, "feedback", "insert")).toBeUndefined();
  });

  it("refuses a malformed body and passes the gate's refusal through", async () => {
    for (const body of ["not json", { conversationId: CONVERSATION, turnId: TURN, rating: "meh" }, { conversationId: CONVERSATION, rating: "up" }, { conversationId: CONVERSATION, turnId: TURN, rating: "up", comment: "x".repeat(1001) }, { conversationId: CONVERSATION, turnId: TURN, rating: "up", extra: 1 }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(admin.recorded).toEqual([]);
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await post({ conversationId: CONVERSATION, turnId: TURN, rating: "up" })).status).toBe(401);
  });
});
```

```ts
// web/tests/api/conversationsRoute.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { DELETE } from "@/app/api/conversations/[id]/route";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
let admin: ReturnType<typeof fakeAdmin>;

function del(id: string) {
  return DELETE(new Request(`http://localhost/api/conversations/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
}

describe("DELETE /api/conversations/[id]", () => {
  beforeEach(() => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({}) });
    admin = fakeAdmin({ conversations: [{ data: [{ id: CONVERSATION }] }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
  });

  it("hides the caller's conversation and answers 204", async () => {
    expect((await del(CONVERSATION)).status).toBe(204);
    expect(callOn(admin.recorded, "conversations", "update")?.[0]).toMatchObject({ deleted_at: expect.any(String) });
    expect(callOn(admin.recorded, "conversations", "eq")).toEqual(["id", CONVERSATION]);
  });

  it("answers 404 for someone else's, an already hidden, or a malformed id, and passes the gate's refusal through", async () => {
    admin = fakeAdmin({ conversations: [{ data: [] }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
    expect((await del(CONVERSATION)).status).toBe(404);
    expect((await del("not-a-uuid")).status).toBe(404);
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await del(CONVERSATION)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/api/chatRoute tests/api/feedbackRoute tests/api/conversationsRoute`
Expected: each fails to resolve its route module.

- [ ] **Step 3: Implement**

```ts
// web/app/api/chat/route.ts
import Anthropic from "@anthropic-ai/sdk";
import { handleChat, type ChatDeps } from "@/lib/chat/handleChat";
import { encodeEvent } from "@/lib/chat/sse";
import { fetchUnWpp } from "@/lib/data/unWpp";
import { fetchWbData360 } from "@/lib/data/wbData360";
import { fetchWhoGho } from "@/lib/data/whoGho";
import { supabaseConversationStore } from "@/lib/db/conversations";
import { supabaseMessageStore } from "@/lib/db/messages";
import { supabaseRunStore } from "@/lib/db/runs";
import { supabaseScenarioStore } from "@/lib/db/scenarios";
import { supabaseTurnStore } from "@/lib/db/turns";
import { requireParticipant } from "@/lib/participant.server";
import { createSimClient } from "@/lib/sim/client";
import { adminClient } from "@/lib/supabase/admin";
import { supabaseUsageStore } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 300;

let anthropic: Anthropic | null = null;

/** One turn of the agent, streamed as server-sent events (agent-core spec, section 3.1). */
export async function POST(request: Request): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const { user, settings } = gate;

  const rawBody = await request.text();
  anthropic ??= new Anthropic();
  const admin = adminClient();
  const deps: ChatDeps = {
    settings,
    client: anthropic,
    usage: supabaseUsageStore(admin),
    conversations: supabaseConversationStore(admin),
    messages: supabaseMessageStore(admin),
    scenarios: supabaseScenarioStore(admin),
    turns: supabaseTurnStore(admin),
    runs: supabaseRunStore(admin),
    sim: createSimClient({ baseUrl: settings.simInternalUrl, secret: settings.simSharedSecret }),
    adapters: {
      unWpp: (query) => fetchUnWpp(query, { apiKey: settings.unApiKey }),
      whoGho: (query) => fetchWhoGho(query),
      wbData360: (query) => fetchWbData360(query),
    },
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  };

  // When the participant closes the page, stop writing and stop the model call.
  const disconnected = new AbortController();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await handleChat(
          deps,
          { id: user.id },
          rawBody,
          (event) => {
            if (open) controller.enqueue(encodeEvent(event));
          },
          disconnected.signal,
        );
      } catch (error) {
        // handleChat never throws by contract; if it ever does, the reader sees the failure instead of a hung stream.
        if (open) controller.error(error);
        open = false;
      } finally {
        if (open) controller.close();
      }
    },
    cancel() {
      open = false;
      disconnected.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
```

```ts
// web/app/api/feedback/route.ts
import { z } from "zod";
import { supabaseConversationStore } from "@/lib/db/conversations";
import { supabaseFeedbackStore } from "@/lib/db/feedback";
import { RATINGS } from "@/lib/enums";
import { requireParticipant } from "@/lib/participant.server";
import { supabaseStepEventSink } from "@/lib/stepEvents";
import { adminClient } from "@/lib/supabase/admin";

const Feedback = z.strictObject({
  conversationId: z.uuid(),
  turnId: z.uuid(),
  rating: z.enum(RATINGS),
  comment: z.string().max(1000).optional(),
  sessionId: z.uuid().nullable().optional(),
});

/** A thumb on an assistant reply (spec 3.2): one row per press, mirrored as a step event for the funnel. */
export async function POST(request: Request): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;

  let body: z.infer<typeof Feedback>;
  try {
    const parsed = Feedback.safeParse(JSON.parse(await request.text()));
    if (!parsed.success) return new Response(null, { status: 400 });
    body = parsed.data;
  } catch {
    return new Response(null, { status: 400 });
  }

  const admin = adminClient();
  try {
    const conversation = await supabaseConversationStore(admin).get(body.conversationId, gate.user.id);
    const feedback = supabaseFeedbackStore(admin);
    if (!conversation || !(await feedback.turnBelongs(body.turnId, body.conversationId))) return new Response(null, { status: 404 });
    const comment = body.comment?.trim() || null;
    await feedback.insert({ userId: gate.user.id, conversationId: body.conversationId, turnId: body.turnId, rating: body.rating, comment });
    await supabaseStepEventSink(admin).log(gate.user.id, [
      { kind: "feedback_given", sessionId: body.sessionId ?? null, conversationId: body.conversationId, turnId: body.turnId, meta: { rating: body.rating, has_comment: comment !== null } },
    ]);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("feedback route failed", error instanceof Error ? error.message : error);
    return new Response(null, { status: 500 });
  }
}
```

```ts
// web/app/api/conversations/[id]/route.ts
import { z } from "zod";
import { supabaseConversationStore } from "@/lib/db/conversations";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";

/** Hide a conversation from the participant (spec 3.3). The study keeps it. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  try {
    const hidden = await supabaseConversationStore(adminClient()).softDelete(id, gate.user.id, new Date());
    return new Response(null, { status: hidden ? 204 : 404 });
  } catch (error) {
    console.error("conversation delete failed", error instanceof Error ? error.message : error);
    return new Response(null, { status: 500 });
  }
}
```

In `web/next.config.ts`, add four entries to `outputFileTracingIncludes` so every route that reaches `loadConsent` ships the consent file:

```ts
    "/chat/[id]": ["./content/**/*.md"],
    "/api/chat": ["./content/**/*.md"],
    "/api/feedback": ["./content/**/*.md"],
    "/api/conversations/[id]": ["./content/**/*.md"],
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix web test -- tests/api`
Expected: PASS (chat 3, feedback 4, conversations 2, plus the existing consent, event, and health tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: clean. (`context.params` as a `Promise` is Next 16's route-handler signature; if `tsc` complains, read `web/node_modules/next/dist/docs/` for the current one.)

```bash
git add web/app/api/chat/route.ts web/app/api/feedback/route.ts "web/app/api/conversations/[id]/route.ts" web/next.config.ts web/tests/api/chatRoute.test.ts web/tests/api/feedbackRoute.test.ts web/tests/api/conversationsRoute.test.ts
git commit -m "feat(api): chat stream, feedback, and conversation delete routes"
```

---
### Task 8: The browser's turn reducer and tool lines

**Files:**
- Create: `web/lib/client/toolLine.ts`, `web/lib/client/turn.ts`
- Test: `web/tests/client/toolLine.test.ts`, `web/tests/client/turn.test.ts`

**Interfaces:**
- Consumes: `Block`, `ChatStreamEvent` (Task 3); `Stage` (`lib/enums.ts`); `fmtValue` (`lib/sim/pyformat.ts`); `CardPayload` (`lib/tools/types.ts`).
- Produces:
  ```ts
  // lib/client/toolLine.ts
  export const TOOL_LABELS: Record<string, string>;   // chat_controller.py _AGENT_TOOL_LABELS
  export const TOOL_STATUS: Record<string, string>;   // chat_controller.py _AGENT_STATUS_LABELS
  export const THINKING = "Thinking…";
  export function toolLabel(name: string): string;
  export function statusLabel(name: string): string;
  export function toolLine(name: string, payload: CardPayload | undefined, ok: boolean): { label: string; detail: string; warn: boolean };
  // lib/client/turn.ts
  export type TurnOutcome = { ok: true; turnId: string; conversationId: string; notice: string | null } | { ok: false; message: string };
  export type TurnProgress = { blocks: Block[]; status: string | null; stage: Stage | null; suggestions: string[]; result: TurnOutcome | null };
  export const INTERRUPTED = "The reply was interrupted. Please try again.";
  export function startTurn(): TurnProgress;
  export function applyEvent(progress: TurnProgress, event: ChatStreamEvent): TurnProgress;
  export function lastStage(turns: { blocks: Block[] }[]): Stage;          // the last stage block anywhere, else "understand"
  export function lastSuggestions(turns: { blocks: Block[] }[]): string[]; // the last turn's suggestions block, else []
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/client/toolLine.test.ts
import { describe, expect, it } from "vitest";

import { TOOL_LABELS, TOOL_STATUS, statusLabel, toolLabel, toolLine } from "@/lib/client/toolLine";
import type { ConfigPayload } from "@/lib/tools/types";

const CONFIG: ConfigPayload & { duration_ms: number } = {
  kind: "config", applied: { disease: "measles", r0: 12 }, approx_r0: 12.0,
  config: { disease: "measles", disease_type: "sir", country: "KEN", n_agents: 10000, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] },
  warnings: ["r0 high"], new_scenario: false, duration_ms: 12,
};

describe("tool lines", () => {
  it("carries the Python labels", () => {
    expect(TOOL_LABELS.configure_simulation).toBe("⚙️ Configured simulation");
    expect(TOOL_LABELS.run_simulation).toBe("▶️ Simulation");
    expect(TOOL_LABELS.web_fetch).toBe("📄 Read page");
    expect(TOOL_STATUS.run_simulation).toBe("Running the simulation — this usually takes 1–2 minutes…");
    expect(TOOL_STATUS.lookup_disease).toBe("Looking up disease parameters…");
    expect(toolLabel("something_new")).toBe("🔧 something_new");
    expect(statusLabel("something_new")).toBe("Running something_new…");
  });

  it("formats the first four payload fields with Python's value formatting, skipping the card's bookkeeping", () => {
    expect(toolLine("configure_simulation", CONFIG, true)).toEqual({
      label: "⚙️ Configured simulation",
      detail: "applied: disease: measles, r0: 12; approx_r0: 12; config: disease: measles, disease_type: sir, country: KEN; warnings: r0 high",
      warn: false,
    });
  });

  it("cuts a long line as Python does (157 characters and an ellipsis) and marks an error", () => {
    const line = toolLine("lookup_disease", { kind: "tool_error", message: "x".repeat(300) }, false);
    expect(line.warn).toBe(true);
    expect(line.detail).toHaveLength(158);
    expect(line.detail.endsWith("…")).toBe(true);
    expect(toolLine("run_simulation", undefined, true)).toEqual({ label: "▶️ Simulation", detail: "", warn: false });
  });
});
```

```ts
// web/tests/client/turn.test.ts
import { describe, expect, it } from "vitest";

import type { ChatStreamEvent } from "@/lib/chat/events";
import { INTERRUPTED, applyEvent, lastStage, lastSuggestions, startTurn, type TurnProgress } from "@/lib/client/turn";

function play(events: ChatStreamEvent[]): TurnProgress {
  return events.reduce((progress, event) => applyEvent(progress, event), startTurn());
}

const CONFIG = { kind: "config" as const, applied: {}, approx_r0: 12, config: { disease: "measles", disease_type: "sir", country: null, n_agents: 10000, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] }, warnings: [], new_scenario: false };

describe("applyEvent", () => {
  it("starts with a status and no result", () => {
    expect(startTurn()).toEqual({ blocks: [], status: "Thinking…", stage: null, suggestions: [], result: null });
    expect(INTERRUPTED).toBe("The reply was interrupted. Please try again.");
  });

  it("extends the open text block and starts a new one after any other block", () => {
    const progress = play([
      { type: "text", delta: "Let me " }, { type: "text", delta: "configure it." },
      { type: "tool_use", id: "tu_1", name: "configure_simulation", input: {} },
      { type: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: CONFIG },
      { type: "text", delta: "Done." },
    ]);
    expect(progress.blocks).toEqual([
      { kind: "text", text: "Let me configure it." },
      { kind: "tool_use", id: "tu_1", name: "configure_simulation", input: {} },
      { kind: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: CONFIG },
      { kind: "text", text: "Done." },
    ]);
    expect(progress.status).toBeNull();
  });

  it("shows what is happening: the tool's status, thinking after a result, the web statuses", () => {
    expect(play([{ type: "text", delta: "x" }]).status).toBeNull();
    expect(play([{ type: "tool_use", id: "tu_1", name: "run_simulation", input: {} }]).status).toBe("Running the simulation — this usually takes 1–2 minutes…");
    expect(play([{ type: "tool_use", id: "tu_1", name: "run_simulation", input: {} }, { type: "tool_result", id: "tu_1", name: "run_simulation", ok: false, payload: { kind: "tool_error", message: "x" } }]).status).toBe("Thinking…");
    expect(play([{ type: "web_search", query: "measles Kenya" }]).status).toBe("Searching the web…");
    expect(play([{ type: "web_fetch", url: "https://www.who.int", title: "WHO" }]).status).toBe("Reading the page…");
    expect(play([{ type: "tool_use", id: "tu_1", name: "something_new", input: {} }]).status).toBe("Running something_new…");
  });

  it("keeps the stage, the suggestions, and notices as blocks too", () => {
    const progress = play([
      { type: "stage", stage: "configure" }, { type: "notice", message: "WEB ERROR: unavailable" }, { type: "suggestions", items: ["Run it", "Fetch data"] },
    ]);
    expect(progress.stage).toBe("configure");
    expect(progress.suggestions).toEqual(["Run it", "Fetch data"]);
    expect(progress.blocks.map((b) => b.kind)).toEqual(["stage", "notice", "suggestions"]);
  });

  it("ends with the ids on done, or the message on discard and error", () => {
    const done = play([{ type: "text", delta: "Hi" }, { type: "done", turnId: "t1", conversationId: "c1", notice: "cut" }]);
    expect(done.result).toEqual({ ok: true, turnId: "t1", conversationId: "c1", notice: "cut" });
    expect(done.status).toBeNull();
    expect(play([{ type: "discard", message: "Dropped." }]).result).toEqual({ ok: false, message: "Dropped." });
    expect(play([{ type: "error", code: "daily_turns", message: "Limit." }]).result).toEqual({ ok: false, message: "Limit." });
  });
});

describe("conversation state from blocks", () => {
  const turns = [
    { blocks: [{ kind: "stage" as const, stage: "configure" as const }, { kind: "suggestions" as const, items: ["Fetch data"] }] },
    { blocks: [{ kind: "text" as const, text: "Hi" }, { kind: "suggestions" as const, items: ["Run it"] }] },
  ];

  it("takes the last stage anywhere and the last turn's suggestions", () => {
    expect(lastStage(turns)).toBe("configure");
    expect(lastStage([])).toBe("understand");
    expect(lastSuggestions(turns)).toEqual(["Run it"]);
    expect(lastSuggestions([turns[0], { blocks: [{ kind: "text", text: "no chips" }] }])).toEqual([]);
    expect(lastSuggestions([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/client/toolLine tests/client/turn`
Expected: both fail to resolve their modules.

- [ ] **Step 3: Implement**

```ts
// web/lib/client/toolLine.ts
import { fmtValue } from "@/lib/sim/pyformat";
import type { CardPayload } from "@/lib/tools/types";

/** epichat/chat_controller.py _AGENT_TOOL_LABELS: the persistent chat line's label. */
export const TOOL_LABELS: Record<string, string> = {
  configure_simulation: "⚙️ Configured simulation",
  lookup_disease: "📖 Disease database",
  fetch_demographics: "🔧 UN WPP demographics",
  fetch_health_system: "🔧 World Bank health system",
  fetch_vaccination_coverage: "🔧 WHO vaccination coverage",
  run_simulation: "▶️ Simulation",
  web_search: "🔎 Web search",
  web_fetch: "📄 Read page",
};

/** epichat/chat_controller.py _AGENT_STATUS_LABELS: what the status line says while a tool runs. */
export const TOOL_STATUS: Record<string, string> = {
  configure_simulation: "Configuring the simulation…",
  lookup_disease: "Looking up disease parameters…",
  fetch_demographics: "Fetching UN demographics…",
  fetch_health_system: "Fetching World Bank health-system data…",
  fetch_vaccination_coverage: "Fetching WHO vaccination coverage…",
  run_simulation: "Running the simulation — this usually takes 1–2 minutes…",
  web_search: "Searching the web…",
  web_fetch: "Reading the page…",
};

export const THINKING = "Thinking…";

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `🔧 ${name}`;
}

export function statusLabel(name: string): string {
  return TOOL_STATUS[name] ?? `Running ${name}…`;
}

const MAX_CHARS = 160;
/** The card's own bookkeeping, never part of the line. */
const HIDDEN = new Set(["kind", "duration_ms", "series"]);

/** The persistent chat line for one tool call: Python's format_agent_tool_line over the payload's first four fields. */
export function toolLine(name: string, payload: CardPayload | undefined, ok: boolean): { label: string; detail: string; warn: boolean } {
  const fields = Object.entries(payload ?? {}).filter(([key]) => !HIDDEN.has(key)).slice(0, 4);
  let detail = fields.map(([key, value]) => `${key}: ${fmtValue(value)}`).join("; ");
  if (detail.length > MAX_CHARS) detail = `${detail.slice(0, MAX_CHARS - 3)}…`;
  return { label: toolLabel(name), detail, warn: !ok };
}
```

```ts
// web/lib/client/turn.ts
import type { Block, ChatStreamEvent } from "@/lib/chat/events";
import type { Stage } from "@/lib/enums";
import { THINKING, statusLabel } from "./toolLine";

export type TurnOutcome = { ok: true; turnId: string; conversationId: string; notice: string | null } | { ok: false; message: string };

export type TurnProgress = {
  /** The reply so far, in the shape turn_events stores. */
  blocks: Block[];
  /** What to show while waiting, such as "Running the simulation…". */
  status: string | null;
  stage: Stage | null;
  suggestions: string[];
  /** Set once the turn has ended, one way or the other. */
  result: TurnOutcome | null;
};

export const INTERRUPTED = "The reply was interrupted. Please try again.";

export function startTurn(): TurnProgress {
  return { blocks: [], status: THINKING, stage: null, suggestions: [], result: null };
}

function withBlock(progress: TurnProgress, block: Block, status: string | null): TurnProgress {
  return { ...progress, blocks: [...progress.blocks, block], status };
}

/** Fold one server event into the turn. A text delta extends the open text block; any other block starts a new one. */
export function applyEvent(progress: TurnProgress, event: ChatStreamEvent): TurnProgress {
  switch (event.type) {
    case "text": {
      const last = progress.blocks.at(-1);
      const blocks =
        last?.kind === "text"
          ? [...progress.blocks.slice(0, -1), { kind: "text" as const, text: last.text + event.delta }]
          : [...progress.blocks, { kind: "text" as const, text: event.delta }];
      return { ...progress, blocks, status: null };
    }
    case "tool_use":
      return withBlock(progress, { kind: "tool_use", id: event.id, name: event.name, input: event.input }, statusLabel(event.name));
    case "tool_result":
      return withBlock(progress, { kind: "tool_result", id: event.id, name: event.name, ok: event.ok, payload: event.payload }, THINKING);
    case "web_search":
      return withBlock(progress, { kind: "web_search", query: event.query }, statusLabel("web_search"));
    case "web_fetch":
      return withBlock(progress, { kind: "web_fetch", url: event.url, title: event.title }, statusLabel("web_fetch"));
    case "notice":
      return withBlock(progress, { kind: "notice", message: event.message }, progress.status);
    case "stage":
      return { ...withBlock(progress, { kind: "stage", stage: event.stage }, progress.status), stage: event.stage };
    case "suggestions":
      return { ...withBlock(progress, { kind: "suggestions", items: event.items }, progress.status), suggestions: event.items };
    case "done":
      return { ...progress, status: null, result: { ok: true, turnId: event.turnId, conversationId: event.conversationId, notice: event.notice } };
    case "discard":
    case "error":
      return { ...progress, status: null, result: { ok: false, message: event.message } };
  }
}

/** The conversation's stage: the last stage block anywhere, or the first stage before any turn. */
export function lastStage(turns: { blocks: Block[] }[]): Stage {
  for (let i = turns.length - 1; i >= 0; i--) {
    for (let j = turns[i].blocks.length - 1; j >= 0; j--) {
      const block = turns[i].blocks[j];
      if (block.kind === "stage") return block.stage;
    }
  }
  return "understand";
}

/** The chips to show: the last turn's suggestions, if it made any. */
export function lastSuggestions(turns: { blocks: Block[] }[]): string[] {
  const last = turns.at(-1);
  if (!last) return [];
  const block = last.blocks.find((b): b is Extract<Block, { kind: "suggestions" }> => b.kind === "suggestions");
  return block?.items ?? [];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix web test -- tests/client`
Expected: PASS (toolLine 3, turn 6, sse 4). If the `detail` assertion for `CONFIG` differs, compare against `fmtValue` for each value (`applied` is an object, so it prints its first three entries as `k: v`); fix the expectation only if `fmtValue` is the thing that is right.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: clean.

```bash
git add web/lib/client/toolLine.ts web/lib/client/turn.ts web/tests/client/toolLine.test.ts web/tests/client/turn.test.ts
git commit -m "feat(client): fold stream events into blocks; Python's tool-line and status labels"
```

---
### Task 9: The chat page

**Files:**
- Create: `web/components/Chat.tsx`, `web/components/ChatHeader.tsx`, `web/components/ConversationList.tsx`, `web/components/TurnBlocks.tsx`, `web/components/ToolLine.tsx`, `web/components/Markdown.tsx`, `web/components/FeedbackControl.tsx`, `web/components/Suggestions.tsx`, `web/lib/client/scroll.ts`, `web/app/chat/[id]/page.tsx`
- Modify: `web/app/chat/page.tsx`
- Delete: `web/components/ChatShell.tsx`
- Test: `web/tests/app/pages.test.ts` (update), `web/tests/client/scroll.test.ts`

**Interfaces:**
- Consumes: `Block`, `ChatStreamEvent` (Task 3); `readEvents` (Task 1); `applyEvent`, `startTurn`, `lastStage`, `lastSuggestions`, `INTERRUPTED`, `TurnProgress` (Task 8); `toolLine` (Task 8); `listConversations`, `supabaseConversationStore`, `ConversationSummary` (Task 4); `supabaseTurnStore`, `ReplayTurn` (Task 4); `CUT_OFF_NOTICE` (Task 6); `withoutNext` (Plan A); `track` (`lib/client/track.ts`); `useSessionId`, `SessionProvider` (`components/SessionProvider.tsx`); `loadParticipant`, `redirectFor` (`lib/participant.server.ts`); `Brand`; `createClient` (`lib/supabase/client.ts`).
- Produces:
  ```ts
  // components/Chat.tsx
  export type DisplayTurn = { id: string; userText: string; blocks: Block[]; notice: string | null };
  export function Chat(props: { email: string; conversations: ConversationSummary[]; initial: { id: string; title: string; turns: DisplayTurn[] } | null; maxMessageChars: number; contactEmail: string }): JSX.Element;
  // lib/client/scroll.ts (CampusOtter's)
  export function isNearBottom(position: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean;
  export function keepFollowing(following: boolean, previousTop: number, position: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean;
  ```

- [ ] **Step 1: Write the failing tests**

Replace the last test of `web/tests/app/pages.test.ts` ("the chat shell opens a session...") with these, and add `"app/chat/[id]/page.tsx"` to the first loop's list and to the redirect loop:

```ts
  it("the resumed-conversation page checks ownership and answers 404 otherwise", () => {
    const source = readFileSync("app/chat/[id]/page.tsx", "utf8");
    expect(source).toContain("supabaseConversationStore(admin).get(id, participant.user.id)");
    expect(source).toContain("notFound()");
    expect(source).toContain("listForReplay(id)");
    expect(source).toContain("z.uuid().safeParse(id)");
  });

  it("both chat pages open a session and render the chat", () => {
    for (const page of ["app/chat/page.tsx", "app/chat/[id]/page.tsx"]) {
      const source = readFileSync(page, "utf8");
      expect(source).toContain("<SessionProvider>");
      expect(source).toContain("<Chat");
    }
    expect(readFileSync("app/chat/page.tsx", "utf8")).toContain("initial={null}");
    expect(existsSync("components/ChatShell.tsx")).toBe(false);
  });

  it("the chat component streams from the chat route, reports suggestion use, and asks for feedback", () => {
    const source = readFileSync("components/Chat.tsx", "utf8");
    expect(source).toContain('fetch("/api/chat"');
    expect(source).toContain("readEvents<ChatStreamEvent>");
    expect(source).toContain("applyEvent(");
    expect(source).toContain('kind: "suggestion_used"');
    expect(source).toContain('kind: "conversation_resumed"');
    expect(source).toContain("useSessionId()");
    expect(source).toContain("<FeedbackControl");
    expect(source).toContain("<Suggestions");
    expect(readFileSync("components/FeedbackControl.tsx", "utf8")).toContain('fetch("/api/feedback"');
    expect(readFileSync("components/ConversationList.tsx", "utf8")).toContain('method: "DELETE"');
  });
```

(`existsSync` joins the `readFileSync` import from `node:fs`.)

```ts
// web/tests/client/scroll.test.ts
import { describe, expect, it } from "vitest";

import { isNearBottom, keepFollowing } from "@/lib/client/scroll";

describe("following the newest message", () => {
  it("counts the last 120 pixels as the end", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 500 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 500 })).toBe(false);
  });

  it("stops following on any scroll up, resumes near the end, and ignores a page that just grew", () => {
    expect(keepFollowing(true, 500, { scrollHeight: 2000, scrollTop: 400, clientHeight: 500 })).toBe(false);
    expect(keepFollowing(false, 400, { scrollHeight: 1000, scrollTop: 450, clientHeight: 500 })).toBe(true);
    expect(keepFollowing(true, 400, { scrollHeight: 3000, scrollTop: 400, clientHeight: 500 })).toBe(true);
    expect(keepFollowing(false, 400, { scrollHeight: 3000, scrollTop: 400, clientHeight: 500 })).toBe(false);
    // The page got shorter and the browser moved the view to its new end: still following.
    expect(keepFollowing(true, 1500, { scrollHeight: 1000, scrollTop: 500, clientHeight: 500 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/app/pages tests/client/scroll`
Expected: the page tests fail on the missing `[id]` page and `ChatShell.tsx` still existing; the scroll test cannot resolve its module.

- [ ] **Step 3: Implement the helpers and the components**

```ts
// web/lib/client/scroll.ts
type ScrollPosition = { scrollHeight: number; scrollTop: number; clientHeight: number };

/** How close to the end still counts as "reading the latest message", in pixels. */
const NEAR = 120;
/** Closer than this is the end itself, allowing for rounding. */
const AT_END = 2;

function distanceFromEnd(position: ScrollPosition): number {
  return position.scrollHeight - position.scrollTop - position.clientHeight;
}

export function isNearBottom(position: ScrollPosition): boolean {
  return distanceFromEnd(position) <= NEAR;
}

/**
 * Whether a reply that is still arriving should keep moving the page down.
 * Any scroll up stops the following; it resumes when the reader is back near
 * the end. A page that grew leaves the position alone, so it changes nothing.
 */
export function keepFollowing(following: boolean, previousTop: number, position: ScrollPosition): boolean {
  if (position.scrollTop < previousTop) return distanceFromEnd(position) <= AT_END;
  if (isNearBottom(position)) return true;
  return following;
}
```

```tsx
// web/components/Markdown.tsx
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** The assistant's prose. Links open in a new tab; code keeps its block or inline form. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-epichat break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
              {children}
            </a>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const content = String(children).replace(/\n$/, "");
            const isBlock = className !== undefined || content.includes("\n");
            return isBlock ? (
              <pre className="my-3 overflow-x-auto rounded-lg border border-line bg-paper-2 p-3 font-mono text-sm">
                <code>{content}</code>
              </pre>
            ) : (
              <code className="rounded bg-paper-2 px-1 py-0.5 font-mono text-[0.9em]">{content}</code>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
```

```tsx
// web/components/ToolLine.tsx
import { toolLine } from "@/lib/client/toolLine";
import type { CardPayload } from "@/lib/tools/types";

/** The persistent one-line record of a tool call, as the Python chat showed it. */
export function ToolLine({ name, payload, ok }: { name: string; payload: CardPayload | undefined; ok: boolean }) {
  const line = toolLine(name, payload, ok);
  return (
    <p className={`my-2 text-sm ${line.warn ? "text-warn-ink" : "text-ink-soft"}`}>
      {line.warn ? "⚠ " : ""}
      <strong className="font-semibold">{line.label}</strong>
      {line.detail ? ` — ${line.detail}` : ""}
    </p>
  );
}
```

```tsx
// web/components/TurnBlocks.tsx
import type { Block } from "@/lib/chat/events";
import { withoutNext } from "@/lib/chat/next";
import { Markdown } from "./Markdown";
import { ToolLine } from "./ToolLine";

const LINE = "my-2 text-sm text-ink-soft";

/** One turn's blocks in order: prose, tool lines, web lines, notices. Stage and suggestion blocks render nothing here. */
export function TurnBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "text": {
            const text = withoutNext(block.text);
            return text ? <Markdown key={index} text={text} /> : null;
          }
          case "tool_result":
            return <ToolLine key={index} name={block.name} payload={block.payload} ok={block.ok} />;
          case "web_search":
            return (
              <p key={index} className={LINE}>
                <strong className="font-semibold">🔎 Web search</strong> — {block.query}
              </p>
            );
          case "web_fetch":
            return (
              <p key={index} className={LINE}>
                <strong className="font-semibold">📄 Read page</strong> —{" "}
                <a href={block.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {block.title}
                </a>
              </p>
            );
          case "notice":
            return (
              <p key={index} role="status" className="my-2 rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2 text-sm text-warn-ink">
                {block.message}
              </p>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
```

```tsx
// web/components/Suggestions.tsx
"use client";

type Props = { items: string[]; disabled: boolean; onPick: (reply: string) => void };

/** The assistant's suggested replies, as buttons above the message box. */
export function Suggestions({ items, disabled, onPick }: Props) {
  if (items.length === 0) return null;
  return (
    <div aria-label="Suggested replies" className="mb-2.5 flex gap-2 overflow-x-auto px-1 pb-0.5">
      {items.map((reply) => (
        <button
          key={reply}
          type="button"
          disabled={disabled}
          onClick={() => onPick(reply)}
          className="shrink-0 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-accent hover:border-accent hover:bg-accent-wash disabled:opacity-50"
        >
          {reply}
        </button>
      ))}
    </div>
  );
}
```

```tsx
// web/components/FeedbackControl.tsx
"use client";

import { useState } from "react";

type Props = { conversationId: string; turnId: string; sessionId: string | null };
type Rating = "up" | "down";

const THUMB = "rounded-full px-2 py-1 text-base hover:bg-paper-2 aria-pressed:bg-accent-wash";

/** Thumbs on an assistant reply, then an optional comment. Every press is one row; the latest wins in reports. */
export function FeedbackControl({ conversationId, turnId, sessionId }: Props) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send(chosen: Rating, text: string): Promise<boolean> {
    setFailed(false);
    const trimmed = text.trim();
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, turnId, rating: chosen, ...(trimmed ? { comment: trimmed } : {}), sessionId }),
    }).catch(() => null);
    if (!response || !response.ok) {
      setFailed(true);
      return false;
    }
    setRating(chosen);
    return true;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-faint">
      <button type="button" aria-label="Helpful" aria-pressed={rating === "up"} onClick={() => void send("up", "")} className={THUMB}>
        👍
      </button>
      <button type="button" aria-label="Not helpful" aria-pressed={rating === "down"} onClick={() => void send("down", "")} className={THUMB}>
        👎
      </button>
      {rating && !commenting && (
        <button type="button" onClick={() => setCommenting(true)} className="underline underline-offset-2 hover:text-ink">
          Add a comment
        </button>
      )}
      {rating && commenting && (
        <form
          className="flex w-full items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send(rating, comment).then((sent) => sent && setCommenting(false));
          }}
        >
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={1000}
            rows={2}
            aria-label="Comment"
            className="flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-ink"
          />
          <button type="submit" className="rounded-full bg-accent px-4 py-1.5 font-semibold text-white hover:bg-accent-deep">
            Send
          </button>
        </form>
      )}
      {failed && (
        <span role="alert" className="text-warn-ink">
          That did not save. Please try again.
        </span>
      )}
    </div>
  );
}
```

```tsx
// web/components/ConversationList.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConversationSummary } from "@/lib/db/conversations";

type Props = { items: ConversationSummary[]; currentId: string | null };

/** The participant's earlier conversations, newest first, each with a two-click delete. */
export function ConversationList({ items: initial, currentId }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function remove(id: string) {
    setFailed(false);
    const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    if (!response || (response.status !== 204 && response.status !== 404)) {
      setFailed(true);
      return;
    }
    setItems((list) => list.filter((item) => item.id !== id));
    if (id === currentId) router.push("/chat");
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold tracking-wide text-ink-faint uppercase">Your conversations</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-ink-soft">None yet. A conversation appears here after your first message.</p>
      ) : (
        <ul className="mt-3 border-t border-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 border-b border-line">
              <Link href={`/chat/${item.id}`} aria-current={item.id === currentId ? "page" : undefined} className="flex min-w-0 flex-1 flex-col gap-0.5 py-3 hover:text-accent">
                <span className="truncate font-medium">{item.title}</span>
                <time dateTime={item.updatedAt} className="font-mono text-xs text-ink-faint">
                  {new Date(item.updatedAt).toLocaleDateString()}
                </time>
              </Link>
              <button
                type="button"
                onClick={() => {
                  if (confirming !== item.id) return setConfirming(item.id);
                  setConfirming(null);
                  void remove(item.id);
                }}
                onBlur={() => setConfirming(null)}
                aria-label={`${confirming === item.id ? "Confirm deleting" : "Delete"} the conversation "${item.title}"`}
                className={
                  confirming === item.id
                    ? "rounded-full bg-warn-wash px-3 py-1.5 text-sm font-medium whitespace-nowrap text-warn-ink"
                    : "rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-soft hover:bg-warn-wash hover:text-warn-ink"
                }
              >
                {confirming === item.id ? "Delete?" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p role="alert" className="mt-3 text-sm text-warn-ink">
          That conversation could not be deleted. Please try again.
        </p>
      )}
    </section>
  );
}
```

```tsx
// web/components/ChatHeader.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { createClient } from "@/lib/supabase/client";

const QUIET = "rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-soft hover:bg-paper-2 hover:text-ink";

/** The bar at the top of the chat: the brand, the address, New, Sign out. New waits while a reply is arriving. */
export function ChatHeader({ email, busy }: { email: string; busy: boolean }) {
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2.5">
        <Brand />
        <nav aria-label="Chat" className="flex items-center gap-1">
          <span className="hidden truncate text-xs text-ink-faint sm:inline">{email}</span>
          {busy ? (
            <span className={`${QUIET} opacity-50`} aria-disabled="true">
              New
            </span>
          ) : (
            <Link href="/chat" className={QUIET} aria-label="New conversation">
              New
            </Link>
          )}
          <button type="button" onClick={signOut} className={QUIET}>
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
}
```

```tsx
// web/components/Chat.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Block, ChatStreamEvent } from "@/lib/chat/events";
import { keepFollowing } from "@/lib/client/scroll";
import { readEvents } from "@/lib/client/sse";
import { track } from "@/lib/client/track";
import { INTERRUPTED, applyEvent, lastStage, lastSuggestions, startTurn, type TurnProgress } from "@/lib/client/turn";
import type { ConversationSummary } from "@/lib/db/conversations";
import { ChatHeader } from "./ChatHeader";
import { ConversationList } from "./ConversationList";
import { FeedbackControl } from "./FeedbackControl";
import { useSessionId } from "./SessionProvider";
import { Suggestions } from "./Suggestions";
import { TurnBlocks } from "./TurnBlocks";

/** A finished turn as the page shows it: the participant's text and the assistant's blocks. */
export type DisplayTurn = { id: string; userText: string; blocks: Block[]; notice: string | null };

type Props = {
  email: string;
  conversations: ConversationSummary[];
  /** The conversation being resumed, or null for a new one. */
  initial: { id: string; title: string; turns: DisplayTurn[] } | null;
  maxMessageChars: number;
  contactEmail: string;
};

const EXAMPLES = ["Model a measles outbreak in Kenya", "What is the R0 of dengue?", "Simulate influenza in Brazil with 60% vaccine coverage"];

function TurnView({ turn, status, feedback }: { turn: DisplayTurn; status: string | null; feedback: { conversationId: string; sessionId: string | null } | null }) {
  return (
    <article className="py-4">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent-wash px-4 py-2.5 whitespace-pre-wrap">{turn.userText}</p>
      <div className="mt-4">
        <TurnBlocks blocks={turn.blocks} />
        {status && (
          <p role="status" className="my-2 text-sm text-ink-faint">
            {status}
          </p>
        )}
        {turn.notice && (
          <p role="status" className="my-2 rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2 text-sm text-warn-ink">
            {turn.notice}
          </p>
        )}
        {feedback && <FeedbackControl conversationId={feedback.conversationId} turnId={turn.id} sessionId={feedback.sessionId} />}
      </div>
    </article>
  );
}

/** The chat: every turn's blocks, the live turn with its status line, suggestion chips, the composer, and the list. */
export function Chat({ email, conversations, initial, maxMessageChars, contactEmail }: Props) {
  const router = useRouter();
  const sessionId = useSessionId();
  const [conversationId, setConversationId] = useState<string | null>(initial?.id ?? null);
  const [turns, setTurns] = useState<DisplayTurn[]>(initial?.turns ?? []);
  const [live, setLive] = useState<{ userText: string; progress: TurnProgress } | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputBox = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef<AbortController | null>(null);
  const following = useRef(true);
  const resumedReported = useRef(false);

  useEffect(() => () => inFlight.current?.abort(), []);

  useEffect(() => {
    if (!initial || !sessionId || resumedReported.current) return;
    resumedReported.current = true;
    track({ kind: "conversation_resumed", sessionId, conversationId: initial.id });
  }, [initial, sessionId]);

  useEffect(() => {
    let previousTop = document.documentElement.scrollTop;
    const onScroll = () => {
      const page = document.documentElement;
      following.current = keepFollowing(following.current, previousTop, page);
      previousTop = page.scrollTop;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (following.current && (live || turns.length > 0)) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [turns, live, error]);

  const suggestions = live ? [] : lastSuggestions(turns);
  const showList = turns.length === 0 && !live;

  /** Send what is in the message box, or a suggested reply the participant pressed. */
  async function send(text: string, suggested = false) {
    const userText = text.trim();
    if (!userText || live) return;
    if (userText.length > maxMessageChars) {
      setError(`That message is too long. Keep it under ${maxMessageChars} characters.`);
      return;
    }
    if (suggested && conversationId) {
      track({ kind: "suggestion_used", sessionId: sessionId ?? undefined, conversationId, turnId: turns.at(-1)?.id, stage: lastStage(turns) });
    }
    const startedWith = conversationId;
    let progress = startTurn();
    following.current = true;
    setError(null);
    if (!suggested) setInput("");
    setLive({ userText, progress });
    const fail = (message: string) => {
      setError(message);
      if (!suggested) setInput(text);
    };
    const request = new AbortController();
    inFlight.current = request;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({ ...(startedWith ? { conversationId: startedWith } : {}), sessionId, text: userText }),
      });
      if (response.status === 401) {
        router.replace("/sign-in");
        return;
      }
      if (!response.ok || !response.body) {
        const problem = (await response.json().catch(() => null)) as { message?: string } | null;
        fail(problem?.message ?? INTERRUPTED);
        return;
      }
      for await (const event of readEvents<ChatStreamEvent>(response.body)) {
        progress = applyEvent(progress, event);
        setLive({ userText, progress });
      }
      if (request.signal.aborted) return;
      if (progress.result?.ok) {
        const { turnId, conversationId: id, notice } = progress.result;
        setTurns((list) => [...list, { id: turnId, userText, blocks: progress.blocks, notice }]);
        if (!startedWith) {
          // The first turn opened the conversation: show its address without reloading the page.
          setConversationId(id);
          window.history.replaceState(null, "", `/chat/${id}`);
        }
      } else {
        fail(progress.result?.message ?? INTERRUPTED);
      }
    } catch {
      if (!request.signal.aborted) fail(INTERRUPTED);
    } finally {
      if (inFlight.current === request) inFlight.current = null;
      setLive(null);
      inputBox.current?.focus();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  }

  const feedback = conversationId ? { conversationId, sessionId } : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <ChatHeader email={email} busy={live !== null} />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
        {showList && (
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-xl font-semibold">What would you like to model?</h2>
            <p className="mt-2 text-ink-soft">
              EpiChat sets up and runs agent-based epidemic simulations from a conversation: a disease, a country, real demographic data, interventions, and the
              results, with every step shown. Try one of these, or type your own.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" onClick={() => void send(example)} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium text-accent hover:border-accent hover:bg-accent-wash">
                  {example}
                </button>
              ))}
            </div>
            {contactEmail && <p className="mt-4 text-sm text-ink-faint">Questions about the study: {contactEmail}.</p>}
          </section>
        )}

        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} status={null} feedback={feedback} />
        ))}
        {live && <TurnView turn={{ id: "live", userText: live.userText, blocks: live.progress.blocks, notice: null }} status={live.progress.status} feedback={null} />}

        {showList && <ConversationList items={conversations} currentId={conversationId} />}
      </main>

      <footer className="sticky bottom-0 border-t border-line bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-4 pt-2.5">
          {error && (
            <p role="alert" className="mb-2.5 rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2.5 text-sm text-warn-ink">
              {error}
            </p>
          )}
          <Suggestions items={suggestions} disabled={live !== null} onPick={(reply) => void send(reply, true)} />
        </div>
        <form className="mx-auto flex max-w-3xl items-end gap-2 px-4 pb-3" onSubmit={submit}>
          <textarea
            ref={inputBox}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={live !== null}
            rows={1}
            maxLength={maxMessageChars}
            placeholder={live ? "Working…" : "Message EpiChat"}
            aria-label="Message"
            className="min-h-11 flex-1 resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 disabled:text-ink-faint"
          />
          <button type="submit" disabled={live !== null || !input.trim()} className="rounded-full bg-accent px-5 py-2.5 font-semibold text-white hover:bg-accent-deep disabled:bg-line disabled:text-ink-faint">
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Write the pages, delete the shell**

```tsx
// web/app/chat/page.tsx
import { redirect } from "next/navigation";
import { Chat } from "@/components/Chat";
import { SessionProvider } from "@/components/SessionProvider";
import { listConversations } from "@/lib/db/conversations";
import { loadParticipant, redirectFor } from "@/lib/participant.server";
import { supabaseProfileStore } from "@/lib/profiles";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** A new conversation, with the list of earlier ones. */
export default async function ChatPage() {
  const participant = await loadParticipant();
  const destination = redirectFor(participant.status);
  if (destination || !participant.user) redirect(destination ?? "/sign-in");

  const admin = adminClient();
  // Seen today. A failure here must not keep the page from opening.
  void supabaseProfileStore(admin).touch(participant.user.id, new Date()).catch(() => {});
  const conversations = await listConversations(admin, participant.user.id);

  return (
    <SessionProvider>
      <Chat email={participant.user.email} conversations={conversations} initial={null} maxMessageChars={participant.settings.maxMessageChars} contactEmail={participant.settings.contactEmail} />
    </SessionProvider>
  );
}
```

```tsx
// web/app/chat/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Chat, type DisplayTurn } from "@/components/Chat";
import { SessionProvider } from "@/components/SessionProvider";
import { CUT_OFF_NOTICE } from "@/lib/chat/handleChat";
import { listConversations, supabaseConversationStore } from "@/lib/db/conversations";
import { supabaseTurnStore } from "@/lib/db/turns";
import { loadParticipant, redirectFor } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Resume a conversation: the server renders its finished turns from turn_events, then the client takes over. */
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const participant = await loadParticipant();
  const destination = redirectFor(participant.status);
  if (destination || !participant.user) redirect(destination ?? "/sign-in");

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const admin = adminClient();
  const conversation = await supabaseConversationStore(admin).get(id, participant.user.id);
  if (!conversation) notFound();

  const [conversations, replay] = await Promise.all([listConversations(admin, participant.user.id), supabaseTurnStore(admin).listForReplay(id)]);
  const turns: DisplayTurn[] = replay.map((turn) => ({ id: turn.id, userText: turn.userText, blocks: turn.blocks, notice: turn.stop === "max_tokens" ? CUT_OFF_NOTICE : null }));

  return (
    <SessionProvider>
      <Chat
        email={participant.user.email}
        conversations={conversations}
        initial={{ id, title: conversation.title, turns }}
        maxMessageChars={participant.settings.maxMessageChars}
        contactEmail={participant.settings.contactEmail}
      />
    </SessionProvider>
  );
}
```

Then `git rm web/components/ChatShell.tsx`.

- [ ] **Step 5: Run the tests, typecheck, lint, and build**

Run: `npm --prefix web test && npm --prefix web run typecheck && npm --prefix web run lint && npm --prefix web run build`
Expected: the suite green (the page tests and scroll tests now pass); typecheck and lint clean; `next build` lists `/chat/[id]`, `/api/chat`, `/api/feedback`, and `/api/conversations/[id]` as dynamic routes. Typical build failures and their fixes: a server-only import reached from `Chat.tsx` (`@/lib/chat/handleChat` must be imported by the `[id]` page only, never by a client component); `window.history.replaceState` flagged by the `react-hooks` lint rules (it is inside an event handler, which is allowed); `params` typed as a plain object (Next 16 hands it over as a Promise).

- [ ] **Step 6: Commit**

```bash
git add -A web/components web/app/chat web/lib/client/scroll.ts web/tests/app/pages.test.ts web/tests/client/scroll.test.ts
git commit -m "feat(web): the chat page: live and replayed turns, suggestion chips, feedback, conversation list"
```

---
### Task 10: Runbook, settings, and the preview verification (owner + session)

**Files:**
- Modify: `web/docs/DEPLOY.md`, `web/tests/app/deploy.test.ts`
- Owner steps (outside the repository): the Supabase SQL editor, the Vercel environment, `web/.env.local`, a preview deployment.

**Interfaces:**
- Consumes: migration 0002 (Task 2); `UN_API_KEY` (already in `lib/config.ts` and `.env.example` from Plan A).
- Produces: the deployed agent core, verified against spec section 1's list.

- [ ] **Step 1: Write the failing test**

In `web/tests/app/deploy.test.ts`, extend the two phrase lists:

```ts
    // in "the environment example names every setting the loader reads": add
      "UN_API_KEY=",
    // in "the deploy document covers the Supabase auth settings the code depends on": add
      "0002_turns.sql", "UN_API_KEY", "ANTHROPIC_API_KEY", "Agent core verification",
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix web test -- tests/app/deploy`
Expected: FAIL on `0002_turns.sql` (and the other new phrases) missing from `docs/DEPLOY.md`.

- [ ] **Step 3: Update the runbook**

In `web/docs/DEPLOY.md`:

1. Section 1, step 2: after the 0001 sentence add: `Sub-project 3 adds \`web/supabase/migrations/0002_turns.sql\` (the \`finish_turn\` function and two scenario columns); run it the same way after 0001.`
2. Section 2 (Anthropic): replace "Not needed until sub-project 3. When it is:" with `Used by the web app from sub-project 3 on (every chat turn) and by the sim service's parameter repair.` and keep the workspace and spend-limit sentences.
3. Section 3 (Environment): add a paragraph: `\`UN_API_KEY\` is the UN Population Data Portal bearer for \`fetch_demographics\`. Empty is allowed: the live call then goes without a bearer, and a failure falls back to the simulation service's CSV demographics. Set it in Vercel (Production and Preview) and in \`web/.env.local\` before the agent-core deploy; the key is the owner's UN Population Data Portal bearer (see `UN_API_KEY` in `.env.example`).`
4. Append a new section before "## 7. Simulation service":

```markdown
## 6b. Agent core verification

Done on a preview deployment after the agent-core branch is pushed, by the
owner and the session together (`docs/superpowers/specs/2026-10-08-agent-core-design.md`,
section 1). Each line is one conversation; the Table Editor checks follow.

1. English, end to end: "Model a measles outbreak in Kenya" → confirm the
   configuration → "Fetch the data" → "Run it". Expect the disease lookup
   line, the configuration line, three data lines (UN, World Bank, WHO), the
   simulation line with peak and attack rate, suggestion chips after every
   reply, and thumbs under each reply.
2. Portuguese: "Simule um surto de dengue no Brasil" — the reply is in
   Portuguese and the tools still run.
3. A refusal: ask for something the model declines (for instance, how to
   make an outbreak worse on purpose). Expect the refusal message
   ("I'm unable to help with that request…") and nothing appended: the next
   message continues the conversation as before.
4. A pause_turn with web search: "Search the web for the latest measles
   case counts in Kenya and summarize them" — expect web-search and read-page
   lines, and a reply that cites pages.
5. Resume: open the conversation from the list; every turn replays with its
   tool lines; delete it; it leaves the list and its address answers 404.

Table Editor, for the English conversation (replace the id):

    select seq, stop, model, input_tokens, output_tokens, cache_read_tokens, cost_usd,
           first_token_at - started_at as to_first_token, finished_at - started_at as total,
           jsonb_array_length(api_calls) as calls, stage_before, stage_after
    from turns where conversation_id = '<id>' order by seq;
    select t.seq, e.seq, e.kind, e.at from turn_events e join turns t on t.id = e.turn_id
    where t.conversation_id = '<id>' order by t.seq, e.seq;   -- thinking rows present, in order, timestamps ascending
    select seq, disease, country_iso3, total_population, stage, stage_reached, has_run from scenarios where conversation_id = '<id>';
    select turn_id, pop_scale, duration_ms, sim_cold_start, error is not null as failed from runs where conversation_id = '<id>';
    select kind, stage, tool, meta, at from step_events where conversation_id = '<id>' order by at;
    select rating, comment, created_at from feedback where conversation_id = '<id>';
    select * from usage_daily where day = current_date;

Expected: `turns.api_calls` has one entry per model call with tokens and
latency; `thinking` events exist; `feedback` has the thumbs pressed;
`step_events` shows conversation_started, tool_called, stage_reached (one per
stage), run_completed, turn, suggestion_used, feedback_given, with ascending
times; `usage_daily.cost_usd` grew by the sum of `turns.cost_usd`.
```

- [ ] **Step 4: Run the test to verify it passes, then the whole suite**

Run: `npm --prefix web test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add web/docs/DEPLOY.md web/tests/app/deploy.test.ts
git commit -m "docs(deploy): migration 0002, UN_API_KEY, and the agent-core verification list"
```

- [ ] **Step 6: Owner steps, in order (after the branch is reviewed and merged, before or right after the push)**

1. Supabase SQL editor: run `web/supabase/migrations/0002_turns.sql`. Expect "Success. No rows returned". Run it again to confirm it is idempotent.
2. `printf '%s' "<the UN key>" | npx vercel env add UN_API_KEY production,preview --sensitive --yes` from the repository root, and add `UN_API_KEY=<the UN key>` to `web/.env.local`. The key is the owner's UN Population Data Portal bearer; never print it in chat.
3. Push the branch (a preview deploy) or `main` (production); confirm the deployment is Ready with `npx vercel ls epichat`.
4. Work through section 6b of the runbook on the deployment with the session; paste the Table Editor results into the conversation (ids and counts only).
5. `curl -s -H "Authorization: Bearer $CRON_SECRET" https://epichat-ai.vercel.app/api/health` still answers `{"ok":true,...,"sim":{"ok":true,...}}`.

---

## Self-review notes

- **Spec coverage.** Section 3.1 (`POST /api/chat`): gates in Task 1 and Task 7; the stream error table in Task 6 (`bad_request`/`message_too_long` from Task 1, `conversation_not_found`, caps, `service_unavailable`, `conversation_invalid`); the event shapes in Task 3; thinking stored only in Task 3. Section 3.2 (`/api/feedback`) and 3.3 (`DELETE`): Task 7, stores in Task 4. Section 3.4 (pages): Task 9. Section 4 (`UN_API_KEY`): Task 7 wires it, Task 10 deploys it. Section 7 (turn loop): Task 5, with the exact request object, the tool order, the event order, the stop rules, the retry, and per-call usage with `served_by`. Section 8 (blocks and stages): Task 3 (blocks, segments), Task 6 (stages after each tool result and at turn end, `stage_reached`, new-scenario reset through Plan A's `resetScenario`), Task 8 (the browser reducer). Section 9 (persistence): Task 2 (`finish_turn`), Task 4 (stores), Task 6 (the payload by outcome, runs inserted as they happen, the scenario saved whatever the outcome, `contextText` from `turns.user_text`, usage in `finally`). Section 11 (page): Task 9, with the Python labels from Task 8 and the status line. Section 12 (errors): Task 6 (`SIMULATION ERROR` is Plan A's; `BadRequestError` → `conversation_invalid`; others → `service_unavailable` with the Python text; `stop = error`). Section 13 (tests): every listed `runTurn`, `handleChat`, reducer, `finish_turn`, and route-gate case has a named test above. Section 14 (deployment): Task 7 (`maxDuration`), Task 10.
- **Deviations stated** (also in the header's refinement list): optional `sessionId`; two scenario columns; `runs.scenario_id` backfill; replay of finished turns only; `feedback_given` written by the route only; step events inside the `finish_turn` payload; text stored in segments; the feedback body's optional `sessionId`; the stage goes to `run` only when params exist; cost priced at the configured model with `served_by` recorded.
- **Type consistency.** `Block`, `StoredEvent`, `TurnEvent`, `ChatStreamEvent` are defined once in Task 3 and consumed by Tasks 4, 5, 6, 8, 9. `ApiCall`, `FinishTurnPayload`, `StepEventJson`, `StoredStop`, `ReplayTurn`, `ScenarioJson` come from Task 4 and are consumed by Tasks 5, 6, 9. `TurnStop` (six values) is Task 5's; `StoredStop` adds `error` and `aborted`. `ChatDeps` (Task 6) is built by Task 7's route with the Task 4 stores and Plan A's `createSimClient` and adapters. `DisplayTurn` (Task 9) is built by the `[id]` page from `ReplayTurn`. `requireParticipant`'s `Gate` (Task 1) is what Task 7 branches on. `executeTool(name, input, deps, now)` is Plan A's signature, used with `now` in Task 6 so the tool's `duration_ms` and the step event agree.
- **Review Focus mapping.** 1 → Task 6 `records an aborted turn without appending messages and still records usage`; 2 → Task 5 `answers a tool call on a paused message before resuming`; 3 → Task 3 `parses suggestions from the last text segment and keeps inline code`; 4 → Task 4 `treats unparseable saved params as absent`; 5 → Task 5 `reports web fetches by title or URL and web errors as notices` and Task 6 `records a fetched page once, and web events as steps`.
- **Placeholder scan.** No TBDs; every code step carries its code; the only prose-described edits are the three one-line import changes in Task 4 and the test-list extensions in Tasks 9 and 10, each with the exact text.
- **Plan A obligations.** `[]` from `parseNext` is no suggestions (Task 6, `treats an empty suggestions block as no suggestions`); `onRun` never throws (Task 6, `keeps the run when its row cannot be inserted`); `contextText` has no date line (Task 6, `the context has no date line`); the implemented names `deriveStage`/`advanceStage`/`firstUserMessage`/`systemBlocks` are used as they exist.
