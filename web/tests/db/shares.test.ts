import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "./helpers";

const ALICE = "11111111-1111-1111-1111-111111111111";
let db: PGlite;
let conversation: string;

beforeEach(async () => {
  db = await createTestDb();
  conversation = (await db.query<{ id: string }>("insert into conversations (user_id) values ($1) returning id", [ALICE])).rows[0].id;
});

async function share(token: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into shares (token, conversation_id, user_id, title, snapshot, turn_count) values ($1, $2, $3, 'T', '{}', 1) returning id",
    [token, conversation, ALICE],
  );
  return rows[0].id;
}

describe("shares (0005)", () => {
  it("allows one active share per conversation and another after a revoke", async () => {
    const first = await share("a".repeat(22));
    await expect(share("b".repeat(22))).rejects.toThrow();
    await db.query("update shares set revoked_at = now() where id = $1", [first]);
    await expect(share("b".repeat(22))).resolves.toBeTruthy();
  });

  it("counts a view and stops once revoked", async () => {
    const id = await share("c".repeat(22));
    const seen = await db.query<{ id: string }>("select record_share_view($1) as id", ["c".repeat(22)]);
    expect(seen.rows[0].id).toBe(id);
    const row = await db.query<{ view_count: number; last_viewed_at: string | null }>("select view_count, last_viewed_at from shares where id = $1", [id]);
    expect(row.rows[0].view_count).toBe(1);
    expect(row.rows[0].last_viewed_at).not.toBeNull();
    await db.query("update shares set revoked_at = now() where id = $1", [id]);
    expect((await db.query<{ id: string | null }>("select record_share_view($1) as id", ["c".repeat(22)])).rows[0].id).toBeNull();
    expect((await db.query<{ id: string | null }>("select record_share_view($1) as id", ["zzz"])).rows[0].id).toBeNull();
  });

  it("accepts the share step-event kinds and applies twice", async () => {
    for (const kind of ["share_created", "share_updated", "share_revoked", "share_opened"]) {
      await db.query("insert into step_events (user_id, conversation_id, kind, meta) values ($1, $2, $3, '{}')", [ALICE, conversation, kind]);
    }
    await db.exec(readFileSync("supabase/migrations/0005_shares.sql", "utf8"));
    expect((await db.query<{ n: number }>("select count(*)::int as n from shares")).rows[0].n).toBe(0);
  });

  it("goes away with its conversation", async () => {
    await share("d".repeat(22));
    await db.query("delete from conversations where id = $1", [conversation]);
    expect((await db.query<{ n: number }>("select count(*)::int as n from shares")).rows[0].n).toBe(0);
  });
});
