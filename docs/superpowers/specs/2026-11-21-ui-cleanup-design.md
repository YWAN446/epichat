# UI cleanup after usability round 1 (part 2 of 3)

Date: 2026-11-21. Size: a small project, one PR. No database migration.

## Why

Round-1 participants missed the right-hand panel on laptop screens, were unsure what it was called, and found the start page and the feedback buttons distracting. The live test on 2026-11-21 added two report defects. Part 3 (the first-use tutorial) walks through the panels, so their names and layout are settled here first.

## Goals

1. **Thumbs removed.** The thumbs up/down under each answer go away (`FeedbackControl`, its use in the conversation, the `feedback_given` client event). Stored ratings, the `feedback` table and its read code stay.
2. **Plain start page.** The heading is one fixed English line (the first of `WELCOME_PHRASES`), no typing animation, no cursor. The typewriter code and the other phrases are deleted.
3. **One name: Dashboard.** The panel is "Dashboard" in the header button, the `aside` labels (including the shared-conversation page), the assistant's instructions (`lib/chat/prompt.ts` says "panel" twice) and the start-page hint. Its tabs are **This conversation** (was "Details") and **Profile**. Hints that say "the Profile tab" become "the Dashboard's Profile tab".
4. **Dashboard visible from 1024 px.** From 1024 px the Dashboard is a column beside the conversation (resizable and collapsible as now). The conversation list stays a column from 1280 px; between 1024 and 1279 px it folds behind the ☰ button as a drawer. Below 1024 px both are overlays as today, with the new-results dot on the Dashboard button.
5. **Chart opens on "Currently infected".** The Dashboard's run chart starts on the infected view, not compartments. The view buttons are unchanged.
6. **Suggested replies wrap.** The chips under the composer wrap onto further lines; no sideways scrolling, and a long chip may break across lines.
7. **Bold and lists in reports.** In the four narrative sections, `**bold**` renders as bold, and a run of `- ` lines renders as a list even when it follows a lead-in line in the same paragraph, in the HTML, Word and PDF reports. The Markdown download keeps the same marks.
8. **Population row without doubled brackets.** When the population's source title has its own brackets, the row no longer nests them. Same text in the Dashboard row (`lib/client/format.ts`) and the report (`lib/report/compose.ts`).
9. **Suggested-reply table on `/admin`.** One row per week (Monday start, UTC), newest first, last 12 weeks: turns sent, turns sent from a button, that count split by kind (assistant's suggestion, example draft, introduction question, intervention option, reference), and participants who used a button out of participants active that week. Counts only, read from `step_events` (`turn` and `suggestion_used`). Researcher accounts are left out.

## Non-goals

- The tutorial (part 3), any change to what the assistant suggests, or to the Dashboard's sections.
- Italics, links, headings or nested lists in report narratives.
- Charts or per-participant rows on `/admin`; replay and export stay for later.
- Re-rendering stored reports: an old report keeps its look.

## Anti-goals

- A participant's typed text reaching the researcher table or the event log.
- The Dashboard covering the conversation at 1024 px: the conversation column keeps a usable width (at least about 480 px) with the Dashboard at its default width.
- The three report formats disagreeing about what is bold or what is a list.

## Approaches

**Report formatting**
- **A (chosen): extend the stored report format.** Paragraph and bullet text may carry bold runs, and the narrative parser emits a list after a lead-in line. All three renderers read the same blocks, so they cannot drift.
- B: each renderer parses the asterisks itself. Three copies of the logic, in two languages.
- C: tell the assistant not to use bold or lists. Works only when it obeys, and bold labels are useful.

**Shipping**
- **A (chosen): one PR.** The items are small and share screens; one review, one preview check.
- B: two PRs, layout first and the table second. Only worth it to get the layout live half a day sooner.

## Decided how

- The stored format gains an optional rich form for text; a document without it renders exactly as today, in both the TypeScript and the Python renderers. `sim/report_render.py` validates the new form.
- Breakpoints change in `WorkspaceShell.tsx` (the Dashboard's static column moves from `xl:` to `lg:`; the conversation list stays on `xl:`), with `Chat.tsx`'s "wide" test following so the open/unseen logic matches what is on screen.
- The table is a server component on the existing `/admin` page, behind the existing researcher check, reading with the admin client.

## Left to the builder

- The exact shape of the rich text in the document model.
- The wording of the population row once the brackets are gone.
- How researcher accounts are matched to user ids.
- Column widths between 1024 and 1279 px.

## Checks before merge

Tests first for every item. Then on the preview: 1024, 1272 and 1280 px wide (Dashboard visible, list folded below 1280, nothing clipped), one report with bold and a list in all four downloads, and the `/admin` table against a hand count for one week.
