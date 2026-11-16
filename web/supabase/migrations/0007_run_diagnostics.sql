-- Sim parameters, phase 4: every run row keeps its diagnostics (spec
-- 2026-10-09, sections 10 and 11), and two step-event kinds record which
-- diagnostics were shown and which options were taken. Apply after 0006 in
-- the SQL editor; safe to run twice. finish_turn is unchanged.

alter table runs add column if not exists diagnostics jsonb not null default '[]'::jsonb;

alter table step_events drop constraint if exists step_events_kind_check;
alter table step_events add constraint step_events_kind_check check (kind in (
  'conversation_started', 'turn', 'stage_reached', 'tool_called', 'tool_failed',
  'run_completed', 'run_failed', 'refusal', 'new_scenario', 'consent_given',
  'consent_declined', 'web_search', 'web_fetch',
  'session_start', 'session_end', 'conversation_opened', 'conversation_resumed',
  'suggestion_used', 'card_expanded', 'chart_view_changed', 'series_downloaded',
  'export', 'feedback_given', 'scenario_panel_opened',
  'share_created', 'share_updated', 'share_revoked', 'share_opened',
  'profile_completed', 'profile_updated', 'memory_added', 'memory_updated', 'memory_removed', 'memory_toggled',
  'diagnostic_shown', 'option_chosen'
));
