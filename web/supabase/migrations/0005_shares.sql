-- Shares (sub-project 4e): a frozen copy of a conversation behind a random
-- token, the four share step events, and a view counter. Apply after 0004 in
-- the SQL editor; safe to run twice.

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
-- One active share per conversation; revoking frees the slot.
create unique index if not exists shares_active_conversation_idx on shares (conversation_id) where revoked_at is null;

-- The same rule as 0001: row-level security on, the browser roles get nothing,
-- the server role gets what the store needs.
alter table shares enable row level security;
do $$
declare
  browser_role text;
begin
  foreach browser_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = browser_role) then
      execute format('revoke all on shares from %I', browser_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on shares to service_role;
  end if;
end;
$$;

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

-- Count an open of a live share; null when the token is unknown or revoked.
create or replace function record_share_view(p_token text) returns uuid
language sql security definer set search_path = public as $$
  update shares set view_count = view_count + 1, last_viewed_at = now()
  where token = p_token and revoked_at is null
  returning id;
$$;

revoke execute on function record_share_view(text) from public;
do $$
declare
  browser_role text;
begin
  foreach browser_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = browser_role) then
      execute format('revoke execute on function record_share_view(text) from %I', browser_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function record_share_view(text) to service_role;
  end if;
end;
$$;
