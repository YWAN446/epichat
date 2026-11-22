# The tutorial's recording

`recording.json` is the practice conversation the first-use tutorial plays. It is a real conversation, exported, not written by hand.

- **Recorded:** 2026-11-21 on the live site (Starsim 4.0.0rc5), under the owner's account.
- **Conversation:** "Model a measles outbreak in Kenya", five turns: the example; "Yes, fetch the data"; "Run as agents (recommended)"; the Try next option "Vaccinate 70% in a campaign from day 30 to day 60 and rerun"; "Create a report".
- **Hand edits:** none. Every number, source, parameter, chart value and sentence is as the app produced it.
- **What the export changes:** turn ids become `practice-N`; each run carries its chart series and no run id, so nothing is fetched; every other database id becomes `practice`; the report document is attached. The export refuses to write a file that still contains the owner's email address.

## Remaking it

1. On the live site, press the example "Model a measles outbreak in Kenya", then the replies that fetch the data and run, then a Try next option that is a vaccination campaign, then a reply that asks for a report. Exactly five turns.
2. In `web/`: `node scripts/export-recording.mjs <conversation id> <owner email> [folder holding .env.local]`.
3. `npx vitest run tests/tutorial`. If a chip text changed, the steps in `lib/tutorial/steps.ts` still fit as long as the five turns are in the same order; if the conversation needed more or fewer confirmations, change the steps' parts and `showTurns` to match.

Hand edits are allowed only to trim extra suggested replies or shorten the assistant's prose, and each must be listed here. No number, source, parameter or chart value may be edited.
