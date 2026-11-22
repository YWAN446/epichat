# First-use tutorial: a recorded practice conversation (round 1, part 3 of 3)

Date: 2026-11-21. Size: a project, one PR, about two days. One database migration (`0009_tutorial.sql`), applied by the owner before merging.

## Why

Round-1 participants did not know what the right-hand panel was for and missed parts of the screen. The owner asked for a game-like first-use tutorial that walks a new participant through each part with one small example, every step skippable. The owner's emphasis: **the tutorial must introduce the Dashboard and make clear what it does.** Round 2 is one to two months away; this should be in place before it.

The idea a participant should leave with: *the conversation is where you ask; the Dashboard is the record of what the conversation has set up and produced: the scenario, the data behind it, every run, and the report.*

## Goals

1. A practice page at `/tutorial` that looks exactly like the chat workspace and plays a recorded measles-in-Kenya conversation, one do-it step at a time.
2. Each step asks for one real action on a real control; the step completes when the participant does it. "Skip step" does it for them; "End tutorial" leaves at any point.
3. Six of the ten do-it steps happen in the Dashboard, and the Dashboard is introduced by name, with what it is for, right after the first answer.
4. New participants land in the tutorial on their first arrival at the chat. Existing participants get a one-time offer. Anyone can replay it from the account menu.
5. Outside the tutorial: an always-visible one-line description at the top of the Dashboard, and plainer empty-state lines in its sections.
6. Counts for the researcher page: how many started, finished, and where people left.

## Non-goals

- A guided real conversation: nothing in the tutorial reaches the assistant or the simulation service.
- Languages other than English.
- Tutorials for the share link, the conversation list, or the Activity section.
- Changing what the assistant says or how the real chat behaves (other than goal 5 and the menu item and offer in goal 4).

## Anti-goals

- A message sent, a conversation or turn saved, a run started, or a daily turn used by the tutorial.
- A participant trapped: every card has "End tutorial", and Escape on a card focuses it rather than closing anything.
- A tutorial that drifts from the app: it must be built from the same components, and a test must fail when the recording can no longer be displayed.
- Personal data in the recording, or typed text in the tutorial's event log.
- The tutorial reappearing uninvited after it was started, skipped or declined once.

## The steps

Copy below is the intended wording; the builder may tighten it but not change its meaning. Each card shows "Step N of 10", the text, "Skip step" and "End tutorial".

| # | Target | The participant does | Card text |
|---|---|---|---|
| 0 | (centre card) | Presses **Start** (or **Skip the tutorial**) | "A 3-minute practice run. You'll set up a small outbreak, run it, and find the results. Nothing here is sent or saved." |
| 1 | The example chip "Model a measles outbreak in Kenya" | Presses it | "Start by asking. Examples like this one are a quick way in; later you can type anything." |
| 2 | The Dashboard, then its Scenario section | Opens **Scenario** | "This is the Dashboard. The conversation is where you ask; the Dashboard keeps the record: the scenario, its data, every run, and the report. Open Scenario to see the setup the assistant just proposed." |
| 3 | Data section | Opens **Data** | "Every number has a source. Open Data to see where the population, birth rate and vaccine coverage came from." |
| 4 | The confirming suggested reply, then the Runs section | Presses the reply; then opens **Runs** | "Suggested replies save typing. Press this one to run the simulation." then "The run is in the Dashboard. Open Runs for its key numbers and chart." |
| 5 | The chart view buttons | Presses **Incidence** | "The same run, seen another way. Switch the chart to Incidence to see new cases per day." |
| 6 | A "Try next" option (a vaccination campaign) | Presses it | "Try a what-if. This adds a vaccination campaign and runs again; the Dashboard shows both runs so you can compare." |
| 7 | Parameters section | Opens **Parameters** | "The exact values the runs used are here, with where each came from." |
| 8 | The reply that asks for a report, then the Report section | Presses the reply; then opens **Report** | "Ask for a report when you're done." then "Your report and its downloads live in the Dashboard." |
| 9 | The Profile tab | Presses **Profile** | "Your profile shapes how the assistant answers. You can change it here at any time." |
| 10 | (centre card) | Presses **Start my own conversation** | "That's the tour. The Dashboard will fill in as you go." |

Rules:

- Steps 4 and 8 have two parts (a reply, then a Dashboard section); they count as one step each.
- The recording is made to fit these steps. If the real conversation needs one more confirmation than the table shows (the assistant asks before fetching data and again before running), that confirmation becomes an extra "press the suggested reply" part of the nearest step, not a new numbered step.
- Below 1024 px the Dashboard is hidden behind the Dashboard button. Each Dashboard step then begins with a part "Press Dashboard to open it" when the Dashboard is closed, and the sheet is closed again before a step that targets the conversation.
- During a do-it step only the target is pressable; the rest of the screen is dimmed and inert.
- **The practice Dashboard starts with every section closed and does not open sections by itself** (the real Dashboard opens Scenario and Runs at the start and reopens sections when something new arrives). This keeps every Dashboard step a real action. The Dashboard component gains an optional mode for this; the real chat keeps its behaviour. A section the participant opened stays open. (Builder check 1; my call, following the owner's choice of do-it steps.)
- "Skip step" applies the step's effect (the reply is sent in the recording, the section opens, the view switches) and moves on.
- The assistant's recorded text appears over about a second, not instantly; with reduced motion it appears at once.

## Behaviour around the tutorial

- **First arrival.** A participant whose account has no "tutorial seen" time and no conversations is sent from `/chat` to `/tutorial`.
- **Existing participants.** With no "tutorial seen" time but at least one conversation, the start page shows a one-time card: "New: a 3-minute practice run that shows what the Dashboard does." with **Take the tutorial** and **Not now**. Either choice records the time.
- **Seen is recorded when the tutorial starts** (step 0 is shown), so a closed tab does not bring it back uninvited.
- **Replay.** The account menu gains a "Tutorial" item that opens `/tutorial`; replays are logged as replays.
- **Leaving.** "End tutorial", "Skip the tutorial" and "Start my own conversation" all go to `/chat`.
- **The practice screen.** The message box is disabled with the placeholder "Typing is off in the practice run." The left column shows one entry, "Practice run", and no account menu. The header's Share button is absent. The Profile tab shows the participant's real profile, read-only, with the line "You can edit your profile in your own conversations."
- **The practice report.** The Report section shows the recorded report's title and four format buttons in a practice-only block (the real downloads point at the database, which the recording does not touch; builder check 5, my call). HTML and Markdown open the recorded report, rendered from the recorded document by the app's own renderers; Word and PDF are shown disabled with "Available in your own conversations." The "Report ready" line inside the conversation shows without download buttons.

## Outside the tutorial

- At the top of the Dashboard's "This conversation" tab, always visible: "What this conversation has set up and produced: the scenario, its data, every run, and the report."
- Empty-state lines, rewritten:
  - Scenario: "The outbreak you describe appears here: the disease, the place, the population and any interventions."
  - Data: "Once the assistant looks up real data, each figure and its source is listed here."
  - Parameters: "The exact values a run will use appear here once a scenario is set up."
  - Runs: "Each simulation you run appears here with its key numbers and chart."
  - Report: "Ask the assistant for a report and it appears here, with downloads."
  - Activity: "Each step the assistant takes is listed here as it works."
  - The existing Parameters line for a scenario whose parameters were not recorded stays as it is.

## Researcher counts

- Events, counts only: `tutorial_started` (meta: `replay` true/false, `entry` one of `first_visit`, `offer`, `menu`), `tutorial_step` (meta: `step` 0-10, `how` one of `done`, `skipped`), `tutorial_finished`, `tutorial_ended` (meta: `step` where they left), `tutorial_offer_declined`.
- `/admin` gains a second table, "Tutorial". Every number is a count of distinct participants, researcher accounts left out, first run-throughs only (builder check 3; my call): started, finished, did not finish, offer declined; then per step, how many reached it, did it, and skipped it. "Did not finish" is started minus finished, so someone who closes the tab is counted, and the step they left at is the last step they reached. Replays are one separate number ("Replayed by N participants").

## Approaches

**Where the practice screen lives**
- **A (chosen): its own page built from the app's real components**, driven by the recording, with no connection to the assistant. It cannot send or save by construction, and `Chat.tsx` is untouched. `SharedConversation` already composes the same components this way.
- B: a practice mode inside the real chat page. Less duplication, but every server call needs a guard and a missed guard sends a real message.

**Remembering who has seen it, and the counts**
- **A (chosen): stored with the account** (`profiles.tutorial_seen_at`) and logged in `step_events`. Follows the participant across devices; needs one migration.
- B: the browser only. No migration, but the offer returns on another device and there are no counts.

**The spotlight and cards**
- **A (chosen): our own small component.** Steps wait for a real action on a real control, which tour libraries handle poorly, and the app has no such dependency.
- B: a tour library. Suited to look-and-next tours, and a dependency to keep in step with this Next.js version.

**Making the recording**
- **Chosen:** the conversation is run once on the live site under the owner's account, then that one conversation is exported read-only from the database into a file in the repository. The owner approved this export on 2026-11-21. A script kept in the repository does the export so the recording can be remade.

## Decided how

- **Who records, and editing by hand (builder check 2; my call):** I make the recording as part of the build, re-running the live conversation until it fits the steps (a "Try next" option that is a vaccination campaign is required; if a run comes back without options, it is run again). Light hand edits to the exported file are allowed and listed in a note beside it: trimming extra suggested replies, and shortening the assistant's prose. No number, source, parameter or chart value is ever edited by hand. Until the real recording exists the build uses a small hand-made stand-in, replaced before the PR is opened.
- **Recording file:** `web/data/tutorial/recording.json`, holding the turns in the shape the conversation components already display (`DisplayTurn[]`), with each run's chart series embedded so nothing is fetched, plus the report document. The export script removes every id that points at the database, the owner's user id and email, and checks the text for the owner's name and email. It is recorded with profile memory off so the assistant's text does not refer to the owner's profile.
- **Steps as data:** one module lists the steps (number, target, text, what completes it, how much of the recording is shown before and after). A pure state function advances the tutorial; the page wires the components' existing callbacks (reply pressed, section opened, chart view changed, tab changed) to it.
- **Targets** are found by a `data-tutorial` attribute added to the existing components, not by text or position.
- **Migration `0009_tutorial.sql`:** adds `profiles.tutorial_seen_at timestamptz` (null for everyone) and the five event kinds to the `step_events` kind check. The kinds are added to `STEP_EVENT_KINDS` in the same change.
- **Event intake:** the tutorial's events carry no conversation id; the existing event route accepts them as it accepts session events. Only fixed words and step numbers are stored.
- **The preview shares the production database** (builder check 4). The migration only adds a column that may be empty and widens a list of allowed words, so it is safe to apply while the old code is live. **The owner applies `0009_tutorial.sql` before the preview check, not just before merging.** The preview run-through is done under the owner's researcher account, which the counts leave out.
- **Access:** `/tutorial` is behind the same sign-in, consent and profile checks as `/chat`.

## Left to the builder

- The look of the dimming, the cutout and the card, within the app's existing styles; where the card sits relative to its target; keyboard focus order.
- How the practice page shares layout code with the chat (the shell component is reusable as it is).
- The exact wording of the recorded first message and replies, so that the recording fits the steps.
- Whether the read-only Profile tab reuses the profile panel with its inputs disabled or shows a plain summary.
- The layout of the Tutorial table on `/admin`.

## Checks before merge

Tests first for every part. A test must fail if the recording stops matching what the components display (it renders every step without error and yields a scenario, data sources, two runs and a report). A test pins that the practice page's code contains no call to the chat, feedback, share or profile-saving routes. On the preview: the whole tutorial at 1280 px and at 1000 px, by doing every step and again by skipping every step; the first-arrival redirect with a fresh account if one is available, otherwise the offer card; the account menu item; the `/admin` Tutorial table after one run-through.
