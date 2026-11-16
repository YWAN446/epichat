import { describe, expect, it } from "vitest";
import { loadSettings } from "@/lib/config";
import { capMessage, supabaseUsageStore } from "@/lib/usage";
import { fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";

describe("supabaseUsageStore", () => {
  it("reserves a turn through the database function and returns its answer", async () => {
    const { client, rpcCalls } = fakeAdmin({ "rpc:reserve_turn": [{ data: "ok" }] });
    const outcome = await supabaseUsageStore(client).reserveTurn(USER, "2026-10-07", "2026-10-01", { dailyTurns: 40, monthlyBudgetUsd: 50 });
    expect(outcome).toBe("ok");
    expect(rpcCalls).toEqual([["reserve_turn", { p_user: USER, p_day: "2026-10-07", p_month_start: "2026-10-01", p_daily_limit: 40, p_monthly_budget: 50 }]]);
  });

  it("refuses an answer it does not recognize and surfaces database errors", async () => {
    const odd = fakeAdmin({ "rpc:reserve_turn": [{ data: "maybe" }] });
    await expect(supabaseUsageStore(odd.client).reserveTurn(USER, "d", "m", { dailyTurns: 1, monthlyBudgetUsd: 1 })).rejects.toThrow(/unexpected/);
    const failing = fakeAdmin({ "rpc:reserve_turn": [{ data: null, error: { message: "down" } }] });
    await expect(supabaseUsageStore(failing.client).reserveTurn(USER, "d", "m", { dailyTurns: 1, monthlyBudgetUsd: 1 })).rejects.toThrow(/down/);
  });

  it("records tokens and cost rounded to six decimals", async () => {
    const { client, rpcCalls } = fakeAdmin();
    await supabaseUsageStore(client).record(USER, "2026-10-07", { turns: 0, inputTokens: 1200, outputTokens: 300, costUsd: 0.0108004 });
    expect(rpcCalls).toEqual([["record_usage", { p_user: USER, p_day: "2026-10-07", p_turns: 0, p_input: 1200, p_output: 300, p_cost: 0.0108 }]]);
  });
});

describe("capMessage", () => {
  it("explains each cap in the participant's terms", () => {
    const settings = loadSettings({});
    expect(capMessage("monthly_budget", settings)).toMatch(/budget for this month/);
    expect(capMessage("daily_turns", settings)).toMatch(/40 messages/);
  });
});
