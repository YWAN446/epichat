# Share Link (sub-project 4e) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A participant shares a conversation as a link to a frozen, read-only snapshot that anyone can open, can update or revoke it, and the study records every share and open.

**Architecture:** A `shares` row holds a random token and a self-contained snapshot (the replayed turns with each run's series embedded, plus the latest report document). A public page under `/s/` renders the snapshot with the existing `Turn` and panel components and nothing interactive; a sibling route renders the report's HTML. Two participant routes create/update and revoke; four new step-event kinds record it. Migration 0005 adds the table with the project's privilege rule, the kinds, and a view counter function.

**Tech Stack:** Next.js 16 App Router (Node runtime), React 19, zod 4, vitest 5 with `@electric-sql/pglite`, Supabase.

**Spec:** `docs/superpowers/specs/2026-10-09-share-link-design.md`

## Global Constraints

- No new npm dependency. Files are CRLF; edit with scripts that preserve line endings or write whole files.
- Token: 16 random bytes, base64url, 22 characters, alphabet `[A-Za-z0-9_-]`.
- The snapshot carries no email, user id, or session id; thinking is excluded; series thinned to 400 points, then 200, then dropped past 2 MB (spec section 4).
- Copy, verbatim: dialog sentence `Anyone with the link can read this conversation as it is now. Your email is not shown.`; unavailable page `This shared conversation is no longer available.`; page line `A frozen copy of an EpiChat conversation, shared by a study participant on <date>`; footer `EpiChat is a research prototype from Emory University.`; dialog errors `Nothing to share yet.` and `Something went wrong. Please try again.`; consent sentence (spec section 10); consent version `2026-10-09`.
- Headers on `/s/*`: `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`.
- Every table gets RLS and the service-role grants (0001's rule); `tests/db/schema.test.ts` `TABLES` gains `shares`.
- Commit messages end with the session's two attribution lines.

## Review Focus

1. A shared conversation whose run has no stored series: the chart says "Series unavailable." and nothing crashes (Task 1 snapshot test; the run card already handles an absent series).
2. A turn cut off by max_tokens carries its notice into the snapshot (Task 1).
3. A revoked link opened again: the page must not come from a cache (Task 4 pins `no-store`; Task 2 pins `record_share_view` returning null once revoked).
4. The public page logs an open; a failure to log must not break the render (Task 4 static pin on the try/catch; the view call is best-effort).
5. A second share of the same conversation while one is active must update, never create a duplicate (Task 2's partial unique index test; Task 3's route test: `created: false` on the second call).

---

### Task 1: The token and the snapshot

**Files:**
- Create: `web/lib/share/token.ts`, `web/lib/share/snapshot.ts`
- Test: `web/tests/share/token.test.ts`, `web/tests/share/snapshot.test.ts`

**Interfaces:**
- Produces: `newToken(): string`, `isToken(s: string): boolean`; `ShareSnapshot`, `ShareTurn`, `SNAPSHOT_MAX_BYTES = 2_000_000`, `buildSnapshot(input: { title: string; replay: ReplayTurn[]; series: Map<string, Series>; report: ReportDocument | null }, now: Date): ShareSnapshot`, `snapshotBytes(snapshot): number`.
- Consumes: `ReplayTurn` (`lib/db/turns.ts`), `CUT_OFF_NOTICE` (`lib/chat/handleChat.ts`), `thinPoints` (`lib/client/chart.ts`), `ReportDocument`.

- [ ] **Step 1: Write the failing tests**

`tests/share/token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isToken, newToken } from "@/lib/share/token";

describe("share tokens", () => {
  it("are 22 base64url characters, distinct, and recognised", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => newToken()));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(isToken(token)).toBe(true);
    }
    expect(isToken("")).toBe(false);
    expect(isToken("abc")).toBe(false);
    expect(isToken("a".repeat(22) + "b")).toBe(false);
    expect(isToken("../../etc/passwd!!!!!!")).toBe(false);
  });
});
```

`tests/share/snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ReplayTurn } from "@/lib/db/turns";
import { SNAPSHOT_MAX_BYTES, buildSnapshot, snapshotBytes } from "@/lib/share/snapshot";
import { CUT_OFF_NOTICE } from "@/lib/chat/handleChat";
import type { RunPayload } from "@/lib/tools/types";
import { params } from "../tools/helpers";

const STATS = { peak_infections: 900, peak_day: 40, total_infected: 4000, total_deaths: 12, n_agents: 10000, sim_days: 366 };
const RUN: RunPayload = { kind: "run", run_id: "run-1", stats: STATS, stats_agents: STATS, attack_rate_pct: 40, pop_scale: 1, population: 10000, effective_params: params({}), warnings: [], repairs: [], data_sources: [], duration_ms: 1000, cold_start: false };
const DAYS = Array.from({ length: 1096 }, (_, i) => i);
const replay: ReplayTurn[] = [
  { id: "t1", seq: 1, userText: "Model measles in Kenya", stop: "end_turn", blocks: [{ kind: "text", text: "Sure." }, { kind: "tool_result", id: "tu", name: "run_simulation", ok: true, payload: RUN }] },
  { id: "t2", seq: 2, userText: "And again", stop: "max_tokens", blocks: [{ kind: "tool_result", id: "tu2", name: "run_simulation", ok: true, payload: { ...RUN, run_id: "run-2" } }] },
];
const NOW = new Date("2026-10-09T18:00:00Z");

describe("buildSnapshot", () => {
  it("copies the turns, embeds and thins each run's series, keeps the cut-off notice, and copies the report", () => {
    const series = new Map([["run-1", { day: DAYS, n_infected: DAYS.map((d) => d % 7) }]]);
    const snapshot = buildSnapshot({ title: "Measles in Kenya", replay, series, report: null }, NOW);
    expect(snapshot).toMatchObject({ version: 1, title: "Measles in Kenya", takenAt: NOW.toISOString(), report: null });
    expect(snapshot.turns.map((t) => [t.id, t.userText, t.notice])).toEqual([["t1", "Model measles in Kenya", null], ["t2", "And again", CUT_OFF_NOTICE]]);
    const first = snapshot.turns[0].blocks[1];
    if (first.kind !== "tool_result" || first.payload.kind !== "run") throw new Error("run");
    expect(first.payload.series?.day.length).toBeLessThanOrEqual(401);
    expect(first.payload.series?.day.at(-1)).toBe(1095);
    const second = snapshot.turns[1].blocks[0];
    if (second.kind !== "tool_result" || second.payload.kind !== "run") throw new Error("run");
    expect(second.payload.series).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain("@");
  });

  it("drops thinking blocks that slipped in and never carries ids beyond turns and runs", () => {
    const withThinking: ReplayTurn[] = [{ ...replay[0], blocks: [{ kind: "thinking", summary: "plan" } as never, ...replay[0].blocks] }];
    const snapshot = buildSnapshot({ title: "T", replay: withThinking, series: new Map(), report: null }, NOW);
    expect(snapshot.turns[0].blocks.map((b) => b.kind)).toEqual(["text", "tool_result"]);
  });

  it("thins harder, then drops series, to stay under the size limit", () => {
    const huge = Array.from({ length: 400 }, (_, i) => i);
    const bigReplay: ReplayTurn[] = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, seq: i + 1, userText: "x", stop: "end_turn", blocks: [{ kind: "tool_result", id: "tu", name: "run_simulation", ok: true, payload: { ...RUN, run_id: `run-${i}` } }] }));
    const series = new Map(bigReplay.map((t, i) => [`run-${i}`, Object.fromEntries(Array.from({ length: 30 }, (_, k) => [`k${k}`, huge.map((d) => d * 1000.123)])) as Record<string, number[]>]));
    const snapshot = buildSnapshot({ title: "T", replay: bigReplay, series, report: null }, NOW);
    expect(snapshotBytes(snapshot)).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
  });
});
```

- [ ] **Step 2: Run them to verify they fail** — `npx vitest run tests/share` → modules missing.

- [ ] **Step 3: Implement**

`lib/share/token.ts`:

```ts
/** A share's address: 128 random bits, base64url, 22 characters. */
export const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export function newToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function isToken(value: string): boolean {
  return TOKEN.test(value);
}
```

`lib/share/snapshot.ts`:

```ts
/** What a share shows: a frozen copy of the conversation (share spec, section 4). Pure. */
import type { Block } from "@/lib/chat/events";
import { CUT_OFF_NOTICE } from "@/lib/chat/handleChat";
import { thinPoints, type Series } from "@/lib/client/chart";
import type { ReplayTurn } from "@/lib/db/turns";
import type { ReportDocument } from "@/lib/report/document";

export type ShareTurn = { id: string; userText: string; blocks: Block[]; notice: string | null };
export type ShareSnapshot = { version: 1; title: string; takenAt: string; turns: ShareTurn[]; report: ReportDocument | null };
export const SNAPSHOT_MAX_BYTES = 2_000_000;

export function snapshotBytes(snapshot: ShareSnapshot): number {
  return Buffer.byteLength(JSON.stringify(snapshot), "utf8");
}

function thinSeries(series: Series, max: number): Series {
  const days = series.day ?? [];
  const out: Series = {};
  for (const [key, values] of Object.entries(series)) {
    if (key === "day") continue;
    const points = thinPoints(days, values, max);
    out[key] = points.map((p) => p.y);
    out.day = points.map((p) => p.x);
  }
  if (!out.day) out.day = days;
  return out;
}

function turnsWith(replay: ReplayTurn[], series: Map<string, Series>, max: number | null): ShareTurn[] {
  return replay.map((turn) => ({
    id: turn.id,
    userText: turn.userText,
    notice: turn.stop === "max_tokens" ? CUT_OFF_NOTICE : null,
    blocks: turn.blocks
      .filter((block) => block.kind !== ("thinking" as Block["kind"]))
      .map((block) => {
        if (block.kind !== "tool_result" || !block.ok || block.payload.kind !== "run" || !block.payload.run_id) return block;
        const found = series.get(block.payload.run_id);
        if (!found || max === null) {
          const { series: _dropped, ...payload } = block.payload;
          void _dropped;
          return { ...block, payload };
        }
        return { ...block, payload: { ...block.payload, series: thinSeries(found, max) } };
      }),
  }));
}

export function buildSnapshot(input: { title: string; replay: ReplayTurn[]; series: Map<string, Series>; report: ReportDocument | null }, now: Date): ShareSnapshot {
  const base = { version: 1 as const, title: input.title, takenAt: now.toISOString(), report: input.report };
  for (const max of [400, 200, null]) {
    const snapshot: ShareSnapshot = { ...base, turns: turnsWith(input.replay, input.series, max) };
    if (snapshotBytes(snapshot) <= SNAPSHOT_MAX_BYTES || max === null) return snapshot;
  }
  throw new Error("unreachable");
}
```

(The stored replay never carries thinking, but the filter keeps the promise.)

- [ ] **Step 4: Run the tests** — PASS; typecheck clean.
- [ ] **Step 5: Commit** — `feat(share): the share token and the frozen snapshot`.

---

### Task 2: Migration 0005, the share store, and the event kinds

**Files:**
- Create: `web/supabase/migrations/0005_shares.sql`, `web/lib/db/shares.ts`
- Modify: `web/lib/enums.ts` (`SERVER_EVENT_KINDS` + the four share kinds), `web/tests/db/schema.test.ts` (`TABLES` + `shares`)
- Test: `web/tests/db/shares.test.ts` (pglite), `web/tests/db/stores.test.ts`

**Interfaces:**
- Produces: `ShareRow`, `ShareStore { active, create, update, revoke, byToken, view }` (spec section 5.2), `supabaseShareStore(admin)`, `shareRow(insert)`.

- [ ] **Step 1: Write the failing tests**

`tests/db/shares.test.ts`:

```ts
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";

const ALICE = "11111111-1111-1111-1111-111111111111";
let db: PGlite;
let conversation: string;

beforeEach(async () => {
  db = await createTestDb();
  conversation = (await db.query<{ id: string }>("insert into conversations (user_id) values ($1) returning id", [ALICE])).rows[0].id;
});

async function share(token: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into shares (token, conversation_id, user_id, title, snapshot, turn_count) values ($1, $2, $3, 'T', '{}', 1) returning id",
    [token, conversation, ALICE],
  );
  return rows[0].id;
}

describe("shares (0005)", () => {
  it("allows one active share per conversation and another after a revoke", async () => {
    const first = await share("a".repeat(22));
    await expect(share("b".repeat(22))).rejects.toThrow();
    await db.query("update shares set revoked_at = now() where id = $1", [first]);
    await expect(share("b".repeat(22))).resolves.toBeTruthy();
  });

  it("counts a view and stops once revoked", async () => {
    const id = await share("c".repeat(22));
    const seen = await db.query<{ id: string }>("select record_share_view($1) as id", ["c".repeat(22)]);
    expect(seen.rows[0].id).toBe(id);
    const row = await db.query<{ view_count: number; last_viewed_at: string }>("select view_count, last_viewed_at from shares where id = $1", [id]);
    expect(row.rows[0].view_count).toBe(1);
    expect(row.rows[0].last_viewed_at).not.toBeNull();
    await db.query("update shares set revoked_at = now() where id = $1", [id]);
    expect((await db.query<{ id: string | null }>("select record_share_view($1) as id", ["c".repeat(22)])).rows[0].id).toBeNull();
    expect((await db.query<{ id: string | null }>("select record_share_view($1) as id", ["zzz"])).rows[0].id).toBeNull();
  });

  it("accepts the share step-event kinds and applies twice", async () => {
    for (const kind of ["share_created", "share_updated", "share_revoked", "share_opened"]) {
      await db.query("insert into step_events (user_id, conversation_id, kind, meta) values ($1, $2, $3, '{}')", [ALICE, conversation, kind]);
    }
    await db.exec(readFileSync("supabase/migrations/0005_shares.sql", "utf8"));
    expect((await db.query<{ n: number }>("select count(*)::int as n from shares")).rows[0].n).toBe(0);
  });
});
```

`tests/db/stores.test.ts` gains a `share store` describe through `fakeAdmin`: `create` inserts `shareRow(...)` and returns the row; `active` selects by `conversation_id`, `user_id`, `is("revoked_at", null)`; `update` updates `snapshot, title, turn_count, taken_at` by id; `revoke` updates `revoked_at` where `conversation_id`, `user_id`, `revoked_at is null` and reports whether a row changed (`select("id")` on the update and `data.length > 0`); `byToken` selects by token with `is("revoked_at", null)` `.maybeSingle()`; `view` calls `rpc("record_share_view", { p_token })` and returns the data.

`tests/db/schema.test.ts`: `TABLES` gains `"shares"`. The enum: `SERVER_EVENT_KINDS` gains `"share_created", "share_updated", "share_revoked", "share_opened"` (schema.test's kinds check will demand the migration).

- [ ] **Step 2: Run them to verify they fail** — `npx vitest run tests/db` → relation `shares` missing, kinds refused, store missing.

- [ ] **Step 3: Write the migration** (spec section 5.1 verbatim, with the `record_share_view` function and its privilege block copied from 0004's `finish_turn` block, naming the function `record_share_view(text)`), the store, and the enum change.

- [ ] **Step 4: Run** `npx vitest run tests/db tests/lib && npm run -s typecheck` — PASS.
- [ ] **Step 5: Commit** — `feat(share): shares table and migration 0005, the share store, and the share event kinds`.

---

### Task 3: The share routes and the delete hook

**Files:**
- Create: `web/app/api/shares/route.ts`
- Modify: `web/app/api/conversations/[id]/route.ts`, `web/next.config.ts` (tracing for `/api/shares`)
- Test: `web/tests/api/sharesRoute.test.ts`, `web/tests/api/conversationsRoute.test.ts`

**Interfaces:**
- Produces: `POST /api/shares { conversationId }` → `{ token, url, takenAt, turnCount, created }`; `DELETE /api/shares { conversationId }` → 204/404.
- Consumes: `supabaseConversationStore.get`, `supabaseTurnStore.listForReplay`, the runs' series (`admin.from("runs").select("id, series").in("id", ids)` through a new `RunStore.seriesFor(ids: string[]): Promise<Map<string, Series>>`), the latest report (`ReportStore.latest(conversationId): Promise<ReportRow | null>`, a new method selecting by `conversation_id` ordered by version desc, limit 1), `buildSnapshot`, `newToken`, `supabaseShareStore`, `supabaseStepEventSink`.

- [ ] **Step 1: Write the failing tests**

`tests/api/sharesRoute.test.ts` mocks `requireParticipant` and `adminClient`; `fakeAdmin` outcomes: `conversations` (the owner's row), `turns` (one replay row with `turn_events`), `runs` (series rows), `reports` (latest or none), `shares` (active or none, then the insert/update result), `step_events` (insert). Cases: first share → 200 with a 22-char token, `url` ending `/s/<token>`, `created: true`, `step_events` insert with `kind: "share_created"` and meta `{ turn_count: 1, has_report: false }`; second share (an active row) → `created: false`, the update call, `share_updated`; no finished turns → 400 `{ code: "nothing_to_share" }`; another participant's conversation → 404; DELETE → 204 and `share_revoked`; DELETE with none active → 404; the gate passes through; a `shares` insert error → 500.

`tests/api/conversationsRoute.test.ts`: the existing delete test also expects `callOn(admin.recorded, "shares", "update")?.[0]` to match `{ revoked_at: expect.any(String) }` (the revoke runs before the soft delete), and a share-revoke error does not change the 204.

- [ ] **Step 2: Run them to verify they fail.**

- [ ] **Step 3: Implement**

```ts
// web/app/api/shares/route.ts
import { z } from "zod";
import { supabaseConversationStore } from "@/lib/db/conversations";
import { supabaseReportStore } from "@/lib/db/reports";
import { supabaseRunStore } from "@/lib/db/runs";
import { supabaseShareStore } from "@/lib/db/shares";
import { supabaseTurnStore } from "@/lib/db/turns";
import { requireParticipant } from "@/lib/participant.server";
import { buildSnapshot } from "@/lib/share/snapshot";
import { newToken } from "@/lib/share/token";
import { supabaseStepEventSink } from "@/lib/stepEvents";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const Body = z.strictObject({ conversationId: z.uuid() });
const UNAVAILABLE = { code: "service_unavailable", message: "Something went wrong. Please try again." };

async function readBody(request: Request): Promise<{ conversationId: string } | null> {
  try { const parsed = Body.safeParse(await request.json()); return parsed.success ? parsed.data : null; } catch { return null; }
}

/** Create the conversation's share, or refresh its snapshot (share spec, section 6). */
export async function POST(request: Request): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  if (!body) return Response.json({ code: "bad_request", message: "conversationId is required." }, { status: 400 });
  const admin = adminClient();
  try {
    const conversation = await supabaseConversationStore(admin).get(body.conversationId, gate.user.id);
    if (!conversation) return Response.json({ code: "not_found", message: "That conversation is no longer available." }, { status: 404 });
    const replay = await supabaseTurnStore(admin).listForReplay(conversation.id);
    if (replay.length === 0) return Response.json({ code: "nothing_to_share", message: "Nothing to share yet." }, { status: 400 });
    const runIds = replay.flatMap((t) => t.blocks.flatMap((b) => (b.kind === "tool_result" && b.ok && b.payload.kind === "run" && b.payload.run_id ? [b.payload.run_id] : [])));
    const [series, report] = await Promise.all([supabaseRunStore(admin).seriesFor(runIds), supabaseReportStore(admin).latest(conversation.id)]);
    const now = new Date();
    const snapshot = buildSnapshot({ title: conversation.title, replay, series, report: report?.document ?? null }, now);
    const shares = supabaseShareStore(admin);
    const active = await shares.active(conversation.id, gate.user.id);
    let token: string;
    if (active) {
      await shares.update(active.id, { title: conversation.title, snapshot, turnCount: replay.length }, now);
      token = active.token;
    } else {
      token = (await shares.create({ conversationId: conversation.id, userId: gate.user.id, title: conversation.title, snapshot, turnCount: replay.length, token: newToken() })).token;
    }
    const kind = active ? "share_updated" : "share_created";
    await supabaseStepEventSink(admin).log(gate.user.id, [{ kind, conversationId: conversation.id, meta: { share_id: active?.id ?? token, turn_count: replay.length, has_report: report !== null } }]);
    return Response.json({ token, url: `${new URL(request.url).origin}/s/${token}`, takenAt: now.toISOString(), turnCount: replay.length, created: !active });
  } catch (error) {
    console.error("share failed", error instanceof Error ? error.message : String(error));
    return Response.json(UNAVAILABLE, { status: 500 });
  }
}

/** Stop sharing. */
export async function DELETE(request: Request): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  if (!body) return Response.json({ code: "bad_request", message: "conversationId is required." }, { status: 400 });
  const admin = adminClient();
  try {
    const revoked = await supabaseShareStore(admin).revoke(body.conversationId, gate.user.id, new Date());
    if (!revoked) return new Response(null, { status: 404 });
    await supabaseStepEventSink(admin).log(gate.user.id, [{ kind: "share_revoked", conversationId: body.conversationId, meta: {} }]);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("share revoke failed", error instanceof Error ? error.message : String(error));
    return Response.json(UNAVAILABLE, { status: 500 });
  }
}
```

(`meta.share_id` is the row id when known; on create, the store's returned row has it, so use `created.id`. The sink's `meta` values must be strings, numbers, booleans, or null.) The conversation delete route calls `supabaseShareStore(admin).revoke(id, gate.user.id, now)` in its own try/catch (logging) before `softDelete`, and logs `share_revoked` when it revoked. `RunStore.seriesFor` and `ReportStore.latest` get store tests in `tests/db/stores.test.ts`.

- [ ] **Step 4: Run** `npx vitest run tests/api tests/db && npm run -s typecheck && npm run -s lint` — PASS.
- [ ] **Step 5: Commit** — `feat(share): create, update, and revoke a share; deleting the conversation revokes it`.

---

### Task 4: The public page and the report page

**Files:**
- Create: `web/app/s/[token]/page.tsx`, `web/app/s/[token]/not-found.tsx`, `web/app/s/[token]/report/route.ts`, `web/components/SharedConversation.tsx`
- Modify: `web/components/panel/ScenarioSection.tsx` (`references?: boolean`, default true), `web/next.config.ts` (`headers()` for `/s/:path*`; tracing for `/s/[token]` and `/s/[token]/report` is unnecessary: they read no consent file)
- Test: `web/tests/app/share.test.ts` (static pins), `web/tests/api/shareReportRoute.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/app/share.test.ts` pins: the page file reads with `isToken(`, `byToken(`, calls `notFound()`, wraps `view(` and the `share_opened` log in `try`, exports `dynamic = "force-dynamic"` and `metadata` with `robots: { index: false, follow: false }`; `not-found.tsx` contains `This shared conversation is no longer available.`; `SharedConversation.tsx` contains `<Turn`, `feedback={null}`, `<ScenarioSection`, `references={false}`, `<RunsSection`, `<DataSection`, `<ActivitySection`, `View report`, `No report was written.`, `A frozen copy of an EpiChat conversation, shared by a study participant on`, `EpiChat is a research prototype from Emory University.`, `deriveArtifacts(`, and does not contain `<Composer`, `<Suggestions`, `<StageStrip`, `<RecapBar`, `FeedbackControl`, `sign-in`; `ScenarioSection.tsx` contains `references`; `next.config.ts` contains `X-Robots-Tag`, `noindex, nofollow`, `no-store`, `"/s/:path*"`.

`tests/api/shareReportRoute.test.ts` (mock `adminClient`; no participant gate): a share with a report answers `text/html`, `inline`, `no-store`, the body contains `<h2>Summary</h2>`; without a report → 404; unknown or malformed token → 404; a store error → 500.

- [ ] **Step 2: Run them to verify they fail.**

- [ ] **Step 3: Implement**

`app/s/[token]/page.tsx` (server component): `isToken` else `notFound()`; `supabaseShareStore(adminClient()).byToken(token)` else `notFound()`; in a try/catch, `view(token)` and `supabaseStepEventSink(admin).log(row.user_id, [{ kind: "share_opened", conversationId: row.conversation_id, meta: { share_id: row.id } }])`, logging failures; render `<SharedConversation snapshot={row.snapshot} token={token} takenAt={row.taken_at} />`. `export const dynamic = "force-dynamic"; export const metadata = { robots: { index: false, follow: false } };`.

`app/s/[token]/not-found.tsx`: the brand and the sentence.

`app/s/[token]/report/route.ts`: `GET` with `params`; `isToken` → 404; `byToken` → 404; no `snapshot.report` → 404; else `new Response(renderHtml(row.snapshot.report), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": "inline", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } })`; errors → 500.

`components/SharedConversation.tsx` ("use client"): the header (Brand, title, the line with the date formatted `en-GB` long), a two-column layout from xl (`grid xl:grid-cols-[minmax(0,46rem)_24rem]`) and one column below, the turns with `<Turn key turn={{ id, userText, blocks, notice }} status={null} feedback={null} />`, the panel sections with `Section` (local `useState` for open/closed, Scenario and Runs open), `ScenarioSection references={false}`, `DataSection`, `RunsSection onChartView={() => {}}`, `ActivitySection`, the Report section with `<a href={`/s/${token}/report`} target="_blank" rel="noreferrer">View report</a>` and the report's title and version from `snapshot.report` or the sentence, the footer.

`ScenarioSection`: `references = true` prop; when false the Status cell shows the status word only.

`next.config.ts`: `async headers() { return [{ source: "/s/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] }]; }`.

- [ ] **Step 4: Run** `npx vitest run tests/app tests/api && npm run -s typecheck && npm run -s lint && npm run -s build` — PASS; the build lists `/s/[token]` and `/s/[token]/report`.
- [ ] **Step 5: Commit** — `feat(share): the public page and the shared report`.

---

### Task 5: The Share dialog

**Files:**
- Create: `web/components/ShareDialog.tsx`
- Modify: `web/components/ChatHeader.tsx` (Share button + props), `web/components/Chat.tsx` (share state, dialog, reset), `web/app/chat/[id]/page.tsx` (`initialShare`)
- Test: `web/tests/app/share.test.ts` (static pins), `web/tests/client/share.test.ts` (a pure helper)

**Interfaces:**
- Produces: `components/ShareDialog.tsx` with props `{ open, conversationId, share: ShareState | null, onChange(share: ShareState | null), onClose }`, `ShareState = { token, url, takenAt, turnCount }`; `lib/client/share.ts` with `shareUrl(origin, token)` and `describeShare(share, now): string` ("Snapshot taken 9 October 2026 · 3 turns") plus `requestShare(conversationId, send)` / `revokeShare(conversationId, send)` returning typed results with the dialog's messages.

- [ ] **Step 1: Write the failing tests**: `tests/client/share.test.ts` for `describeShare` (singular/plural turns, the date), `requestShare` (200 → state; 400 → "Nothing to share yet."; 500/network → "Something went wrong. Please try again."), `revokeShare` (204 → ok; 404 → ok too, nothing to revoke; 500 → the generic message). Static pins: `ShareDialog.tsx` contains `<dialog`, `showModal()`, `Create link`, `Update snapshot`, `Stop sharing`, `Copy`, `Copied`, `navigator.clipboard`, the sentence; `ChatHeader.tsx` contains `Share` and `onShare`; `Chat.tsx` contains `<ShareDialog`, `initialShare`, and `setShare(null)` inside `resetConversation`; `app/chat/[id]/page.tsx` contains `active(` and `initialShare`.

- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement** as specified in spec section 8; the header's Share button is a `button` between New and Details, hidden when `conversationId` is null, disabled while busy; the dialog element is rendered by `Chat` and opened by the button.
- [ ] **Step 4: Run** `npx vitest run tests/app tests/client && npm run -s typecheck && npm run -s lint` — PASS.
- [ ] **Step 5: Commit** — `feat(share): the Share dialog`.

---

### Task 6: Consent text, docs, and the deploy pins

**Files:**
- Modify: `web/content/consent.md` (the sentence, version `2026-10-09`), `web/docs/DEPLOY.md` (section 1.2: 0005; new section 6f; the consent version note), `web/tests/app/deploy.test.ts`, `web/tests/lib/consent.test.ts` if it pins the version
- Test: the deploy pins (`0005_shares.sql`, `/api/shares`, `/s/`, `Share verification`, `2026-10-09`)

- [ ] **Step 1: Add the pins and run** `npx vitest run tests/app/deploy.test.ts tests/lib` → FAIL.
- [ ] **Step 2: Write the docs and the consent change.**
- [ ] **Step 3: Run** `npm test && npm run -s typecheck && npm run -s lint && npm run -s build` — PASS.
- [ ] **Step 4: Commit** — `docs: share verification, migration 0005, and the consent sentence`.
