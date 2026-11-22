# UI Cleanup (round 1, part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the thumbs and the start-page animation, name the right-hand panel "Dashboard" everywhere and show it as a column from 1024 px, open the chart on "Currently infected", wrap the suggested replies, render bold and lists in reports, fix the population row's doubled brackets, and add a weekly suggested-reply table to `/admin`.

**Architecture:** Front-end changes are edits to existing components in `web/components` and pure helpers in `web/lib/client`. Report formatting is parsed once in `web/lib/report/document.ts` into optional text runs that the HTML, Markdown, Word and PDF renderers read. The researcher table is a pure weekly aggregation in a new `web/lib/admin/suggestionUse.ts`, fed by a paged read of `step_events`, rendered by the existing server page.

**Tech Stack:** Next.js 16, React, Tailwind 4, vitest (node environment; components are tested with `renderToStaticMarkup` or by reading source, as the existing tests do), Supabase admin client, Python (python-docx, reportlab) for `sim/report_render.py`.

**Spec:** `docs/superpowers/specs/2026-11-21-ui-cleanup-design.md`

## Global Constraints

- No database migration. `STEP_EVENT_KINDS` in `web/lib/enums.ts` mirrors a database check; do not remove a kind from it.
- A document without the new run fields renders byte-for-byte as today in every renderer.
- No participant-typed text in the researcher table or the event log; the table shows counts only.
- The panel is called "Dashboard"; its tabs are "This conversation" and "Profile". Internal identifiers (`details`, `DetailsPanel`, `panel-…` ids) keep their names.
- Breakpoints: Dashboard column from Tailwind `lg` (64rem, 1024 px); conversation list column from `xl` (80rem, 1280 px).
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_016eXYLxC75PS9hTJQ9tQPjd`
- Commands, from the worktree root:
  - Web (in `web/`, needs the `node_modules` junction: `cmd //c "mklink /J web\\node_modules ..\\..\\..\\web\\node_modules"`): `npx vitest run <file>`; whole suite `npx vitest run`; `npx tsc --noEmit -p .`; `npm run -s lint`.
  - Python: `/c/Users/Yuke/stat/other-projects/EpiChat/epichat/.venv/Scripts/python -m pytest sim/tests/test_report_render.py -q`

## Review Focus

1. A remembered Dashboard width of 640 px on a 1024 px screen: the conversation column must keep at least 480 px (Task 3 pins the cap).
2. The conversation list opened as a drawer between 1024 and 1279 px: a backdrop must show and a press outside must close it, while the Dashboard column stays in place (Task 3).
3. Unmatched or empty bold marks (`a ** b`, `****`, `**bold` with no close): shown literally, never dropping text (Task 5).
4. Numbered lines (`1. …`, `2. …`) in a narrative: each stays its own line, not mashed into one paragraph (Task 5).
5. More than 1,000 `step_events` rows in the 12 weeks: every row is counted, not only the first page (Task 7).

---

### Task 1: Remove the thumbs and the start-page animation

**Files:**
- Delete: `web/components/FeedbackControl.tsx`
- Modify: `web/components/Turn.tsx`, `web/components/Chat.tsx` (the `feedback` prop chain), `web/lib/clientEvents.ts`, `web/components/Welcome.tsx`, `web/lib/client/welcome.ts`
- Test: `web/tests/app/workspace.test.ts`, `web/tests/client/welcome.test.ts`, `web/tests/lib/clientEvents.test.ts`

**Interfaces:**
- Produces: `WELCOME_HEADING: string` in `web/lib/client/welcome.ts` (value: `"Which infectious disease scenario would you like to explore today?"`). `INTRO_QUESTIONS` unchanged. `WELCOME_PHRASES`, `TypewriterState`, `TYPEWRITER_START`, `TYPEWRITER_DELAYS`, `typewriterText`, `typewriterStep` are deleted.
- Kept untouched: `app/api/feedback/route.ts`, `lib/db/feedback.ts`, `RATINGS`, the `feedback_given` entry in `CLIENT_EVENT_KINDS`.

- [ ] **Step 1: Write the failing tests**

In `workspace.test.ts`, change the first test's expectation from `"<FeedbackControl"` present to absent, and add:

```ts
it("has no thumbs and no typing animation (round-1 UI cleanup)", () => {
  expect(existsSync("components/FeedbackControl.tsx")).toBe(false);
  expect(read("components/Turn.tsx")).not.toContain("FeedbackControl");
  const welcome = read("components/Welcome.tsx");
  for (const gone of ["useTypewriter", "animate-pulse", "WELCOME_PHRASES", "prefers-reduced-motion"]) expect(welcome).not.toContain(gone);
  expect(welcome).toContain("{WELCOME_HEADING}");
});
```

In `welcome.test.ts`, replace the typewriter tests with:

```ts
it("has one fixed English heading", () => {
  expect(WELCOME_HEADING).toBe("Which infectious disease scenario would you like to explore today?");
});
```

In `clientEvents.test.ts`: `readClientEvent` of a well-formed `feedback_given` event returns `null`.

- [ ] **Step 2: Run** `npx vitest run tests/app/workspace.test.ts tests/client/welcome.test.ts tests/lib/clientEvents.test.ts` — Expected: FAIL (FeedbackControl exists; `WELCOME_HEADING` undefined; event accepted).

- [ ] **Step 3: Implement.** Delete the component and every `feedback` prop that only fed it (follow `tsc`). Remove the `feedback_given` member from the `ClientEvent` union only. `Welcome.tsx` renders `<h1 id="welcome-heading" …>{WELCOME_HEADING}</h1>` with no `min-h`, no `sr-only` twin, no hooks; update its doc comment.

- [ ] **Step 4: Run** the three files, then `npx tsc --noEmit -p .` and `npm run -s lint` — Expected: PASS, no errors, no unused imports.

- [ ] **Step 5: Commit** `feat(web): remove the thumbs and the start-page animation`

---

### Task 2: One name, "Dashboard", with tabs "This conversation" and "Profile"

**Files:**
- Modify: `web/components/panel/PanelTabs.tsx`, `web/components/SharedConversation.tsx:47`, `web/components/Welcome.tsx` (hint), `web/components/ProfileSetup.tsx:99`, `web/lib/chat/prompt.ts:36,71`
- Test: `web/tests/app/workspace.test.ts`, `web/tests/chat/prompt.test.ts`

**Exact copy:**
- Tab label: `This conversation` (was `Details`); tablist `aria-label="Dashboard"` (was `Right column`).
- Shared page: `<aside aria-label="Dashboard" …>`.
- Welcome hint: `Your profile shapes the answers. Edit it in the Dashboard's Profile tab.`
- ProfileSetup: `…You can change them any time in the Dashboard's Profile tab.`
- Prompt line 36: `"Charts": point to the Dashboard's chart views.`
- Prompt line 71 opens: `The configuration, the data applied, and every run are shown in the Dashboard beside the conversation (its "This conversation" tab), and after a run …` (rest unchanged). Add one sentence after it: `Call it the Dashboard when you point the participant to it; the profile lives in its "Profile" tab.`

- [ ] **Step 1: Write the failing tests**

```ts
// workspace.test.ts
it("calls the right-hand panel the Dashboard, with tabs This conversation and Profile", () => {
  const tabs = read("components/panel/PanelTabs.tsx");
  expect(tabs).toContain(">This conversation</Tab>");
  expect(tabs).toContain('aria-label="Dashboard"');
  expect(tabs).not.toContain(">Details</Tab>");
  expect(read("components/SharedConversation.tsx")).toContain('<aside aria-label="Dashboard"');
  expect(read("components/Welcome.tsx")).toContain("Edit it in the Dashboard's Profile tab.");
  expect(read("components/ProfileSetup.tsx")).toContain("the Dashboard's Profile tab");
});
```

```ts
// prompt.test.ts — against the built system prompt text, using the file's existing builder helper
expect(prompt).toContain("shown in the Dashboard beside the conversation");
expect(prompt).toContain('"This conversation" tab');
expect(prompt).not.toMatch(/\bin a panel\b|the panel's/);
```

- [ ] **Step 2: Run** both files — Expected: FAIL on every new assertion.
- [ ] **Step 3: Implement** the copy above. Fix any existing test that pinned the old words.
- [ ] **Step 4: Run** both files — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): name the panel Dashboard and its tabs`

---

### Task 3: Dashboard as a column from 1024 px

**Files:**
- Modify: `web/lib/client/layout.ts`, `web/components/WorkspaceShell.tsx`, `web/components/Chat.tsx`, `web/components/ChatHeader.tsx` (comment only)
- Test: `web/tests/client/layout.test.ts`, `web/tests/app/workspace.test.ts`

**Interfaces:**
- Produces in `layout.ts`:
  - `export const COLUMN_FROM: Record<Side, string> = { left: "(min-width: 80rem)", right: "(min-width: 64rem)" }`
  - `export function useColumn(side: Side): boolean` — true when that side is a static column; false on the server and until hydrated. Replaces `useWide` (delete it).
  - `export const MIN_CONVERSATION_REM = 30` (480 px).

**Shell rules (`WorkspaceShell.tsx`):**
- `DRAWER` keeps `xl:`; `SHEET` uses `lg:static lg:w-(--column)` and `lg:max-w-[calc(100vw-30rem)]` in place of `xl:max-w-none`.
- `HANDLE` takes its breakpoint per side: left `xl:block`, right `lg:block`. Write both class strings out literally (Tailwind cannot see built names).
- Right `aside`: `layout.right.open ? "lg:flex" : "lg:hidden"`.
- Backdrop: rendered when `drawerOpen || sheetOpen`; class `xl:hidden` when `drawerOpen`, otherwise `lg:hidden`.
- Doc comment: "The Dashboard is a column from lg and the conversation list from xl; below that each is an overlay…".

**Chat rules (`Chat.tsx`):** `const leftColumn = useColumn("left"); const rightColumn = useColumn("right");` — `rightColumn` replaces `wide` at the `panelVisible` line, in `onDashboard` and in the Profile-menu handler; `leftColumn` replaces it in the menu toggle and `menuOpen`. Opening the drawer no longer needs to close the sheet when `rightColumn` is true.

- [ ] **Step 1: Write the failing tests**

```ts
// layout.test.ts
it("makes the Dashboard a column from 1024 px and the list from 1280 px", () => {
  expect(COLUMN_FROM).toEqual({ left: "(min-width: 80rem)", right: "(min-width: 64rem)" });
  expect(MIN_CONVERSATION_REM).toBe(30);
});
```

```ts
// workspace.test.ts — render the shell with renderToStaticMarkup(createElement(WorkspaceShell, props))
const shell = (over: Partial<Props>) => renderToStaticMarkup(createElement(WorkspaceShell, { header: null, sidebar: "LIST", panel: "DASH", children: "MAIN", drawerOpen: false, sheetOpen: false, onClose: () => {}, columnRef: { current: null }, layout: DEFAULT_LAYOUT, onResize: () => {}, ...over }));
const aside = (html: string, label: string) => html.match(new RegExp(`<aside aria-label="${label}"[^>]*>`))![0];

it("shows the Dashboard as a column from lg and the list from xl", () => {
  const html = shell({});
  expect(aside(html, "Dashboard")).toContain("lg:flex");
  expect(aside(html, "Dashboard")).toContain("lg:static");
  expect(aside(html, "Dashboard")).not.toContain("xl:");
  expect(aside(html, "Conversations")).toContain("xl:flex");
  expect(aside(html, "Conversations")).not.toContain("lg:");
});
it("keeps 480 px for the conversation however wide the Dashboard was left", () => {
  expect(aside(shell({ layout: { ...DEFAULT_LAYOUT, right: { open: true, width: 640 } } }), "Dashboard")).toContain("lg:max-w-[calc(100vw-30rem)]");
});
it("puts a backdrop behind the list drawer up to xl, and behind the Dashboard sheet only below lg", () => {
  expect(shell({ drawerOpen: true })).toMatch(/aria-label="Close"[^>]*xl:hidden/);
  expect(shell({ sheetOpen: true })).toMatch(/aria-label="Close"[^>]*lg:hidden/);
  expect(shell({})).not.toContain('aria-label="Close"');
});
it("collapses the Dashboard column when it is closed", () => {
  expect(aside(shell({ layout: { ...DEFAULT_LAYOUT, right: { open: false, width: 384 } } }), "Dashboard")).toContain("lg:hidden");
});
it("reads each side's own breakpoint in the chat", () => {
  const chat = read("components/Chat.tsx");
  expect(chat).toContain('useColumn("left")');
  expect(chat).toContain('useColumn("right")');
  expect(chat).not.toContain("useWide");
});
```

- [ ] **Step 2: Run** both files — Expected: FAIL (`COLUMN_FROM` undefined; `xl:` on the Dashboard aside).
- [ ] **Step 3: Implement** `useColumn` (one `useSyncExternalStore` per side, subscribing to `COLUMN_FROM[side]`), then the shell and chat rules above.
- [ ] **Step 4: Run** both files, `npx tsc --noEmit -p .`, `npm run -s lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): show the Dashboard as a column from 1024 px`

---

### Task 4: Chart opens on "Currently infected"; suggested replies wrap; population row

**Files:**
- Modify: `web/lib/enums.ts:117`, `web/lib/client/chart.ts:4`, `web/components/panel/RunsSection.tsx`, `web/components/Suggestions.tsx`, `web/lib/client/format.ts`, `web/lib/report/compose.ts:179`
- Test: `web/tests/client/runsRender.test.ts`, `web/tests/client/format.test.ts`, `web/tests/report/compose.test.ts`, `web/tests/app/workspace.test.ts`, `web/tests/lib/clientEvents.test.ts`

**Interfaces:**
- `CHART_VIEWS = ["infected", "compartments", "incidence", "cumulative", "deaths"] as const`; `ChartView = (typeof CHART_VIEWS)[number]`; `VIEW_LABELS.infected = "Currently infected"`.
- `export function populationText(value: number, place: string, origin: string): string` in `format.ts`: `"2,000,000, Example County, Kenya (you set it)"` when `origin` has no bracket; `"3,271,616, Utah; source: Census Bureau QuickFacts (2020 census)"` when `origin` contains `(` or `)`. `populationRow` and `compose.ts:179` both call it.

- [ ] **Step 1: Write the failing tests**

```ts
// runsRender.test.ts
it("opens the chart on Currently infected, first of five views", () => {
  const html = render([run(params({ schema_version: 2 }))]);
  const pressed = html.match(/<button[^>]*aria-pressed="true"[^>]*>([^<]*)</)!;
  expect(pressed[1]).toBe("Currently infected");
  expect(html.indexOf("Currently infected")).toBeLessThan(html.indexOf("Compartments"));
});
```
(If the view buttons mark the selection another way than `aria-pressed`, assert on that marker instead.)

```ts
// clientEvents.test.ts
it("accepts the infected chart view", () => {
  expect(readClientEvent(JSON.stringify({ kind: "chart_view_changed", conversationId: ID, turnId: ID, view: "infected" }))).not.toBeNull();
});
```

```ts
// format.test.ts
it("writes the population without nesting brackets", () => {
  expect(populationText(2000000, "Example County, Kenya", "you set it")).toBe("2,000,000, Example County, Kenya (you set it)");
  expect(populationText(3271616, "Utah", "Census Bureau QuickFacts (2020 census)")).toBe("3,271,616, Utah; source: Census Bureau QuickFacts (2020 census)");
});
```

```ts
// compose.test.ts — an area scenario whose source title is "QuickFacts (2020)"
expect(populationCell).toBe("3,271,616, Utah; source: QuickFacts (2020)");
expect(populationCell).not.toContain("))");
```

```ts
// workspace.test.ts
it("wraps the suggested replies instead of scrolling them sideways", () => {
  const html = renderToStaticMarkup(createElement(Suggestions, { items: ["Run it with a school closure from day 30 and compare the peaks"], disabled: false, onPick: () => {} }));
  for (const gone of ["overflow-x-auto", "whitespace-nowrap", "shrink-0"]) expect(html).not.toContain(gone);
  expect(html).toContain("flex-wrap");
  expect(html).toContain("text-left");
});
```

- [ ] **Step 2: Run** the five files — Expected: FAIL on each new test.
- [ ] **Step 3: Implement.** `RunsSection` default state `"infected"`. `Suggestions`: container `flex flex-wrap gap-2`; buttons drop `shrink-0 whitespace-nowrap`, add `max-w-full text-left`.
- [ ] **Step 4: Run** the five files and `npx tsc --noEmit -p .` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): infected chart first, wrapping replies, population row without nested brackets`

---

### Task 5: Bold runs and lists in the report document (TypeScript)

**Files:**
- Modify: `web/lib/report/document.ts`, `web/lib/report/html.ts`, `web/lib/report/markdown.ts`
- Test: `web/tests/report/document.test.ts`, `web/tests/report/html.test.ts`, `web/tests/report/markdown.test.ts`

**Interfaces (Task 6 consumes the JSON shape):**

```ts
export type TextRun = { text: string; bold?: true };
// ReportBlock members become:
| { kind: "paragraph"; text: string; runs?: TextRun[] }
| { kind: "bullets"; items: string[]; itemRuns?: TextRun[][] }
export function textRuns(source: string): { text: string; runs?: TextRun[] };
```

Rules:
- `textRuns`: `**x**` with `x` non-empty and not starting or ending with a space is a bold run; the marks are dropped from `text`. `runs` is present only when at least one run is bold, and the runs' texts joined equal `text`. Anything else (unmatched, empty, `****`) is literal.
- `narrativeBlocks`: within a blank-line chunk, consecutive bullet lines (`- ` or `* `) form one `bullets` block; a line matching `/^\d+[.)]\s+/` is its own `paragraph` (number kept); other consecutive lines join with a space into one `paragraph`. Every paragraph and item goes through `textRuns`; `itemRuns` is present only when some item has a bold run, and then has one entry per item.
- `DOCUMENT_VERSION` stays 1. `wordCount` unchanged.
- HTML: runs render as escaped text with `<strong>` around bold runs; without runs, output is unchanged.
- Markdown: bold runs render as `**${plain(text)}**`; without runs, unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
// document.test.ts
it("turns **bold** into runs and drops the marks from the text", () => {
  expect(textRuns("**Peak:** day 40")).toEqual({ text: "Peak: day 40", runs: [{ text: "Peak:", bold: true }, { text: " day 40" }] });
  expect(textRuns("no marks")).toEqual({ text: "no marks" });
});
it("leaves unmatched or empty marks as typed", () => {
  for (const literal of ["a ** b", "****", "**open", "2 ** 3 ** 4"]) expect(textRuns(literal)).toEqual({ text: literal });
});
it("makes a list of dash lines that follow a lead-in line", () => {
  expect(narrativeBlocks("Two options:\n- close schools\n- **vaccinate** early")).toEqual([
    { kind: "paragraph", text: "Two options:" },
    { kind: "bullets", items: ["close schools", "vaccinate early"], itemRuns: [[{ text: "close schools" }], [{ text: "vaccinate", bold: true }, { text: " early" }]] },
  ]);
});
it("keeps numbered lines apart", () => {
  expect(narrativeBlocks("1. Rerun with 70% coverage.\n2. Compare the peaks.")).toEqual([
    { kind: "paragraph", text: "1. Rerun with 70% coverage." },
    { kind: "paragraph", text: "2. Compare the peaks." },
  ]);
});
it("still reads a plain paragraph and a plain list as before", () => {
  expect(narrativeBlocks("One line\nand another.\n\n- a\n- b")).toEqual([{ kind: "paragraph", text: "One line and another." }, { kind: "bullets", items: ["a", "b"] }]);
});
```

```ts
// html.test.ts — via renderHtml on a one-section document
expect(html).toContain("<p><strong>Peak:</strong> day 40</p>");
expect(html).toContain("<li><strong>vaccinate</strong> early</li>");
expect(htmlOf({ kind: "paragraph", text: "a <b> & **c**" })).toContain("<p>a &lt;b&gt; &amp; **c**</p>");   // no runs: unchanged
expect(htmlOf({ kind: "paragraph", text: "x<y", runs: [{ text: "x<y", bold: true }] })).toContain("<strong>x&lt;y</strong>");
```

```ts
// markdown.test.ts
expect(md).toContain("**Peak:** day 40");
expect(md).toContain("- **vaccinate** early");
expect(mdOf({ kind: "paragraph", text: "2 * 3" })).toContain("2 \\* 3");   // no runs: unchanged
```

- [ ] **Step 2: Run** the three files — Expected: FAIL (`textRuns` undefined; lead-in list joined into one paragraph).
- [ ] **Step 3: Implement** `textRuns`, the regrouped `narrativeBlocks`, and one shared helper per renderer that takes `(text, runs?)`.
- [ ] **Step 4: Run** `npx vitest run tests/report` and `npx tsc --noEmit -p .` — Expected: PASS, including the existing compose tests.
- [ ] **Step 5: Commit** `feat(report): bold runs and lead-in lists in the report document`

---

### Task 6: Bold runs in the Word and PDF renderers

**Files:**
- Modify: `sim/report_render.py` (`validate_document`, `render_docx`, `render_pdf`)
- Test: `sim/tests/test_report_render.py`

**Interfaces:**
- Consumes Task 5's JSON: optional `runs` on a paragraph (`[{"text": str, "bold"?: true}]`), optional `itemRuns` on bullets (one run list per item).
- Validation: `runs` must be a list of objects with a string `text` and, if present, `bold is True`; `itemRuns` must have `len(items)` entries. A violation raises the same error type the function raises for a bad `text` today.
- Word: one docx run per text run, `run.bold = True` for bold. PDF: `<b>…</b>` around the escaped, font-fixed text of a bold run, inside the same `Paragraph`. For a CJK document where the bold face is the regular face, bold falls back to regular rather than failing.

- [ ] **Step 1: Write the failing tests** (reuse the file's document fixture and docx/pdf readers)

```python
def test_bold_runs_reach_the_word_file():
    doc = document_with([{"kind": "paragraph", "text": "Peak: day 40", "runs": [{"text": "Peak:", "bold": True}, {"text": " day 40"}]},
                         {"kind": "bullets", "items": ["vaccinate early"], "itemRuns": [[{"text": "vaccinate", "bold": True}, {"text": " early"}]]}])
    word = Document(io.BytesIO(render_docx(doc)))
    para = next(p for p in word.paragraphs if p.text == "Peak: day 40")
    assert [(r.text, bool(r.bold)) for r in para.runs] == [("Peak:", True), (" day 40", False)]
    item = next(p for p in word.paragraphs if p.text == "vaccinate early")
    assert item.style.name == "List Bullet" and item.runs[0].bold

def test_bold_runs_reach_the_pdf_without_the_marks():
    text = pdf_text_of(render_pdf(doc_with_bold))
    assert "Peak: day 40" in text and "**" not in text and "<b>" not in text

def test_a_document_without_runs_renders_as_before():
    plain = document_with([{"kind": "paragraph", "text": "a ** b"}])
    para = next(p for p in Document(io.BytesIO(render_docx(plain))).paragraphs if p.text == "a ** b")
    assert len(para.runs) == 1 and not para.runs[0].bold

@pytest.mark.parametrize("block", [
    {"kind": "paragraph", "text": "x", "runs": [{"text": 1}]},
    {"kind": "paragraph", "text": "x", "runs": [{"text": "x", "bold": "yes"}]},
    {"kind": "bullets", "items": ["a", "b"], "itemRuns": [[{"text": "a"}]]},
])
def test_malformed_runs_are_refused(block):
    with pytest.raises(ValueError):
        validate_document(document_with([block]))
```
(Use the exception type `validate_document` already raises if it is not `ValueError`.)

- [ ] **Step 2: Run** the pytest command — Expected: the four new tests FAIL (single unbolded run; no validation).
- [ ] **Step 3: Implement** in the three functions.
- [ ] **Step 4: Run** the pytest command — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(report): bold runs in the Word and PDF reports`

---

### Task 7: Weekly suggested-reply table on `/admin`

**Files:**
- Create: `web/lib/admin/suggestionUse.ts`, `web/components/admin/SuggestionUseTable.tsx`
- Modify: `web/app/admin/page.tsx`
- Test: `web/tests/lib/suggestionUse.test.ts`, `web/tests/app/pages.test.ts`

**Interfaces:**

```ts
export const WEEKS_SHOWN = 12;
export type UseEvent = { userId: string; at: string; kind: "turn" | "suggestion_used"; source: string | null };
export type WeekRow = {
  weekStart: string;                                   // "2026-11-16", a Monday, UTC
  turns: number; fromButton: number;
  bySource: Record<(typeof SUGGESTION_SOURCES)[number] | "other", number>;
  usersWithButton: number; activeUsers: number;        // activeUsers: distinct users with a turn or a press that week
};
export function weekStartUtc(at: Date): string;
export function weeklySuggestionUse(events: UseEvent[], now: Date, excludeUserIds?: ReadonlySet<string>): WeekRow[];  // WEEKS_SHOWN rows, newest first, zero rows included
export async function loadUseEvents(admin: SupabaseClient, since: Date): Promise<UseEvent[]>;      // pages step_events 1000 rows at a time with .range() ordered by id until a short page
export async function researcherUserIds(admin: SupabaseClient, emails: string[]): Promise<Set<string>>;  // admin.auth.admin.listUsers, paged, case-insensitive email match
export const SOURCE_LABELS: Record<keyof WeekRow["bySource"], string> = { model: "Assistant's suggestion", draft: "Example draft", intro: "Introduction question", option: "Intervention option", reference: "Reference", other: "Other" };
```

`loadUseEvents` selects only `user_id, at, kind, meta->>source` for kinds `turn` and `suggestion_used` with `at >= since`. A `source` outside `SUGGESTION_SOURCES` (or null) counts under `other`. The page shows, under the participant count, a heading "Suggested replies, by week", one sentence — "Weeks start on Monday (UTC). Researcher accounts are left out." — and the table: Week of, Turns, From a button, the six source columns, "Participants using one" as `2 of 5`. The "Other" column is omitted when it is zero in every row. Replace the "arrive in sub-project 4" sentence with "Replay and export come later."

- [ ] **Step 1: Write the failing tests**

```ts
// suggestionUse.test.ts
const NOW = new Date("2026-11-21T15:00:00Z");                 // a Saturday; its week starts Monday 2026-11-16
const ev = (userId: string, at: string, kind: UseEvent["kind"], source: string | null = null): UseEvent => ({ userId, at, kind, source });

it("starts weeks on Monday, UTC", () => {
  expect(weekStartUtc(new Date("2026-11-22T23:59:59Z"))).toBe("2026-11-16");   // Sunday
  expect(weekStartUtc(new Date("2026-11-23T00:00:00Z"))).toBe("2026-11-23");   // Monday
});
it("gives twelve weeks, newest first, with empty weeks as zeros", () => {
  const rows = weeklySuggestionUse([], NOW);
  expect(rows).toHaveLength(12);
  expect(rows[0].weekStart).toBe("2026-11-16");
  expect(rows[11].weekStart).toBe("2026-08-31");
  expect(rows[0]).toMatchObject({ turns: 0, fromButton: 0, usersWithButton: 0, activeUsers: 0 });
});
it("counts turns, presses by kind, and the participants behind them", () => {
  const rows = weeklySuggestionUse([
    ev("a", "2026-11-17T10:00:00Z", "turn"), ev("a", "2026-11-17T10:00:00Z", "suggestion_used", "model"),
    ev("a", "2026-11-18T10:00:00Z", "turn"), ev("b", "2026-11-18T11:00:00Z", "turn"),
    ev("b", "2026-11-19T11:00:00Z", "turn"), ev("b", "2026-11-19T11:00:00Z", "suggestion_used", "intro"),
    ev("c", "2026-11-19T12:00:00Z", "turn"), ev("c", "2026-11-19T12:00:00Z", "suggestion_used", null),
    ev("a", "2026-11-10T10:00:00Z", "turn"),
  ], NOW);
  expect(rows[0]).toMatchObject({ turns: 5, fromButton: 3, usersWithButton: 3, activeUsers: 3 });
  expect(rows[0].bySource).toEqual({ model: 1, draft: 0, intro: 1, option: 0, reference: 0, other: 1 });
  expect(rows[1]).toMatchObject({ weekStart: "2026-11-09", turns: 1, fromButton: 0, activeUsers: 1 });
});
it("leaves researcher accounts out and ignores events outside the twelve weeks", () => {
  const rows = weeklySuggestionUse([ev("r", "2026-11-17T10:00:00Z", "turn"), ev("a", "2026-08-30T23:00:00Z", "turn"), ev("a", "2026-11-17T10:00:00Z", "turn")], NOW, new Set(["r"]));
  expect(rows.reduce((n, row) => n + row.turns, 0)).toBe(1);
});
it("reads every page of events", async () => {
  const pages = [Array.from({ length: 1000 }, (_, i) => row(i)), Array.from({ length: 3 }, (_, i) => row(1000 + i))];
  const events = await loadUseEvents(fakeAdmin(pages), new Date("2026-08-31T00:00:00Z"));   // fakeAdmin: a chainable stub whose .range(from, to) resolves pages[from / 1000]
  expect(events).toHaveLength(1003);
});
```

```ts
// pages.test.ts
it("the admin page shows the weekly suggested-reply table behind the researcher check", () => {
  const source = readFileSync("app/admin/page.tsx", "utf8");
  for (const piece of ["<SuggestionUseTable", "weeklySuggestionUse(", "researcherUserIds("]) expect(source).toContain(piece);
  expect(source.indexOf("notFound()")).toBeLessThan(source.indexOf("loadUseEvents("));
  expect(readFileSync("components/admin/SuggestionUseTable.tsx", "utf8")).not.toMatch(/user_text|userText|email/);
});
```

Also a render test in `suggestionUse.test.ts`: `renderToStaticMarkup(createElement(SuggestionUseTable, { rows }))` contains `"2 of 5"` for `{ usersWithButton: 2, activeUsers: 5 }`, the header `Assistant's suggestion`, and no `Other` header when every `other` is 0.

- [ ] **Step 2: Run** `npx vitest run tests/lib/suggestionUse.test.ts tests/app/pages.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the module, the table (a server component, `<table>` with `<th scope="col">`, numbers in `font-mono`, wrapped in `overflow-x-auto`), and the page wiring (`since` = the Monday eleven weeks before this week's).
- [ ] **Step 4: Run** the two files, then the whole gate: `npx vitest run`, `npx tsc --noEmit -p .`, `npm run -s lint` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(admin): weekly suggested-reply table`

---

### After the tasks

Push the branch and open a PR (main is protected; the owner says when to merge). On the preview, check: 1024, 1272 and 1280 px wide (Dashboard visible, list folded below 1280, nothing clipped, drawer backdrop works at 1100 px); one new report with bold and a list in all four downloads; the `/admin` table against a hand count for one week.
