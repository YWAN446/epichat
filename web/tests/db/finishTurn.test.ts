import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "./helpers";

const ALICE = "11111111-1111-1111-1111-111111111111";
const TURN_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const TURN_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const SESSION = "44444444-4444-4444-8444-444444444444";

let db: PGlite;
let conversation: string;

beforeEach(async () => {
  db = await createTestDb();
  const { rows } = await db.query<{ id: string }>("insert into conversations (user_id) values ($1) returning id", [ALICE]);
  conversation = rows[0].id;
});

function payload(over: Record<string, unknown> = {}) {
  return {
    user_id: ALICE,
    conversation_id: conversation,
    title: "Measles in Kenya",
    turn: {
      id: TURN_1, session_id: SESSION, user_text: "Model measles in Kenya", started_at: "2026-10-08T15:00:00Z", first_token_at: "2026-10-08T15:00:02Z",
      finished_at: "2026-10-08T15:00:09Z", stop: "end_turn", refusal_category: null, model: "claude-opus-5-5", effort: "medium",
      api_calls: [{ model: "claude-opus-5-5", input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 50, stop_reason: "end_turn", latency_ms: 900, served_by: "claude-opus-5-5" }],
      input_tokens: 150, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 50, cost_usd: 0.00105, stage_before: "understand", stage_after: "configure",
    },
    events: [
      { seq: 1, at: "2026-10-08T15:00:02Z", kind: "thinking", summary: "Plan the model" },
      { seq: 2, at: "2026-10-08T15:00:03Z", kind: "tool_use", id: "tu_1", name: "configure_simulation", input: { disease: "measles" } },
      { seq: 3, at: "2026-10-08T15:00:04Z", kind: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: { kind: "config", approx_r0: 12 } },
      { seq: 4, at: "2026-10-08T15:00:05Z", kind: "stage", stage: "configure" },
      { seq: 5, at: "2026-10-08T15:00:09Z", kind: "text", text: "Configured." },
    ],
    messages: [
      { role: "user", content: "Today's date: 2026-10-08.\n\nModel measles in Kenya" },
      { role: "assistant", content: [{ type: "text", text: "Configured." }] },
    ],
    scenario: { id: null, seq: 1, params: { beta: 1.5 }, disease: "measles", country_iso3: "KEN", total_population: null, data_sources: [], web_sources: [], stage: "configure", stage_reached: "configure", has_run: false },
    step_events: [
      { kind: "conversation_started", session_id: SESSION, stage: "understand", tool: null, meta: {} },
      { kind: "tool_called", session_id: SESSION, stage: "configure", tool: "configure_simulation", meta: { duration_ms: 12 } },
    ],
    ...over,
  };
}

async function finish(p: unknown): Promise<string> {
  const { rows } = await db.query<{ id: string }>("select finish_turn($1::jsonb) as id", [JSON.stringify(p)]);
  return rows[0].id;
}

async function count(table: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return rows[0].n;
}

async function one<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

describe("finish_turn", () => {
  it("writes the turn, its events, the messages, a new scenario, the pointer and title, and the step events", async () => {
    const scenarioId = await finish(payload());

    const turn = await one<Record<string, unknown>>("select * from turns where id = $1", [TURN_1]);
    expect(turn).toMatchObject({ conversation_id: conversation, session_id: SESSION, seq: 1, user_text: "Model measles in Kenya", stop: "end_turn", model: "claude-opus-5-5", effort: "medium", stage_before: "understand", stage_after: "configure" });
    expect(Number(turn.input_tokens)).toBe(150);
    expect(Number(turn.cost_usd)).toBeCloseTo(0.00105, 6);
    expect(turn.api_calls).toHaveLength(1);
    expect(new Date(turn.first_token_at as string).toISOString()).toBe("2026-10-08T15:00:02.000Z");

    const { rows: events } = await db.query<{ seq: number; kind: string; payload: Record<string, unknown> }>("select seq, kind, payload from turn_events where turn_id = $1 order by seq", [TURN_1]);
    expect(events.map((e) => e.kind)).toEqual(["thinking", "tool_use", "tool_result", "stage", "text"]);
    expect(events[1].payload).toEqual({ id: "tu_1", name: "configure_simulation", input: { disease: "measles" } });
    expect(events[4].payload).toEqual({ text: "Configured." });

    const { rows: messages } = await db.query<{ seq: number; role: string; content: unknown }>("select seq, role, content from messages where conversation_id = $1 order by seq", [conversation]);
    expect(messages.map((m) => [m.seq, m.role])).toEqual([[1, "user"], [2, "assistant"]]);
    expect(messages[0].content).toBe("Today's date: 2026-10-08.\n\nModel measles in Kenya");

    const scenario = await one<Record<string, unknown>>("select * from scenarios where id = $1", [scenarioId]);
    expect(scenario).toMatchObject({ conversation_id: conversation, seq: 1, params: { beta: 1.5 }, disease: "measles", country_iso3: "KEN", total_population: null, stage: "configure", stage_reached: "configure", has_run: false });

    expect(await one("select active_scenario_id, title from conversations where id = $1", [conversation])).toEqual({ active_scenario_id: scenarioId, title: "Measles in Kenya" });

    const { rows: steps } = await db.query("select kind, tool, stage, turn_id, session_id from step_events where conversation_id = $1 order by id", [conversation]);
    expect(steps).toEqual([
      { kind: "conversation_started", tool: null, stage: "understand", turn_id: TURN_1, session_id: SESSION },
      { kind: "tool_called", tool: "configure_simulation", stage: "configure", turn_id: TURN_1, session_id: SESSION },
    ]);
  });

  it("continues every sequence on the next turn, updates the scenario by id, rounds the population, and keeps the title", async () => {
    const scenarioId = await finish(payload());
    await finish(payload({
      title: "Something else",
      turn: { ...payload().turn, id: TURN_2, user_text: "Run it", stop: "max_tokens" },
      events: [{ seq: 1, at: "2026-10-08T15:01:00Z", kind: "text", text: "Running." }],
      messages: [{ role: "user", content: "Run it" }, { role: "assistant", content: [{ type: "text", text: "Running." }] }],
      scenario: { ...payload().scenario, id: scenarioId, has_run: true, stage: "interpret", stage_reached: "interpret", total_population: 54027487.3 },
      step_events: [],
    }));
    expect((await one<{ seq: number }>("select seq from turns where id = $1", [TURN_2])).seq).toBe(2);
    expect((await one<{ seq: number }>("select max(seq)::int as seq from messages where conversation_id = $1", [conversation])).seq).toBe(4);
    expect(await count("scenarios")).toBe(1);
    const scenario = await one<{ has_run: boolean; stage: string; total_population: string | number }>("select has_run, stage, total_population from scenarios where id = $1", [scenarioId]);
    expect(scenario.has_run).toBe(true);
    expect(scenario.stage).toBe("interpret");
    expect(Number(scenario.total_population)).toBe(54027487);
    expect((await one<{ title: string }>("select title from conversations where id = $1", [conversation])).title).toBe("Measles in Kenya");
  });

  it("appends no messages for a dropped turn but keeps the turn, its events, and the scenario", async () => {
    await finish(payload({ turn: { ...payload().turn, stop: "refusal", refusal_category: "bio" }, messages: null }));
    expect(await count("turns")).toBe(1);
    expect(await count("turn_events")).toBe(5);
    expect(await count("messages")).toBe(0);
    expect(await count("scenarios")).toBe(1);
    expect((await one<{ refusal_category: string }>("select refusal_category from turns where id = $1", [TURN_1])).refusal_category).toBe("bio");
  });

  it("claims this turn's runs for the new scenario", async () => {
    await db.query("insert into runs (conversation_id, user_id, turn_id, params) values ($1, $2, $3, '{}'::jsonb)", [conversation, ALICE, TURN_1]);
    const scenarioId = await finish(payload());
    expect((await one<{ scenario_id: string }>("select scenario_id from runs where turn_id = $1", [TURN_1])).scenario_id).toBe(scenarioId);
  });

  it("refuses a scenario id from another conversation", async () => {
    const { rows } = await db.query<{ id: string }>("insert into conversations (user_id) values ($1) returning id", [ALICE]);
    const { rows: other } = await db.query<{ id: string }>("insert into scenarios (conversation_id, seq) values ($1, 1) returning id", [rows[0].id]);
    await expect(finish(payload({ scenario: { ...payload().scenario, id: other[0].id } }))).rejects.toThrow(/not in conversation/);
    expect(await count("turns")).toBe(0);
  });

  it("rolls everything back when one row is bad", async () => {
    await expect(finish(payload({ step_events: [{ kind: "chat_text", meta: {} }] }))).rejects.toThrow();
    for (const table of ["turns", "turn_events", "messages", "scenarios", "step_events"]) expect(await count(table)).toBe(0);
    expect((await one<{ title: string }>("select title from conversations where id = $1", [conversation])).title).toBe("");
  });

  it("is callable by the server role only", async () => {
    const secured = await createTestDb({ roles: true });
    const can = async (role: string) =>
      (await secured.query<{ allowed: boolean }>("select has_function_privilege($1, 'finish_turn(jsonb)', 'execute') as allowed", [role])).rows[0].allowed;
    expect(await can("service_role")).toBe(true);
    expect(await can("anon")).toBe(false);
    expect(await can("authenticated")).toBe(false);
  });
  it("stores a recap event once 0003 is applied, and 0003 applies twice", async () => {
    await db.exec(readFileSync("supabase/migrations/0003_recap.sql", "utf8"));
    await finish(payload({ events: [{ seq: 1, at: "2026-10-08T15:00:09Z", kind: "recap", items: ["Measles in Kenya"] }] }));
    const { rows } = await db.query<{ kind: string; payload: { items: string[] } }>("select kind, payload from turn_events where turn_id = $1", [TURN_1]);
    expect(rows).toEqual([{ kind: "recap", payload: { items: ["Measles in Kenya"] } }]);
    await expect(db.query("insert into turn_events (turn_id, seq, kind) values ($1, 2, 'image')", [TURN_1])).rejects.toThrow();
  });
});
