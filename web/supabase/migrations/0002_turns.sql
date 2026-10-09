-- Agent core: the scenario columns a resumed turn needs, and the one function
-- that writes a finished turn. Apply after 0001 in the SQL editor; safe to run twice.

alter table scenarios add column if not exists has_run boolean not null default false;
alter table scenarios add column if not exists stage_reached text
  check (stage_reached in ('understand', 'configure', 'ground', 'run', 'interpret'));

-- Write one turn atomically: the turns row, its events, the appended messages
-- (only when the turn finished), the scenario (updated by id, or inserted with
-- its seq), this turn's runs' scenario pointer, the conversation's pointer,
-- time, and title, and the step events. Any failure rolls everything back and
-- the route answers service_unavailable. Returns the scenario id.
--
-- p: { user_id, conversation_id, title,
--      turn: { id, session_id, user_text, started_at, first_token_at, finished_at,
--              stop, refusal_category, model, effort, api_calls, input_tokens,
--              output_tokens, cache_read_tokens, cache_write_tokens, cost_usd,
--              stage_before, stage_after },
--      events: [ { seq, at, kind, ...payload } ],
--      messages: [ { role, content } ] | null,
--      scenario: { id, seq, params, disease, country_iso3, total_population,
--                  data_sources, web_sources, stage, stage_reached, has_run },
--      step_events: [ { kind, session_id, stage, tool, meta } ] }
create or replace function finish_turn(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := (p->>'user_id')::uuid;
  v_conversation uuid := (p->>'conversation_id')::uuid;
  t jsonb := p->'turn';
  v_turn uuid := (t->>'id')::uuid;
  s jsonb := p->'scenario';
  v_scenario uuid;
  v_seq int;
  item jsonb;
begin
  select coalesce(max(seq), 0) + 1 into v_seq from turns where conversation_id = v_conversation;
  insert into turns (id, conversation_id, session_id, seq, user_text, started_at, first_token_at, finished_at,
    stop, refusal_category, model, effort, api_calls, input_tokens, output_tokens, cache_read_tokens,
    cache_write_tokens, cost_usd, stage_before, stage_after)
  values (v_turn, v_conversation, (t->>'session_id')::uuid, v_seq, coalesce(t->>'user_text', ''),
    coalesce((t->>'started_at')::timestamptz, now()), (t->>'first_token_at')::timestamptz,
    coalesce((t->>'finished_at')::timestamptz, now()), t->>'stop', t->>'refusal_category', t->>'model', t->>'effort',
    coalesce(t->'api_calls', '[]'::jsonb), coalesce((t->>'input_tokens')::bigint, 0), coalesce((t->>'output_tokens')::bigint, 0),
    coalesce((t->>'cache_read_tokens')::bigint, 0), coalesce((t->>'cache_write_tokens')::bigint, 0),
    coalesce((t->>'cost_usd')::numeric, 0), t->>'stage_before', t->>'stage_after');

  for item in select * from jsonb_array_elements(coalesce(p->'events', '[]'::jsonb)) loop
    insert into turn_events (turn_id, seq, at, kind, payload)
    values (v_turn, (item->>'seq')::int, coalesce((item->>'at')::timestamptz, now()), item->>'kind', item - 'seq' - 'at' - 'kind');
  end loop;

  if jsonb_typeof(p->'messages') = 'array' then
    select coalesce(max(seq), 0) into v_seq from messages where conversation_id = v_conversation;
    for item in select * from jsonb_array_elements(p->'messages') loop
      v_seq := v_seq + 1;
      insert into messages (conversation_id, seq, role, content) values (v_conversation, v_seq, item->>'role', item->'content');
    end loop;
  end if;

  if jsonb_typeof(s) = 'object' then
    if s->>'id' is not null then
      v_scenario := (s->>'id')::uuid;
      update scenarios set
        params = nullif(s->'params', 'null'::jsonb), disease = s->>'disease', country_iso3 = s->>'country_iso3',
        total_population = round((s->>'total_population')::numeric)::bigint,
        data_sources = coalesce(s->'data_sources', '[]'::jsonb), web_sources = coalesce(s->'web_sources', '[]'::jsonb),
        stage = s->>'stage', stage_reached = s->>'stage_reached', has_run = coalesce((s->>'has_run')::boolean, false),
        updated_at = now()
      where id = v_scenario and conversation_id = v_conversation;
      if not found then
        raise exception 'scenario % is not in conversation %', v_scenario, v_conversation;
      end if;
    else
      insert into scenarios (conversation_id, seq, params, disease, country_iso3, total_population, data_sources, web_sources,
        stage, stage_reached, has_run)
      values (v_conversation,
        coalesce((s->>'seq')::int, (select coalesce(max(seq), 0) + 1 from scenarios where conversation_id = v_conversation)),
        nullif(s->'params', 'null'::jsonb), s->>'disease', s->>'country_iso3', round((s->>'total_population')::numeric)::bigint,
        coalesce(s->'data_sources', '[]'::jsonb), coalesce(s->'web_sources', '[]'::jsonb),
        s->>'stage', s->>'stage_reached', coalesce((s->>'has_run')::boolean, false))
      returning id into v_scenario;
    end if;
    update runs set scenario_id = v_scenario where turn_id = v_turn and scenario_id is null;
    update conversations set active_scenario_id = v_scenario, updated_at = now(),
      title = case when title = '' then coalesce(p->>'title', '') else title end
    where id = v_conversation;
  else
    update conversations set updated_at = now(),
      title = case when title = '' then coalesce(p->>'title', '') else title end
    where id = v_conversation;
  end if;

  for item in select * from jsonb_array_elements(coalesce(p->'step_events', '[]'::jsonb)) loop
    insert into step_events (user_id, session_id, conversation_id, turn_id, kind, stage, tool, meta)
    values (v_user, (item->>'session_id')::uuid, v_conversation, v_turn, item->>'kind', item->>'stage', item->>'tool',
      coalesce(item->'meta', '{}'::jsonb));
  end loop;

  return v_scenario;
end;
$$;

-- The same privileges as 0001's functions: the server role only.
revoke execute on function finish_turn(jsonb) from public;
do $$
declare
  browser_role text;
begin
  foreach browser_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = browser_role) then
      execute format('revoke execute on function finish_turn(jsonb) from %I', browser_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function finish_turn(jsonb) to service_role;
  end if;
end;
$$;
