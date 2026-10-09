# Share Link Design (sub-project 4e)

Date: 2026-10-09. Parent specs: `2026-10-07-web-agent-architecture-design.md`
(the architecture), `2026-10-08-workspace-design.md` (the workspace),
`2026-10-09-report-design.md` (the report, whose HTML renderer this reuses).
This spec is the authority for sharing; the parents win for everything else.

## 1. Purpose

A participant presses Share and gets a link. Anyone with the link sees the
conversation as it was at that moment: the turns, the activity lines, the run
summaries and charts, the details panel, and the report when one exists.
Later turns, deletions, or new report versions never change what the link
shows. The participant can update the snapshot or stop sharing. The study
learns when links are created, updated, revoked, and opened.

## 2. Decisions made on 2026-10-09

- **A frozen snapshot, not a live view** (owner's decision). The link shows
  a copy taken at share time.
- **Anyone with the link**, signed in or not. No index by search engines.
- **Revocable** from the conversation; a deleted conversation revokes its
  share.
- **One link per conversation.** Updating the snapshot keeps the link;
  stopping sharing retires it. Sharing again after stopping makes a new link.
- **No email, name, user id, or session id** in the snapshot or on the page.
  The title is the conversation's title (the first message, cut to 60
  characters), which the participant wrote.
- **The report travels with the share**: the latest report at share time,
  rendered by the report's HTML renderer at its own address under the link.
- **Thinking stays out**, as in the replay.
- **Consent text gains one sentence and the consent version is bumped**, so
  every participant sees the new text once (owner's answer read as "yes,
  bump"; flip in section 13 if that was not the intent).
- **A frozen copy in a `shares` table** (approach 1 of the brainstorm): the
  public page reads nothing but the snapshot row.

## 3. The flow

1. In a conversation with at least one finished turn, Share in the header
   opens a dialog. The first time: "Create link". The server takes the
   snapshot and answers the link; the dialog shows it with Copy and the
   sentence "Anyone with the link can read this conversation as it is now.
   Your email is not shown."
2. On later presses the dialog shows the link, "Snapshot taken <date>, N
   turns", Update snapshot, and Stop sharing. Update takes a new snapshot
   under the same link. Stop sharing revokes it; the link answers the
   unavailable page from then on.
3. A visitor opens `/s/<token>`: the brand, the title, "A frozen copy of an
   EpiChat conversation, shared by a study participant on <date>", the turns
   in the middle, the details panel on the right, View report when the
   snapshot has one. Nothing to type, press, or sign in to.
4. Deleting the conversation from the sidebar revokes its share in the same
   request.

## 4. The snapshot: `lib/share/snapshot.ts`

```ts
export type ShareSnapshot = {
  version: 1;
  title: string;
  takenAt: string;                         // ISO 8601
  turns: ShareTurn[];                      // finished turns, oldest first
  report: ReportDocument | null;           // the latest report at share time
};
export type ShareTurn = { id: string; userText: string; blocks: Block[]; notice: string | null };
```

`buildSnapshot(input: { title: string; replay: ReplayTurn[]; series: Map<string, Series>; report: ReportDocument | null }, now: Date): ShareSnapshot`
is pure:

- `replay` is `TurnStore.listForReplay(conversationId)`: finished turns with
  thinking already left out. `notice` is `CUT_OFF_NOTICE` for a turn whose
  stop was `max_tokens`, as `/chat/[id]` does.
- Every successful `run_simulation` result block gets its run's series
  embedded (`payload.series`), looked up by `run_id` in `series`, thinned
  with `thinPoints` to at most 400 points per key when the run is longer. A
  run whose series is missing keeps `series` absent; the chart shows
  "Series unavailable." as it does today.
- `report` is copied as is.
- Nothing else is added. The blocks carry no email or ids beyond turn and
  run ids.

`snapshotSize(snapshot): number` (the JSON length) guards the 2 MB limit:
when exceeded, the builder thins every series to 200 points and, if still
over, drops the series and keeps the stats.

## 5. Storage

### 5.1 Migration `web/supabase/migrations/0005_shares.sql`

```sql
create table if not exists shares (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null,
  title text not null,
  snapshot jsonb not null,
  turn_count int not null,
  taken_at timestamptz not null default now(),
  revoked_at timestamptz,
  view_count int not null default 0,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists shares_conversation_idx on shares (conversation_id);
alter table shares enable row level security;
-- then the same do-block as 0004: revoke all from anon/authenticated, grant select, insert, update, delete to service_role

alter table step_events drop constraint if exists step_events_kind_check;
alter table step_events add constraint step_events_kind_check check (kind in (
  'conversation_started', 'turn', 'stage_reached', 'tool_called', 'tool_failed',
  'run_completed', 'run_failed', 'refusal', 'new_scenario', 'consent_given',
  'consent_declined', 'web_search', 'web_fetch',
  'session_start', 'session_end', 'conversation_opened', 'conversation_resumed',
  'suggestion_used', 'card_expanded', 'chart_view_changed', 'series_downloaded',
  'export', 'feedback_given', 'scenario_panel_opened',
  'share_created', 'share_updated', 'share_revoked', 'share_opened'
));

create or replace function record_share_view(p_token text) returns uuid
language sql security definer set search_path = public as $$
  update shares set view_count = view_count + 1, last_viewed_at = now()
  where token = p_token and revoked_at is null
  returning id;
$$;
-- then the same privilege block as finish_turn: revoke from public and the browser roles, grant to service_role
```

`record_share_view(p_token)` increments `view_count`, sets `last_viewed_at`,
and returns the share's id when the token exists and is not revoked, else
null (an update that matches no row returns nothing). The page calls it
once per open.

One active share per conversation: a partial unique index
`create unique index if not exists shares_active_conversation_idx on shares (conversation_id) where revoked_at is null;`.

Idempotent; run twice in verification; `tests/db/schema.test.ts`'s `TABLES`
gains `shares`.

### 5.2 Store: `lib/db/shares.ts`

```ts
export type ShareRow = { id: string; token: string; conversation_id: string; user_id: string; title: string; snapshot: ShareSnapshot; turn_count: number; taken_at: string; revoked_at: string | null; view_count: number };
export interface ShareStore {
  /** The conversation's active share, or null. */
  active(conversationId: string, userId: string): Promise<ShareRow | null>;
  /** Insert a new share with a fresh token; returns the row. */
  create(share: { conversationId: string; userId: string; title: string; snapshot: ShareSnapshot; turnCount: number; token: string }): Promise<ShareRow>;
  /** Replace the active share's snapshot, title, turn count, and taken_at; same token. */
  update(id: string, share: { title: string; snapshot: ShareSnapshot; turnCount: number }, now: Date): Promise<void>;
  /** Set revoked_at on the conversation's active share; false when there was none. */
  revoke(conversationId: string, userId: string, now: Date): Promise<boolean>;
  /** The public read: the active share by token, or null. */
  byToken(token: string): Promise<ShareRow | null>;
  /** Count a view (record_share_view); the share id, or null when revoked or unknown. */
  view(token: string): Promise<string | null>;
}
```

`lib/share/token.ts`: `newToken(): string` is 16 bytes from
`crypto.getRandomValues` (or `randomBytes`), base64url, 22 characters;
`isToken(s)` is `/^[A-Za-z0-9_-]{22}$/`.

## 6. Routes

| Route | Who | What |
|---|---|---|
| `POST /api/shares` `{ conversationId }` | participant, owner | create the share when none is active, else update its snapshot. Answers `{ token, url, takenAt, turnCount, created: boolean }`. 400 `nothing_to_share` when the conversation has no finished turn; 404 when the conversation is not the participant's. Logs `share_created` or `share_updated` with meta `{ share_id, turn_count, has_report }`. |
| `DELETE /api/shares` `{ conversationId }` | participant, owner | revoke; 204; 404 when none is active. Logs `share_revoked`. |
| `GET /s/[token]` | anyone | the public page (section 7). Unknown, malformed, or revoked token: the unavailable page, status 404. Calls `view(token)` and logs `share_opened` against the owner with meta `{ share_id }` and no session. |
| `GET /s/[token]/report` | anyone | the report's HTML (`renderHtml(snapshot.report)`), inline, `text/html`; 404 when the snapshot has no report or the share is gone. Counts no view. |

`DELETE /api/conversations/[id]` revokes the active share before the soft
delete (same request, best effort: a share revoke failure is logged and the
delete proceeds).

`url` is `${origin}/s/${token}` with the request's origin.

Headers on `/s/*` (`next.config.ts` `headers()`): `X-Robots-Tag: noindex,
nofollow`, `Cache-Control: no-store`; the page's metadata sets `robots:
{ index: false, follow: false }`. The pages run on the Node runtime with
`dynamic = "force-dynamic"` and read with the admin client; the proxy's
`PROTECTED_PREFIXES` already leave `/s` public.

## 7. The public page: `app/s/[token]/page.tsx`

Server component. Reads `byToken`; on null renders `SharedUnavailable`
("This shared conversation is no longer available.", status 404 via
`notFound()` with a `not-found.tsx` under `app/s/[token]/`). Otherwise
renders `SharedConversation` (client component) with the snapshot and the
token:

- Header: the brand (not a link to `/chat`), the title, and the line "A
  frozen copy of an EpiChat conversation, shared by a study participant on
  <date>". No New, no Details toggle, no Sign out.
- Middle: the turns with the existing `Turn` component, `feedback={null}`
  (no thumbs), no suggestions, no stage strip, no recap, no composer. The
  run summaries draw from the embedded series.
- Right: the panel sections composed directly, not through `DetailsPanel`
  (which owns the open-state events): `ScenarioSection` with
  `references={false}` (a new prop that hides the sources buttons, since the
  references route is participant-only), `DataSection`, `RunsSection` with a
  no-op `onChartView`, `ActivitySection`, and a "Report" section that shows
  the report's title and version with "View report" opening
  `/s/<token>/report` in a new tab, or "No report was written." Sections
  use the existing `Section` component; Scenario and Runs open, the rest
  closed, no events.
- Below xl the panel stacks under the turns (no drawer, no sheet): a
  single-column page.
- Footer: "EpiChat is a research prototype from Emory University." No
  sign-in link: the study is invite-only.

The artifacts come from `deriveArtifacts(snapshot.turns)`, unchanged.

## 8. The dialog: `components/ShareDialog.tsx`

Opened from a Share button in `ChatHeader` (between New and Details), shown
only when `conversationId` is set and disabled while a reply streams. The
dialog is a `<dialog>` element with `showModal()`, closed by Escape, a Close
button, or a press on the backdrop; focus moves into it on open and back to
the Share button on close (the overlays' missing focus management is a
known minor; the dialog element handles it natively).

States, from `GET`-free design: the dialog learns the share's state from the
`POST`/`DELETE` answers and from `initialShare` passed by the page
(`active(conversationId, userId)` read in `/chat/[id]`'s server component as
`{ token, takenAt, turnCount } | null`).

- None: the sentence, "Create link".
- Active: the link in a read-only input, Copy (uses `navigator.clipboard`
  with a visible "Copied" confirmation; falls back to selecting the text),
  "Snapshot taken <date> · N turns", "Update snapshot", "Stop sharing".
- Busy: buttons disabled while a request is in flight; errors shown in the
  dialog ("Nothing to share yet." for 400, "Something went wrong. Please try
  again." otherwise).

Pressing Create or Update calls `POST /api/shares`; Stop calls `DELETE`.
`Chat.tsx` keeps `share` state and passes it down; a new conversation
(`resetConversation`) clears it.

## 9. Events

- Server kinds (`SERVER_EVENT_KINDS`): `share_created`, `share_updated`,
  `share_revoked` (meta `{ share_id, turn_count, has_report }`),
  `share_opened` (meta `{ share_id }`, `session_id` null, `conversation_id`
  the shared conversation, `user_id` the owner).
- `lib/stepEvents.ts`'s sink is reused by the share routes and the public
  page (the public page logs with the admin client; it has no participant).
- No client event: the dialog's presses are the routes' events.

## 10. Consent

`content/consent.md`, under "What we collect", gains: "You can share a
conversation with anyone by creating a link; the link shows a copy of the
conversation taken at that moment, without your email, and we count how
often it is opened." The front matter version becomes `2026-10-09`, so
every participant is shown the text once more (section 2).

## 11. Error handling

| Failure | Behaviour |
|---|---|
| Share with no finished turn | 400 `nothing_to_share`; the dialog says "Nothing to share yet." |
| Share a conversation that is not the participant's, or is deleted | 404 |
| Snapshot over 2 MB | series thinned, then dropped (section 4); never refused |
| `shares` insert or update fails | 500, the dialog's generic message; nothing logged as created |
| Token malformed | the unavailable page, no database read |
| Token unknown or revoked | the unavailable page, 404 |
| `record_share_view` fails | the page still renders; the failure is logged |
| Report route on a share without a report | 404 |
| Conversation delete when the share revoke fails | the delete proceeds; the revoke failure is logged |

## 12. Testing

- `tests/share/snapshot.test.ts`: thinking excluded, series embedded and
  thinned, missing series kept absent, report copied, size guard (thin,
  then drop), no email or user id anywhere in the JSON.
- `tests/share/token.test.ts`: length, alphabet, uniqueness over 1,000
  draws, `isToken`.
- `tests/db/finishTurn.test.ts` or a new `tests/db/shares.test.ts`
  (pglite): 0005 twice; the partial unique index refuses a second active
  share; `record_share_view` increments and returns null when revoked;
  `schema.test.ts` with `shares` in `TABLES`.
- `tests/db/stores.test.ts`: the share store's calls through `fakeAdmin`.
- `tests/api/sharesRoute.test.ts`: create, update, revoke, the owner
  check, 400 without turns, the events logged.
- `tests/api/conversationsRoute.test.ts`: delete revokes the share.
- `tests/app/share.test.ts` (static pins): the dialog's three states and
  copy, the public page's composition (no composer, no thumbs, no sign-in
  link, `references={false}`, the report link), `next.config.ts` headers,
  `not-found.tsx`.
- `tests/lib/clientEvents.test.ts` unchanged; `tests/db/finishTurn.test.ts`
  accepts the new step-event kinds.
- `tests/app/deploy.test.ts`: DEPLOY.md mentions `0005_shares.sql`,
  `/api/shares`, `/s/`, "Share verification", and the consent version.

## 13. Out of scope, recorded for later

- Sharing a single report rather than a conversation.
- Password-protected or expiring links.
- A "Try EpiChat" call to action on the public page (the study is
  invite-only).
- Keeping the consent version unchanged (flip section 2 and section 10 if
  the owner prefers a text-only change).

## 14. Files

Create: `web/lib/share/{snapshot,token}.ts`, `web/lib/db/shares.ts`,
`web/app/api/shares/route.ts`, `web/app/s/[token]/{page,not-found}.tsx`,
`web/app/s/[token]/report/route.ts`, `web/components/{ShareDialog,SharedConversation}.tsx`,
`web/supabase/migrations/0005_shares.sql`, the tests above.

Modify: `web/lib/enums.ts`, `web/lib/stepEvents.ts` (if its kinds are
typed from the enum, nothing), `web/components/{ChatHeader,Chat}.tsx`,
`web/components/panel/ScenarioSection.tsx` (`references` prop),
`web/app/chat/[id]/page.tsx` (`initialShare`),
`web/app/api/conversations/[id]/route.ts`, `web/next.config.ts`,
`web/content/consent.md`, `web/docs/DEPLOY.md`.

## 15. Deployment

1. Apply `0005_shares.sql` in the Supabase SQL editor, twice, before the
   push: the new step-event kinds and the function must exist when the code
   deploys.
2. Push main.
3. DEPLOY.md section 6f, "Share verification": share a conversation, copy
   the link, open it in a private window (no sign-in, the turns, the charts,
   the panel, View report), check the robots and cache headers in the
   network tab, update the snapshot after a new turn, stop sharing and see
   the unavailable page, delete a shared conversation and see its link die;
   Table Editor: the share row's `view_count`, and
   `select kind, meta from step_events where kind like 'share_%'`.
4. Every participant sees the updated consent text on their next visit.
