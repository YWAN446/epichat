-- Profile and memory (sub-project 4d): the questionnaire's columns on
-- profiles, the memories table, and six step-event kinds. Apply after 0005 in
-- the SQL editor; safe to run twice.

alter table profiles add column if not exists role text check (role in (
  'student', 'modeler', 'epidemiologist', 'clinician', 'public_health_practitioner', 'policy_maker', 'communicator', 'general_public', 'other'));
alter table profiles add column if not exists experience text check (experience in ('none', 'some', 'a_lot'));
alter table profiles add column if not exists goals text[] not null default '{}';
alter table profiles add column if not exists disease_interest text check (char_length(disease_interest) <= 60);
alter table profiles add column if not exists country_interest text check (char_length(country_interest) = 3);
alter table profiles add column if not exists decisions text check (char_length(decisions) <= 200);
alter table profiles add column if not exists results_pref text not null default 'all' check (results_pref in ('summary', 'tables', 'charts', 'all'));
alter table profiles add column if not exists report_format text not null default 'pdf' check (report_format in ('md', 'html', 'docx', 'pdf'));
alter table profiles add column if not exists memory_enabled boolean not null default true;
alter table profiles add column if not exists profile_completed_at timestamptz;
alter table profiles add column if not exists profile_updated_at timestamptz;

-- What the assistant (or the participant) remembers across conversations.
-- Rows are deactivated, never deleted; the study keeps them.
create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('role', 'situation', 'preference', 'decision', 'solution', 'other')),
  text text not null check (char_length(text) between 1 and 200),
  source text not null check (source in ('agent', 'participant')),
  source_conversation_id uuid references conversations(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists memories_user_active_idx on memories (user_id, active, created_at);

-- The same rule as 0001: row-level security on, the browser roles get nothing,
-- the server role gets what the store needs.
alter table memories enable row level security;
do $$
declare
  browser_role text;
begin
  foreach browser_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = browser_role) then
      execute format('revoke all on memories from %I', browser_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on memories to service_role;
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
  'share_created', 'share_updated', 'share_revoked', 'share_opened',
  'profile_completed', 'profile_updated', 'memory_added', 'memory_updated', 'memory_removed', 'memory_toggled'
));
