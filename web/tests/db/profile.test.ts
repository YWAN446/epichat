import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "./helpers";

const ALICE = "11111111-1111-1111-1111-111111111111";
let db: PGlite;

beforeEach(async () => {
  db = await createTestDb();
  await db.query(
    "insert into profiles (user_id, email, participant_type, consent_version, consented_at) values ($1, 'a@emory.edu', 'graduate_student', '2026-10-10', now())",
    [ALICE],
  );
});

describe("profiles (0006)", () => {
  it("defaults the preferences and accepts the questionnaire's values", async () => {
    const { rows } = await db.query<{ goals: string[]; results_pref: string; report_format: string; memory_enabled: boolean; profile_completed_at: string | null }>(
      "select goals, results_pref, report_format, memory_enabled, profile_completed_at from profiles where user_id = $1",
      [ALICE],
    );
    expect(rows[0]).toEqual({ goals: [], results_pref: "all", report_format: "pdf", memory_enabled: true, profile_completed_at: null });
    await db.query(
      "update profiles set role = 'policy_maker', experience = 'some', goals = '{deciding,communicating}', disease_interest = 'measles', country_interest = 'KEN', decisions = 'vaccination campaigns', results_pref = 'summary', report_format = 'docx', memory_enabled = false, profile_completed_at = now(), profile_updated_at = now() where user_id = $1",
      [ALICE],
    );
    const after = await db.query<{ role: string; goals: string[]; memory_enabled: boolean }>("select role, goals, memory_enabled from profiles where user_id = $1", [ALICE]);
    expect(after.rows[0]).toEqual({ role: "policy_maker", goals: ["deciding", "communicating"], memory_enabled: false });
  });

  it("refuses a role, an experience, a preference, a format, or a country outside the lists, and text over the limits", async () => {
    for (const sql of [
      "update profiles set role = 'wizard' where user_id = $1",
      "update profiles set experience = 'lots' where user_id = $1",
      "update profiles set results_pref = 'loud' where user_id = $1",
      "update profiles set report_format = 'txt' where user_id = $1",
      "update profiles set country_interest = 'KENYA' where user_id = $1",
      `update profiles set decisions = '${"x".repeat(201)}' where user_id = $1`,
      `update profiles set disease_interest = '${"x".repeat(61)}' where user_id = $1`,
    ]) {
      await expect(db.query(sql, [ALICE])).rejects.toThrow();
    }
  });
});

describe("memories (0006)", () => {
  const add = (kind: string, source = "agent", text = "Works at a county health office") =>
    db.query<{ id: string }>("insert into memories (user_id, kind, text, source) values ($1, $2, $3, $4) returning id", [ALICE, kind, text, source]);

  it("accepts every kind and both sources, defaults to active, and refuses the rest", async () => {
    for (const kind of ["role", "situation", "preference", "decision", "solution", "other"]) await add(kind);
    await add("other", "participant");
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from memories where active");
    expect(rows[0].n).toBe(7);
    await expect(add("wish")).rejects.toThrow();
    await expect(add("role", "robot")).rejects.toThrow();
    await expect(add("role", "agent", "x".repeat(201))).rejects.toThrow();
    await expect(add("role", "agent", "")).rejects.toThrow();
  });

  it("keeps a memory when its source conversation is deleted", async () => {
    const conversation = (await db.query<{ id: string }>("insert into conversations (user_id) values ($1) returning id", [ALICE])).rows[0].id;
    await db.query("insert into memories (user_id, kind, text, source, source_conversation_id) values ($1, 'role', 'A modeler', 'agent', $2)", [ALICE, conversation]);
    await db.query("delete from conversations where id = $1", [conversation]);
    const { rows } = await db.query<{ source_conversation_id: string | null }>("select source_conversation_id from memories");
    expect(rows).toEqual([{ source_conversation_id: null }]);
  });

  it("accepts the six step-event kinds and applies twice", async () => {
    for (const kind of ["profile_completed", "profile_updated", "memory_added", "memory_updated", "memory_removed", "memory_toggled"]) {
      await db.query("insert into step_events (user_id, kind, meta) values ($1, $2, '{}')", [ALICE, kind]);
    }
    await db.exec(readFileSync("supabase/migrations/0006_profile_memory.sql", "utf8"));
    expect((await db.query<{ n: number }>("select count(*)::int as n from step_events")).rows[0].n).toBe(6);
    expect((await db.query<{ n: number }>("select count(*)::int as n from memories")).rows[0].n).toBe(0);
  });
});
