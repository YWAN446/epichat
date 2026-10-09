import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedField } from "@/lib/data/types";
import type { RepairRecord, SimStats } from "@/lib/sim/client";
import type { SimParams } from "@/lib/sim/params";
import type { RunRecord } from "@/lib/tools/types";

export type RunInsert = { conversationId: string; userId: string; turnId: string; scenarioId: string | null; record: RunRecord };

/** One successful run as the report reads it back (report spec, section 5). */
export type ReportRun = {
  id: string;
  createdAt: string;
  effectiveParams: SimParams;
  stats: SimStats;
  statsAgents: SimStats;
  popScale: number;
  series: Record<string, number[]> | null;
  repairs: RepairRecord[];
  warnings: string[];
  dataSources: ResolvedField[];
};

export interface RunStore {
  /** Insert the row and return its id. Throws when the database refuses; onRun swallows it. */
  insert(run: RunInsert): Promise<string>;
  /** The scenario's successful runs plus this turn's not-yet-linked ones, oldest first, with their series (the report). */
  listForReport(conversationId: string, scenarioId: string | null, turnId: string): Promise<ReportRun[]>;
  /** The stored series of the given runs, by id; runs without one are left out (the share's snapshot). */
  seriesFor(ids: string[]): Promise<Map<string, Record<string, number[]>>>;
}

type ReportRunRow = {
  id: string; created_at: string; scenario_id: string | null; turn_id: string | null; effective_params: SimParams; stats: SimStats; stats_agents: SimStats;
  pop_scale: number | string | null; series: Record<string, number[]> | null; repairs: RepairRecord[] | null; warnings: string[] | null; data_sources: ResolvedField[] | null;
};

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
    async listForReport(conversationId, scenarioId, turnId) {
      const { data, error } = await admin
        .from("runs")
        .select("id, created_at, scenario_id, turn_id, effective_params, stats, stats_agents, pop_scale, series, repairs, warnings, data_sources")
        .eq("conversation_id", conversationId)
        .is("error", null)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`runs read failed: ${error.message}`);
      return ((data ?? []) as ReportRunRow[])
        // The stored scenario's runs, plus this turn's not-yet-linked ones; never an earlier turn's orphan when the scenario is new.
        .filter((row) => (scenarioId !== null && row.scenario_id === scenarioId) || (row.scenario_id === null && row.turn_id === turnId))
        .map((row) => ({
          id: row.id,
          createdAt: row.created_at,
          effectiveParams: row.effective_params,
          stats: row.stats,
          statsAgents: row.stats_agents,
          popScale: Number(row.pop_scale ?? 1),
          series: row.series ?? null,
          repairs: row.repairs ?? [],
          warnings: row.warnings ?? [],
          dataSources: row.data_sources ?? [],
        }));
    },
    async seriesFor(ids) {
      const out = new Map<string, Record<string, number[]>>();
      if (ids.length === 0) return out;
      const { data, error } = await admin.from("runs").select("id, series").in("id", ids);
      if (error) throw new Error(`runs read failed: ${error.message}`);
      for (const row of (data ?? []) as { id: string; series: Record<string, number[]> | null }[]) if (row.series) out.set(row.id, row.series);
      return out;
    },
  };
}
