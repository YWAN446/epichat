import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { STEP_EVENT_KINDS, TUTORIAL_EVENT_KINDS } from "@/lib/enums";
import { createTestDb } from "./helpers";

const ALICE = "11111111-1111-1111-1111-111111111111";

describe("the tutorial's migration (0009)", () => {
  it("adds an empty tutorial_seen_at and accepts the five tutorial event kinds", async () => {
    const db = await createTestDb();
    await db.query("insert into profiles (user_id, email) values ($1, 'a@emory.edu')", [ALICE]);
    expect((await db.query("select tutorial_seen_at from profiles")).rows[0]).toEqual({ tutorial_seen_at: null });
    expect(TUTORIAL_EVENT_KINDS).toEqual(["tutorial_started", "tutorial_step", "tutorial_finished", "tutorial_ended", "tutorial_offer_declined"]);
    for (const kind of TUTORIAL_EVENT_KINDS) await db.query("insert into step_events (user_id, kind) values ($1, $2)", [ALICE, kind]);
    await expect(db.query("insert into step_events (user_id, kind) values ($1, 'tutorial_other')", [ALICE])).rejects.toThrow();
  });

  it("keeps every kind the app can write, and can be applied twice", async () => {
    const db = await createTestDb();
    await db.exec(readFileSync("supabase/migrations/0009_tutorial.sql", "utf8"));
    for (const kind of STEP_EVENT_KINDS) await db.query("insert into step_events (user_id, kind) values ($1, $2)", [ALICE, kind]);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from step_events");
    expect(rows[0].n).toBe(STEP_EVENT_KINDS.length);
  });
});
