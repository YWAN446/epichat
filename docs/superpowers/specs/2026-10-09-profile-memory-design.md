# Participant Profile and Agent Memory Design (sub-project 4d)

Date: 2026-10-09. Parent specs: `2026-10-07-web-agent-architecture-design.md`
(the architecture), `2026-10-08-workspace-design.md` (the workspace; its
section 15 sketched this sub-project as "4d. Memory"), `2026-10-09-report-design.md`
(the report, whose summary this shapes). This spec is the authority for the
profile and the memory; the parents win for everything else.

## 1. Purpose

Every participant has a profile. Right after consent they answer a short
required questionnaire: who they are, how much they know about epidemic
models, what they want from simulations, and, if they wish, the disease,
country, and decisions they care about. The profile, their preferences, and
what the assistant has learned about them live in a Profile tab in the right
column, where they can edit everything; the assistant adds to the memory
through a tool. The profile shapes how much detail the assistant gives, how
it frames feedback, and what the report leads with.

## 2. Decisions made on 2026-10-09

- **A required step** between consent and the first conversation (owner's
  decision): role, experience, and goals are required; the rest optional.
- **Approach 1 of the brainstorm:** profile fields on the profile row,
  memories as rows, both injected into the first user message of every
  conversation as an "About this participant" block. The system prompt stays
  byte-stable and cached for everyone.
- **Memory is on for everyone, visible and editable** (decision of
  2026-10-08), with a switch in the preferences.
- **The assistant remembers through one tool**, `remember`, three calls per
  turn at most, thirty active memories per participant; its oldest give way
  first, the participant's own are never dropped automatically.
- **Profile changes apply from the next conversation.** The tab says so.
- **Consent text gains one bullet and the version is bumped** (owner's
  decision).
- **The consent form keeps its participant type** (the study's enrolment
  category, named in the consent text); the profile's role is a finer field,
  pre-filled from it where the mapping is plain.
- **No names.** The profile never asks for one; the assistant addresses the
  participant by role at most.

## 3. The flow

1. After consent the participant lands on `/profile` ("Tell us about
   yourself"): one page, the fields of section 4, Save. On save the chat
   opens. Existing participants meet the page on their next visit; the
   consent bump sends everyone through consent first, then here.
2. In the workspace the right column has two tabs, Details and Profile.
   Profile shows the fields, the preferences, and the memory list; every
   item is editable in place; Save writes it; the tab notes that changes
   reach the assistant from the next conversation.
3. Every new conversation's first message carries the About block (section
   8). The assistant pitches detail and framing by it, and calls `remember`
   when it learns something worth keeping. The new memory appears in the
   tab as the turn finishes (the panel re-reads the list when a
   `remember` tool result arrives in the stream).
4. The participant can edit, delete, or add memories, switch memory off
   (the tool is withheld and nothing is injected; the rows stay), or forget
   everything (deactivates every memory, with a confirmation).

## 4. The profile

| Field | Column | Values | Required |
|---|---|---|---|
| Role or position | `role` | `student`, `modeler`, `epidemiologist`, `clinician`, `public_health_practitioner`, `policy_maker`, `communicator`, `general_public`, `other` | yes |
| Experience with epidemic models | `experience` | `none`, `some`, `a_lot` | yes |
| What you want from simulations | `goals` (text[]) | any of `learning`, `exploring`, `deciding`, `communicating`; at least one | yes |
| Disease of interest | `disease_interest` | a disease key from the database, or free text ≤ 60 chars | no |
| Country of interest | `country_interest` | ISO3 from `country_names.json` | no |
| Decisions you can influence | `decisions` | free text ≤ 200 chars, one line | no |
| How you prefer results | `results_pref` | `summary`, `tables`, `charts`, `all` (default `all`) | no |
| Preferred report format | `report_format` | `md`, `html`, `docx`, `pdf` (default `pdf`) | no |
| Memory | `memory_enabled` | boolean, default true | — |
| | `profile_completed_at`, `profile_updated_at` | timestamps | — |

Pre-fill from `participant_type`: `graduate_student` → `student`,
`public_health_practitioner` → `public_health_practitioner`; the others
leave the role unselected. Labels (`PROFILE_LABELS` in `lib/enums.ts`):
Student; Modeler; Epidemiologist; Clinician; Public health practitioner;
Policy maker; Journalist or communicator; General public; Other. Experience:
None; Some; A lot. Goals: Learning; Exploring scenarios; Making decisions;
Communicating to others. Results: Plain-language summary; Tables and
numbers; Charts; All of them.

The disease field offers the database's display names as suggestions
(`<datalist>`) and stores the key when one matches, else the text; the
country field offers the names and stores the ISO3. Both show the name.

## 5. The memory

```sql
create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('role', 'situation', 'preference', 'decision', 'solution', 'other')),
  text text not null check (char_length(text) <= 200),
  source text not null check (source in ('agent', 'participant')),
  source_conversation_id uuid references conversations(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists memories_user_active_idx on memories (user_id, active, created_at);
```

Kinds, in the tab's words: Role, Situation, Preference, Decision they can
make, Solution they already use, Other. `MEMORY_KINDS` in `lib/enums.ts`.

Caps: 30 active memories per participant. When the assistant's `remember`
would exceed it, the oldest active memory with `source = 'agent'` is
deactivated first; when none remains, the call answers "MEMORY FULL" and the
model is told to ask the participant to tidy the list. The participant's
own adds are refused at the cap with a message in the tab.

## 6. Migration `web/supabase/migrations/0006_profile_memory.sql`

- `profiles` gains the columns of section 4 (`goals text[] not null default
  '{}'`, `memory_enabled boolean not null default true`, the rest nullable
  with the check constraints listed, `results_pref` and `report_format`
  defaulting as above).
- The `memories` table with row-level security and the service-role grants
  (the rule of 0001, as 0004 and 0005 do).
- `step_events_kind_check` re-created with `profile_completed`,
  `profile_updated`, `memory_added`, `memory_updated`, `memory_removed`,
  `memory_toggled` appended; `SERVER_EVENT_KINDS` gains the same six.
- Idempotent; applied twice in verification; `schema.test.ts` `TABLES`
  gains `memories`.

## 7. The participant gate

`ParticipantStatus` gains `"profile"` between `"consent"` and `"ok"`:
`participantStatus` returns it when the profile has `consented_at` for the
current version but no `profile_completed_at`. `redirectFor("profile")` is
`/profile`. `apiRefusal("profile")` is 403 `{ code: "profile_required",
message: "Please tell us about yourself before continuing." }`; the chat
treats it like `consent_required` and goes to `/profile`. `/profile` itself
requires `consent` to be done (status `profile` or `ok`); a participant with
status `ok` may open it too, to edit.

`ProfileStore` gains `profileFields(userId)`, `saveProfile(userId, fields,
now)` (sets `profile_completed_at` on first save), and the `Profile` type
carries every field. `lib/profile/schema.ts` holds the zod schema
(`ProfileInput`) shared by the page, the routes, and the tests.

## 8. The About block: `lib/profile/about.ts`

`aboutBlock(profile: ProfileFields, memories: Memory[]): string` returns,
for a complete profile:

```
About this participant (from their profile and your memory; pitch the detail and the framing by it; do not repeat it back; do not ask for what it already says):
- Role: policy maker · Experience with epidemic models: some · Wants: making decisions, communicating to others
- Interest: measles in Kenya · Decisions they can influence: vaccination campaigns
- Prefers: plain-language summary · Report format: PDF
- Remembered: Works at a county health office (situation) · Asked for results as tables last time (preference)
```

Lines with nothing to say are left out; the Remembered line lists active
memories, newest last, as "text (kind)". `firstUserMessage(dateIso, text,
about?)` becomes `Today's date: …\n\n${about}\n\n${text}` when `about` is
given; the stored message carries it (the study sees it); the turn's
`user_text` stays the typed text, so replays, titles, and shares show only
what the participant wrote. `handleChat` builds the block once per new
conversation from `profileFields` and the active memories (empty when
`memory_enabled` is false: profile lines only).

## 9. The `remember` tool

```ts
export const RememberInput = z.strictObject({
  kind: z.enum(MEMORY_KINDS),
  text: z.string().trim().min(3).max(200),
  replaces: z.uuid().optional(),   // a memory this one supersedes
});
```

Description: "Remember something about this participant for future
conversations: a role, their situation, a preference about how they like
results, a decision they can make, a solution they already use. One short
line, in the third person, without their name. Use it when they state such a
thing, not for facts about the disease or the scenario. Pass `replaces` to
update an earlier memory shown in the About block."

Behaviour (`lib/tools/remember.ts`): refused with "MEMORY OFF: this
participant switched memory off." when `memory_enabled` is false (the tool
is also left out of `tools` for that turn); at most 3 per turn (the fourth
answers "MEMORY LIMIT: three per turn."); `replaces` must be the
participant's own active memory or the call answers "MEMORY NOT FOUND";
inserts with `source = 'agent'` and the conversation id, deactivating the
replaced one; applies the cap (section 5); answers "Remembered: <text>"; the
payload `{ kind: "memory", memory_id, memory_kind, text, replaced: boolean }`
is a new `CardPayload`; the activity line says "Remembered: <text>"; the
step event is the usual `tool_called` plus `memory_added` with meta
`{ memory_id, kind, replaced }`.

`ToolDeps` gains `memory: { enabled: boolean; list(): Promise<Memory[]>;
add(kind, text, replaces?): Promise<{ id: string } | "full" | "not_found">; }`
built by `handleChat` from `MemoryStore`.

## 10. The prompt: `lib/chat/prompt.ts`

A "## The participant" section after "## About EpiChat":

- The first message may carry an About block. Use it; never repeat it or
  ask for what it states; never use a name.
- Experience none: explain every term the first time, lead with what the
  numbers mean for people, keep parameters out of the prose unless asked,
  use comparisons such as "one in ten". Some: the standard voice. A lot:
  name parameters, methods, and caveats in full, offer sensitivity runs.
- Goals: learning → teach as you go, one idea at a time; exploring → propose
  comparisons and what-ifs; making decisions → lead with implications and
  options, say what the model can and cannot tell them; communicating →
  give quotable one-sentence findings and name the figure that shows each.
- Results preference: summary → fewer numbers in prose; tables → a Markdown
  table for every comparison; charts → point to the panel's views; all →
  the standard.
- Report format: when offering the report, name the preferred format first.
- Memory: call `remember` as section 9 says; when the participant corrects
  something you remembered, call it with `replaces`.

The report (`composeReport`) takes `profile: { experience, goals,
results_pref } | null`; it changes nothing in the tables and figures, and
only the narrative instructions to the model (the `write_report` tool
description gains "Lead the summary with <goal framing>" built from the
goals) — the composition itself stays deterministic. `ReportDownloads`
orders the preferred format first.

## 11. The Profile tab

- `components/panel/PanelTabs.tsx`: two buttons, Details and Profile,
  `role="tablist"`, keyboard arrows, `aria-selected`; the active tab's
  content below. `DetailsPanel` keeps the sections; `ProfilePanel` is new.
- `components/panel/ProfilePanel.tsx`: three `Section`s. **Profile**: the
  fields as a form (selects, checkboxes for goals, the two suggestion
  inputs, the decisions line), Save and Cancel, "Changes reach the
  assistant from your next conversation." **Preferences**: results, report
  format, the memory switch ("Remember things about me across
  conversations"). **Memory**: the active memories newest first, each with
  its kind badge, "Added by the assistant on <date>" or "Added by you", Edit
  (text and kind in place) and Delete; an Add row; "Forget everything" with
  a confirmation; empty state "Nothing remembered yet. The assistant adds
  what you tell it about your role, your situation, and your preferences;
  you can add your own."
- The panel re-reads the memory list when a `memory` payload arrives in a
  finished turn and after every edit.
- The tab is available with no conversation open. Opening it reports
  `scenario_panel_opened` with section `profile` (`PANEL_SECTIONS` gains
  `profile`).
- Below xl the sheet shows the tabs the same way.

## 12. Routes

| Route | What |
|---|---|
| `GET /api/profile` | the participant's fields and preferences |
| `PATCH /api/profile` | partial update, zod-validated; `profile_updated` with meta of the changed field names |
| `GET /api/memories` | active memories, newest first |
| `POST /api/memories` `{ kind, text }` | add with `source = 'participant'`; `memory_added`; 409 `memory_full` at the cap |
| `PATCH /api/memories/[id]` `{ kind?, text? }` | edit the participant's own or the assistant's; `memory_updated` |
| `DELETE /api/memories/[id]` | deactivate; `memory_removed` |
| `DELETE /api/memories` | forget everything (deactivate all); `memory_removed` with meta `{ all: true, count }` |
| `PATCH /api/profile` with `{ memory_enabled }` | the switch; `memory_toggled` |
| `POST /api/profile/setup` | the questionnaire's save: the full required set; sets `profile_completed_at`; `profile_completed` |

All participant-only (status `ok`, or `profile` for the setup route),
owner-scoped by `user_id`, 404 for another participant's memory.

## 13. Consent

`content/consent.md`, under "What we collect", gains: "Your answers to the
profile questions and what the assistant remembers about you, which you can
see and edit." The version becomes the deploy date (`2026-10-10` or later,
set when the branch merges), so every participant reads it once.

## 14. Error handling

| Failure | Behaviour |
|---|---|
| Setup saved with a missing required field | the page marks it; the route answers 400 with the field |
| Setup when consent is missing | redirect to consent |
| A disease text that matches nothing | stored as typed, shown as typed |
| A country not in the list | refused by the page's suggestion input; the route answers 400 |
| `remember` with memory off, over the per-turn limit, at the cap, or with a bad `replaces` | the messages of section 9; never an error outcome |
| The memory list fails to load in the tab | "Memory could not be loaded." with Retry |
| A profile save fails | the form keeps the edits and shows "Could not save. Please try again." |
| A participant with an incomplete profile calls the chat | 403 `profile_required` → `/profile` |

## 15. Testing

- `tests/profile/schema.test.ts`: the zod schema's required and optional
  fields, limits, the pre-fill mapping.
- `tests/profile/about.test.ts`: the About block line by line, omissions,
  memory off, the thirty-memory list.
- `tests/chat/prompt.test.ts`: the section and its phrases; `firstUserMessage`
  with and without the block.
- `tests/tools/remember.test.ts`: off, limit, cap with agent-first eviction,
  replaces, payload, content.
- `tests/chat/handleChat.test.ts`: the block on the first message only; the
  tool withheld when memory is off; the `memory_added` event.
- `tests/db/profile.test.ts` (pglite): 0006 twice, the constraints, the
  cap query; `schema.test.ts` with `memories`.
- `tests/db/stores.test.ts`: the profile fields round trip and the memory
  store calls.
- `tests/api/profileRoute.test.ts`, `memoriesRoute.test.ts`, `setupRoute.test.ts`.
- `tests/lib/participant.test.ts`: the `profile` status and its redirect and
  refusal.
- `tests/app/profile.test.ts`: static pins for the page, the tabs, the
  panel, the chat's 403 handling.
- `tests/report/compose.test.ts`: unchanged tables with a profile given.
- `tests/app/deploy.test.ts`: DEPLOY.md pins.

## 16. Out of scope, recorded for later

- Memories scoped to a scenario or a conversation (the recap does that).
- Importing a profile from an institutional directory.
- Letting the assistant edit the profile fields themselves (it only adds
  memories; the participant owns the fields).
- A researcher view of profiles (sub-project 5).

## 17. Files

Create: `web/app/profile/page.tsx`, `web/components/ProfileSetup.tsx`,
`web/components/panel/{PanelTabs,ProfilePanel}.tsx`, `web/lib/profile/{schema,about}.ts`,
`web/lib/db/memories.ts`, `web/lib/tools/remember.ts`,
`web/app/api/profile/{route,setup/route}.ts`, `web/app/api/memories/{route,[id]/route}.ts`,
`web/supabase/migrations/0006_profile_memory.sql`, the tests.

Modify: `web/lib/enums.ts`, `web/lib/participant.ts`, `web/lib/participant.server.ts`,
`web/lib/profiles.ts`, `web/lib/chat/{prompt,handleChat}.ts`,
`web/lib/tools/{types,index}.ts`, `web/lib/client/{activity,toolLine,drafts,artifacts}.ts`,
`web/components/{Chat,Welcome}.tsx`, `web/components/panel/{DetailsPanel,ReportSection}.tsx`,
`web/lib/report/compose.ts`, `web/app/api/chat/route.ts`, `web/app/chat/{page,[id]/page}.tsx`,
`web/content/consent.md`, `web/docs/DEPLOY.md`, `web/next.config.ts`.

## 18. Deployment

1. Apply `0006_profile_memory.sql` in the Supabase SQL editor, twice, before
   the push.
2. Push main; every participant passes consent and the profile page once.
3. DEPLOY.md section 6g, "Profile verification": consent, the profile page
   with a missing required field refused, Save, the chat; the Profile tab's
   three groups, an edit, the memory switch; a conversation where the
   participant states a preference and the activity line reads
   "Remembered: …", the memory in the tab, Edit, Delete, Forget everything;
   a new conversation whose first stored message carries the About block
   (Table Editor: `select content from messages where conversation_id =
   '<id>' and seq = 1`); the step events `profile_completed`,
   `memory_added`, `memory_updated`, `memory_removed`.
