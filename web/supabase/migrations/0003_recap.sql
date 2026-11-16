-- 0003: the recap turn event (workspace spec, section 7). Safe to run twice.
-- A reply's decisions-so-far list, kept by the model and shown under the
-- conversation. Every other kind stays as 0001 defined it.
alter table turn_events drop constraint if exists turn_events_kind_check;
alter table turn_events add constraint turn_events_kind_check check (kind in (
  'text', 'thinking', 'tool_use', 'tool_result', 'web_search', 'web_fetch',
  'stage', 'suggestions', 'notice', 'recap'));
