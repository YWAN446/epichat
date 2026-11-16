import type { SupabaseClient } from "@supabase/supabase-js";
import type { Settings } from "./config";

export type UsageDelta = { turns: number; inputTokens: number; outputTokens: number; costUsd: number };
export type TurnReservation = "ok" | "monthly_budget" | "daily_turns";
export type CapName = Exclude<TurnReservation, "ok">;
export type TurnLimits = { dailyTurns: number; monthlyBudgetUsd: number };

const RESERVATIONS: readonly string[] = ["ok", "monthly_budget", "daily_turns"];

export interface UsageStore {
  /**
   * Count one turn for this user unless a cap is already reached. The database
   * does this in a single statement, so parallel requests cannot each slip under the cap.
   */
  reserveTurn(userId: string, day: string, monthStart: string, limits: TurnLimits): Promise<TurnReservation>;
  /** Add a finished turn's tokens and cost. The turn itself was counted by reserveTurn. */
  record(userId: string, day: string, delta: UsageDelta): Promise<void>;
}

export function capMessage(cap: CapName, settings: Pick<Settings, "dailyTurnsPerUser">): string {
  if (cap === "monthly_budget") {
    return "EpiChat has used its budget for this month. It will be available again on the 1st.";
  }
  return `You have reached today's limit of ${settings.dailyTurnsPerUser} messages. It resets at midnight Eastern time.`;
}

export function supabaseUsageStore(admin: SupabaseClient): UsageStore {
  return {
    async reserveTurn(userId, day, monthStart, limits) {
      const { data, error } = await admin.rpc("reserve_turn", {
        p_user: userId,
        p_day: day,
        p_month_start: monthStart,
        p_daily_limit: limits.dailyTurns,
        p_monthly_budget: limits.monthlyBudgetUsd,
      });
      if (error) throw new Error(`reserve_turn failed: ${error.message}`);
      if (typeof data !== "string" || !RESERVATIONS.includes(data)) throw new Error("reserve_turn returned an unexpected answer");
      return data as TurnReservation;
    },

    async record(userId, day, delta) {
      const { error } = await admin.rpc("record_usage", {
        p_user: userId,
        p_day: day,
        p_turns: delta.turns,
        p_input: delta.inputTokens,
        p_output: delta.outputTokens,
        p_cost: Number(delta.costUsd.toFixed(6)),
      });
      if (error) throw new Error(`record_usage failed: ${error.message}`);
    },
  };
}
