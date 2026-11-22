-- First-use tutorial (spec 2026-11-21, tutorial design): when a participant first saw, or declined, the tutorial,
-- and the tutorial's five countable events. Apply after 0008 in the SQL editor, before deploying the web app that
-- reads the column (the preview deployment shares this database); safe to run twice.

alter table profiles add column if not exists tutorial_seen_at timestamptz;

-- The kinds of 0007_run_diagnostics.sql plus the tutorial's. Keep the list the same as STEP_EVENT_KINDS in web/lib/enums.ts.
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
  'diagnostic_shown', 'option_chosen',
  'tutorial_started', 'tutorial_step', 'tutorial_finished', 'tutorial_ended', 'tutorial_offer_declined'
));
