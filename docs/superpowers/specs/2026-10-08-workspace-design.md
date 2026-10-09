# EpiChat Workspace — Design (sub-project 4a)

Parent: `docs/superpowers/specs/2026-10-07-web-agent-architecture-design.md`
(sections 10 and 15.4). Predecessor: `docs/superpowers/specs/2026-10-08-agent-core-design.md`
(sections 8, 10, 11), which this spec extends and, for the page, replaces.

## 1. Purpose

The chat built in sub-project 3 puts everything in one column: every tool
call drops a tagged line into the stream, a run turn shows seven or eight of
them before the prose, and the numbers a participant needs are scattered
through the lines. A public-health student or practitioner who has never set
up a simulation (the study's audience, "non-modelers") cannot scan it.

This sub-project turns the page into a workspace: earlier conversations on
the left, a simple conversation in the middle, the details on the right. The
middle shows prose, one activity line per reply, and, after a run, the key
numbers and the epidemic curve. A stage tracker above the composer shows
where the participant is and offers draft messages for that step. A recap
under the conversation lists the decisions made so far.

## 2. Decisions made on 2026-10-08

1. The parent spec's sub-project 4 is split: **4a workspace** (this spec),
   **4b staged workflow** (plan, parameters, simulate, results, with a role
   per stage and backtracking), **4c report** (HTML, Markdown, Word, PDF
   composed from the artifacts), **4d memory** (per-participant memory across
   conversations, on for everyone, visible and editable), then **5
   researcher view and exports** as the parent spec describes. Section 15
   records the vision for 4b–4d so 4a's choices line up with it.
2. The right panel is a projection of what is already stored: tool result
   payloads in `turn_events` and the scenario row. No artifacts table. New
   artifact kinds in 4b and 4c arrive as new payload kinds.
3. The recap is kept by the model, not derived: every reply ends with a
   fenced `recap` block, like the `next` block, stored as a `recap` turn
   event. The code sees "data was applied"; the model also sees "the user
   cares about children under five".
4. The stage stays derived from tool results, never declared (parent 10.1).
5. The chart is inline SVG drawn by the app, not a charting library. The
   development machine's npm cannot add a dependency safely (npm bug 4828;
   `npm ci` only), the series is at most 2,001 points, and four line views
   need no library. This replaces the parent spec's Recharts choice.
6. Guidance is chat-led: draft messages per stage, editable before sending.
   The panel displays; it has no form fields. Sending a message stays the
   only way to act, so the study measures the conversation.
7. Inline in the middle, at most one figure and one row of numbers per
   reply, both from the run payload. Markdown tables in the prose are
   allowed when the model compares scenarios or lays out choices.

## 3. Layout

Three columns from 1280 px (`xl`): left 16 rem, right 24 rem, the middle
takes the rest with its content at most 46 rem wide and centered. Below
1280 px the middle fills the viewport; the left column becomes a drawer
opened by a menu button in the header, the right a sheet opened by a
Details button. Both are fixed overlays with a backdrop; Escape and the
backdrop close them. While a sheet is closed and a new artifact arrives, the
Details button shows a dot until it is opened.

The header spans the full width: menu button (narrow only), brand, then
New, Details (narrow only), the email (from `sm`), Sign out. New keeps its
reset behaviour from sub-project 3.

The page no longer scrolls; each column scrolls on its own. The follow-
the-reply logic in `lib/client/scroll.ts` runs on the middle column's
element instead of the document.

### 3.1 Left: conversations

A "New conversation" button, then the list grouped by day: Today, Yesterday,
then the date. Each row: title, delete on hover and focus with the two-press
confirmation from sub-project 3. The current conversation is highlighted.
When the first turn of a new conversation finishes, its row appears at the
top without a reload. Deleting the current conversation navigates to
`/chat`. Empty state: "A conversation appears here after your first
message."

### 3.2 Middle: the conversation

An empty conversation shows the welcome card ("What would you like to
model?", the study description, the contact line) with the Understand
drafts as chips. Then the turns (section 5). At the bottom, sticky: the
error alert, the recap bar, the stage strip, the chips, the composer
(section 6).

### 3.3 Right: details

`DetailsPanel` with four collapsible sections, each with an empty state:

| Section | Content | Empty state |
|---|---|---|
| Scenario | disease and model type, country, population, duration, R0, infectious and exposed periods, interventions, warnings; the literature parameters from the disease lookup as rows (typical, range, status) | "The configuration appears here once a scenario is set up." |
| Data | one entry per data payload of the current scenario: source name, location, each applied value with its unit, citations as links, warnings | "Real data appears here once it is fetched." |
| Runs | one entry per run, newest first and open: stat tiles, the chart with a view switch (compartments, incidence, cumulative, deaths), effective parameters, repairs if any, data sources used, population scale, duration | "Results appear here after the first run." |
| Activity | every tool and web step of the conversation in order: label, detail, duration, failure marker | "Steps appear here as the assistant works." |

The newest run's section opens when a run completes. Opening a section by
hand logs `scenario_panel_opened` with its `section`.

## 4. Projection: `lib/client/artifacts.ts`

```ts
export type RunArtifact = { turnId: string; index: number; payload: RunPayload };
export type ActivityItem = { turnId: string; kind: "tool" | "web_search" | "web_fetch"; name: string; ok: boolean; label: string; detail: string; durationMs: number | null };
export type Artifacts = { disease: DiseasePayload | null; config: ConfigPayload | null; data: DataPayload[]; runs: RunArtifact[]; activity: ActivityItem[] };
export function deriveArtifacts(turns: { id: string; blocks: Block[] }[]): Artifacts;
```

Walk every block of every turn in order. `disease`: the latest successful
`lookup_disease` payload. `config`: the latest successful
`configure_simulation` payload; one with `new_scenario: true` also empties
`data`. `data`: every successful data payload since then, in order, plus
failed fetches as `tool_error` entries are not kept (the Activity section
shows failures). `runs`: every successful run, in order, `index` counting
from 1. `activity`: every `tool_result`, `web_search`, and `web_fetch`
block, with `label` and `detail` from `toolLine`. The live turn is passed
as one more turn with id `"live"`, so the panel updates while a reply
arrives.

## 5. A turn in the middle: `components/Turn.tsx`

In order:

1. The participant's bubble.
2. The activity line (`components/ActivityLine.tsx`): one sentence built by
   `summarizeActivity(blocks)` in `lib/client/activity.ts`, pieces joined
   by " · ": "Looked up measles", "Started a new scenario" or "Configured
   the simulation", "Fetched 3 data sources" (counted across the three
   fetch tools), "Ran the simulation, 1.8 min" (`duration_ms` under a
   minute as "42 s"), "Searched the web" with a count when more than one,
   "Read 2 pages", and "⚠ Simulation failed" for a failed tool using the
   tool's label. Nothing is rendered when the turn made no calls. While the
   turn is live and `status` is set, the status text shows in place of the
   summary. A press expands the per-step list: the sub-project 3 tool lines
   and web lines, unchanged. Expanding logs `card_expanded` with
   `card: "activity"`.
3. The blocks in order: prose through Markdown after `withoutHidden`
   (section 7); a successful `run_simulation` result renders
   `components/RunSummary.tsx` in its place: four tiles (Peak day, Peak
   infections, Attack rate, Deaths, from `stats`, `attack_rate_pct`) and
   the chart in its "infected" view (currently infected per day), 200 px
   tall, no view switch. Other tool results render nothing here (the
   activity line covers them). Web blocks render nothing here. Notices as
   now.
4. The feedback thumbs.

Series: the live run payload carries `series`; a replayed one does not.
`RunSummary` and the panel's run entry take `series` when present and
otherwise call `loadSeries(runId)` from `lib/client/series.ts`, which
fetches `GET /api/runs/[id]` once per id and caches the promise. A failed
or missing series shows "Series unavailable." where the chart would be.

## 6. The bottom stack

- **Recap bar** (`components/RecapBar.tsx`): "Decisions so far" and the
  latest recap items (`lastRecap(turns)` in `lib/client/turn.ts`: the
  newest turn that has a `recap` block). Collapsed by default to the first
  item and "+N more"; a press expands the list and logs `card_expanded` with
  `card: "recap"`. Hidden when no turn has a recap.
- **Stage strip** (`components/StageStrip.tsx`): the five stages in order
  with labels Understand, Configure, Ground in data, Run, Interpret; stages
  before the current one marked done, the current one marked, with its hint
  under the strip. The current stage is the live turn's stage while a reply
  arrives, otherwise `lastStage(turns)`.
- **Chips** (`Suggestions`, unchanged): `chipsFor(stage, suggestions)` in
  `lib/client/drafts.ts` returns the model's suggestions when the newest
  turn has any, otherwise the stage's drafts. A pressed chip sends its text
  and logs `suggestion_used` with `source: "model"` or `"draft"`. No chips
  while a reply arrives.
- **Composer**: unchanged.

`lib/client/drafts.ts` holds the texts:

| Stage | Hint | Drafts |
|---|---|---|
| understand | Describe the outbreak you want to model: a disease, a place, and what you want to find out. | Model a measles outbreak in Kenya · Simulate influenza in Brazil with 60% vaccine coverage · What is the R0 of dengue? |
| configure | Check the configuration. When it looks right, ground it in real data. | Yes, fetch the data · Use a population of 2 million · Add a vaccination campaign at 80% coverage |
| ground | Real data is applied. Run the simulation when you are ready. | Run it · Which data sources were used? · Lower the contact rate by 20% |
| run | The simulation is running. This usually takes one to two minutes. | (none) |
| interpret | Explore the results, or change something and run again. | What does the peak mean for hospitals? · Compare with 90% vaccine coverage · Start a new scenario |

## 7. The recap block

`lib/chat/fenced.ts` generalizes `next.ts`: `parseFenced(text, tag, { maxItems, maxChars })`
returns the lines of the last complete fenced block with that tag (list
markers removed, empty lines skipped, a `stage:` line skipped) or null;
`withoutFenced(text, tags)` strips every complete block with any of the
tags and an arriving one at the end, with the sub-project 3 rule for an odd
number of fences. `next.ts` keeps `parseNext` and `withoutNext` as
wrappers; `withoutHidden(text) = withoutFenced(text, ["next", "recap"])`.
`parseRecap(text)` uses 8 items of 120 characters.

The event sink stores text blocks after `withoutHidden`. At turn end
`handleChat` emits and stores, in this order, `{ kind: "recap", items }`
when the final text has a non-empty recap block, then `suggestions` as
before. `Block` and `ChatStreamEvent` gain `recap`; the browser's reducer
sets `progress.recap`. Migration `0003_recap.sql` adds `'recap'` to the
`turn_events` kind check, idempotently (drop the constraint if it exists,
add it with the full list). Replay includes recap blocks as stored.

The system prompt gains, before "Suggested replies", a section
"Decisions recap": end every reply with a fenced block tagged `recap`
listing the decisions made so far in this conversation, one per line, three
to eight lines, each under 100 characters, oldest first, rewritten in full
every time because the interface shows only the latest: what is being
modelled and where, settings the user chose or confirmed, data applied,
runs done and what changed between them, and what the user said they care
about. The block comes right before the `next` block, nothing else goes in
it, and the interface never shows it as text. The "Cards" section is
replaced by "The interface": the configuration, the data applied, and
every run are shown in a panel beside the conversation, and after a run
the key numbers and the epidemic curve appear under the tool call; do not
retype those numbers; interpret them; a short Markdown table is welcome
when comparing scenarios or laying out choices.

## 8. Run series route: `GET /api/runs/[id]`

`requireParticipant()` as the other routes. A non-uuid id → 404. Select
`user_id, series` from `runs` by id; missing, another participant's, or a
null series → 404. Otherwise `{ series }` with
`Cache-Control: private, max-age=3600`. Added to
`outputFileTracingIncludes`.

## 9. Chart: `components/Chart.tsx` and `lib/client/chart.ts`

Pure functions, tested on their own: `thinPoints(days, values, max)`
keeps at most `max` evenly strided points plus the last; `niceTicks(max, count)`
returns rounded tick values; `linePath(points, width, height, yMax)`
returns an SVG path string; `seriesFor(view, series)` maps a view to its
lines and labels: `infected` → n_infected ("Currently infected");
`compartments` → n_susceptible, n_exposed (when present), n_infected,
n_recovered; `incidence` → new_infections; `cumulative` → cum_infections;
`deaths` → cum_deaths. `infected` exists only for the inline chart; the panel's switch offers the four `CHART_VIEWS`. Missing keys are skipped; a view with no lines
renders "Series unavailable.".

The component draws a responsive SVG (`viewBox`, width 100%): left axis
with four ticks and compact numbers (1.2k, 3.4M), bottom axis in days with
five ticks, one path per line in the app's palette (accent for infected,
ink-soft for susceptible, warn for exposed, a green for recovered, ink for
cumulative and deaths), a legend under the plot, and on pointer move a
vertical guide with a readout of the nearest day's values. Nothing is
animated. The panel's chart has a view switch that logs
`chart_view_changed`; the inline one is fixed to `infected`.

## 10. Client events

`lib/clientEvents.ts` and `lib/enums.ts`:

- `suggestion_used` gains `source: "model" | "draft"` (optional, so an old
  tab keeps working).
- `CARD_KINDS` gains `"activity"` and `"recap"`.
- `scenario_panel_opened` gains optional `section: "scenario" | "data" | "runs" | "activity"`;
  opening the narrow-screen sheet logs it without a section.
- `/api/event` copies `source` and `section` into `meta` along with the
  keys it already copies.

No `step_events` migration: kinds are unchanged, and `meta` is free-form.

## 11. Files

New: `components/WorkspaceShell.tsx` (columns, drawer and sheet state,
backdrop, Escape), `components/Turn.tsx`, `components/ActivityLine.tsx`,
`components/RunSummary.tsx`, `components/Chart.tsx`,
`components/RecapBar.tsx`, `components/StageStrip.tsx`,
`components/panel/DetailsPanel.tsx`, `components/panel/ScenarioSection.tsx`,
`components/panel/DataSection.tsx`, `components/panel/RunsSection.tsx`,
`components/panel/ActivitySection.tsx`, `components/panel/Section.tsx`
(the collapsible frame), `lib/client/artifacts.ts`, `lib/client/activity.ts`,
`lib/client/drafts.ts`, `lib/client/chart.ts`, `lib/client/series.ts`,
`lib/chat/fenced.ts`, `app/api/runs/[id]/route.ts`,
`supabase/migrations/0003_recap.sql`.

Changed: `components/Chat.tsx` (owns the state as now; renders
`WorkspaceShell` with the list, the turns, the bottom stack, and the panel;
`TurnView` moves to `Turn.tsx`; the welcome card's chips come from
`drafts.ts`), `components/ChatHeader.tsx` (full width, menu and Details
buttons), `components/ConversationList.tsx` (sidebar form, day groups, New
button, rows added when a conversation is created), `components/TurnBlocks.tsx`
(prose, run summary, notices only; tool and web lines move to the activity
list), `lib/chat/next.ts`, `lib/chat/events.ts`, `lib/chat/handleChat.ts`,
`lib/chat/prompt.ts`, `lib/client/turn.ts`, `lib/enums.ts`,
`lib/clientEvents.ts`, `app/api/event/route.ts`, `next.config.ts`,
`docs/DEPLOY.md`.

## 12. Error handling

- A series that cannot be loaded shows "Series unavailable." in place of
  the chart, inline and in the panel; the tiles still show.
- A reply without a recap block leaves the previous recap in place; a
  conversation with none hides the bar.
- A malformed `recap` block (nothing parseable) is treated as absent.
- The conversation list is rendered by the server on each page load; a
  delete that fails shows the sub-project 3 message.
- Panel sections with nothing to show render their empty state; the panel
  never throws on a payload missing optional fields (`stats` without
  `total_deaths`, data without warnings).
- `GET /api/runs/[id]` answers 404 for anything that is not the caller's
  run with a series, 500 on a database error.

## 13. Testing

Unit tests (vitest, node): `tests/chat/fenced.test.ts` (parseFenced,
parseRecap, withoutHidden with complete, arriving, and nested fences);
`tests/chat/handleChat.test.ts` (recap emitted before suggestions and
stored; none when absent); `tests/chat/events.test.ts` (stored text
strips the recap block); `tests/db/finishTurn.test.ts` (0003 applies twice
and `finish_turn` accepts a recap event); `tests/client/turn.test.ts`
(recap event, lastRecap); `tests/client/artifacts.test.ts`;
`tests/client/activity.test.ts`; `tests/client/drafts.test.ts`;
`tests/client/chart.test.ts`; `tests/client/series.test.ts` (one fetch per
id, failure → null); `tests/api/runsRoute.test.ts`;
`tests/lib/clientEvents.test.ts` (new fields accepted, unknown refused);
`tests/chat/prompt.test.ts` (new sections, no Cards section, still
deterministic). Component tests follow the sub-project 3 pattern: static
checks on the source in `tests/app/pages.test.ts` and a new
`tests/app/workspace.test.ts` (the shell renders the three regions, the
header has the two toggles, the turn renders the activity line and the run
summary, the panel has the four sections and their empty states).

Manual verification on a preview deployment, recorded in `docs/DEPLOY.md`
section 6c: the three columns at desktop width; drawer and sheet on a
phone; a run shows tiles and the curve inline and opens the Runs section;
the recap updates each turn; drafts change with the stage; a resumed
conversation shows the same panel as the live one; the chart on a resumed
run loads through the route.

## 14. Deployment

`supabase/migrations/0003_recap.sql` is run in the SQL editor before the
code deploys; without it `finish_turn` rejects every turn that carries a
recap. `docs/DEPLOY.md` section 1.2 names it and section 6c lists the
checks above.

## 15. Vision for the rest of sub-project 4 (recorded, not built here)

- **4b. Staged workflow.** Stages become Plan, Parameters, Simulate,
  Results, Report. Plan: the participant describes their situation, the
  options they weigh, and what they hope to learn; the assistant, in an
  epidemiologist's role, designs the simulation and names what it cannot
  answer, producing a plan artifact. Parameters: in a data-processing role
  the assistant turns the plan into a full parameter set, grounds it in
  data, and confirms it before any run. Simulate: Starsim now, other
  engines later; a missing parameter sends the flow back one stage.
  Results: back in the epidemiologist's role, explain, take feedback, rerun
  scenarios. One turn loop; the stage selects a role section of the prompt
  and the tool set. Stages stay derived: a plan artifact exists, a
  parameter set was confirmed, a run finished, a report exists.
- **4c. Report.** A report artifact composed from the plan, the
  parameters, the data, the runs, and the recap, exported as HTML,
  Markdown, Word, or PDF; Word and PDF through the sim service reusing
  `epichat/exporter.py`.
- **4d. Memory.** A `memories` table per participant (kind: role,
  situation, preference, solution; text; source conversation; active
  flag), written by a `remember` tool with a step event, injected into the
  first user message of a conversation, capped in count and length, with a
  page where the participant sees, edits, deletes, or switches it off.
  Default on for everyone, visible and editable (decision of 2026-10-08).
