# EpiChat Workspace (sub-project 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-column chat into a workspace: conversations on the left, a simple conversation in the middle with one activity line per reply and an inline run summary, a details panel on the right projected from stored events, a stage strip with draft messages, and a model-kept recap of decisions.

**Architecture:** The server gains one block kind (`recap`, parsed from a fenced block like `next`), one migration, one read route for a run's series, and a prompt change. Everything else is browser code: pure projection and summary functions in `lib/client/`, an SVG chart, and components composed by `Chat.tsx`, which keeps owning the conversation state and now renders a three-column shell.

**Tech Stack:** Next.js 16.3.8 (App Router, Node runtime), React 19.2.8, TypeScript, Tailwind 4 tokens from `app/globals.css`, zod 4, vitest 5 (node environment; component tests are static source checks), `@electric-sql/pglite` for SQL tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-workspace-design.md` (parent: `docs/superpowers/specs/2026-10-07-web-agent-architecture-design.md`; predecessor: `docs/superpowers/specs/2026-10-08-agent-core-design.md`).

## Global Constraints

- Work in `web/`. Commands below run from `web/` unless they say otherwise. Tests: `npx vitest run <file>`; whole suite: `npm test`; `npm run typecheck`; `npm run lint`; `npm run build`.
- Never run `npm install`; dependencies are fixed (`npm ci` only). No new packages: the chart is inline SVG.
- Commit messages end with the two attribution lines the session reminder gives.
- The stage is derived from tool results, never declared by the model (parent spec 10.1). No code path sets a stage from text.
- Hidden fenced blocks are `next` and `recap`; stored text and shown text never contain either, complete or arriving.
- Order at turn end: the `recap` block is emitted and stored before `suggestions`.
- Recap limits: 8 items, 120 characters each. Suggestions keep 3 items, 80 characters.
- Copy, verbatim: empty states "The configuration appears here once a scenario is set up.", "Real data appears here once it is fetched.", "Results appear here after the first run.", "Steps appear here as the assistant works.", "A conversation appears here after your first message."; chart fallback "Series unavailable."; recap heading "Decisions so far"; stage labels Understand, Configure, Ground in data, Run, Interpret; hints and drafts as in the spec's section 6 table.
- Client events: `suggestion_used.source` is `"model"` or `"draft"`; `card_expanded.card` adds `"activity"` and `"recap"`; `scenario_panel_opened.section` is one of `scenario`, `data`, `runs`, `activity`. Free text never enters an event.
- Breakpoint for three columns: Tailwind `xl` (1280 px). Left column 16 rem, right 24 rem, middle content at most 46 rem.
- `GET /api/runs/[id]` answers only the caller's run that has a series; `Cache-Control: private, max-age=3600`.
- Migration `0003_recap.sql` is idempotent and leaves every other kind in the check unchanged.
- The Python system prompt text (`data/system_prompt.json`) is never edited; only the appended sections change.

## Review Focus

1. A replayed run whose `run_id` is null (the runs insert failed at the time): tiles must render and the chart must say "Series unavailable." without a request. Pinned by `initialSeriesState` in Task 7.
2. A series that is all zeros or one point: the chart must not divide by zero or draw NaN paths. Pinned by `niceTicks(0, 4)` and `linePath` with a single point in Task 7.
3. A reply that omits the recap block after earlier replies had one: the bar keeps the newest recap, and nothing hidden shows as text. Pinned by `lastRecap` in Task 1.
4. A turn made of web steps only (search, read, no tools): the activity line still summarizes it. Pinned in Task 6.
5. The `run` stage while a simulation runs: no draft chips, the hint explains the wait. Pinned by `chipsFor("run", [])` in Task 4.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/chat/fenced.ts` (new) | parse and strip tagged fenced blocks |
| `lib/chat/next.ts` | thin wrappers: `parseNext`, `parseRecap`, `withoutNext`, `withoutHidden` |
| `lib/chat/events.ts` | `recap` block and stream event; sink stores text after `withoutHidden` |
| `lib/chat/handleChat.ts` | emit and store the recap before the suggestions |
| `lib/chat/prompt.ts` | "Decisions recap" and "The interface" sections |
| `lib/client/turn.ts` | reducer handles `recap`; `lastRecap` |
| `lib/client/drafts.ts` (new) | stage labels, hints, drafts, `chipsFor` |
| `lib/client/artifacts.ts` (new) | `deriveArtifacts` projection |
| `lib/client/activity.ts` (new) | `summarizeActivity`, `formatDuration` |
| `lib/client/chart.ts` (new) | chart math: lines per view, thinning, ticks, paths, compact numbers |
| `lib/client/series.ts` (new) | `loadSeries` with a per-id cache, `initialSeriesState` |
| `lib/client/conversations.ts` (new) | `groupByDay` for the sidebar |
| `lib/enums.ts`, `lib/clientEvents.ts`, `app/api/event/route.ts` | new event fields |
| `app/api/runs/[id]/route.ts` (new) | a run's series for its owner |
| `supabase/migrations/0003_recap.sql` (new) | the `recap` event kind |
| `components/Chart.tsx`, `RunSummary.tsx`, `ActivityLine.tsx`, `Turn.tsx`, `TurnBlocks.tsx` | the middle column's reply |
| `components/panel/Section.tsx`, `ScenarioSection.tsx`, `DataSection.tsx`, `RunsSection.tsx`, `ActivitySection.tsx`, `DetailsPanel.tsx` | the right column |
| `components/RecapBar.tsx`, `StageStrip.tsx`, `ConversationList.tsx`, `ChatHeader.tsx` | bottom stack, left column, header |
| `components/WorkspaceShell.tsx`, `Chat.tsx`, `app/chat/[id]/page.tsx` | the shell and its state |
| `docs/DEPLOY.md`, `next.config.ts` | runbook and tracing |

---

### Task 1: The recap block end to end on the server and in the reducer

**Files:**
- Create: `lib/chat/fenced.ts`
- Modify: `lib/chat/next.ts`, `lib/chat/events.ts:12-45`, `lib/chat/handleChat.ts:24,237-241`, `lib/client/turn.ts`, `components/TurnBlocks.tsx:2,15`
- Test: `tests/chat/fenced.test.ts` (new), `tests/chat/events.test.ts`, `tests/chat/handleChat.test.ts`, `tests/client/turn.test.ts`

**Interfaces:**
- Consumes: `createEventSink` and `parseNext` as they exist; `Block`, `ChatStreamEvent`.
- Produces: `parseFenced(text, tag, { maxItems, maxChars }): string[] | null`; `withoutFenced(text, tags): string`; `parseRecap(text): string[] | null`; `withoutHidden(text): string`; `Block` gains `{ kind: "recap"; items: string[] }`; `ChatStreamEvent` gains `{ type: "recap"; items: string[] }`; `TurnProgress.recap: string[]`; `lastRecap(turns): string[]`.

- [ ] **Step 1: Write the failing fenced-block tests**

`tests/chat/fenced.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseFenced, withoutFenced } from "@/lib/chat/fenced";
import { parseRecap, withoutHidden, withoutNext } from "@/lib/chat/next";

const LIMITS = { maxItems: 8, maxChars: 120 };
const reply = "Here is the plan.\n\n```recap\n- Measles in Kenya\n2. Population 2 million\n```\n\n```next\nRun it\n```";

describe("fenced blocks", () => {
  it("parses the last complete block with a tag, dropping list markers and applying the limits", () => {
    expect(parseFenced(reply, "recap", LIMITS)).toEqual(["Measles in Kenya", "Population 2 million"]);
    expect(parseFenced(reply, "next", { maxItems: 3, maxChars: 80 })).toEqual(["Run it"]);
    expect(parseFenced("no block", "recap", LIMITS)).toBeNull();
    expect(parseFenced("```recap\nold\n```\ntext\n```recap\nnew\n```", "recap", LIMITS)).toEqual(["new"]);
    expect(parseFenced("```recap\n" + "x".repeat(200) + "\n```", "recap", LIMITS)![0]).toHaveLength(120);
    expect(parseRecap("```recap\n1\n2\n3\n4\n5\n6\n7\n8\n9\n```")).toHaveLength(8);
    expect(parseRecap("```recap\nstage: run\nA\n```")).toEqual(["A"]);
  });

  it("strips every hidden block, complete or arriving, and leaves code blocks and inline code alone", () => {
    expect(withoutHidden(reply)).toBe("Here is the plan.");
    expect(withoutFenced("Text.\n\n```rec", ["next", "recap"])).toBe("Text.");
    expect(withoutFenced("Text.\n\n```ne", ["next", "recap"])).toBe("Text.");
    expect(withoutFenced("Text.\n\n``", ["next", "recap"])).toBe("Text.");
    expect(withoutHidden("Code:\n```python\nprint(1)\n```")).toBe("Code:\n```python\nprint(1)\n```");
    expect(withoutHidden("Use `beta`.\n\n```recap\nA\n```\n\n```next\nRun it\n```")).toBe("Use `beta`.");
    expect(withoutHidden("Try `beta")).toBe("Try `beta");
    expect(withoutNext("Keep.\n\n```recap\nA\n```")).toBe("Keep.\n\n```recap\nA\n```");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/chat/fenced.test.ts`
Expected: FAIL, cannot resolve `@/lib/chat/fenced`.

- [ ] **Step 3: Write `lib/chat/fenced.ts` and the wrappers**

`lib/chat/fenced.ts`:

```ts
/**
 * Fenced blocks the assistant appends for the interface: ```next (suggested
 * replies) and ```recap (decisions so far). Adapted from CampusOtter's
 * nextStep.ts. A stage line is skipped: stages are derived, never declared.
 */
export type FencedLimits = { maxItems: number; maxChars: number };

function completeBlock(tag: string): RegExp {
  return new RegExp("```" + tag + "[ \\t]*\\n([\\s\\S]*?)\\n?```", "g");
}

/** n(?:e(?:x(?:t[\s\S]*)?)?)? for "next": any prefix of the tag, or the tag and anything after it. */
function prefixPattern(tag: string, index = 0): string {
  return index === tag.length - 1 ? tag[index] + "[\\s\\S]*" : tag[index] + "(?:" + prefixPattern(tag, index + 1) + ")?";
}

/**
 * A block that has started and not yet closed, or the first backticks of one,
 * at the end of the text. Anchored to a line start so a backtick closing
 * inline code is never taken for a fence.
 */
function arrivingBlock(tags: string[]): RegExp {
  const inner = tags.map((tag) => prefixPattern(tag)).join("|");
  return new RegExp("(?:^|\\n)[ \\t]*```(?:" + inner + ")?$|(?:^|\\n)[ \\t]*`{1,2}$");
}

/** The lines of the last complete block with the tag, or null when there is none. */
export function parseFenced(text: string, tag: string, limits: FencedLimits): string[] | null {
  const blocks = [...text.matchAll(completeBlock(tag))];
  const last = blocks.at(-1);
  if (!last) return null;
  const items: string[] = [];
  for (const raw of last[1].split("\n")) {
    const line = raw.trim();
    if (!line || /^stage:/i.test(line)) continue;
    if (items.length < limits.maxItems) {
      items.push(line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").slice(0, limits.maxChars).trim());
    }
  }
  return items;
}

/** The text as the reader should see it: no block with any of the tags, whether complete or still arriving. */
export function withoutFenced(text: string, tags: string[]): string {
  let shown = text;
  for (const tag of tags) shown = shown.replace(completeBlock(tag), "");
  const arriving = arrivingBlock(tags).exec(shown);
  if (!arriving) return shown.trim();
  // An odd number of fences before it means another code block is open and these backticks close it.
  const fencesBefore = shown.slice(0, arriving.index).split("```").length - 1;
  return (fencesBefore % 2 === 1 ? shown : shown.slice(0, arriving.index)).trim();
}
```

Replace the whole of `lib/chat/next.ts` with:

```ts
/**
 * The two hidden blocks a reply ends with: ```recap (decisions so far, 8 lines
 * of 120 characters) then ```next (one to three suggested replies of 80).
 */
import { parseFenced, withoutFenced } from "./fenced";

export const HIDDEN_TAGS = ["next", "recap"];

export function parseNext(text: string): string[] | null {
  return parseFenced(text, "next", { maxItems: 3, maxChars: 80 });
}

export function parseRecap(text: string): string[] | null {
  return parseFenced(text, "recap", { maxItems: 8, maxChars: 120 });
}

/** The reply without its next block only (kept for callers that handle one tag). */
export function withoutNext(text: string): string {
  return withoutFenced(text, ["next"]);
}

/** The reply as the reader should see it: no recap, no next, complete or arriving. */
export function withoutHidden(text: string): string {
  return withoutFenced(text, HIDDEN_TAGS);
}
```

- [ ] **Step 4: Run the fenced and next tests**

Run: `npx vitest run tests/chat/fenced.test.ts tests/chat/next.test.ts`
Expected: PASS, both files (the next tests keep passing through the wrapper).

- [ ] **Step 5: Write the failing sink, handler, and reducer tests**

Append to `tests/chat/events.test.ts` inside the existing `describe` (after the test that uses `parseNext`):

```ts
  it("stores text without the recap block and keeps a recap block in order", () => {
    const emitted: ChatStreamEvent[] = [];
    const s = createEventSink((e) => emitted.push(e), clock());
    s.text("Done.\n\n```recap\nMeasles in Kenya\n```\n\n```next\nRun it\n```");
    s.block({ kind: "recap", items: ["Measles in Kenya"] });
    s.block({ kind: "suggestions", items: ["Run it"] });
    const stored = s.finish();
    expect(stored.map((e) => e.kind)).toEqual(["text", "recap", "suggestions"]);
    expect(stored[0]).toMatchObject({ text: "Done." });
    expect(emitted.filter((e) => e.type === "recap")).toEqual([{ type: "recap", items: ["Measles in Kenya"] }]);
  });
```

Append to `tests/chat/handleChat.test.ts` inside `describe("handleChat")`, after the empty-suggestions test:

```ts
  it("emits and stores the recap before the suggestions, and neither when the reply has none", async () => {
    const text = "Sure.\n\n```recap\nMeasles in Kenya\n- Population 2 million\n```\n\n```next\nRun it\n```";
    const { run, emitted, finished } = setup([{ message: message([textBlock(text)]), text: [text] }]);
    await run(HELLO);
    expect(emitted.map((e) => e.type)).toEqual(["text", "recap", "suggestions", "done"]);
    expect(emitted[1]).toEqual({ type: "recap", items: ["Measles in Kenya", "Population 2 million"] });
    expect(finished[0].events.map((e) => e.kind)).toEqual(["text", "recap", "suggestions"]);
    expect(finished[0].events[0]).toMatchObject({ text: "Sure." });
    expect(finished[0].events[1]).toMatchObject({ kind: "recap", items: ["Measles in Kenya", "Population 2 million"] });

    const plain = setup([{ message: message([textBlock("Plain.")]), text: ["Plain."] }]);
    await plain.run(HELLO);
    expect(plain.emitted.map((e) => e.type)).toEqual(["text", "done"]);
  });
```

In `tests/client/turn.test.ts`, change the first assertion of "starts with a status and no result" to:

```ts
    expect(startTurn()).toEqual({ blocks: [], status: "Thinking…", stage: null, suggestions: [], recap: [], result: null });
```

and append inside `describe("applyEvent")`:

```ts
  it("keeps the recap items and lastRecap finds the newest turn that has one", () => {
    const progress = play([{ type: "text", delta: "Done." }, { type: "recap", items: ["A", "B"] }]);
    expect(progress.recap).toEqual(["A", "B"]);
    expect(progress.blocks.at(-1)).toEqual({ kind: "recap", items: ["A", "B"] });
    const turns = [
      { blocks: [{ kind: "recap" as const, items: ["old"] }] },
      { blocks: [{ kind: "text" as const, text: "no recap this time" }] },
    ];
    expect(lastRecap(turns)).toEqual(["old"]);
    expect(lastRecap([])).toEqual([]);
  });
```

and add `lastRecap` to the import from `@/lib/client/turn`.

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run tests/chat/events.test.ts tests/chat/handleChat.test.ts tests/client/turn.test.ts`
Expected: FAIL. The sink test fails on the stored text still containing the recap block (and a type error on `kind: "recap"` under vitest is not fatal); the handler test fails on the emitted types; the reducer test fails on `lastRecap` not exported.

- [ ] **Step 7: Implement**

`lib/chat/events.ts`: in `Block`, add the line `| { kind: "recap"; items: string[] }` after the `suggestions` line. In `ChatStreamEvent`, add `| { type: "recap"; items: string[] }` after the `suggestions` line. Change the import `import { withoutNext } from "./next";` to `import { withoutHidden } from "./next";` and in `closeText` change `withoutNext(buffer)` to `withoutHidden(buffer)`.

`lib/chat/handleChat.ts`: change the import to `import { parseNext, parseRecap } from "./next";` and replace the two lines

```ts
      const items = parseNext(sink.lastText());
      if (items && items.length > 0) sink.block({ kind: "suggestions", items });
```

with

```ts
      // Read the final text once: storing a block clears the sink's buffer.
      const finalText = sink.lastText();
      const recap = parseRecap(finalText);
      if (recap && recap.length > 0) sink.block({ kind: "recap", items: recap });
      const items = parseNext(finalText);
      if (items && items.length > 0) sink.block({ kind: "suggestions", items });
```

`lib/client/turn.ts`: add `recap: string[];` to `TurnProgress` after `suggestions` with the comment `/** The decisions so far, from the reply's recap block. */`; in `startTurn` return `{ blocks: [], status: THINKING, stage: null, suggestions: [], recap: [], result: null }`; in `applyEvent` add before `case "done"`:

```ts
    case "recap":
      return { ...withBlock(progress, { kind: "recap", items: event.items }, progress.status), recap: event.items };
```

and append:

```ts
/** The decisions so far: the newest turn's recap block, or none. */
export function lastRecap(turns: { blocks: Block[] }[]): string[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    for (let j = turns[i].blocks.length - 1; j >= 0; j--) {
      const block = turns[i].blocks[j];
      if (block.kind === "recap") return block.items;
    }
  }
  return [];
}
```

`components/TurnBlocks.tsx`: import `withoutHidden` instead of `withoutNext` and use it in the `text` case. (The whole file is rewritten in Task 9; this keeps the live text clean meanwhile.)

- [ ] **Step 8: Run the four test files and the typecheck**

Run: `npx vitest run tests/chat tests/client/turn.test.ts && npm run typecheck`
Expected: PASS for every file; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add lib/chat/fenced.ts lib/chat/next.ts lib/chat/events.ts lib/chat/handleChat.ts lib/client/turn.ts components/TurnBlocks.tsx tests/chat/fenced.test.ts tests/chat/events.test.ts tests/chat/handleChat.test.ts tests/client/turn.test.ts
git commit -m "feat(chat): the recap block, parsed, stored, and streamed before the suggestions"
```

---

### Task 2: Migration 0003 and the runbook line

**Files:**
- Create: `supabase/migrations/0003_recap.sql`
- Modify: `docs/DEPLOY.md:11-13`
- Test: `tests/db/finishTurn.test.ts`, `tests/app/deploy.test.ts:23`

**Interfaces:**
- Consumes: `finish_turn(p jsonb)` from 0002; `createTestDb()` applies every file in `supabase/migrations` in name order.
- Produces: the `turn_events` kind check accepts `'recap'`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/db/finishTurn.test.ts` inside the top-level `describe` (add `import { readFileSync } from "node:fs";` at the top):

```ts
  it("stores a recap event once 0003 is applied, and 0003 applies twice", async () => {
    await db.exec(readFileSync("supabase/migrations/0003_recap.sql", "utf8"));
    const id = await finish(payload({ events: [{ seq: 1, at: "2026-10-08T15:00:09Z", kind: "recap", items: ["Measles in Kenya"] }] }));
    const { rows } = await db.query<{ kind: string; payload: { items: string[] } }>("select kind, payload from turn_events where turn_id = $1", [id]);
    expect(rows).toEqual([{ kind: "recap", payload: { items: ["Measles in Kenya"] } }]);
    await expect(db.query("insert into turn_events (turn_id, seq, kind) values ($1, 2, 'image')", [id])).rejects.toThrow();
  });
```

In `tests/app/deploy.test.ts`, add `"0003_recap.sql"` to the phrase list of "the deploy document covers the Supabase auth settings the code depends on".

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/db/finishTurn.test.ts tests/app/deploy.test.ts`
Expected: FAIL. The finishTurn test throws ENOENT on the migration file; the deploy test misses the phrase.

- [ ] **Step 3: Write the migration and the runbook line**

`supabase/migrations/0003_recap.sql`:

```sql
-- 0003: the recap turn event (workspace spec, section 7). Safe to run twice.
-- A reply's decisions-so-far list, kept by the model and shown under the
-- conversation. Every other kind stays as 0001 defined it.
alter table turn_events drop constraint if exists turn_events_kind_check;
alter table turn_events add constraint turn_events_kind_check check (kind in (
  'text', 'thinking', 'tool_use', 'tool_result', 'web_search', 'web_fetch',
  'stage', 'suggestions', 'notice', 'recap'));
```

In `docs/DEPLOY.md`, after the sentence ending "run it the same way after 0001." add:

```
   Sub-project 4a adds `web/supabase/migrations/0003_recap.sql` (one more
   turn event kind, `recap`); run it after 0002, before the workspace code
   deploys, or every turn is rejected by `finish_turn`.
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/db tests/app/deploy.test.ts`
Expected: PASS (the schema tests still reject `'image'` and accept every stored kind).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0003_recap.sql docs/DEPLOY.md tests/db/finishTurn.test.ts tests/app/deploy.test.ts
git commit -m "feat(db): migration 0003 adds the recap turn event kind"
```

---

### Task 3: The prompt's new sections

**Files:**
- Modify: `lib/chat/prompt.ts:13-29`
- Test: `tests/chat/prompt.test.ts:8-12`

**Interfaces:**
- Produces: `SYSTEM_PROMPT` with sections "## Decisions recap", "## Suggested replies", "## The interface", "## Repairs"; no "## Cards".

- [ ] **Step 1: Change the test**

Replace the first test in `tests/chat/prompt.test.ts` with:

```ts
  it("starts with the Python agent's prompt verbatim and adds the four sections", () => {
    expect(SYSTEM_PROMPT.startsWith((promptFile as { system: string }).system)).toBe(true);
    for (const heading of ["## Decisions recap", "## Suggested replies", "## The interface", "## Repairs"]) expect(SYSTEM_PROMPT).toContain(heading);
    expect(SYSTEM_PROMPT).not.toContain("## Cards");
    expect(SYSTEM_PROMPT.indexOf("```recap")).toBeLessThan(SYSTEM_PROMPT.indexOf("```next"));
    expect(SYSTEM_PROMPT).toContain("three to eight lines");
    expect(SYSTEM_PROMPT).toContain("panel beside the conversation");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/chat/prompt.test.ts`
Expected: FAIL on "## Decisions recap".

- [ ] **Step 3: Rewrite `ADDITIONS` in `lib/chat/prompt.ts`**

```ts
const ADDITIONS = `

## Decisions recap

- End every reply with a fenced block tagged \`recap\`: the decisions made so far in this conversation, one per line, three to eight lines, each under 100 characters, oldest first. Rewrite it in full every time; the interface shows only the latest. Include what is being modelled and where, settings the user chose or confirmed, data applied, runs done and what changed between them, and what the user said they care about. Nothing else goes in the block, and the interface never shows it as text:

\`\`\`recap
Measles in Kenya, SIR model, one year
Population 2 million (user's choice)
UN demographics applied; 72% vaccine coverage from WHO
Run 1 done; the user asked about hospital capacity
\`\`\`

## Suggested replies

- After the recap, end with a fenced block tagged \`next\` holding one to three short replies the user might send next, one per line. Each is a complete message that fits the moment ("Yes, fetch the data", "Run it", "Set R0 to 12", "Compare with 90% coverage"), never a placeholder the user would have to fill in. The interface turns the block into buttons and never shows it as text, so nothing else goes in it:

\`\`\`next
Yes, fetch the data
Run it
\`\`\`

## The interface

- The configuration, the data applied, and every run are shown in a panel beside the conversation, and after a run the key numbers and the epidemic curve appear under your tool call. Do not retype those numbers in a list; interpret them: what the peak means, what the interventions did, what the limitations are. A short Markdown table is welcome when you compare scenarios or lay out choices.

## Repairs

- When run_simulation reports repairs, say which parameters were changed to make the run succeed and why, before interpreting the results.`;
```

Update the file's header comment: "followed by the four additions from the workspace spec, section 7".

- [ ] **Step 4: Run the prompt tests**

Run: `npx vitest run tests/chat/prompt.test.ts`
Expected: PASS, four tests (still deterministic, still over 5,000 characters).

- [ ] **Step 5: Commit**

```bash
git add lib/chat/prompt.ts tests/chat/prompt.test.ts
git commit -m "feat(prompt): ask for a recap block and describe the panel instead of cards"
```

---

### Task 4: Stage labels, hints, and drafts

**Files:**
- Create: `lib/client/drafts.ts`
- Test: `tests/client/drafts.test.ts` (new)

**Interfaces:**
- Consumes: `Stage`, `STAGES` from `lib/enums.ts`.
- Produces: `STAGE_LABELS: Record<Stage, string>`, `STAGE_HINTS: Record<Stage, string>`, `DRAFTS: Record<Stage, string[]>`, `chipsFor(stage: Stage, suggestions: string[]): { items: string[]; source: "model" | "draft" }`.

- [ ] **Step 1: Write the failing test**

`tests/client/drafts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { DRAFTS, STAGE_HINTS, STAGE_LABELS, chipsFor } from "@/lib/client/drafts";
import { STAGES } from "@/lib/enums";

describe("stage drafts", () => {
  it("labels and hints every stage, with three drafts everywhere except while running", () => {
    expect(STAGES.map((s) => STAGE_LABELS[s])).toEqual(["Understand", "Configure", "Ground in data", "Run", "Interpret"]);
    for (const stage of STAGES) expect(STAGE_HINTS[stage].length).toBeGreaterThan(20);
    expect(DRAFTS.run).toEqual([]);
    for (const stage of STAGES.filter((s) => s !== "run")) {
      expect(DRAFTS[stage]).toHaveLength(3);
      for (const draft of DRAFTS[stage]) expect(draft.length).toBeLessThanOrEqual(80);
    }
    expect(DRAFTS.understand[0]).toBe("Model a measles outbreak in Kenya");
    expect(DRAFTS.interpret).toContain("Start a new scenario");
    expect(STAGE_HINTS.run).toBe("The simulation is running. This usually takes one to two minutes.");
  });

  it("prefers the model's suggestions and falls back to the stage's drafts", () => {
    expect(chipsFor("configure", ["Fetch the data"])).toEqual({ items: ["Fetch the data"], source: "model" });
    expect(chipsFor("configure", [])).toEqual({ items: DRAFTS.configure, source: "draft" });
    expect(chipsFor("run", [])).toEqual({ items: [], source: "draft" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/client/drafts.test.ts`
Expected: FAIL, cannot resolve `@/lib/client/drafts`.

- [ ] **Step 3: Write `lib/client/drafts.ts`**

```ts
/** The stage strip's words and the draft messages offered when the model made no suggestion (workspace spec, section 6). */
import type { Stage } from "@/lib/enums";

export const STAGE_LABELS: Record<Stage, string> = {
  understand: "Understand",
  configure: "Configure",
  ground: "Ground in data",
  run: "Run",
  interpret: "Interpret",
};

export const STAGE_HINTS: Record<Stage, string> = {
  understand: "Describe the outbreak you want to model: a disease, a place, and what you want to find out.",
  configure: "Check the configuration. When it looks right, ground it in real data.",
  ground: "Real data is applied. Run the simulation when you are ready.",
  run: "The simulation is running. This usually takes one to two minutes.",
  interpret: "Explore the results, or change something and run again.",
};

export const DRAFTS: Record<Stage, string[]> = {
  understand: ["Model a measles outbreak in Kenya", "Simulate influenza in Brazil with 60% vaccine coverage", "What is the R0 of dengue?"],
  configure: ["Yes, fetch the data", "Use a population of 2 million", "Add a vaccination campaign at 80% coverage"],
  ground: ["Run it", "Which data sources were used?", "Lower the contact rate by 20%"],
  run: [],
  interpret: ["What does the peak mean for hospitals?", "Compare with 90% vaccine coverage", "Start a new scenario"],
};

export type ChipSource = "model" | "draft";

/** The chips above the composer: the model's suggestions when it made any, otherwise the stage's drafts. */
export function chipsFor(stage: Stage, suggestions: string[]): { items: string[]; source: ChipSource } {
  if (suggestions.length > 0) return { items: suggestions, source: "model" };
  return { items: DRAFTS[stage], source: "draft" };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/client/drafts.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/client/drafts.ts tests/client/drafts.test.ts
git commit -m "feat(client): stage labels, hints, and draft messages"
```

---

### Task 5: Client event fields for the workspace

**Files:**
- Modify: `lib/enums.ts:70-73`, `lib/clientEvents.ts:25-33`, `app/api/event/route.ts:64`
- Test: `tests/lib/clientEvents.test.ts`, `tests/api/eventRoute.test.ts`

**Interfaces:**
- Produces: `CARD_KINDS = ["disease", "config", "data", "run", "tool_error", "activity", "recap"]`, `PANEL_SECTIONS = ["scenario", "data", "runs", "activity"]`, `SUGGESTION_SOURCES = ["model", "draft"]`; `suggestion_used.source?`, `scenario_panel_opened.section?`; the route copies `source` and `section` into `meta`.

- [ ] **Step 1: Write the failing tests**

Append to the "accepts each fixed shape" test in `tests/lib/clientEvents.test.ts`:

```ts
    expect(readClientEvent(JSON.stringify({ kind: "suggestion_used", conversationId: CONVERSATION, stage: "ground", source: "draft" }))).toMatchObject({ source: "draft" });
    expect(readClientEvent(JSON.stringify({ kind: "card_expanded", conversationId: CONVERSATION, turnId: TURN, card: "activity" }))).toMatchObject({ card: "activity" });
    expect(readClientEvent(JSON.stringify({ kind: "card_expanded", conversationId: CONVERSATION, turnId: TURN, card: "recap" }))).toMatchObject({ card: "recap" });
    expect(readClientEvent(JSON.stringify({ kind: "scenario_panel_opened", conversationId: CONVERSATION, section: "runs" }))).toMatchObject({ section: "runs" });
    expect(readClientEvent(JSON.stringify({ kind: "scenario_panel_opened", conversationId: CONVERSATION }))).toMatchObject({ kind: "scenario_panel_opened" });
```

and to the refusal test:

```ts
    expect(readClientEvent(JSON.stringify({ kind: "suggestion_used", conversationId: CONVERSATION, stage: "ground", source: "typed" }))).toBeNull();
    expect(readClientEvent(JSON.stringify({ kind: "scenario_panel_opened", conversationId: CONVERSATION, section: "notes" }))).toBeNull();
```

Append to `tests/api/eventRoute.test.ts` after "logs an interaction with its conversation and stage":

```ts
  it("keeps the chip source and the panel section in meta", async () => {
    await post({ kind: "suggestion_used", sessionId: SESSION, conversationId: CONVERSATION, stage: "ground", source: "draft" });
    let events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "suggestion_used", meta: { source: "draft" } });
    admin.recorded.length = 0;
    await post({ kind: "scenario_panel_opened", sessionId: SESSION, conversationId: CONVERSATION, section: "runs" });
    events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "scenario_panel_opened", meta: { section: "runs" } });
  });
```

(If `admin.recorded` is not a plain array in that file's setup, re-run the file's `beforeEach` setup instead of resetting; the first assertion alone proves the point.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/lib/clientEvents.test.ts tests/api/eventRoute.test.ts`
Expected: FAIL: `source` is an unknown key under `strictObject`, so the parsed event is null.

- [ ] **Step 3: Implement**

`lib/enums.ts`: change `CARD_KINDS` to `["disease", "config", "data", "run", "tool_error", "activity", "recap"] as const` and add after it:

```ts
/** The details panel's sections, for scenario_panel_opened. */
export const PANEL_SECTIONS = ["scenario", "data", "runs", "activity"] as const;
export type PanelSection = (typeof PANEL_SECTIONS)[number];
/** Where a pressed chip came from. */
export const SUGGESTION_SOURCES = ["model", "draft"] as const;
```

`lib/clientEvents.ts`: import `PANEL_SECTIONS, SUGGESTION_SOURCES` too; change the two shapes:

```ts
  z.strictObject({ kind: z.literal("suggestion_used"), sessionId, conversationId: id, turnId: id.optional(), stage: z.enum(STAGES), source: z.enum(SUGGESTION_SOURCES).optional() }),
  z.strictObject({ kind: z.literal("scenario_panel_opened"), sessionId, conversationId: id, section: z.enum(PANEL_SECTIONS).optional() }),
```

`app/api/event/route.ts`: change the key list to `["card", "view", "format", "rating", "runId", "source", "section"] as const`.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/lib/clientEvents.test.ts tests/api/eventRoute.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/enums.ts lib/clientEvents.ts app/api/event/route.ts tests/lib/clientEvents.test.ts tests/api/eventRoute.test.ts
git commit -m "feat(events): chip source, panel section, and two more card kinds"
```

---

### Task 6: The projection and the activity summary

**Files:**
- Create: `lib/client/artifacts.ts`, `lib/client/activity.ts`
- Test: `tests/client/artifacts.test.ts`, `tests/client/activity.test.ts` (new)

**Interfaces:**
- Consumes: `Block` (`lib/chat/events.ts`), `CardPayload` types (`lib/tools/types.ts`), `toolLine`, `toolLabel` (`lib/client/toolLine.ts`).
- Produces: `deriveArtifacts(turns: { id: string; blocks: Block[] }[]): Artifacts`; `emptyArtifacts(): Artifacts`; types `Artifacts`, `RunArtifact`, `ActivityItem`; `summarizeActivity(blocks: Block[]): string`; `formatDuration(ms: number): string`.

- [ ] **Step 1: Write the failing tests**

`tests/client/artifacts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Block } from "@/lib/chat/events";
import { deriveArtifacts, emptyArtifacts } from "@/lib/client/artifacts";
import type { CardPayload, ConfigPayload, DataPayload, DiseasePayload, RunPayload } from "@/lib/tools/types";
import { params } from "../tools/helpers";

const STATS = { peak_infections: 900, peak_day: 40, total_infected: 4000, total_deaths: 12, n_agents: 10000, sim_days: 365 };
const DISEASE: DiseasePayload = { kind: "disease", canonical_name: "measles", display_name: "Measles", parameters: {} };
const CONFIG = (new_scenario: boolean): ConfigPayload => ({
  kind: "config", applied: {}, approx_r0: 12, warnings: [], new_scenario,
  config: { disease: "measles", disease_type: "sir", country: "KEN", n_agents: 10000, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] },
});
const DATA: DataPayload = { kind: "data", source: "un_wpp", iso3: "KEN", applied: { birth_rate: 28.1 }, citations: ["UN WPP 2024"], duration_ms: 310 };
const RUN: RunPayload = {
  kind: "run", run_id: "run-1", stats: STATS, stats_agents: STATS, attack_rate_pct: 40, pop_scale: 1, population: 10000, effective_params: params({}),
  warnings: [], repairs: [], data_sources: [], duration_ms: 108000, cold_start: false,
};
const result = (name: string, payload: CardPayload, ok = true): Block => ({ kind: "tool_result", id: "tu", name, ok, payload });

describe("deriveArtifacts", () => {
  it("starts empty", () => {
    expect(deriveArtifacts([])).toEqual(emptyArtifacts());
  });

  it("keeps the latest disease and configuration, the data since the last new scenario, every run, and every step", () => {
    const turns = [
      { id: "t1", blocks: [result("lookup_disease", DISEASE), result("configure_simulation", CONFIG(true)), { kind: "web_search" as const, query: "measles Kenya 2026" }] },
      { id: "t2", blocks: [result("fetch_demographics", DATA), result("fetch_vaccination_coverage", { kind: "tool_error", message: "WHO timed out" }, false)] },
      { id: "t3", blocks: [result("run_simulation", RUN)] },
      { id: "t4", blocks: [result("configure_simulation", CONFIG(true)), result("run_simulation", { ...RUN, run_id: "run-2" })] },
    ];
    const a = deriveArtifacts(turns);
    expect(a.disease).toBe(DISEASE);
    expect(a.config?.new_scenario).toBe(true);
    expect(a.data).toEqual([]);
    expect(a.runs.map((r) => [r.turnId, r.index, r.payload.run_id])).toEqual([["t3", 1, "run-1"], ["t4", 2, "run-2"]]);
    expect(a.activity.map((s) => [s.turnId, s.kind, s.name, s.ok, s.durationMs])).toEqual([
      ["t1", "tool", "lookup_disease", true, null], ["t1", "tool", "configure_simulation", true, null], ["t1", "web_search", "web_search", true, null],
      ["t2", "tool", "fetch_demographics", true, 310], ["t2", "tool", "fetch_vaccination_coverage", false, null],
      ["t3", "tool", "run_simulation", true, 108000], ["t4", "tool", "configure_simulation", true, null], ["t4", "tool", "run_simulation", true, 108000],
    ]);
    expect(a.activity[2].detail).toBe("measles Kenya 2026");
    expect(a.activity[3].label).toBe("🔧 UN WPP demographics");
    expect(deriveArtifacts(turns.slice(0, 3)).data).toEqual([DATA]);
  });
});
```

`tests/client/activity.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Block } from "@/lib/chat/events";
import { formatDuration, summarizeActivity } from "@/lib/client/activity";

const STATS = { peak_infections: 9, peak_day: 4, total_infected: 40, total_deaths: 0, n_agents: 100, sim_days: 30 };
const run = (duration_ms: number, ok = true): Block => ({
  kind: "tool_result", id: "tu", name: "run_simulation", ok,
  payload: ok
    ? { kind: "run", run_id: null, stats: STATS, stats_agents: STATS, attack_rate_pct: 40, pop_scale: 1, population: 100, effective_params: {} as never, warnings: [], repairs: [], data_sources: [], duration_ms, cold_start: false }
    : { kind: "tool_error", message: "boom" },
});
const tool = (name: string, payload: Extract<Block, { kind: "tool_result" }>["payload"], ok = true): Block => ({ kind: "tool_result", id: "tu", name, ok, payload });

describe("summarizeActivity", () => {
  it("names each step in order and counts the fetches, searches, and pages", () => {
    const blocks: Block[] = [
      tool("lookup_disease", { kind: "disease", canonical_name: "measles", display_name: "Measles", parameters: {} }),
      tool("configure_simulation", { kind: "config", applied: {}, approx_r0: 12, warnings: [], new_scenario: true, config: { disease: "measles", disease_type: "sir", country: null, n_agents: 1, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] } }),
      tool("fetch_demographics", { kind: "data", source: "un_wpp", iso3: "KEN", applied: {}, citations: [] }),
      tool("fetch_health_system", { kind: "data", source: "wb_data360", iso3: "KEN", applied: {}, citations: [] }),
      tool("fetch_vaccination_coverage", { kind: "data", source: "who_gho", iso3: "KEN", applied: {}, citations: [] }),
      run(108000),
    ];
    expect(summarizeActivity(blocks)).toBe("Looked up Measles · Started a new scenario · Fetched 3 data sources · Ran the simulation, 1.8 min");
    expect(summarizeActivity([{ kind: "web_search", query: "a" }, { kind: "web_search", query: "b" }, { kind: "web_fetch", url: "https://x", title: "X" }])).toBe("Searched the web (2) · Read 1 page");
    expect(summarizeActivity([tool("configure_simulation", { kind: "config", applied: {}, approx_r0: 2, warnings: [], new_scenario: false, config: { disease: null, disease_type: "sir", country: null, n_agents: 1, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] } }), tool("fetch_demographics", { kind: "data", source: "un_wpp", iso3: "KEN", applied: {}, citations: [] })])).toBe("Configured the simulation · Fetched 1 data source");
    expect(summarizeActivity([run(0, false)])).toBe("⚠ Simulation failed");
    expect(summarizeActivity([tool("fetch_vaccination_coverage", { kind: "tool_error", message: "x" }, false)])).toBe("⚠ WHO vaccination coverage failed");
    expect(summarizeActivity([{ kind: "text", text: "hi" }])).toBe("");
  });

  it("formats durations as seconds under a minute and minutes with one decimal above", () => {
    expect(formatDuration(300)).toBe("1 s");
    expect(formatDuration(42000)).toBe("42 s");
    expect(formatDuration(108000)).toBe("1.8 min");
    expect(formatDuration(120000)).toBe("2 min");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/client/artifacts.test.ts tests/client/activity.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `lib/client/activity.ts`**

```ts
/** The one-line summary of a reply's tool and web steps (workspace spec, section 5). */
import type { Block } from "@/lib/chat/events";
import { toolLabel } from "./toolLine";

/** "42 s" under a minute, "1.8 min" above, whole minutes without the decimal. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  return `${(ms / 60_000).toFixed(1).replace(/\.0$/, "")} min`;
}

/** The chat-line label without its leading emoji: "Configured simulation", "Simulation". */
function plainLabel(name: string): string {
  return toolLabel(name).replace(/^\S+\s/, "");
}

type Counted = "fetch" | "search" | "page";
type Piece = { text: string } | { count: Counted; n: number };

function render(piece: Piece): string {
  if ("text" in piece) return piece.text;
  const plural = piece.n === 1 ? "" : "s";
  if (piece.count === "fetch") return `Fetched ${piece.n} data source${plural}`;
  if (piece.count === "search") return piece.n === 1 ? "Searched the web" : `Searched the web (${piece.n})`;
  return `Read ${piece.n} page${plural}`;
}

/** One sentence for the turn's steps, pieces joined by " · "; empty when the turn made no calls. */
export function summarizeActivity(blocks: Block[]): string {
  const pieces: Piece[] = [];
  const bump = (count: Counted) => {
    const last = pieces.at(-1);
    if (last && "count" in last && last.count === count) last.n += 1;
    else pieces.push({ count, n: 1 });
  };
  for (const block of blocks) {
    if (block.kind === "web_search") bump("search");
    else if (block.kind === "web_fetch") bump("page");
    else if (block.kind === "tool_result") {
      const payload = block.payload;
      if (!block.ok) pieces.push({ text: `⚠ ${plainLabel(block.name)} failed` });
      else if (block.name === "lookup_disease") pieces.push({ text: `Looked up ${payload.kind === "disease" ? payload.display_name : "the disease"}` });
      else if (block.name === "configure_simulation") pieces.push({ text: payload.kind === "config" && payload.new_scenario ? "Started a new scenario" : "Configured the simulation" });
      else if (block.name.startsWith("fetch_")) bump("fetch");
      else if (block.name === "run_simulation") pieces.push({ text: `Ran the simulation${payload.kind === "run" ? `, ${formatDuration(payload.duration_ms)}` : ""}` });
      else pieces.push({ text: plainLabel(block.name) });
    }
  }
  return pieces.map(render).join(" · ");
}
```

- [ ] **Step 4: Write `lib/client/artifacts.ts`**

```ts
/**
 * The details panel's content, projected from the turns' blocks (workspace
 * spec, section 4). Pure: the same blocks give the same artifacts, live or
 * replayed.
 */
import type { Block } from "@/lib/chat/events";
import type { ConfigPayload, DataPayload, DiseasePayload, RunPayload } from "@/lib/tools/types";
import { toolLabel, toolLine } from "./toolLine";

export type RunArtifact = { turnId: string; index: number; payload: RunPayload };
export type ActivityItem = {
  turnId: string;
  kind: "tool" | "web_search" | "web_fetch";
  name: string;
  ok: boolean;
  label: string;
  detail: string;
  durationMs: number | null;
};
export type Artifacts = {
  /** The latest successful disease lookup. */
  disease: DiseasePayload | null;
  /** The latest successful configuration. */
  config: ConfigPayload | null;
  /** Successful data fetches since the last new scenario, in order. */
  data: DataPayload[];
  /** Every successful run of the conversation, oldest first. */
  runs: RunArtifact[];
  /** Every tool and web step, in order. */
  activity: ActivityItem[];
};

export function emptyArtifacts(): Artifacts {
  return { disease: null, config: null, data: [], runs: [], activity: [] };
}

export function deriveArtifacts(turns: { id: string; blocks: Block[] }[]): Artifacts {
  const out = emptyArtifacts();
  for (const turn of turns) {
    for (const block of turn.blocks) {
      if (block.kind === "web_search") {
        out.activity.push({ turnId: turn.id, kind: "web_search", name: "web_search", ok: true, label: toolLabel("web_search"), detail: block.query, durationMs: null });
        continue;
      }
      if (block.kind === "web_fetch") {
        out.activity.push({ turnId: turn.id, kind: "web_fetch", name: "web_fetch", ok: true, label: toolLabel("web_fetch"), detail: block.title || block.url, durationMs: null });
        continue;
      }
      if (block.kind !== "tool_result") continue;
      const line = toolLine(block.name, block.payload, block.ok);
      const duration = block.payload?.duration_ms;
      out.activity.push({ turnId: turn.id, kind: "tool", name: block.name, ok: block.ok, label: line.label, detail: line.detail, durationMs: typeof duration === "number" ? duration : null });
      if (!block.ok) continue;
      const payload = block.payload;
      if (payload.kind === "disease") out.disease = payload;
      else if (payload.kind === "config") {
        out.config = payload;
        if (payload.new_scenario) out.data = [];
      } else if (payload.kind === "data") out.data.push(payload);
      else if (payload.kind === "run") out.runs.push({ turnId: turn.id, index: out.runs.length + 1, payload });
    }
  }
  return out;
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run tests/client/artifacts.test.ts tests/client/activity.test.ts && npm run typecheck`
Expected: PASS, 4 tests; typecheck clean. If the artifacts test's `result` helper type does not compile under vitest's transpile-only run it still executes; keep the helper typed as `payload: CardPayload` by importing `CardPayload` from `@/lib/tools/types` if the conditional type reads badly.

- [ ] **Step 6: Commit**

```bash
git add lib/client/artifacts.ts lib/client/activity.ts tests/client/artifacts.test.ts tests/client/activity.test.ts
git commit -m "feat(client): project the panel's artifacts and summarize a reply's activity"
```

---

### Task 7: Chart math and the series loader

**Files:**
- Create: `lib/client/chart.ts`, `lib/client/series.ts`
- Test: `tests/client/chart.test.ts`, `tests/client/series.test.ts` (new)

**Interfaces:**
- Consumes: `CHART_VIEWS` from `lib/enums.ts`; `RunPayload`.
- Produces: `ChartView = "infected" | "compartments" | "incidence" | "cumulative" | "deaths"`; `Series = Record<string, number[]>`; `Line = { key; label; color; values }`; `Point = { x; y }`; `seriesFor(view, series): Line[]`; `thinPoints(days, values, max): Point[]`; `niceTicks(max, count): number[]`; `compact(n): string`; `linePath(points, width, height, xMax, yMax): string`; `nearestIndex(days, day): number`; `loadSeries(runId, send?): Promise<Series | null>`; `clearSeriesCache()`; `initialSeriesState(payload): Series | null | "loading"`.

- [ ] **Step 1: Write the failing tests**

`tests/client/chart.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { compact, linePath, nearestIndex, niceTicks, seriesFor, thinPoints } from "@/lib/client/chart";

describe("chart math", () => {
  it("maps each view to the lines the series has", () => {
    const series = { day: [0, 1, 2], n_susceptible: [9, 8, 7], n_infected: [1, 2, 3], n_recovered: [0, 0, 0], new_infections: [1, 1, 1], cum_infections: [1, 2, 3], cum_deaths: [0, 0, 1] };
    expect(seriesFor("infected", series).map((l) => l.key)).toEqual(["n_infected"]);
    expect(seriesFor("compartments", series).map((l) => l.key)).toEqual(["n_susceptible", "n_infected", "n_recovered"]);
    expect(seriesFor("compartments", { ...series, n_exposed: [0, 1, 0] }).map((l) => l.key)).toEqual(["n_susceptible", "n_exposed", "n_infected", "n_recovered"]);
    expect(seriesFor("incidence", series)[0]).toMatchObject({ key: "new_infections", label: "New infections per day", values: [1, 1, 1] });
    expect(seriesFor("cumulative", series)[0].key).toBe("cum_infections");
    expect(seriesFor("deaths", series)[0].key).toBe("cum_deaths");
    expect(seriesFor("deaths", { day: [0] })).toEqual([]);
  });

  it("thins long series evenly and always keeps the last point", () => {
    const days = Array.from({ length: 1000 }, (_, i) => i);
    const values = days.map((d) => d * 2);
    const points = thinPoints(days, values, 100);
    expect(points.length).toBeLessThanOrEqual(101);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 999, y: 1998 });
    expect(thinPoints([0, 1, 2], [5, 6, 7], 100)).toEqual([{ x: 0, y: 5 }, { x: 1, y: 6 }, { x: 2, y: 7 }]);
  });

  it("picks round ticks, compacts numbers, and never divides by zero", () => {
    expect(niceTicks(950, 4)).toEqual([0, 250, 500, 750, 1000]);
    expect(niceTicks(365, 5)).toEqual([0, 100, 200, 300, 400]);
    expect(niceTicks(0, 4)).toEqual([0, 1]);
    expect(compact(999)).toBe("999");
    expect(compact(1234)).toBe("1.2k");
    expect(compact(20000)).toBe("20k");
    expect(compact(3_400_000)).toBe("3.4M");
    expect(linePath([{ x: 0, y: 0 }, { x: 10, y: 5 }], 100, 50, 10, 10)).toBe("M0 50 L100 25");
    expect(linePath([{ x: 0, y: 0 }], 100, 50, 0, 0)).toBe("M0 50");
    expect(linePath([], 100, 50, 10, 10)).toBe("");
  });

  it("finds the nearest day", () => {
    expect(nearestIndex([0, 4, 8, 12], 5)).toBe(1);
    expect(nearestIndex([0, 4, 8, 12], 7)).toBe(2);
    expect(nearestIndex([0, 4, 8, 12], 99)).toBe(3);
    expect(nearestIndex([], 3)).toBe(0);
  });
});
```

`tests/client/series.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearSeriesCache, initialSeriesState, loadSeries } from "@/lib/client/series";

const SERIES = { day: [0, 1], n_infected: [1, 2] };

describe("loadSeries", () => {
  beforeEach(() => clearSeriesCache());

  it("fetches a run's series once per id and shares the promise", async () => {
    const send = vi.fn(async () => Response.json({ series: SERIES }));
    const [a, b] = await Promise.all([loadSeries("run-1", send), loadSeries("run-1", send)]);
    expect(a).toEqual(SERIES);
    expect(b).toBe(a);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("/api/runs/run-1");
    await loadSeries("run-1", send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("answers null on a failure and does not cache it", async () => {
    const send = vi.fn(async () => new Response(null, { status: 404 }));
    expect(await loadSeries("run-2", send)).toBeNull();
    expect(await loadSeries("run-2", send)).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
    const thrower = vi.fn(async () => { throw new Error("offline"); });
    expect(await loadSeries("run-3", thrower)).toBeNull();
  });

  it("starts from the payload: its series, loading when a run id can fetch one, or nothing", () => {
    const base = { kind: "run" as const, run_id: "run-1", stats: {} as never, stats_agents: {} as never, attack_rate_pct: 0, pop_scale: 1, population: 1, effective_params: {} as never, warnings: [], repairs: [], data_sources: [], duration_ms: 1, cold_start: false };
    expect(initialSeriesState({ ...base, series: SERIES })).toEqual(SERIES);
    expect(initialSeriesState(base)).toBe("loading");
    expect(initialSeriesState({ ...base, run_id: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/client/chart.test.ts tests/client/series.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `lib/client/chart.ts`**

```ts
/** Pure chart math for the SVG epidemic curves (workspace spec, section 9). */
import type { CHART_VIEWS } from "@/lib/enums";

export type ChartView = "infected" | (typeof CHART_VIEWS)[number];
export type Series = Record<string, number[]>;
export type Line = { key: string; label: string; color: string; values: number[] };
export type Point = { x: number; y: number };

const ACCENT = "var(--color-accent)";
const INK = "var(--color-ink)";
const LINES: Record<ChartView, { key: string; label: string; color: string }[]> = {
  infected: [{ key: "n_infected", label: "Currently infected", color: ACCENT }],
  compartments: [
    { key: "n_susceptible", label: "Susceptible", color: "var(--color-ink-soft)" },
    { key: "n_exposed", label: "Exposed", color: "var(--color-warn)" },
    { key: "n_infected", label: "Infectious", color: ACCENT },
    { key: "n_recovered", label: "Recovered", color: "#3a7d5a" },
  ],
  incidence: [{ key: "new_infections", label: "New infections per day", color: ACCENT }],
  cumulative: [{ key: "cum_infections", label: "Cumulative infections", color: INK }],
  deaths: [{ key: "cum_deaths", label: "Cumulative deaths", color: INK }],
};

/** The view's lines that the series actually has, in display order. */
export function seriesFor(view: ChartView, series: Series): Line[] {
  return LINES[view].filter((line) => Array.isArray(series[line.key]) && series[line.key].length > 0).map((line) => ({ ...line, values: series[line.key] }));
}

/** At most `max` evenly strided points, always ending on the last one. */
export function thinPoints(days: number[], values: number[], max: number): Point[] {
  const n = Math.min(days.length, values.length);
  if (n === 0) return [];
  const stride = n <= max ? 1 : Math.ceil(n / max);
  const points: Point[] = [];
  for (let i = 0; i < n; i += stride) points.push({ x: days[i], y: values[i] });
  if (points.at(-1)?.x !== days[n - 1]) points.push({ x: days[n - 1], y: values[n - 1] });
  return points;
}

/** Round tick values from 0 to at least `max`, about `count` of them; [0, 1] for an empty range. */
export function niceTicks(max: number, count: number): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let value = 0; value < max + step; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

/** 999, 1.2k, 20k, 3.4M. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  const trim = (s: string) => s.replace(/\.0$/, "");
  if (abs >= 1_000_000) return `${trim((n / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${trim((n / 1_000).toFixed(1))}k`;
  return Math.round(n).toString();
}

/** An SVG path through the points, x over [0, xMax] → [0, width], y over [0, yMax] → [height, 0]. */
export function linePath(points: Point[], width: number, height: number, xMax: number, yMax: number): string {
  const sx = xMax > 0 ? width / xMax : 0;
  const sy = yMax > 0 ? height / yMax : 0;
  const fmt = (v: number) => Number(v.toFixed(1)).toString();
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p.x * sx)} ${fmt(height - p.y * sy)}`).join(" ");
}

/** The index of the day closest to `day`; 0 for an empty series. */
export function nearestIndex(days: number[], day: number): number {
  let best = 0;
  for (let i = 1; i < days.length; i++) if (Math.abs(days[i] - day) < Math.abs(days[best] - day)) best = i;
  return best;
}
```

- [ ] **Step 4: Write `lib/client/series.ts`**

```ts
/** A replayed run's series comes from GET /api/runs/[id]; a live one arrives with the event (workspace spec, section 5). */
import type { RunPayload } from "@/lib/tools/types";
import type { Series } from "./chart";

const cache = new Map<string, Promise<Series | null>>();

/** The series for a run, fetched once per id while the page lives; null when it cannot be had. */
export function loadSeries(runId: string, send: typeof fetch = fetch): Promise<Series | null> {
  const pending = cache.get(runId);
  if (pending) return pending;
  const request = Promise.resolve()
    .then(() => send(`/api/runs/${runId}`))
    .then(async (response) => (response.ok ? (((await response.json()) as { series?: Series }).series ?? null) : null))
    .catch(() => null)
    .then((series) => {
      if (series === null) cache.delete(runId);
      return series;
    });
  cache.set(runId, request);
  return request;
}

export function clearSeriesCache(): void {
  cache.clear();
}

/** What a run card starts with: the payload's own series, "loading" when there is a run to fetch, or nothing. */
export function initialSeriesState(payload: RunPayload): Series | null | "loading" {
  if (payload.series) return payload.series;
  return payload.run_id ? "loading" : null;
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run tests/client/chart.test.ts tests/client/series.test.ts && npm run typecheck`
Expected: PASS, 7 tests; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add lib/client/chart.ts lib/client/series.ts tests/client/chart.test.ts tests/client/series.test.ts
git commit -m "feat(client): chart math and the per-run series loader"
```

---

### Task 8: `GET /api/runs/[id]`

**Files:**
- Create: `app/api/runs/[id]/route.ts`
- Modify: `next.config.ts:14`
- Test: `tests/api/runsRoute.test.ts` (new), `tests/app/pages.test.ts` (tracing check if one exists for routes; otherwise skip)

**Interfaces:**
- Consumes: `requireParticipant()` (`{ ok: true, user, settings } | { ok: false, response }`), `adminClient()`.
- Produces: `GET` handler answering `{ series }`.

- [ ] **Step 1: Write the failing test**

`tests/api/runsRoute.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { GET } from "@/app/api/runs/[id]/route";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const RUN = "66666666-6666-4666-8666-666666666666";
const SERIES = { day: [0, 1], n_infected: [1, 2] };
let admin: ReturnType<typeof fakeAdmin>;

function get(id: string) {
  return GET(new Request(`http://localhost/api/runs/${id}`), { params: Promise.resolve({ id }) });
}

describe("GET /api/runs/[id]", () => {
  beforeEach(() => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({}) });
    admin = fakeAdmin({ runs: [{ data: { user_id: USER.id, series: SERIES } }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
  });

  it("answers the caller's run series, privately cacheable", async () => {
    const response = await get(RUN);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ series: SERIES });
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(callOn(admin.recorded, "runs", "select")).toEqual(["user_id, series"]);
    expect(callOn(admin.recorded, "runs", "eq")).toEqual(["id", RUN]);
  });

  it("answers 404 for a malformed id, a missing run, another participant's run, or one without a series; 500 on a database error; passes the gate through", async () => {
    expect((await get("nope")).status).toBe(404);
    admin = fakeAdmin({ runs: [{ data: null }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
    expect((await get(RUN)).status).toBe(404);
    admin = fakeAdmin({ runs: [{ data: { user_id: "22222222-2222-2222-2222-222222222222", series: SERIES } }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
    expect((await get(RUN)).status).toBe(404);
    admin = fakeAdmin({ runs: [{ data: { user_id: USER.id, series: null } }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
    expect((await get(RUN)).status).toBe(404);
    admin = fakeAdmin({ runs: [{ data: null, error: { message: "down" } }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get(RUN)).status).toBe(500);
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await get(RUN)).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/api/runsRoute.test.ts`
Expected: FAIL, cannot resolve the route module.

- [ ] **Step 3: Write the route and the tracing line**

`app/api/runs/[id]/route.ts`:

```ts
import { z } from "zod";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const NOT_FOUND = { code: "not_found", message: "That run is no longer available." };

/** A run's time series for the participant who made it; the replayed run card draws its chart from this. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json(NOT_FOUND, { status: 404 });

  const { data, error } = await adminClient().from("runs").select("user_id, series").eq("id", id).maybeSingle();
  if (error) {
    console.error("run read failed", error.message);
    return Response.json({ code: "service_unavailable", message: "Please try again." }, { status: 500 });
  }
  const row = data as { user_id: string; series: Record<string, number[]> | null } | null;
  if (!row || row.user_id !== gate.user.id || !row.series) return Response.json(NOT_FOUND, { status: 404 });
  return Response.json({ series: row.series }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
```

`next.config.ts`: add `"/api/runs/[id]": ["./content/**/*.md"],` after the conversations line.

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/api/runsRoute.test.ts && npm run typecheck`
Expected: PASS, 2 tests; typecheck clean. If `requireParticipant`'s `Gate` type names the user field differently, read `lib/participant.server.ts` and match it; the test's mocked value must then match too.

- [ ] **Step 5: Commit**

```bash
git add app/api/runs/[id]/route.ts next.config.ts tests/api/runsRoute.test.ts
git commit -m "feat(api): a run's series for its owner"
```

---

### Task 9: The reply in the middle: chart, run summary, activity line, turn

**Files:**
- Create: `components/Chart.tsx`, `components/RunSummary.tsx`, `components/ActivityLine.tsx`, `components/Turn.tsx`
- Modify: `components/TurnBlocks.tsx` (rewrite)
- Test: `tests/app/workspace.test.ts` (new)

**Interfaces:**
- Consumes: Task 6 `summarizeActivity`; Task 7 `seriesFor`, `thinPoints`, `niceTicks`, `compact`, `linePath`, `nearestIndex`, `loadSeries`, `initialSeriesState`, types `ChartView`, `Series`; `withoutHidden`; `ToolLine`, `Markdown`, `FeedbackControl`; `commaInt` from `lib/sim/pyformat.ts`.
- Produces: `Chart({ series, view, height? })`; `RunSummary({ payload })`; `StatTiles({ payload })`; `useRunSeries(payload)`; `ActivityLine({ blocks, status, onExpand? })`; `Turn({ turn, status, feedback, onActivityExpand? })`; `DisplayTurn` type moves to `Turn.tsx`.

- [ ] **Step 1: Write the failing static tests**

`tests/app/workspace.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("the reply in the middle column", () => {
  it("renders the user's bubble, one activity line, the blocks, and the thumbs", () => {
    const turn = read("components/Turn.tsx");
    for (const piece of ["<ActivityLine", "<TurnBlocks", "<FeedbackControl", "turn.userText", "export type DisplayTurn"]) expect(turn).toContain(piece);
  });

  it("shows prose, the run summary, and notices only; tool lines live in the activity list", () => {
    const blocks = read("components/TurnBlocks.tsx");
    expect(blocks).toContain("withoutHidden(");
    expect(blocks).toContain("<RunSummary");
    expect(blocks).not.toContain("<ToolLine");
    expect(blocks).not.toContain("Web search");
    const line = read("components/ActivityLine.tsx");
    for (const piece of ["summarizeActivity(", "aria-expanded", "<ToolLine", "Web search", "Read page"]) expect(line).toContain(piece);
  });

  it("draws the run's tiles and curve, fetching a replayed series through the loader", () => {
    const summary = read("components/RunSummary.tsx");
    for (const piece of ["Peak day", "Peak infections", "Attack rate", "Deaths", "loadSeries(", "initialSeriesState(", "Series unavailable.", 'view="infected"']) expect(summary).toContain(piece);
    const chart = read("components/Chart.tsx");
    for (const piece of ["<svg", "viewBox", "seriesFor(", "thinPoints(", "niceTicks(", "linePath(", "nearestIndex(", "onPointerMove", "Series unavailable."]) expect(chart).toContain(piece);
    expect(existsSync("components/Chart.tsx")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/app/workspace.test.ts`
Expected: FAIL, ENOENT on `components/Turn.tsx`.

- [ ] **Step 3: Write `components/Chart.tsx`**

```tsx
"use client";

import { useState, type PointerEvent } from "react";
import { compact, linePath, nearestIndex, niceTicks, seriesFor, thinPoints, type ChartView, type Series } from "@/lib/client/chart";

const WIDTH = 640;
const PAD = { top: 12, right: 12, bottom: 28, left: 52 };
const MAX_POINTS = 400;

type Props = { series: Series; view: ChartView; height?: number };

/** An epidemic curve as inline SVG: axes, one path per line, a legend, and a readout of the day under the pointer. */
export function Chart({ series, view, height = 240 }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const lines = seriesFor(view, series);
  const days = Array.isArray(series.day) ? series.day : [];
  if (lines.length === 0 || days.length === 0) return <p className="text-sm text-ink-faint">Series unavailable.</p>;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const xMax = days[days.length - 1] || 1;
  const yTicks = niceTicks(Math.max(...lines.flatMap((line) => line.values)), 4);
  const yTop = yTicks[yTicks.length - 1];
  const xTicks = niceTicks(xMax, 5).filter((tick) => tick <= xMax);
  const x = (day: number) => (day / xMax) * plotW;
  const y = (value: number) => plotH - (value / yTop) * plotH;
  const paths = lines.map((line) => ({ ...line, d: linePath(thinPoints(days, line.values, MAX_POINTS), plotW, plotH, xMax, yTop) }));

  function onMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * WIDTH - PAD.left;
    const day = Math.round(Math.max(0, Math.min(1, px / plotW)) * xMax);
    setHover(nearestIndex(days, day));
  }

  return (
    <figure>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full touch-none" role="img" aria-label={lines.map((line) => line.label).join(", ")} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <g transform={`translate(${PAD.left} ${PAD.top})`}>
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={0} x2={plotW} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" />
              <text x={-8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-faint)">
                {compact(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text key={tick} x={x(tick)} y={plotH + 18} textAnchor="middle" fontSize={11} fill="var(--color-ink-faint)">
              {tick}
            </text>
          ))}
          <text x={plotW} y={plotH + 18} textAnchor="end" fontSize={11} fill="var(--color-ink-faint)" dy={-14} opacity={0}>
            day
          </text>
          {paths.map((path) => (
            <path key={path.key} d={path.d} fill="none" stroke={path.color} strokeWidth={1.8} strokeLinejoin="round" />
          ))}
          {hover !== null && <line x1={x(days[hover])} x2={x(days[hover])} y1={0} y2={plotH} stroke="var(--color-ink-faint)" strokeDasharray="3 3" />}
        </g>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {lines.map((line) => (
          <span key={line.key}>
            <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: line.color }} />
            {line.label}
            {hover !== null && `: ${compact(line.values[hover] ?? 0)}`}
          </span>
        ))}
        <span>{hover === null ? "Days" : `Day ${days[hover]}`}</span>
      </figcaption>
    </figure>
  );
}
```

(Drop the invisible "day" text element if lint objects to it; the caption's "Days" label is the one that matters.)

- [ ] **Step 4: Write `components/RunSummary.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { Series } from "@/lib/client/chart";
import { initialSeriesState, loadSeries } from "@/lib/client/series";
import { commaInt } from "@/lib/sim/pyformat";
import type { RunPayload } from "@/lib/tools/types";
import { Chart } from "./Chart";

/** The run's series: the payload's own, or fetched once for a replayed run. */
export function useRunSeries(payload: RunPayload): Series | null | "loading" {
  const [state, setState] = useState<Series | null | "loading">(() => initialSeriesState(payload));
  useEffect(() => {
    if (payload.series || !payload.run_id) return;
    let active = true;
    void loadSeries(payload.run_id).then((series) => {
      if (active) setState(series);
    });
    return () => {
      active = false;
    };
  }, [payload.series, payload.run_id]);
  return state;
}

/** Peak day, peak infections, attack rate, deaths. */
export function StatTiles({ payload }: { payload: RunPayload }) {
  const tiles: [string, string][] = [
    ["Peak day", `Day ${payload.stats.peak_day}`],
    ["Peak infections", commaInt(payload.stats.peak_infections)],
    ["Attack rate", `${payload.attack_rate_pct.toFixed(1)}%`],
    ["Deaths", commaInt(payload.stats.total_deaths ?? 0)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-paper-2 px-3 py-2">
          <dt className="text-xs text-ink-faint">{label}</dt>
          <dd className="font-mono text-base font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Inline under the run's tool call: the tiles and the infected curve. The panel carries the rest. */
export function RunSummary({ payload }: { payload: RunPayload }) {
  const series = useRunSeries(payload);
  return (
    <section aria-label="Simulation results" className="my-3 rounded-xl border border-line bg-surface p-3">
      <StatTiles payload={payload} />
      <div className="mt-3">
        {series === "loading" ? <p className="text-sm text-ink-faint">Loading the curve…</p> : series ? <Chart series={series} view="infected" height={200} /> : <p className="text-sm text-ink-faint">Series unavailable.</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Write `components/ActivityLine.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { Block } from "@/lib/chat/events";
import { summarizeActivity } from "@/lib/client/activity";
import { ToolLine } from "./ToolLine";

type Props = { blocks: Block[]; status: string | null; onExpand?: () => void };

const LINE = "text-sm text-ink-soft";

/** One line for the reply's tool and web steps; the status text while the reply is live; a press shows each step. */
export function ActivityLine({ blocks, status, onExpand }: Props) {
  const [open, setOpen] = useState(false);
  const steps = blocks.filter((block) => block.kind === "tool_result" || block.kind === "web_search" || block.kind === "web_fetch");
  const summary = summarizeActivity(blocks);
  if (!status && steps.length === 0) return null;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) onExpand?.();
  }

  return (
    <div className="my-2">
      <button type="button" aria-expanded={open} disabled={steps.length === 0} onClick={toggle} className={`${LINE} rounded px-1 text-left hover:bg-paper-2 disabled:hover:bg-transparent`}>
        {status ?? summary}
        {steps.length > 0 && (
          <span aria-hidden="true" className="ml-1 text-ink-faint">
            {open ? "▾" : "▸"}
          </span>
        )}
      </button>
      {open && (
        <ul className="mt-1 border-l-2 border-line pl-3">
          {steps.map((block, index) => (
            <li key={index}>
              {block.kind === "tool_result" ? (
                <ToolLine name={block.name} payload={block.payload} ok={block.ok} />
              ) : block.kind === "web_search" ? (
                <p className={`my-2 ${LINE}`}>
                  <strong className="font-semibold">🔎 Web search</strong> — {block.query}
                </p>
              ) : (
                <p className={`my-2 ${LINE}`}>
                  <strong className="font-semibold">📄 Read page</strong> —{" "}
                  <a href={block.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {block.title}
                  </a>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Rewrite `components/TurnBlocks.tsx` and write `components/Turn.tsx`**

`components/TurnBlocks.tsx`:

```tsx
import type { Block } from "@/lib/chat/events";
import { withoutHidden } from "@/lib/chat/next";
import { Markdown } from "./Markdown";
import { RunSummary } from "./RunSummary";

/** One turn's blocks in order: prose, the run summary, notices. Tool and web steps live in the activity line; stage, suggestions, and recap blocks render nothing here. */
export function TurnBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "text": {
            const text = withoutHidden(block.text);
            return text ? <Markdown key={index} text={text} /> : null;
          }
          case "tool_result":
            return block.ok && block.payload.kind === "run" ? <RunSummary key={index} payload={block.payload} /> : null;
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

`components/Turn.tsx`:

```tsx
"use client";

import type { Block } from "@/lib/chat/events";
import { ActivityLine } from "./ActivityLine";
import { FeedbackControl } from "./FeedbackControl";
import { TurnBlocks } from "./TurnBlocks";

/** A turn as the page shows it: the participant's text and the assistant's blocks. */
export type DisplayTurn = { id: string; userText: string; blocks: Block[]; notice: string | null };

type Props = {
  turn: DisplayTurn;
  /** The live status text, or null once the reply is complete. */
  status: string | null;
  feedback: { conversationId: string; sessionId: string | null } | null;
  onActivityExpand?: () => void;
};

export function Turn({ turn, status, feedback, onActivityExpand }: Props) {
  return (
    <article className="py-4">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent-wash px-4 py-2.5 whitespace-pre-wrap">{turn.userText}</p>
      <div className="mt-4">
        <ActivityLine blocks={turn.blocks} status={status} onExpand={onActivityExpand} />
        <TurnBlocks blocks={turn.blocks} />
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
```

In `components/Chat.tsx`, replace the local `TurnView` function and the `DisplayTurn` type with `import { Turn, type DisplayTurn } from "./Turn";` plus `export type { DisplayTurn };`, and render `<Turn ... />` where `<TurnView ... />` was (same props; the `status` for a finished turn is `null`). Remove the now-unused imports (`FeedbackControl`, `TurnBlocks`). Task 12 rewrites the rest of the file.

In `tests/app/pages.test.ts`, the chat-component test asserts `<FeedbackControl` on `components/Chat.tsx`; change that one line to read `components/Turn.tsx` instead, since the thumbs now render there.

- [ ] **Step 7: Run the static test, the typecheck, and the lint**

Run: `npx vitest run tests/app/workspace.test.ts && npm run typecheck && npm run lint`
Expected: PASS, 3 tests; typecheck and lint clean.

- [ ] **Step 8: Commit**

```bash
git add components/Chart.tsx components/RunSummary.tsx components/ActivityLine.tsx components/Turn.tsx components/TurnBlocks.tsx components/Chat.tsx tests/app/workspace.test.ts
git commit -m "feat(ui): one activity line per reply, an inline run summary, and an SVG chart"
```

---

### Task 10: The details panel

**Files:**
- Create: `components/panel/Section.tsx`, `components/panel/ScenarioSection.tsx`, `components/panel/DataSection.tsx`, `components/panel/RunsSection.tsx`, `components/panel/ActivitySection.tsx`, `components/panel/DetailsPanel.tsx`
- Test: `tests/app/workspace.test.ts`

**Interfaces:**
- Consumes: `Artifacts`, `RunArtifact`, `ActivityItem` (Task 6); `formatDuration` (Task 6); `Chart`, `StatTiles`, `useRunSeries` (Task 9); `CHART_VIEWS`, `PanelSection` (`lib/enums.ts`); `fmtValue` (`lib/sim/pyformat.ts`); `ChartView`.
- Produces: `DetailsPanel({ artifacts, onSectionOpen, onChartView })` where `onSectionOpen(section: PanelSection)` and `onChartView(view: ChartView, turnId: string)`.

- [ ] **Step 1: Write the failing static tests**

Append to `tests/app/workspace.test.ts`:

```ts
describe("the details panel", () => {
  it("has four collapsible sections with the spec's empty states", () => {
    const panel = read("components/panel/DetailsPanel.tsx");
    for (const piece of ["<ScenarioSection", "<DataSection", "<RunsSection", "<ActivitySection", "runs.length"]) expect(panel).toContain(piece);
    expect(read("components/panel/ScenarioSection.tsx")).toContain("The configuration appears here once a scenario is set up.");
    expect(read("components/panel/DataSection.tsx")).toContain("Real data appears here once it is fetched.");
    expect(read("components/panel/RunsSection.tsx")).toContain("Results appear here after the first run.");
    expect(read("components/panel/ActivitySection.tsx")).toContain("Steps appear here as the assistant works.");
    const section = read("components/panel/Section.tsx");
    expect(section).toContain("aria-expanded");
    expect(section).toContain("aria-controls");
  });

  it("gives every run its tiles, a chart with the four views, its parameters, repairs, and sources", () => {
    const runs = read("components/panel/RunsSection.tsx");
    for (const piece of ["<StatTiles", "<Chart", "CHART_VIEWS", "useRunSeries(", "effective_params", "repairs", "data_sources", "onChartView("]) expect(runs).toContain(piece);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/app/workspace.test.ts`
Expected: FAIL, ENOENT on `components/panel/DetailsPanel.tsx`.

- [ ] **Step 3: Write `components/panel/Section.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";

type Props = { id: string; title: string; open: boolean; count?: number; onToggle: (open: boolean) => void; children: ReactNode };

/** A collapsible section of the details panel. */
export function Section({ id, title, open, count, onToggle, children }: Props) {
  return (
    <section className="border-b border-line">
      <h3>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => onToggle(!open)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold hover:bg-paper-2">
          <span className="flex-1">{title}</span>
          {count !== undefined && count > 0 && <span className="rounded-full bg-paper-2 px-2 text-xs font-medium text-ink-soft">{count}</span>}
          <span aria-hidden="true" className="text-ink-faint">
            {open ? "▾" : "▸"}
          </span>
        </button>
      </h3>
      {open && (
        <div id={id} className="px-4 pb-4 text-sm">
          {children}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Write `components/panel/ScenarioSection.tsx`**

```tsx
import { commaInt } from "@/lib/sim/pyformat";
import type { ConfigPayload, DiseasePayload } from "@/lib/tools/types";

const STATUS: Record<string, string> = { ok: "", under_review: "under review", estimates_only: "estimates only", no_source: "no source" };

type Props = { config: ConfigPayload | null; disease: DiseasePayload | null };

/** The present configuration and the literature parameters behind it. */
export function ScenarioSection({ config, disease }: Props) {
  if (!config && !disease) return <p className="text-ink-faint">The configuration appears here once a scenario is set up.</p>;
  const c = config?.config;
  const rows: [string, string][] = c
    ? [
        ["Disease", c.disease ?? "—"],
        ["Model", c.disease_type.toUpperCase()],
        ["Country", c.country ?? "—"],
        ["Agents", commaInt(c.n_agents)],
        ["Duration", `${c.sim_dur_years} year${c.sim_dur_years === 1 ? "" : "s"}`],
        ["R0 (approx.)", (config?.approx_r0 ?? 0).toFixed(1)],
        ["Infectious period", `${c.dur_inf} days`],
        ...(c.dur_exp ? ([["Exposed period", `${c.dur_exp} days`]] as [string, string][]) : []),
        ["Interventions", c.interventions.length > 0 ? c.interventions.join(", ") : "none"],
      ]
    : [];
  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-faint">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {config && config.warnings.length > 0 && (
        <ul className="rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3 py-2 text-warn-ink">
          {config.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {disease && (
        <div>
          <h4 className="mb-1 text-xs font-semibold tracking-wide text-ink-faint uppercase">{disease.display_name} in the literature</h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-faint">
                <th className="py-1 pr-2 font-medium">Parameter</th>
                <th className="py-1 pr-2 font-medium">Typical</th>
                <th className="py-1 pr-2 font-medium">Range</th>
                <th className="py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(disease.parameters).map(([name, p]) => (
                <tr key={name} className="border-t border-line">
                  <td className="py-1 pr-2">{name}</td>
                  <td className="py-1 pr-2 font-mono">{p.typical !== undefined ? `${p.typical}${p.unit ? ` ${p.unit}` : ""}` : "—"}</td>
                  <td className="py-1 pr-2 font-mono">{p.min !== undefined && p.max !== undefined ? `${p.min}–${p.max}` : "—"}</td>
                  <td className="py-1 text-ink-soft">{STATUS[p.status] ?? p.status}{p.n_estimates > 0 ? ` (${p.n_estimates})` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write `components/panel/DataSection.tsx`**

```tsx
import { fmtValue } from "@/lib/sim/pyformat";
import type { DataPayload } from "@/lib/tools/types";

export const SOURCE_LABELS: Record<DataPayload["source"], string> = {
  un_wpp: "UN World Population Prospects",
  wb_data360: "World Bank Data360",
  who_gho: "WHO Global Health Observatory",
  sim_fallback: "Built-in fallback",
};

/** Every data fetch applied to the current scenario. */
export function DataSection({ data }: { data: DataPayload[] }) {
  if (data.length === 0) return <p className="text-ink-faint">Real data appears here once it is fetched.</p>;
  return (
    <ul className="space-y-3">
      {data.map((entry, index) => (
        <li key={index}>
          <p className="font-medium">
            {SOURCE_LABELS[entry.source] ?? entry.source} <span className="font-normal text-ink-faint">· {entry.iso3}</span>
          </p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
            {Object.entries(entry.applied).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-ink-faint">{key}</dt>
                <dd>{fmtValue(value)}</dd>
              </div>
            ))}
          </dl>
          {entry.warnings && entry.warnings.length > 0 && <p className="mt-1 text-xs text-warn-ink">{entry.warnings.join(" ")}</p>}
          {entry.citations.length > 0 && (
            <ul className="mt-1 text-xs text-ink-soft">
              {entry.citations.map((citation) => (
                <li key={citation}>
                  {/^https?:\/\//.test(citation) ? (
                    <a href={citation} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      {citation}
                    </a>
                  ) : (
                    citation
                  )}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: Write `components/panel/RunsSection.tsx`**

```tsx
"use client";

import { useState } from "react";
import { formatDuration } from "@/lib/client/activity";
import type { RunArtifact } from "@/lib/client/artifacts";
import type { ChartView } from "@/lib/client/chart";
import { CHART_VIEWS } from "@/lib/enums";
import { fmtValue } from "@/lib/sim/pyformat";
import { Chart } from "../Chart";
import { StatTiles, useRunSeries } from "../RunSummary";

const VIEW_LABELS: Record<(typeof CHART_VIEWS)[number], string> = { compartments: "Compartments", incidence: "Incidence", cumulative: "Cumulative", deaths: "Deaths" };
const PARAM_KEYS = ["beta", "n_contacts", "init_prev", "dur_inf", "dur_exp", "dur_immune", "p_death", "sim_dur_years", "n_agents"] as const;

type Props = { runs: RunArtifact[]; onChartView: (view: ChartView, turnId: string) => void };

function RunEntry({ run, open: initiallyOpen, onChartView }: { run: RunArtifact; open: boolean; onChartView: Props["onChartView"] }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [view, setView] = useState<ChartView>("compartments");
  const series = useRunSeries(run.payload);
  const p = run.payload;
  return (
    <li className="rounded-lg border border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-left font-medium hover:bg-paper-2">
        <span>Run {run.index}</span>
        <span className="text-xs text-ink-faint">
          {formatDuration(p.duration_ms)}
          {p.cold_start ? ", cold start" : ""}
        </span>
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          <StatTiles payload={p} />
          <div role="group" aria-label="Chart view" className="flex flex-wrap gap-1">
            {CHART_VIEWS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={view === candidate}
                onClick={() => {
                  setView(candidate);
                  onChartView(candidate, run.turnId);
                }}
                className="rounded-full border border-line px-2.5 py-0.5 text-xs aria-pressed:border-accent aria-pressed:bg-accent-wash"
              >
                {VIEW_LABELS[candidate]}
              </button>
            ))}
          </div>
          {series === "loading" ? <p className="text-ink-faint">Loading the curve…</p> : series ? <Chart series={series} view={view} /> : <p className="text-ink-faint">Series unavailable.</p>}
          <details>
            <summary className="cursor-pointer text-xs font-semibold tracking-wide text-ink-faint uppercase">Effective parameters</summary>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
              {PARAM_KEYS.filter((key) => p.effective_params[key] !== null && p.effective_params[key] !== undefined).map((key) => (
                <div key={key} className="contents">
                  <dt className="text-ink-faint">{key}</dt>
                  <dd>{fmtValue(p.effective_params[key])}</dd>
                </div>
              ))}
              {p.effective_params.interventions.length > 0 && (
                <div className="contents">
                  <dt className="text-ink-faint">interventions</dt>
                  <dd>{p.effective_params.interventions.map((i) => `${i.type}${i.coverage !== null && i.coverage !== undefined ? ` ${Math.round(i.coverage * 100)}%` : ""}`).join(", ")}</dd>
                </div>
              )}
              <div className="contents">
                <dt className="text-ink-faint">population</dt>
                <dd>
                  {fmtValue(p.population)} (scale {fmtValue(p.pop_scale)})
                </dd>
              </div>
            </dl>
          </details>
          {p.repairs.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold tracking-wide text-warn-ink uppercase">Repairs ({p.repairs.length})</summary>
              <ol className="mt-1 list-decimal pl-4 text-xs text-ink-soft">
                {p.repairs.map((repair) => (
                  <li key={repair.attempt}>
                    {repair.error}
                    {repair.changes && repair.changes.length > 0 && <span> → {repair.changes.map((change) => `${change.field}: ${fmtValue(change.from)} → ${fmtValue(change.to)}`).join("; ")}</span>}
                  </li>
                ))}
              </ol>
            </details>
          )}
          {p.data_sources.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold tracking-wide text-ink-faint uppercase">Data sources ({p.data_sources.length})</summary>
              <ul className="mt-1 text-xs text-ink-soft">
                {p.data_sources.map((source) => (
                  <li key={source.field}>
                    <span className="font-mono">{source.field}</span> = {fmtValue(source.value)} — {source.citation}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {p.warnings.length > 0 && <p className="text-xs text-warn-ink">{p.warnings.join(" ")}</p>}
        </div>
      )}
    </li>
  );
}

/** Every run of the conversation, newest first and open. */
export function RunsSection({ runs, onChartView }: Props) {
  if (runs.length === 0) return <p className="text-ink-faint">Results appear here after the first run.</p>;
  const newest = runs[runs.length - 1];
  return (
    <ul className="space-y-2">
      {[...runs].reverse().map((run) => (
        <RunEntry key={run.turnId + run.index} run={run} open={run === newest} onChartView={onChartView} />
      ))}
    </ul>
  );
}
```

- [ ] **Step 7: Write `components/panel/ActivitySection.tsx` and `components/panel/DetailsPanel.tsx`**

`components/panel/ActivitySection.tsx`:

```tsx
import { formatDuration } from "@/lib/client/activity";
import type { ActivityItem } from "@/lib/client/artifacts";

/** Every tool and web step of the conversation, in order. */
export function ActivitySection({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <p className="text-ink-faint">Steps appear here as the assistant works.</p>;
  return (
    <ol className="space-y-1.5">
      {items.map((item, index) => (
        <li key={index} className={item.ok ? "" : "text-warn-ink"}>
          <span className="font-medium">
            {item.ok ? "" : "⚠ "}
            {item.label}
          </span>
          {item.durationMs !== null && <span className="ml-1 text-xs text-ink-faint">{formatDuration(item.durationMs)}</span>}
          {item.detail && <p className="text-xs break-words text-ink-soft">{item.detail}</p>}
        </li>
      ))}
    </ol>
  );
}
```

`components/panel/DetailsPanel.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { Artifacts } from "@/lib/client/artifacts";
import type { ChartView } from "@/lib/client/chart";
import type { PanelSection } from "@/lib/enums";
import { ActivitySection } from "./ActivitySection";
import { DataSection } from "./DataSection";
import { RunsSection } from "./RunsSection";
import { ScenarioSection } from "./ScenarioSection";
import { Section } from "./Section";

type Props = { artifacts: Artifacts; onSectionOpen: (section: PanelSection) => void; onChartView: (view: ChartView, turnId: string) => void };

/** The right column: the present scenario, the data applied, every run, and every step. The newest run opens its section. */
export function DetailsPanel({ artifacts, onSectionOpen, onChartView }: Props) {
  const [open, setOpen] = useState<Record<PanelSection, boolean>>({ scenario: true, data: false, runs: true, activity: false });
  const runCount = useRef(artifacts.runs.length);

  useEffect(() => {
    if (artifacts.runs.length > runCount.current) setOpen((state) => ({ ...state, runs: true }));
    runCount.current = artifacts.runs.length;
  }, [artifacts.runs.length]);

  const toggle = (section: PanelSection) => (next: boolean) => {
    setOpen((state) => ({ ...state, [section]: next }));
    if (next) onSectionOpen(section);
  };

  return (
    <div className="text-sm">
      <h2 className="px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-ink-faint uppercase">Details</h2>
      <Section id="panel-scenario" title="Scenario" open={open.scenario} onToggle={toggle("scenario")}>
        <ScenarioSection config={artifacts.config} disease={artifacts.disease} />
      </Section>
      <Section id="panel-data" title="Data" count={artifacts.data.length} open={open.data} onToggle={toggle("data")}>
        <DataSection data={artifacts.data} />
      </Section>
      <Section id="panel-runs" title="Runs" count={artifacts.runs.length} open={open.runs} onToggle={toggle("runs")}>
        <RunsSection runs={artifacts.runs} onChartView={onChartView} />
      </Section>
      <Section id="panel-activity" title="Activity" count={artifacts.activity.length} open={open.activity} onToggle={toggle("activity")}>
        <ActivitySection items={artifacts.activity} />
      </Section>
    </div>
  );
}
```

- [ ] **Step 8: Run the static tests, the typecheck, and the lint**

Run: `npx vitest run tests/app/workspace.test.ts && npm run typecheck && npm run lint`
Expected: PASS, 5 tests; typecheck and lint clean. The lint rule against `!` non-null assertions, if enabled, is satisfied by replacing `config!.approx_r0` with `(config?.approx_r0 ?? 0)`.

- [ ] **Step 9: Commit**

```bash
git add components/panel tests/app/workspace.test.ts
git commit -m "feat(ui): the details panel with scenario, data, runs, and activity sections"
```

---

### Task 11: Recap bar, stage strip, sidebar list, header

**Files:**
- Create: `components/RecapBar.tsx`, `components/StageStrip.tsx`, `lib/client/conversations.ts`
- Modify: `components/ConversationList.tsx` (rewrite), `components/ChatHeader.tsx` (rewrite)
- Test: `tests/client/conversations.test.ts` (new), `tests/app/workspace.test.ts`

**Interfaces:**
- Consumes: `STAGE_LABELS`, `STAGE_HINTS` (Task 4); `STAGE_INDEX` (`lib/chat/stages.ts`); `STAGES`; `ConversationSummary`, `titleFrom` (`lib/db/conversations.ts`).
- Produces: `RecapBar({ items, onExpand? })`; `StageStrip({ stage })`; `groupByDay(items, now): DayGroup[]`; `dayLabel(iso, now): string`; `summaryFor(id, text, now): ConversationSummary`; `ConversationList({ items, currentId, busy, onNew, onPick, onRemoved })`; `ChatHeader({ email, busy, onNew, onMenu, onDetails, menuOpen, detailsOpen, unseen })`.

- [ ] **Step 1: Write the failing tests**

`tests/client/conversations.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { dayLabel, groupByDay, summaryFor } from "@/lib/client/conversations";

const NOW = new Date(2026, 9, 8, 12, 0, 0);
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).toISOString();

describe("sidebar grouping", () => {
  it("labels today, yesterday, and earlier days, with the year only when it differs", () => {
    expect(dayLabel(at(2026, 9, 8, 1), NOW)).toBe("Today");
    expect(dayLabel(at(2026, 9, 7, 23), NOW)).toBe("Yesterday");
    expect(dayLabel(at(2026, 8, 30), NOW)).toBe("Sep 30");
    expect(dayLabel(at(2025, 11, 25), NOW)).toBe("Dec 25, 2025");
  });

  it("groups consecutive conversations by day, keeping their order", () => {
    const items = [
      { id: "a", title: "A", updatedAt: at(2026, 9, 8, 11) },
      { id: "b", title: "B", updatedAt: at(2026, 9, 8, 8) },
      { id: "c", title: "C", updatedAt: at(2026, 9, 7) },
      { id: "d", title: "D", updatedAt: at(2026, 8, 30) },
    ];
    expect(groupByDay(items, NOW).map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([["Today", ["a", "b"]], ["Yesterday", ["c"]], ["Sep 30", ["d"]]]);
    expect(groupByDay([], NOW)).toEqual([]);
  });

  it("builds the row for a conversation the first turn just opened", () => {
    expect(summaryFor("x", "Model a measles outbreak in Kenya", NOW)).toEqual({ id: "x", title: "Model a measles outbreak in Kenya", updatedAt: NOW.toISOString() });
  });
});
```

Append to `tests/app/workspace.test.ts`:

```ts
describe("the bottom stack, the sidebar, and the header", () => {
  it("shows the decisions so far, collapsed to the first one", () => {
    const bar = read("components/RecapBar.tsx");
    for (const piece of ["Decisions so far", "aria-expanded", "items.length - 1", "more"]) expect(bar).toContain(piece);
  });

  it("marks the current stage and explains it", () => {
    const strip = read("components/StageStrip.tsx");
    for (const piece of ["STAGE_LABELS", "STAGE_HINTS", "STAGE_INDEX", 'aria-current={', '"step"']) expect(strip).toContain(piece);
  });

  it("lists conversations by day with New at the top and a two-press delete", () => {
    const list = read("components/ConversationList.tsx");
    for (const piece of ["groupByDay(", "New conversation", "A conversation appears here after your first message.", "Delete?", "onRemoved(", "aria-current"]) expect(list).toContain(piece);
  });

  it("gives the header the two narrow-screen toggles and keeps New's reset", () => {
    const header = read("components/ChatHeader.tsx");
    for (const piece of ['aria-label="Conversations"', 'aria-label="Details"', "xl:hidden", "onClick={onNew}", "aria-expanded"]) expect(header).toContain(piece);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/client/conversations.test.ts tests/app/workspace.test.ts`
Expected: FAIL: the conversations module is missing; the static tests miss `RecapBar.tsx`.

- [ ] **Step 3: Write `lib/client/conversations.ts`**

```ts
/** The sidebar's day groups and the row for a conversation the page just opened. */
import { titleFrom, type ConversationSummary } from "@/lib/db/conversations";

export type DayGroup = { label: string; items: ConversationSummary[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** "Today", "Yesterday", "Sep 30", or "Dec 25, 2025" in the browser's local time. */
export function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  if (dayKey(date) === dayKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  const year = date.getFullYear() === now.getFullYear() ? "" : `, ${date.getFullYear()}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${year}`;
}

/** Consecutive conversations with the same day label, in the order given (newest first). */
export function groupByDay(items: ConversationSummary[], now: Date): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const label = dayLabel(item.updatedAt, now);
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/** The sidebar row for a conversation whose first turn just finished; the server's title rule, applied here. */
export function summaryFor(id: string, text: string, now: Date): ConversationSummary {
  return { id, title: titleFrom(text), updatedAt: now.toISOString() };
}
```

- [ ] **Step 4: Write `components/RecapBar.tsx` and `components/StageStrip.tsx`**

`components/RecapBar.tsx`:

```tsx
"use client";

import { useState } from "react";

type Props = { items: string[]; onExpand?: () => void };

/** The decisions made so far, from the newest recap block; one line until pressed. */
export function RecapBar({ items, onExpand }: Props) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) onExpand?.();
  }

  return (
    <div className="mb-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
      <button type="button" aria-expanded={open} onClick={toggle} className="flex w-full items-baseline gap-2 text-left">
        <span className="shrink-0 font-semibold">Decisions so far</span>
        {!open && (
          <span className="min-w-0 truncate text-ink-soft">
            {items[0]}
            {items.length > 1 && <span className="text-ink-faint"> +{items.length - 1} more</span>}
          </span>
        )}
        <span aria-hidden="true" className="ml-auto text-ink-faint">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-ink-soft">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

`components/StageStrip.tsx`:

```tsx
import { STAGE_INDEX } from "@/lib/chat/stages";
import { STAGE_HINTS, STAGE_LABELS } from "@/lib/client/drafts";
import { STAGES, type Stage } from "@/lib/enums";

const DONE = "rounded-full bg-accent-wash px-2.5 py-1 text-accent";
const CURRENT = "rounded-full bg-accent px-2.5 py-1 text-white";
const AHEAD = "rounded-full px-2.5 py-1 text-ink-faint";

/** The five stages with the current one marked, and a line about what happens now. */
export function StageStrip({ stage }: { stage: Stage }) {
  const current = STAGE_INDEX[stage];
  return (
    <nav aria-label="Workflow stage" className="mb-2.5">
      <ol className="flex gap-1 overflow-x-auto text-xs font-medium whitespace-nowrap">
        {STAGES.map((candidate, index) => (
          <li key={candidate} aria-current={candidate === stage ? "step" : undefined} className={index < current ? DONE : index === current ? CURRENT : AHEAD}>
            {STAGE_LABELS[candidate]}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-xs text-ink-faint">{STAGE_HINTS[stage]}</p>
    </nav>
  );
}
```

- [ ] **Step 5: Rewrite `components/ConversationList.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { groupByDay } from "@/lib/client/conversations";
import type { ConversationSummary } from "@/lib/db/conversations";

type Props = {
  items: ConversationSummary[];
  currentId: string | null;
  /** A reply is arriving: New waits. */
  busy: boolean;
  onNew: () => void;
  /** A row was pressed (the link navigates); the shell closes its drawer. */
  onPick: () => void;
  /** A conversation was deleted; the owner of the list drops it. */
  onRemoved: (id: string) => void;
};

const ROW = "flex min-w-0 flex-1 flex-col gap-0.5 py-2 text-sm hover:text-accent aria-[current=page]:font-semibold aria-[current=page]:text-accent";
const NEW = "mb-3 block rounded-full border border-line bg-surface px-3.5 py-1.5 text-center text-sm font-medium text-accent hover:border-accent hover:bg-accent-wash";

/** The left column: New, then the participant's conversations by day, each with a two-press delete. */
export function ConversationList({ items, currentId, busy, onNew, onPick, onRemoved }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function remove(id: string) {
    setFailed(false);
    const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    if (!response || (response.status !== 204 && response.status !== 404)) {
      setFailed(true);
      return;
    }
    onRemoved(id);
  }

  return (
    <div className="flex flex-col px-3 py-4">
      {busy ? (
        <span className={`${NEW} opacity-50`} aria-disabled="true">
          New conversation
        </span>
      ) : (
        <Link href="/chat" onClick={onNew} className={NEW}>
          New conversation
        </Link>
      )}
      {items.length === 0 ? (
        <p className="px-1 text-sm text-ink-soft">A conversation appears here after your first message.</p>
      ) : (
        groupByDay(items, new Date()).map((group) => (
          <section key={group.label} className="mb-3">
            <h2 className="px-1 text-xs font-semibold tracking-wide text-ink-faint uppercase" suppressHydrationWarning>
              {group.label}
            </h2>
            <ul>
              {group.items.map((item) => (
                <li key={item.id} className="flex items-center gap-1 px-1">
                  <Link href={`/chat/${item.id}`} onClick={onPick} aria-current={item.id === currentId ? "page" : undefined} className={ROW}>
                    <span className="truncate">{item.title}</span>
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
                        ? "rounded-full bg-warn-wash px-2 py-1 text-xs font-medium whitespace-nowrap text-warn-ink"
                        : "rounded-full px-2 py-1 text-xs font-medium whitespace-nowrap text-ink-faint hover:bg-warn-wash hover:text-warn-ink"
                    }
                  >
                    {confirming === item.id ? "Delete?" : "Delete"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {failed && (
        <p role="alert" className="px-1 text-sm text-warn-ink">
          That conversation could not be deleted. Please try again.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Rewrite `components/ChatHeader.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { createClient } from "@/lib/supabase/client";

const QUIET = "rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-soft hover:bg-paper-2 hover:text-ink";
const ICON = "relative rounded-full px-2.5 py-1.5 text-sm text-ink-soft hover:bg-paper-2 hover:text-ink xl:hidden";

type Props = {
  email: string;
  busy: boolean;
  onNew: () => void;
  onMenu: () => void;
  onDetails: () => void;
  menuOpen: boolean;
  detailsOpen: boolean;
  /** Something new arrived in the panel while it was closed. */
  unseen: boolean;
};

/** The full-width bar: the menu toggle (narrow), the brand, New, the Details toggle (narrow), the address, Sign out. */
export function ChatHeader({ email, busy, onNew, onMenu, onDetails, menuOpen, detailsOpen, unseen }: Props) {
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <header className="z-30 border-b border-line bg-paper/90 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={onMenu} aria-expanded={menuOpen} aria-label="Conversations" className={ICON}>
          ☰
        </button>
        <Brand />
        <nav aria-label="Chat" className="ml-auto flex items-center gap-1">
          <span className="hidden truncate text-xs text-ink-faint sm:inline">{email}</span>
          {busy ? (
            <span className={`${QUIET} opacity-50`} aria-disabled="true">
              New
            </span>
          ) : (
            <Link href="/chat" onClick={onNew} className={QUIET} aria-label="New conversation">
              New
            </Link>
          )}
          <button type="button" onClick={onDetails} aria-expanded={detailsOpen} aria-label="Details" className={ICON}>
            Details
            {unseen && <span aria-hidden="true" className="absolute top-1 right-1 h-2 w-2 rounded-full bg-accent" />}
          </button>
          <button type="button" onClick={signOut} className={QUIET}>
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npx vitest run tests/client/conversations.test.ts tests/app/workspace.test.ts && npm run typecheck`
Expected: the unit tests and static tests PASS; the typecheck FAILS only in `components/Chat.tsx`, which still passes the old props (fixed in Task 12). If the typecheck reports anything else, fix it here.

- [ ] **Step 8: Commit**

```bash
git add lib/client/conversations.ts components/RecapBar.tsx components/StageStrip.tsx components/ConversationList.tsx components/ChatHeader.tsx tests/client/conversations.test.ts tests/app/workspace.test.ts
git commit -m "feat(ui): recap bar, stage strip, day-grouped sidebar, header toggles"
```

---

### Task 12: The shell and the chat state

**Files:**
- Create: `components/WorkspaceShell.tsx`
- Modify: `components/Chat.tsx` (rewrite)
- Test: `tests/app/workspace.test.ts`, `tests/app/pages.test.ts`

**Interfaces:**
- Consumes: everything above. `Chat` keeps its props: `{ email, conversations, initial, maxMessageChars, contactEmail }`.
- Produces: `WorkspaceShell({ header, sidebar, panel, children, drawerOpen, sheetOpen, onClose, columnRef })`.

- [ ] **Step 1: Write the failing static tests**

Append to `tests/app/workspace.test.ts`:

```ts
describe("the shell", () => {
  it("lays out three regions, overlays on narrow screens, and closes them on Escape", () => {
    const shell = read("components/WorkspaceShell.tsx");
    for (const piece of ['aria-label="Conversations"', 'aria-label="Details"', "<main", "xl:static", "xl:hidden", '"Escape"', "overflow-y-auto", "h-dvh"]) expect(shell).toContain(piece);
  });

  it("composes the chat from the shell, the panel, the strip, the recap, and the chips, and reports the panel events", () => {
    const chat = read("components/Chat.tsx");
    for (const piece of ["<WorkspaceShell", "<DetailsPanel", "<StageStrip", "<RecapBar", "<Suggestions", "deriveArtifacts(", "chipsFor(", "lastRecap(", "summaryFor(", 'kind: "scenario_panel_opened"', 'kind: "chart_view_changed"', 'card: "activity"', 'card: "recap"', "source"]) expect(chat).toContain(piece);
    expect(chat).not.toContain("window.scrollTo");
    expect(chat).not.toContain("EXAMPLES");
    expect(chat).toContain("DRAFTS.understand");
  });
});
```

In `tests/app/pages.test.ts`, the New-reset test keeps passing: it looks for `function startNew`, `setTurns([])`, `setConversationId(null)` in `Chat.tsx` and `onClick={onNew}` in `ChatHeader.tsx`. Leave it as it is.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/app/workspace.test.ts`
Expected: FAIL, ENOENT on `components/WorkspaceShell.tsx`.

- [ ] **Step 3: Write `components/WorkspaceShell.tsx`**

```tsx
"use client";

import { useEffect, type ReactNode, type RefObject } from "react";

type Props = {
  header: ReactNode;
  sidebar: ReactNode;
  panel: ReactNode;
  children: ReactNode;
  drawerOpen: boolean;
  sheetOpen: boolean;
  onClose: () => void;
  /** The middle column, which scrolls on its own. */
  columnRef: RefObject<HTMLElement | null>;
};

const DRAWER = "absolute inset-y-0 left-0 z-20 w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-paper xl:static xl:flex xl:w-64";
const SHEET = "absolute inset-y-0 right-0 z-20 w-96 max-w-[92vw] flex-col overflow-y-auto border-l border-line bg-paper xl:static xl:flex xl:w-96";

/** Three columns from xl; below that the sides are overlays with a backdrop, closed by Escape or a press outside. */
export function WorkspaceShell({ header, sidebar, panel, children, drawerOpen, sheetOpen, onClose, columnRef }: Props) {
  const overlay = drawerOpen || sheetOpen;

  useEffect(() => {
    if (!overlay) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, onClose]);

  return (
    <div className="flex h-dvh flex-col">
      {header}
      <div className="relative flex min-h-0 flex-1">
        <aside aria-label="Conversations" className={`${drawerOpen ? "flex" : "hidden"} ${DRAWER}`}>
          {sidebar}
        </aside>
        <main ref={columnRef} className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
        <aside aria-label="Details" className={`${sheetOpen ? "flex" : "hidden"} ${SHEET}`}>
          {panel}
        </aside>
        {overlay && <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 z-10 bg-ink/20 xl:hidden" />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `components/Chat.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatStreamEvent } from "@/lib/chat/events";
import { deriveArtifacts } from "@/lib/client/artifacts";
import type { ChartView } from "@/lib/client/chart";
import { summaryFor } from "@/lib/client/conversations";
import { DRAFTS, chipsFor, type ChipSource } from "@/lib/client/drafts";
import { keepFollowing } from "@/lib/client/scroll";
import { readEvents } from "@/lib/client/sse";
import { track } from "@/lib/client/track";
import { INTERRUPTED, applyEvent, lastRecap, lastStage, lastSuggestions, startTurn, type TurnProgress } from "@/lib/client/turn";
import type { ConversationSummary } from "@/lib/db/conversations";
import type { PanelSection } from "@/lib/enums";
import { ChatHeader } from "./ChatHeader";
import { ConversationList } from "./ConversationList";
import { DetailsPanel } from "./panel/DetailsPanel";
import { RecapBar } from "./RecapBar";
import { useSessionId } from "./SessionProvider";
import { StageStrip } from "./StageStrip";
import { Suggestions } from "./Suggestions";
import { Turn, type DisplayTurn } from "./Turn";
import { WorkspaceShell } from "./WorkspaceShell";

export type { DisplayTurn };

type Props = {
  email: string;
  conversations: ConversationSummary[];
  /** The conversation being resumed, or null for a new one. */
  initial: { id: string; title: string; turns: DisplayTurn[] } | null;
  maxMessageChars: number;
  contactEmail: string;
};

const CHIP = "rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium text-accent hover:border-accent hover:bg-accent-wash";

/** The workspace: the list on the left, the conversation and its bottom stack in the middle, the details on the right. Owns the conversation state. */
export function Chat({ email, conversations: initialConversations, initial, maxMessageChars, contactEmail }: Props) {
  const router = useRouter();
  const sessionId = useSessionId();
  const [conversationId, setConversationId] = useState<string | null>(initial?.id ?? null);
  const [conversations, setConversations] = useState(initialConversations);
  const [turns, setTurns] = useState<DisplayTurn[]>(initial?.turns ?? []);
  const [live, setLive] = useState<{ userText: string; progress: TurnProgress } | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const inputBox = useRef<HTMLTextAreaElement>(null);
  const column = useRef<HTMLElement>(null);
  const inFlight = useRef<AbortController | null>(null);
  const following = useRef(true);
  const resumedReported = useRef(false);

  useEffect(() => () => inFlight.current?.abort(), []);

  useEffect(() => {
    if (!initial || !sessionId || resumedReported.current) return;
    resumedReported.current = true;
    track({ kind: "conversation_resumed", sessionId, conversationId: initial.id });
  }, [initial, sessionId]);

  // Follow the reply inside the middle column; the page itself never scrolls.
  useEffect(() => {
    const element = column.current;
    if (!element) return;
    let previousTop = element.scrollTop;
    const onScroll = () => {
      following.current = keepFollowing(following.current, previousTop, element);
      previousTop = element.scrollTop;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const element = column.current;
    if (element && following.current && (live || turns.length > 0)) element.scrollTo({ top: element.scrollHeight });
  }, [turns, live, error]);

  const artifacts = useMemo(() => deriveArtifacts(live ? [...turns, { id: "live", blocks: live.progress.blocks }] : turns), [turns, live]);
  const artifactCount = artifacts.runs.length + artifacts.data.length + (artifacts.config ? 1 : 0);
  const seen = useRef(artifactCount);
  useEffect(() => {
    if (artifactCount > seen.current && !sheet) setUnseen(true);
    seen.current = artifactCount;
  }, [artifactCount, sheet]);

  const stage = live?.progress.stage ?? lastStage(turns);
  const empty = turns.length === 0 && !live;
  const chips = live || empty ? { items: [], source: "draft" as ChipSource } : chipsFor(stage, lastSuggestions(turns));
  const recap = lastRecap(turns);
  const feedback = conversationId ? { conversationId, sessionId } : null;
  const session = sessionId ?? undefined;

  function openSheet() {
    setSheet(true);
    setUnseen(false);
    if (conversationId) track({ kind: "scenario_panel_opened", sessionId: session, conversationId });
  }
  function onSectionOpen(section: PanelSection) {
    if (conversationId) track({ kind: "scenario_panel_opened", sessionId: session, conversationId, section });
  }
  function onChartView(view: ChartView, turnId: string) {
    if (conversationId && turnId !== "live" && view !== "infected") track({ kind: "chart_view_changed", sessionId: session, conversationId, turnId, view });
  }
  function onActivityExpand(turnId: string) {
    if (conversationId && turnId !== "live") track({ kind: "card_expanded", sessionId: session, conversationId, turnId, card: "activity" });
  }
  function onRecapExpand() {
    const turnId = turns.at(-1)?.id;
    if (conversationId && turnId) track({ kind: "card_expanded", sessionId: session, conversationId, turnId, card: "recap" });
  }

  /** Send what is in the message box, or a chip the participant pressed (with where it came from). */
  async function send(text: string, source?: ChipSource) {
    const userText = text.trim();
    if (!userText || live) return;
    if (userText.length > maxMessageChars) {
      setError(`That message is too long. Keep it under ${maxMessageChars} characters.`);
      return;
    }
    const suggested = source !== undefined;
    if (suggested && conversationId) {
      track({ kind: "suggestion_used", sessionId: session, conversationId, turnId: turns.at(-1)?.id, stage, source });
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
          // The first turn opened the conversation: show its address and its row without reloading the page.
          setConversationId(id);
          setConversations((list) => [summaryFor(id, userText, new Date()), ...list]);
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

  /**
   * Start a new conversation. The first turn swaps the address to /chat/[id]
   * without a navigation, so a link back to /chat can land on this same
   * component instance with its state intact; reset it here before the link
   * navigates, rather than relying on a remount.
   */
  function startNew() {
    if (live) return;
    inFlight.current?.abort();
    inFlight.current = null;
    following.current = true;
    setTurns([]);
    setConversationId(null);
    setError(null);
    setInput("");
    setDrawer(false);
  }

  function onRemoved(id: string) {
    setConversations((list) => list.filter((item) => item.id !== id));
    if (id === conversationId) router.push("/chat");
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

  return (
    <WorkspaceShell
      header={
        <ChatHeader
          email={email}
          busy={live !== null}
          onNew={startNew}
          onMenu={() => setDrawer((open) => !open)}
          onDetails={() => (sheet ? setSheet(false) : openSheet())}
          menuOpen={drawer}
          detailsOpen={sheet}
          unseen={unseen}
        />
      }
      sidebar={<ConversationList items={conversations} currentId={conversationId} busy={live !== null} onNew={startNew} onPick={() => setDrawer(false)} onRemoved={onRemoved} />}
      panel={<DetailsPanel artifacts={artifacts} onSectionOpen={onSectionOpen} onChartView={onChartView} />}
      drawerOpen={drawer}
      sheetOpen={sheet}
      onClose={() => {
        setDrawer(false);
        setSheet(false);
      }}
      columnRef={column}
    >
      <div className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col px-4 py-6">
        {empty && (
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-xl font-semibold">What would you like to model?</h2>
            <p className="mt-2 text-ink-soft">
              EpiChat sets up and runs agent-based epidemic simulations from a conversation: a disease, a country, real demographic data, interventions, and the
              results, with every step shown. Try one of these, or type your own.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {DRAFTS.understand.map((draft) => (
                <button key={draft} type="button" onClick={() => void send(draft, "draft")} className={CHIP}>
                  {draft}
                </button>
              ))}
            </div>
            {contactEmail && <p className="mt-4 text-sm text-ink-faint">Questions about the study: {contactEmail}.</p>}
          </section>
        )}

        {turns.map((turn) => (
          <Turn key={turn.id} turn={turn} status={null} feedback={feedback} onActivityExpand={() => onActivityExpand(turn.id)} />
        ))}
        {live && <Turn turn={{ id: "live", userText: live.userText, blocks: live.progress.blocks, notice: null }} status={live.progress.status} feedback={null} />}
      </div>

      <footer className="sticky bottom-0 border-t border-line bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto max-w-[46rem] px-4 pt-2.5">
          {error && (
            <p role="alert" className="mb-2.5 rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2.5 text-sm text-warn-ink">
              {error}
            </p>
          )}
          <RecapBar items={recap} onExpand={onRecapExpand} />
          <StageStrip stage={stage} />
          <Suggestions items={chips.items} disabled={live !== null} onPick={(reply) => void send(reply, chips.source)} />
        </div>
        <form className="mx-auto flex max-w-[46rem] items-end gap-2 px-4 pb-3" onSubmit={submit}>
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
    </WorkspaceShell>
  );
}
```

- [ ] **Step 5: Run the whole suite, the typecheck, and the lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: every test PASSES; typecheck and lint clean. If the suggestion-used static test in `tests/app/pages.test.ts` expects `send(reply, true)`, update it to `send(reply, chips.source)`; if the `StageStrip` `aria-current` string in the static test differs from the source, align the source to the test.

- [ ] **Step 6: Commit**

```bash
git add components/WorkspaceShell.tsx components/Chat.tsx tests/app/workspace.test.ts tests/app/pages.test.ts
git commit -m "feat(ui): the three-column workspace shell"
```

---

### Task 13: Runbook, build, and the parent spec's note

**Files:**
- Modify: `docs/DEPLOY.md` (new section 6c before section 7), `../docs/superpowers/specs/2026-10-07-web-agent-architecture-design.md` (section 15.4)
- Test: `tests/app/deploy.test.ts:23`

- [ ] **Step 1: Extend the deploy test**

Add `"Workspace verification"` and `"/api/runs/"` to the phrase list in "the deploy document covers the Supabase auth settings the code depends on".

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/app/deploy.test.ts`
Expected: FAIL on "Workspace verification".

- [ ] **Step 3: Write section 6c in `docs/DEPLOY.md`** (before `## 7. Simulation service`)

```markdown
## 6c. Workspace verification

Done on a preview deployment after the workspace branch is pushed, with
migration 0003 applied first (section 1.2). One browser at desktop width
(1280 px or wider) and one phone.

1. Desktop: three columns. New conversation at the top left; the welcome
   card with three draft chips in the middle; Details on the right with
   Scenario, Data, Runs, Activity and their empty states.
2. "Model a measles outbreak in Kenya" → confirm → "Fetch the data" →
   "Run it". After each reply: one activity line (press it to see the
   steps), the recap bar under the conversation growing by a line or two,
   the stage strip advancing Understand → Configure → Ground in data →
   Run → Interpret, chips that are the model's suggestions. After the run:
   four tiles and the infected curve inline; the Runs section opens with
   the chart, its four views, the effective parameters, and the sources.
3. Phone: the menu button opens the conversation drawer; Details opens the
   sheet, with a dot on the button after the run completed while it was
   closed; Escape and the backdrop close both.
4. Resume the conversation from the sidebar: the same panel, the recap,
   and the chart (loaded through `/api/runs/[id]`, visible in the
   network tab as one request per run). Delete it from the sidebar: it
   leaves the list and its address answers 404.
5. Table Editor, for the conversation: `select seq, kind, payload from
   turn_events where turn_id in (select id from turns where
   conversation_id = '<id>') order by turn_id, seq` shows a `recap` row
   before each `suggestions` row; `select kind, meta from step_events
   where conversation_id = '<id>' and kind in ('suggestion_used',
   'card_expanded', 'scenario_panel_opened', 'chart_view_changed')`
   shows `source`, `card`, `section`, and `view` values.
```

- [ ] **Step 4: Add the revision note to the parent spec**

In `../docs/superpowers/specs/2026-10-07-web-agent-architecture-design.md`, at the end of section 15.4, append:

```markdown
**Revision 2026-10-08.** Sub-project 4 is split into 4a workspace
(`2026-10-08-workspace-design.md`: three columns, a projected details
panel, an SVG chart instead of Recharts, a model-kept recap), 4b staged
workflow with roles, 4c report export, and 4d per-participant memory; the
researcher view and exports move to sub-project 5. The vision for 4b–4d
is recorded in the workspace spec's section 15.
```

- [ ] **Step 5: Run the deploy test, the suite, the typecheck, the lint, and the build**

Run: `npx vitest run tests/app/deploy.test.ts && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all green; the build lists `/api/runs/[id]` among the dynamic routes.

- [ ] **Step 6: Commit**

```bash
git add docs/DEPLOY.md tests/app/deploy.test.ts ../docs/superpowers/specs/2026-10-07-web-agent-architecture-design.md
git commit -m "docs: workspace verification list, migration 0003, and the sub-project 4 split"
```
