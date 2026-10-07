import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";

const ALICE = "11111111-1111-1111-1111-111111111111";
const BEN = "22222222-2222-2222-2222-222222222222";
const DAY = "2026-10-05";
const MONTH_START = "2026-10-01";
const RECORD = "select record_usage($1, $2, $3, $4, $5, $6)";

let db: PGlite;

async function reserve(user: string, limit = 3, budget = 50): Promise<string> {
  const { rows } = await db.query<{ outcome: string }>(
    "select reserve_turn($1, $2, $3, $4, $5) as outcome",
    [user, DAY, MONTH_START, limit, budget],
  );
  return rows[0].outcome;
}

async function row(user: string) {
  const { rows } = await db.query<{ turns: number; input_tokens: number; cost_usd: string }>(
    "select turns, input_tokens, cost_usd from usage_daily where user_id = $1 and day = $2",
    [user, DAY],
  );
  return rows[0] ?? null;
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("reserve_turn", () => {
  it("reserves turns up to the daily limit and then refuses", async () => {
    const outcomes: string[] = [];
    for (let attempt = 0; attempt < 5; attempt++) outcomes.push(await reserve(ALICE));
    expect(outcomes).toEqual(["ok", "ok", "ok", "daily_turns", "daily_turns"]);
    expect((await row(ALICE))?.turns).toBe(3);
  });

  it("lets exactly one of two racing requests through at the limit", async () => {
    await reserve(ALICE, 3);
    await reserve(ALICE, 3);
    const outcomes = await Promise.all([reserve(ALICE, 3), reserve(ALICE, 3)]);
    expect(outcomes.sort()).toEqual(["daily_turns", "ok"]);
    expect((await row(ALICE))?.turns).toBe(3);
  });

  it("counts each user separately", async () => {
    for (let attempt = 0; attempt < 3; attempt++) await reserve(ALICE);
    expect(await reserve(ALICE)).toBe("daily_turns");
    expect(await reserve(BEN)).toBe("ok");
  });

  it("refuses everyone once this month's cost reaches the budget, without counting a turn", async () => {
    await db.query(RECORD, [BEN, "2026-10-02", 0, 0, 0, 50]);
    expect(await reserve(ALICE)).toBe("monthly_budget");
    expect(await row(ALICE)).toBeNull();
  });

  it("ignores cost from before this month", async () => {
    await db.query(RECORD, [BEN, "2026-09-30", 0, 0, 0, 100]);
    expect(await reserve(ALICE)).toBe("ok");
  });

  it("refuses when the daily limit or the budget is zero", async () => {
    expect(await reserve(ALICE, 0)).toBe("daily_turns");
    expect(await reserve(ALICE, 3, 0)).toBe("monthly_budget");
    expect(await row(ALICE)).toBeNull();
  });
});

describe("record_usage", () => {
  it("adds a finished turn's tokens and cost without adding a turn", async () => {
    await reserve(ALICE);
    await db.query(RECORD, [ALICE, DAY, 0, 100, 50, 0.01]);
    await db.query(RECORD, [ALICE, DAY, 0, 200, 70, 0.02]);
    const saved = await row(ALICE);
    expect(saved?.turns).toBe(1);
    expect(Number(saved?.input_tokens)).toBe(300);
    expect(Number(saved?.cost_usd)).toBeCloseTo(0.03, 6);
  });
});
