-- EpiChat web app schema. Apply once in the Supabase SQL editor; safe to run twice.
-- No policies are created: with row-level security on and no policies, the
-- publishable key can read nothing. Only the secret key (server) has access.

-- Participants. consented_at null = not yet asked. A consent_version older than
-- content/consent.md's version re-prompts. Declining writes no row here.
create table if not exists profiles (
  user_id uuid primary key,
  email text not null,
  participant_type text check (participant_type in (
    'graduate_student', 'faculty_or_researcher', 'public_health_practitioner', 'other')),
  consent_version text,
  consented_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- One browser visit. The client pings last_active_at and closes it on unload.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  started_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  ended_at timestamptz,
  user_agent text,
  viewport text,
  language text,
  timezone text
);
create index if not exists sessions_user_idx on sessions (user_id, started_at);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default '',
  active_scenario_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A participant's "delete" hides the conversation; the study keeps it.
  deleted_at timestamptz
);
create index if not exists conversations_user_idx on conversations (user_id, updated_at desc);

-- The exact Anthropic message list, append-only.
create table if not exists messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  seq int not null,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq)
);

create table if not exists turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  session_id uuid,
  seq int not null,
  user_text text not null,
  started_at timestamptz not null default now(),
  first_token_at timestamptz,
  finished_at timestamptz,
  stop text not null check (stop in (
    'end_turn', 'max_tokens', 'refusal', 'tool_limit', 'empty', 'paused', 'error', 'aborted')),
  refusal_category text,
  model text,
  effort text,
  -- One entry per model call: tokens by kind, stop reason, latency.
  api_calls jsonb not null default '[]',
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_usd numeric(12,6) not null default 0,
  stage_before text,
  stage_after text,
  unique (conversation_id, seq)
);

-- The display stream of a turn, in order, with timestamps. Replaying it
-- rebuilds the conversation on screen, cards included.
create table if not exists turn_events (
  id bigint generated always as identity primary key,
  turn_id uuid not null references turns(id) on delete cascade,
  seq int not null,
  at timestamptz not null default now(),
  kind text not null check (kind in (
    'text', 'thinking', 'tool_use', 'tool_result', 'web_search', 'web_fetch',
    'stage', 'suggestions', 'notice')),
  payload jsonb not null default '{}',
  unique (turn_id, seq)
);

-- The deterministic simulation state; replaces the in-memory agent state.
create table if not exists scenarios (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  seq int not null,
  params jsonb,
  disease text,
  country_iso3 text,
  total_population bigint,
  data_sources jsonb not null default '[]',
  web_sources jsonb not null default '[]',
  stage text check (stage in ('understand', 'configure', 'ground', 'run', 'interpret')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, seq)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_active_scenario_fk') then
    alter table conversations
      add constraint conversations_active_scenario_fk
      foreign key (active_scenario_id) references scenarios(id) on delete set null;
  end if;
end;
$$;

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid references scenarios(id) on delete set null,
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid not null,
  turn_id uuid,
  params jsonb not null,
  effective_params jsonb,
  pop_scale numeric,
  stats jsonb,
  stats_agents jsonb,
  series jsonb,
  warnings jsonb not null default '[]',
  data_sources jsonb not null default '[]',
  repairs jsonb not null default '[]',
  duration_ms int,
  sim_cold_start boolean,
  error jsonb,
  created_at timestamptz not null default now()
);
create index if not exists runs_user_idx on runs (user_id, created_at);

-- Thumbs on an assistant reply, with an optional comment. One row per press.
create table if not exists feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  conversation_id uuid not null references conversations(id) on delete cascade,
  turn_id uuid not null references turns(id) on delete cascade,
  rating text not null check (rating in ('up', 'down')),
  comment text,
  created_at timestamptz not null default now()
);

-- The structured event log for funnels and counts. meta holds fixed words and
-- numbers; free text lives in messages and feedback. Keep the kind list the
-- same as STEP_EVENT_KINDS in web/lib/enums.ts.
create table if not exists step_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  session_id uuid,
  conversation_id uuid,
  turn_id uuid,
  at timestamptz not null default now(),
  kind text not null,
  stage text,
  tool text,
  meta jsonb not null default '{}'
);
alter table step_events drop constraint if exists step_events_kind_check;
alter table step_events add constraint step_events_kind_check check (kind in (
  'conversation_started', 'turn', 'stage_reached', 'tool_called', 'tool_failed',
  'run_completed', 'run_failed', 'refusal', 'new_scenario', 'consent_given',
  'consent_declined', 'web_search', 'web_fetch',
  'session_start', 'session_end', 'conversation_opened', 'conversation_resumed',
  'suggestion_used', 'card_expanded', 'chart_view_changed', 'series_downloaded',
  'export', 'feedback_given', 'scenario_panel_opened'
));
create index if not exists step_events_user_at_idx on step_events (user_id, at);
create index if not exists step_events_conversation_idx on step_events (conversation_id);
create index if not exists step_events_kind_at_idx on step_events (kind, at);

-- Turns, tokens, and cost per user per day (from CampusOtter).
create table if not exists usage_daily (
  user_id uuid not null,
  day date not null,
  turns int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(12,6) not null default 0,
  primary key (user_id, day)
);

alter table profiles enable row level security;
alter table sessions enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table turns enable row level security;
alter table turn_events enable row level security;
alter table scenarios enable row level security;
alter table runs enable row level security;
alter table feedback enable row level security;
alter table step_events enable row level security;
alter table usage_daily enable row level security;

-- Add a finished turn's tokens and cost to the user's row for the day.
create or replace function record_usage(
  p_user uuid, p_day date, p_turns int, p_input bigint, p_output bigint, p_cost numeric
) returns void language sql as $$
  insert into usage_daily (user_id, day, turns, input_tokens, output_tokens, cost_usd)
  values (p_user, p_day, p_turns, p_input, p_output, p_cost)
  on conflict (user_id, day) do update set
    turns = usage_daily.turns + excluded.turns,
    input_tokens = usage_daily.input_tokens + excluded.input_tokens,
    output_tokens = usage_daily.output_tokens + excluded.output_tokens,
    cost_usd = usage_daily.cost_usd + excluded.cost_usd;
$$;

-- Count one turn unless a cap is already reached. Checking and counting happen
-- in one statement, so parallel requests cannot each slip under the daily
-- limit. Returns 'ok', 'monthly_budget', or 'daily_turns'.
create or replace function reserve_turn(
  p_user uuid, p_day date, p_month_start date, p_daily_limit int, p_monthly_budget numeric
) returns text language plpgsql as $$
declare
  spent numeric;
  reserved int;
begin
  select coalesce(sum(u.cost_usd), 0) into spent
  from usage_daily u
  where u.day >= p_month_start;
  if spent >= p_monthly_budget then
    return 'monthly_budget';
  end if;
  if p_daily_limit <= 0 then
    return 'daily_turns';
  end if;

  insert into usage_daily as u (user_id, day, turns)
  values (p_user, p_day, 1)
  on conflict (user_id, day) do update set turns = u.turns + 1
    where u.turns < p_daily_limit
  returning u.turns into reserved;

  if reserved is null then
    return 'daily_turns';
  end if;
  return 'ok';
end;
$$;

-- Privileges. New Supabase projects grant nothing on new public tables by
-- default, so the server's role is granted what it needs here. The browser
-- roles get nothing, and the functions are not callable by them.
revoke execute on function record_usage(uuid, date, int, bigint, bigint, numeric) from public;
revoke execute on function reserve_turn(uuid, date, date, int, numeric) from public;

do $$
declare
  browser_role text;
  tables text := 'profiles, sessions, conversations, messages, turns, turn_events, scenarios, runs, feedback, step_events, usage_daily';
begin
  foreach browser_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = browser_role) then
      execute format('revoke all on %s from %I', tables, browser_role);
      execute format('revoke execute on function record_usage(uuid, date, int, bigint, bigint, numeric) from %I', browser_role);
      execute format('revoke execute on function reserve_turn(uuid, date, date, int, numeric) from %I', browser_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    execute format('grant select, insert, update, delete on %s to service_role', tables);
    grant usage, select on all sequences in schema public to service_role;
    grant execute on function record_usage(uuid, date, int, bigint, bigint, numeric) to service_role;
    grant execute on function reserve_turn(uuid, date, date, int, numeric) to service_role;
  end if;
end;
$$;
