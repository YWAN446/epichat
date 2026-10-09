# Report Design (sub-project 4c)

Date: 2026-10-09. Parent specs: `2026-10-07-web-agent-architecture-design.md`
(the architecture), `2026-10-08-workspace-design.md` (the workspace, whose
section 15 recorded this sub-project as a vision). This spec is the authority
for the report; where it and the parents differ, this spec wins for the report
and the parents win for everything else.

## 1. Purpose

At the end of a conversation the assistant offers a report. A non-modeler reads
the first page and understands what was modelled, what happened, what the
interventions did, and what the caveats are; the detail follows for readers
who want it. The report downloads as Markdown, HTML, Word, or PDF, belongs to
the conversation, shows in the details panel, and is kept for the study.

## 2. Decisions made on 2026-10-09

- **The model narrates, code assembles.** The assistant writes only the
  narrative sections (summary, what the results mean, limitations and
  assumptions, next steps, an optional title) through a tool. Code fills every
  factual section from stored artifacts. No number passes through the model
  on its way into the report.
- **One structured document, four renderers.** The report is a JSON document
  of blocks (section 4). Markdown and HTML are rendered in the web app with no
  new dependency (none can be installed on the owner's machine). Word and PDF
  are rendered by the sim service in Python, which also draws the figures.
- **Sections, in reader order:** title block, summary, key results, what the
  results mean, what was modelled, decisions made, limitations and
  assumptions, suggested next steps, appendix (section 5).
- **Tables and figures in every format.** The key-results table and one
  figure with every run's infected curve on shared axes; the configuration,
  data-source, and parameter tables. Word and PDF embed the figure as a PNG
  drawn by matplotlib; HTML embeds it as inline SVG; Markdown carries every
  table and number and replaces each figure with a one-line note that the
  figure is in the HTML or PDF version (a Markdown file cannot carry an image
  without a dependency or a second file).
- **A sixth stage, Report,** after Interpret, derived as every other stage
  is: the scenario has a report written after its latest run.
- **Versions.** Each call of the tool stores a new version; the panel shows
  the latest; every version stays in the database for the study.
- **Scope of one report:** the active scenario, with all of its successful
  runs. A conversation that started a new scenario reports on the new one.
- **Language.** The narrative follows the conversation's language, as the
  prompt already requires. Code-filled headings, labels, and captions are
  English in this sub-project (section 16).
- **No new npm dependency; two new Python dependencies** in the sim service:
  `python-docx` and `reportlab`, both pure Python. matplotlib arrives with
  Starsim.

## 3. The flow

1. After interpreting a run the assistant's suggested replies include
   "Create a report"; the Interpret stage's drafts do too.
2. The participant asks for the report. The assistant calls `write_report`
   with the narrative sections. The tool composes the document (section 6),
   stores it (section 7), and answers the model with a short confirmation.
3. The reply says the report is ready, in which formats, and where. The stage
   strip advances to Report. The panel's Report section opens with the title,
   the version, the section list, and four downloads. Under the tool call in
   the conversation a compact line offers the same downloads.
4. Changes come through conversation. "Shorten the summary" or "add the 90%
   scenario" (after running it) make the assistant call the tool again; a new
   version replaces the one on screen.
5. A new run after a report puts the stage back to Interpret: the report is
   stale until the assistant writes the next version.

## 4. The report document: `lib/report/document.ts`

```ts
export type ReportDocument = {
  version: 1;                       // the document format, for the renderers
  title: string;                    // "Measles in Kenya, SIR model, one year"
  subtitle: string;                 // "EpiChat report · version 2 · 9 October 2026"
  generatedAt: string;              // ISO 8601
  language: string;                 // BCP 47 of the narrative, best effort ("en")
  sections: ReportSection[];
};

export type SectionId = "summary" | "results" | "meaning" | "modelled" | "decisions" | "limitations" | "next_steps" | "appendix";
export type ReportSection = { id: SectionId; heading: string; blocks: ReportBlock[] };

export type ReportBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "table"; caption?: string; columns: string[]; rows: string[][] }
  | { kind: "keyValues"; items: [string, string][] }
  | { kind: "figure"; id: string; caption: string; xLabel: string; yLabel: string; lines: FigureLine[] }
  | { kind: "note"; text: string };

export type FigureLine = { label: string; x: number[]; y: number[] };
```

Text in `paragraph`, `bullets`, `table`, and `keyValues` is plain text: no
Markdown, no HTML. The renderers escape it. Narrative text from the model is
split into paragraphs on blank lines; a paragraph whose every line starts with
`- ` becomes a `bullets` block. Figure series are thinned to at most 400 points
per line with `thinPoints` from `lib/client/chart.ts` (pure, usable on the
server), so a document with several runs stays under 100 KB.

`lib/report/document.ts` also exports `ReportNarrative` (the tool's input
after validation) and `ReportPayload` (section 7.3).

## 5. Composition: `lib/report/compose.ts`

`composeReport(input: ComposeInput, now: Date): ReportDocument` is pure.

```ts
export type ComposeInput = {
  scenario: Scenario;                    // lib/tools/types
  runs: ReportRun[];                     // successful runs of the scenario, oldest first
  recap: string[];                       // the latest stored recap, or []
  literature: DiseasePayload | null;     // lookup(scenario.disease) summaries, when known
  narrative: ReportNarrative;
  version: number;
  conversationTitle: string;
  starsimVersion: string | null;         // from the latest run
};
export type ReportRun = { id: string; label: string; createdAt: string; effectiveParams: SimParams; stats: SimStats; attackRatePct: number; population: number; popScale: number; series: Record<string, number[]> | null; repairs: RepairRecord[]; warnings: string[]; dataSources: ResolvedField[] };
```

Run labels: "Run 1", "Run 2", … in order; when a run's effective parameters
differ from the previous run's in a vaccine coverage, a treatment capacity, R₀,
or population, the difference is appended in words ("Run 2, vaccine coverage
90%") using `lib/client/format.ts`.

The sections and their blocks:

| Section | Heading | Blocks |
|---|---|---|
| title block | the document's `title` and `subtitle` | none (rendered by the renderers from the document head) |
| summary | Summary | the narrative's `summary` as paragraphs |
| results | Key results | `table` "Results by run": Run, Peak day, Peak infections, Attack rate, Disease deaths; `figure` "Infected over time" with one line per run (`n_infected` against `day`), x "Day", y "People infected"; a `note` when a run has no stored series ("Run N's curve is not available.") |
| meaning | What the results mean | the narrative's `meaning` |
| modelled | What was modelled | `keyValues` from the configuration in words (Disease, Model, Country, Population, Agents, Duration, R₀ (approx.), Infectious period, Exposed period when any, Interventions), reusing the labels of `components/panel/ScenarioSection.tsx` through a shared `configurationRows()` moved to `lib/client/format.ts`; `table` "Data sources": Source, Field, Value, Citation, from `scenario.dataSources` with `describeField` and `SOURCE_LABELS`; a `paragraph` "No real data was fetched; every value is a literature value or an assumption." when there are none |
| decisions | Decisions made | `bullets` of the recap lines; a `paragraph` "The conversation recorded no decisions." when empty |
| limitations | Limitations and assumptions | the narrative's `limitations` |
| next_steps | Suggested next steps | the narrative's `next_steps` |
| appendix | Appendix | `table` "Effective parameters" with one column per run (parameter names as rows, values through `fmtValue`); `table` "Repairs" (Run, Attempt, Error, Changes) only when any run has repairs; `table` "Literature parameters" (Parameter, Typical, Range, Status, Consensus source) from `literature.parameters` with `parameterLabel`, `formatQuantity`, `formatRange`; `keyValues` "Software": EpiChat web, Starsim `starsimVersion`, "Report format 1" |

Numbers are formatted once, here, with `commaInt`, `fmtValue`, and the format
helpers; the renderers never reformat.

## 6. The tool: `write_report`

Registered in `lib/tools/index.ts` with the other tools.

```ts
export const WriteReportInput = z.strictObject({
  title: z.string().trim().min(3).max(120).optional(),
  summary: z.string().trim().min(80).max(1500),
  meaning: z.string().trim().min(40).max(4000),
  limitations: z.string().trim().min(40).max(4000),
  next_steps: z.string().trim().min(20).max(2000),
});
```

Description for the model (in `TOOLS`): "Write the report for the current
scenario. Call this when the user asks for a report, or when they accept your
offer after interpreting a run. Give the narrative sections only; the report's
tables and figures are filled from the stored results, so do not repeat
numbers. summary: five to eight sentences for a decision-maker. meaning: what
the results show, comparing runs when there are several. limitations: the
model's limits and every assumption that came from neither a tool nor the
user. next_steps: scenarios worth running and data worth checking. Call it
again, with the full text, to produce a new version after changes."

Behaviour (`lib/tools/writeReport.ts`):

1. Refuse with `REPORT NOT READY: run the simulation before writing a
   report.` when `scenario.hasRun` is false or no successful run of the
   scenario exists. Not an error outcome: the model explains.
2. Load through `deps.reports` (section 7.2): the scenario's successful runs
   (those with `scenario_id = scenario.id`, plus this turn's runs that are not
   yet linked), the latest recap, and the version number (one more than the
   conversation's report count).
3. `literature = scenario.disease ? lookupPayload(scenario.disease) : null`
   (the same summaries `lookup_disease` returns).
4. `composeReport(...)`, then `deps.reports.insert(...)` (section 7.2). Set
   `scenario.hasReport = true` and `scenario.reportCurrent = true`.
5. Answer the model: `content` is `Report written: "<title>", version N, 9
   sections, ~W words. The participant can download it from the Details
   panel as Markdown, HTML, Word, or PDF.`; `payload` is the `ReportPayload`.
6. A storage failure answers `content: "REPORT NOT SAVED: the report could not
   be stored. Say so and offer to try again."` with `isError: true` and a
   `tool_error` payload; the scenario flags stay unchanged.

`run_simulation` sets `scenario.reportCurrent = false` after a successful run
(the report is stale). `configure_simulation` with `new_scenario` resets both
flags through `emptyScenario`.

## 7. Storage

### 7.1 Migration `web/supabase/migrations/0004_reports.sql`

```sql
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  scenario_id uuid references scenarios(id) on delete set null,
  user_id uuid not null,
  turn_id uuid,
  version int not null,
  title text not null,
  language text,
  narrative jsonb not null,
  document jsonb not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, version)
);
create index if not exists reports_conversation_idx on reports (conversation_id, version desc);

alter table scenarios add column if not exists has_report boolean not null default false;
alter table scenarios add column if not exists report_current boolean not null default false;
alter table scenarios drop constraint if exists scenarios_stage_check;
alter table scenarios add constraint scenarios_stage_check
  check (stage in ('understand', 'configure', 'ground', 'run', 'interpret', 'report'));
alter table scenarios drop constraint if exists scenarios_stage_reached_check;
alter table scenarios add constraint scenarios_stage_reached_check
  check (stage_reached in ('understand', 'configure', 'ground', 'run', 'interpret', 'report'));
```

`finish_turn` is replaced in the same migration with two additions, mirroring
the runs: the scenario update and insert carry `has_report` and
`report_current` (`coalesce((s->>'has_report')::boolean, false)`, same for
`report_current`), and after the scenario is known: `update reports set
scenario_id = v_scenario where turn_id = v_turn and scenario_id is null;`.
The constraint names above are the ones PostgreSQL generated for the inline
checks in 0001 and 0002; the migration is idempotent and is run twice in
verification, like 0003.

Deleting a conversation cascades to its reports (0001's conversation delete
path needs no change).

### 7.2 Stores

`lib/db/reports.ts`:

```ts
export type ReportInsert = { conversationId: string; userId: string; turnId: string; scenarioId: string | null; version: number; title: string; language: string; narrative: ReportNarrative; document: ReportDocument };
export type ReportRow = { id: string; user_id: string; conversation_id: string; version: number; title: string; document: ReportDocument };
export interface ReportStore {
  insert(report: ReportInsert): Promise<string>;                   // the id; throws when the database refuses
  count(conversationId: string): Promise<number>;
  get(id: string): Promise<ReportRow | null>;                      // the download route
}
```

`lib/db/runs.ts` gains `listForReport(conversationId, scenarioId | null,
turnId): Promise<ReportRun[]>`: successful runs of the conversation where
`scenario_id = $scenarioId` or (`scenario_id is null` and `turn_id =
$turnId`, this turn's runs that `finish_turn` has not linked yet), ordered by
`created_at`, with `series`. `lib/db/turns.ts` gains `lastRecap(conversationId):
Promise<string[]>` (the `recap` event of the latest finished turn).

`ToolDeps` gains `reports: ReportDeps`:

```ts
export type ReportDeps = {
  runs(): Promise<ReportRun[]>;
  recap(): Promise<string[]>;
  nextVersion(): Promise<number>;
  insert(report: Omit<ReportInsert, "conversationId" | "userId" | "turnId" | "scenarioId">): Promise<string | null>;  // null when the insert failed
  conversationTitle: string;
};
```

`handleChat.ts` builds it from `deps.reports`, `deps.runs`, `deps.turns`, and
the conversation, the way `onRun` is built. `ChatDeps` gains `reports:
ReportStore`; `app/api/chat/route.ts` wires `supabaseReportStore(admin)`.

### 7.3 The stored tool result

```ts
export type ReportPayload = { kind: "report"; report_id: string | null; version: number; title: string; sections: { id: SectionId; heading: string }[]; words: number };
```

added to `CardPayload`. `words` counts the whitespace-separated words of the
four narrative sections. The document itself is not in the turn event (it can
be 100 KB); the panel reads the payload and the downloads read the table.
`turn_events_kind_check` is unchanged: `report` is a payload kind, not an
event kind. `CARD_KINDS` gains `"report"`; `PANEL_SECTIONS` gains `"report"`.

### 7.4 Scenario

`Scenario` (lib/tools/types.ts) gains `hasReport: boolean` and
`reportCurrent: boolean`; `ScenarioJson` and `scenarioToJson` carry
`has_report` and `report_current`; `emptyScenario` sets both false.

## 8. Stage

`STAGES` becomes `["understand", "configure", "ground", "run", "interpret",
"report"]`. `deriveStage`:

```ts
if (running) return "run";
if (scenario.reportCurrent) return "report";
if (scenario.hasRun) return "interpret";
...
```

`STAGE_LABELS.report = "Report"`; `STAGE_HINTS.report = "The report is ready.
Download it from the Details panel, or ask for changes."`;
`STAGE_HINTS.interpret` becomes "Explore the results, change something and run
again, or ask for a report."; `DRAFTS.interpret = ["What does the peak mean
for hospitals?", "Compare with 90% vaccine coverage", "Create a report"]`;
`DRAFTS.report = ["Shorten the summary", "Run another scenario to compare",
"Start a new scenario"]`. The strip shows six steps; on narrow screens it
already scrolls.

The zod enum in `lib/clientEvents.ts` takes the new stage through `STAGES`;
`step_events.stage` is free text.

## 9. Prompt: `lib/chat/prompt.ts`

A "## Report" section after "## The interface":

- After interpreting a run, offer a report among the suggested replies
  ("Create a report").
- When the user asks for one, call `write_report` with the narrative sections.
  The summary is five to eight sentences a decision-maker can act on; the
  other sections are a few short paragraphs each; bullet lines are welcome.
  Do not repeat numbers: the report's tables and figure carry every result,
  parameter, and source. Write in the user's language.
- After the tool succeeds, say the report is ready and that Markdown, HTML,
  Word, and PDF are in the Details panel; do not paste the report into the
  conversation.
- When the user asks for changes, call `write_report` again with the full
  text of every section; the new version replaces the old one on screen.
- When the user asks for a report before any run, say what has to happen
  first.

## 10. Panel and conversation

- `lib/client/artifacts.ts`: `Artifacts.report: ReportPayload | null` (the
  latest successful `write_report` result; cleared by a `new_scenario`).
- `components/panel/ReportSection.tsx`: the title; "Version N · <date>"; the
  section headings as a list; four download links (`Markdown`, `HTML`,
  `Word`, `PDF`) to `/api/reports/<id>?format=<md|html|docx|pdf>` with the
  `download` attribute, and `Open` to the HTML format in a new tab. Each press
  calls `track({ kind: "export", conversationId, format })`. Empty state:
  "The report appears here once you ask for one."
- `components/panel/DetailsPanel.tsx`: a "Report" section between Runs and
  Activity, opened when a report arrives, the way Runs opens on a new run;
  opening it reports `scenario_panel_opened` with section `report`.
- `components/ReportLine.tsx`, rendered by `TurnBlocks.tsx` under a
  successful `write_report` result: "Report ready: <title>, version N" and
  the four downloads.
- `ChatHeader`'s unseen dot counts a report as a new artifact.

## 11. Downloads: `GET /api/reports/[id]`

`requireParticipant`; the id must be a uuid, else 404; the row must exist and
belong to the participant, else 404 (the runs route's shape). `format` is one
of `md`, `html`, `docx`, `pdf`, else 400.

| format | rendered by | content type | disposition |
|---|---|---|---|
| md | `lib/report/markdown.ts` `renderMarkdown(document)` | `text/markdown; charset=utf-8` | attachment, `<slug>-v<N>.md` |
| html | `lib/report/html.ts` `renderHtml(document)` | `text/html; charset=utf-8` | inline (the Open link) unless `download=1`, then attachment `<slug>-v<N>.html` |
| docx | sim service `POST /export` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | attachment `<slug>-v<N>.docx` |
| pdf | sim service `POST /export` | `application/pdf` | attachment `<slug>-v<N>.pdf` |

`slug` is the title lower-cased, non-alphanumerics collapsed to `-`, at most
60 characters. `Cache-Control: private, max-age=3600` on every success.

`renderMarkdown`: `# title`, the subtitle in italics, `## heading` per section,
paragraphs, `- ` bullets, GitHub tables (cells escape `|`), key-values as a
two-column table, figures as `*Figure: <caption>. The chart is in the HTML and
PDF versions of this report.*`, notes in italics.

`renderHtml`: one self-contained page: `<!doctype html>`, `<meta charset>`,
viewport, the title, a `<style>` block with the app's palette (paper, ink,
accent, line) and print rules (`@page` margins, tables that do not split
rows, the figure at full width), then the same structure as Markdown with
`<table>` and inline `<svg>` figures drawn by `lib/report/svg.ts`
`figureSvg(figure, width = 720, height = 320)` using `niceTicks`, `linePath`,
and `compact` from `lib/client/chart.ts`, one colour per line from a fixed
palette, a legend, and axis labels. Every text node passes through
`escapeHtml`. No script. The page prints to a clean PDF from any browser, a
free fallback when the sim service is down.

`docx` and `pdf`: `deps.sim.export(format, document)` on the `SimClient`
(section 12). On `{ ok: false }` the route answers 503 with
`{ code: "export_unavailable", message: "Word and PDF exports are temporarily
unavailable. Markdown and HTML still work." }`; the panel shows the message
under the buttons for one minute. `next.config.ts` traces the route like
`/api/runs/[id]`.

## 12. Sim service: `POST /export`

`sim/main.py` gains:

```python
class ExportRequest(BaseModel):
    format: Literal["docx", "pdf"]
    document: dict   # a ReportDocument; validated by render.validate_document

@app.post("/export")
def export_route(body: ExportRequest, settings: Settings = Depends(require_bearer)):
    problems = render.validate_document(body.document)
    if problems: return _error(422, "invalid_document", detail="; ".join(problems))
    data = render.render_docx(body.document) if body.format == "docx" else render.render_pdf(body.document)
    return Response(content=data, media_type=MEDIA[body.format])
```

`sim/report_render.py` (`render` above):

- `validate_document(doc) -> list[str]`: version 1, the required keys, every
  block kind known, every figure line with equal-length `x` and `y`, at most
  2 MB serialised, at most 40 sections, at most 12 lines per figure.
- `figure_png(figure) -> bytes`: matplotlib with the `Agg` backend, 1600×700
  px at 150 dpi, one line per entry, legend, axis labels, grid, the app's
  palette; `plt.close` after saving.
- `render_docx(doc) -> bytes`: `python-docx`; title as Heading 1, subtitle as
  italic paragraph, section headings as Heading 2, paragraphs, bullets
  (`List Bullet`), tables with the `Light Grid Accent 1` style and a bold
  header row, key-values as two-column tables, figures as pictures 6.3 inches
  wide with the caption below, notes in italics.
- `render_pdf(doc) -> bytes`: `reportlab` platypus on A4 with 18 mm margins:
  `Paragraph` styles for title, subtitle, headings, body, caption; `Table`
  with a header row, grid lines, repeating header rows across pages;
  `Image` for figures; `KeepTogether` for a caption and its figure. Fonts:
  `epichat.exporter._has_cjk` and `_rl_register_cjk` for CJK text,
  `_sanitize_latin` otherwise (R₀ becomes R0 in the PDF only).
- Text is escaped for reportlab's mini-HTML (`&`, `<`, `>`).

`sim/requirements.txt` gains `python-docx>=1.1` and `reportlab>=4.0`.
`vercel.json` needs no change: the function's `excludeFiles` already keeps
tests out, and the export runs in well under the 300 s limit. The service's
`buildCommand` copies `epichat/` in, so `epichat.exporter` is importable.

`lib/sim/client.ts`: `export(format: "docx" | "pdf", document: ReportDocument):
Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false;
status: number; kind: SimFailureKind; detail: string }>` with the same bearer
header, a 60 s timeout, and the same failure mapping as `simulate`.

## 13. Events

- Server: `tool_called` / `tool_failed` with tool `write_report` (existing
  kinds); `stage_reached` for `report`.
- Client: `export` with `format` in `EXPORT_FORMATS = ["md", "html", "docx",
  "pdf"]`; `scenario_panel_opened` with section `report`; `card_expanded`
  with card `report` when the conversation's report line is expanded (it has
  no expansion in this sub-project; the kind is reserved).
- `/api/event` copies `format` into meta already.

## 14. Error handling

| Failure | Behaviour |
|---|---|
| `write_report` before any run | tool answers REPORT NOT READY; the assistant explains; no event beyond `tool_called` |
| the insert fails | tool answers REPORT NOT SAVED with `isError`; `tool_failed` event; flags unchanged; the assistant offers to retry |
| a run has no stored series | the figure omits that run and a note names it |
| recap missing | "The conversation recorded no decisions." |
| `lookup(scenario.disease)` finds nothing | the literature table is omitted |
| download of a report the participant does not own | 404 |
| unknown format | 400 |
| sim service unavailable for docx/pdf | 503 `export_unavailable`; Markdown and HTML unaffected; the panel shows the message |
| sim render raises | 500 `render_failed` from the service, mapped to the same 503 for the browser; the service logs the traceback |
| document fails `validate_document` | 422 from the service; the route logs it and answers 503 (a bug, not a participant error) |
| the narrative fails validation (too short, too long) | the tool answers the zod problems through `executeTool`'s existing path; the model rewrites |

## 15. Testing

- `tests/report/document.test.ts`: narrative splitting into paragraphs and
  bullets; thinning keeps 400 points and the last one.
- `tests/report/compose.test.ts`: a fixture with two runs (one with a 90%
  coverage) and one without a series: every section present in order; the
  results table rows; the figure's two lines and the note for the third run;
  run labels in words; the data-source and literature tables; the appendix
  parameter columns; empty recap wording; the version in the subtitle;
  numbers formatted once (`55,100,586`, `2.4%`).
- `tests/report/markdown.test.ts` and `tests/report/html.test.ts`: render the
  fixture; headings, table rows, escaped `|`, `<`, `&`; the figure note in
  Markdown; `<svg` with as many `<path` as lines in HTML; no `<script`; the
  print stylesheet present; `escapeHtml` on a hostile title.
- `tests/report/svg.test.ts`: axis ticks and paths for a two-line figure;
  an empty line draws nothing.
- `tests/tools/writeReport.test.ts`: refusal before a run; the content line;
  the payload; the flags; `insert` failure path; the recap and runs read
  through `ReportDeps`.
- `tests/chat/stages.test.ts`: `reportCurrent` → `report`; a run resets it.
- `tests/db/finishTurn.test.ts` (pglite): 0004 applies twice; the report row
  links to the scenario; `has_report` and `report_current` persist; stage
  `report` is accepted.
- `tests/api/reportsRoute.test.ts`: owner check, each format's headers, the
  503 path with a failing fake sim client, the inline/attachment switch.
- `tests/sim/client.test.ts`: `export` success and each failure kind.
- `tests/app/workspace.test.ts`: static pins for `ReportSection`,
  `ReportLine`, the six-step strip, and the panel wiring.
- `sim/tests/test_report_render.py`: a sample document renders to docx (read
  back with python-docx: headings, a table, a picture) and pdf (starts with
  `%PDF`, more than one page for a long sample, CJK sample renders);
  `validate_document` rejects a bad figure; `/export` answers 401 without the
  bearer, 422 on a bad document, and the right media type on success.
- `tests/app/deploy.test.ts`: DEPLOY.md mentions `0004_reports.sql`,
  `/api/reports/`, `/export`, `python-docx`, `reportlab`, and "Report
  verification".

## 16. Out of scope, recorded for later

- Localised headings and captions (the narrative already follows the
  conversation's language).
- Figures inside the Markdown file.
- A report across several scenarios of one conversation.
- The share link (its own spec) will reuse `renderHtml` for the snapshot page.
- The report-writer role and the plan artifact belong to 4b; when 4b lands,
  the plan becomes a section before "What was modelled".

## 17. Files

Create: `web/lib/report/document.ts`, `compose.ts`, `markdown.ts`, `html.ts`,
`svg.ts`; `web/lib/tools/writeReport.ts`; `web/lib/db/reports.ts`;
`web/app/api/reports/[id]/route.ts`; `web/components/panel/ReportSection.tsx`;
`web/components/ReportLine.tsx`; `web/supabase/migrations/0004_reports.sql`;
`sim/report_render.py`; `sim/tests/test_report_render.py`; the tests above.

Modify: `web/lib/tools/{types,index,runSimulation,configureSimulation}.ts`,
`web/lib/chat/{handleChat,prompt,stages}.ts`, `web/lib/enums.ts`,
`web/lib/clientEvents.ts`, `web/lib/client/{artifacts,drafts,format}.ts`,
`web/lib/db/{runs,turns,scenarios}.ts`, `web/lib/sim/client.ts`,
`web/app/api/chat/route.ts`, `web/components/{TurnBlocks,Chat}.tsx`,
`web/components/panel/{DetailsPanel,ScenarioSection}.tsx`, `web/next.config.ts`,
`sim/main.py`, `sim/requirements.txt`, `web/docs/DEPLOY.md`.

## 18. Deployment

1. Apply `0004_reports.sql` in the Supabase SQL editor, twice, before the
   push: without it `finish_turn` rejects the new scenario fields.
2. Push main: the web app and the sim service deploy together; the sim
   build installs the two libraries.
3. DEPLOY.md section 6e, "Report verification": a measles conversation
   through a run, "Create a report", the panel's Report section, the four
   downloads opened (Word in Word, PDF in a viewer, HTML in the browser,
   Markdown in an editor), a second run and "Update the report", the stage
   strip's sixth step, and the Table Editor: `select version, title,
   jsonb_array_length(document->'sections') from reports where
   conversation_id = '<id>' order by version` and the `export` step events
   with their formats.
