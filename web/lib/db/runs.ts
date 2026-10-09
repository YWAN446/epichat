import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunRecord } from "@/lib/tools/types";

export type RunInsert = { conversationId: string; userId: string; turnId: string; scenarioId: string | null; record: RunRecord };

export interface RunStore {
  /** Insert the row and return its id. Throws when the database refuses; onRun swallows it. */
  insert(run: RunInsert): Promise<string>;
}

/** The runs columns for one simulation, finished or failed. */
export function runRow(run: RunInsert): Record<string, unknown> {
  const { record } = run;
  const result = record.result;
  const common = {
    conversation_id: run.conversationId,
    user_id: run.userId,
    turn_id: run.turnId,
    scenario_id: run.scenarioId,
    params: record.params,
    pop_scale: record.popScale,
    warnings: record.warnings,
    data_sources: record.dataSources,
    repairs: result.repairs,
  };
  if (result.ok) {
    return {
      ...common,
      effective_params: result.effective_params,
      stats: result.stats,
      stats_agents: result.stats_agents,
      series: result.series,
      duration_ms: result.duration_ms,
      sim_cold_start: result.cold_start,
      error: null,
    };
  }
  return {
    ...common,
    effective_params: null,
    stats: null,
    stats_agents: null,
    series: null,
    duration_ms: null,
    sim_cold_start: null,
    error: { kind: result.kind, detail: result.detail, status: result.status, attempts: result.attempts },
  };
}

export function supabaseRunStore(admin: SupabaseClient): RunStore {
  return {
    async insert(run) {
      const { data, error } = await admin.from("runs").insert(runRow(run)).select("id").single();
      if (error || !data) throw new Error(`runs insert failed: ${error?.message ?? "no row"}`);
      return (data as { id: string }).id;
    },
  };
}
