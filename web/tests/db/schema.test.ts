import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { STEP_EVENT_KINDS } from "@/lib/enums";
import { applyMigrations, createTestDb } from "./helpers";

const ALICE = "11111111-1111-1111-1111-111111111111";
const TABLES = [
  "profiles", "sessions", "conversations", "messages", "turns", "turn_events",
  "scenarios", "runs", "feedback", "step_events", "usage_daily", "reports", "shares",
];

let db: PGlite;

beforeEach(async () => {
  db = await createTestDb();
});

async function newConversation(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into conversations (user_id, title) values ($1, 'Measles in Kenya') returning id",
    [ALICE],
  );
  return rows[0].id;
}

describe("migration", () => {
  it("creates every table and can be applied twice", async () => {
    const { rows } = await db.query<{ relname: string }>(
      "select relname from pg_class where relkind = 'r' and relname = any($1) order by relname",
      [TABLES],
    );
    expect(rows.map((row) => row.relname)).toEqual([...TABLES].sort());
    await expect(applyMigrations(db)).resolves.toBeUndefined();
  });

  it("has row-level security on every table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname = any($1) order by relname",
      [TABLES],
    );
    expect(rows).toEqual([...TABLES].sort().map((relname) => ({ relname, relrowsecurity: true })));
  });

  it("grants the server role what it needs and the browser roles nothing", async () => {
    const secured = await createTestDb({ roles: true });
    const can = async (sql: string, params: string[]) =>
      (await secured.query<{ allowed: boolean }>(`select ${sql} as allowed`, params)).rows[0].allowed;
    for (const table of TABLES) {
      for (const privilege of ["select", "insert", "update", "delete"]) {
        expect(await can("has_table_privilege('service_role', $1, $2)", [table, privilege])).toBe(true);
        expect(await can("has_table_privilege('anon', $1, $2)", [table, privilege])).toBe(false);
        expect(await can("has_table_privilege('authenticated', $1, $2)", [table, privilege])).toBe(false);
      }
    }
    for (const fn of ["record_usage(uuid, date, integer, bigint, bigint, numeric)", "reserve_turn(uuid, date, date, integer, numeric)"]) {
      expect(await can("has_function_privilege('service_role', $1, 'execute')", [fn])).toBe(true);
      expect(await can("has_function_privilege('anon', $1, 'execute')", [fn])).toBe(false);
    }
  });
});

describe("profiles", () => {
  it("keeps one row per user with a fixed participant type", async () => {
    await db.query(
      "insert into profiles (user_id, email, participant_type, consent_version, consented_at) values ($1, 'a@emory.edu', 'graduate_student', '2026-10-07', now())",
      [ALICE],
    );
    await expect(
      db.query("insert into profiles (user_id, email, participant_type) values ($1, 'a@emory.edu', 'student')", [ALICE]),
    ).rejects.toThrow();
  });
});

describe("conversation tree", () => {
  it("numbers messages, turns, and events per conversation and cascades deletes", async () => {
    const conversation = await newConversation();
    await db.query("insert into messages (conversation_id, seq, role, content) values ($1, 1, 'user', '[]'::jsonb)", [conversation]);
    await expect(
      db.query("insert into messages (conversation_id, seq, role, content) values ($1, 1, 'assistant', '[]'::jsonb)", [conversation]),
    ).rejects.toThrow();
    const { rows } = await db.query<{ id: string }>(
      "insert into turns (conversation_id, seq, user_text, stop) values ($1, 1, 'hi', 'end_turn') returning id",
      [conversation],
    );
    await db.query("insert into turn_events (turn_id, seq, kind, payload) values ($1, 1, 'text', '{\"text\":\"hello\"}'::jsonb)", [rows[0].id]);
    await db.query("insert into feedback (user_id, conversation_id, turn_id, rating) values ($1, $2, $3, 'up')", [ALICE, conversation, rows[0].id]);
    await db.query("delete from conversations where id = $1", [conversation]);
    for (const table of ["messages", "turns", "turn_events", "feedback"]) {
      const { rows: left } = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
      expect(left[0].n).toBe(0);
    }
  });

  it("rejects a stop reason, event kind, or rating outside the fixed lists", async () => {
    const conversation = await newConversation();
    await expect(
      db.query("insert into turns (conversation_id, seq, user_text, stop) values ($1, 1, 'hi', 'crashed')", [conversation]),
    ).rejects.toThrow();
    const { rows } = await db.query<{ id: string }>(
      "insert into turns (conversation_id, seq, user_text, stop) values ($1, 1, 'hi', 'end_turn') returning id",
      [conversation],
    );
    await expect(
      db.query("insert into turn_events (turn_id, seq, kind) values ($1, 1, 'image')", [rows[0].id]),
    ).rejects.toThrow();
    await expect(
      db.query("insert into feedback (user_id, conversation_id, turn_id, rating) values ($1, $2, $3, 'meh')", [ALICE, conversation, rows[0].id]),
    ).rejects.toThrow();
  });

  it("points a conversation at its active scenario and clears the pointer when the scenario goes", async () => {
    const conversation = await newConversation();
    const { rows } = await db.query<{ id: string }>(
      "insert into scenarios (conversation_id, seq, params, stage) values ($1, 1, '{}'::jsonb, 'configure') returning id",
      [conversation],
    );
    await db.query("update conversations set active_scenario_id = $1 where id = $2", [rows[0].id, conversation]);
    await db.query("delete from scenarios where id = $1", [rows[0].id]);
    const { rows: after } = await db.query<{ active_scenario_id: string | null }>(
      "select active_scenario_id from conversations where id = $1",
      [conversation],
    );
    expect(after[0].active_scenario_id).toBeNull();
  });
});

describe("step_events", () => {
  it("accepts every kind the app knows and nothing else", async () => {
    for (const kind of STEP_EVENT_KINDS) {
      await db.query("insert into step_events (user_id, kind) values ($1, $2)", [ALICE, kind]);
    }
    await expect(db.query("insert into step_events (user_id, kind) values ($1, 'chat_text')", [ALICE])).rejects.toThrow();
  });
});

describe("sessions", () => {
  it("records a visit with device facts and can be closed", async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into sessions (user_id, user_agent, viewport, language, timezone) values ($1, 'UA', '390x844', 'en-US', 'America/New_York') returning id",
      [ALICE],
    );
    await db.query("update sessions set ended_at = now() where id = $1 and user_id = $2", [rows[0].id, ALICE]);
    const { rows: closed } = await db.query<{ ended: boolean }>("select ended_at is not null as ended from sessions where id = $1", [rows[0].id]);
    expect(closed[0].ended).toBe(true);
  });
});
