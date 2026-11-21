import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedField } from "@/lib/data/types";
import type { Diagnostic, RepairRecord, SimStats } from "@/lib/sim/client";
import { coerceParams, type SimParams } from "@/lib/sim/params";
import type { RunRecord } from "@/lib/tools/types";

/** scenarioSeq: the seq of the scenario the run was made for, so a turn that starts another scenario keeps the runs apart (final review 5). */
export type RunInsert = { conversationId: string; userId: string; turnId: string; scenarioId: string | null; scenarioSeq?: number | null; record: RunRecord };

/** One successful run as the report reads it back (report spec, section 5). */
export type ReportRun = {
  id: string;
  createdAt: string;
  /** Round-1 spec 8: the run's number in the Runs section, its place among the conversation's successful runs, from 1. */
  index: number;
  effectiveParams: SimParams;
  stats: SimStats;
  statsAgents: SimStats;
  popScale: number;
  series: Record<string, number[]> | null;
  repairs: RepairRecord[];
  warnings: string[];
  dataSources: ResolvedField[];
};

/** The scenario's latest successful run, as the comparison and the option matching read it (spec 11). */
export type PreviousRun = { id: string; effectiveParams: SimParams; stats: SimStats; statsAgents: SimStats; popScale: number; diagnostics: Diagnostic[] };

export interface RunStore {
  /** Insert the row and return its id. Throws when the database refuses; onRun swallows it. */
  insert(run: RunInsert): Promise<string>;
  /** The scenario's successful runs plus this turn's not-yet-linked ones, oldest first, with their series (the report). */
  listForReport(conversationId: string, scenarioId: string | null, turnId: string, scenarioSeq?: number): Promise<ReportRun[]>;
  /** The stored series of the given runs, by id; runs without one are left out (the share's snapshot). */
  seriesFor(ids: string[]): Promise<Map<string, Record<string, number[]>>>;
  /** The newest successful run of the scenario (this turn's unlinked ones included), or null. Throws when the database refuses. */
  latest(conversationId: string, scenarioId: string | null, turnId: string, scenarioSeq?: number): Promise<PreviousRun | null>;
}

type ReportRunRow = {
  id: string; created_at: string; scenario_id: string | null; scenario_seq?: number | null; turn_id: string | null; effective_params: unknown; stats: SimStats; stats_agents: SimStats;
  pop_scale: number | string | null; series: Record<string, number[]> | null; repairs: RepairRecord[] | null; warnings: string[] | null; data_sources: ResolvedField[] | null;
};

type PreviousRow = {
  id: string; created_at: string; scenario_id: string | null; scenario_seq?: number | null; turn_id: string | null; effective_params: unknown; stats: SimStats; stats_agents: SimStats;
  pop_scale: number | string | null; diagnostics: Diagnostic[] | null;
};

/**
 * The stored scenario's runs, plus this turn's not-yet-linked ones of the same scenario seq; never an earlier turn's orphan when
 * the scenario is new, nor a run of a scenario the turn replaced (final review 5).
 */
function belongs(row: { scenario_id: string | null; scenario_seq?: number | null; turn_id: string | null }, scenarioId: string | null, turnId: string, seq?: number): boolean {
  if (scenarioId !== null && row.scenario_id === scenarioId) return true;
  return row.scenario_id === null && row.turn_id === turnId && (seq === undefined || row.scenario_seq === null || row.scenario_seq === undefined || row.scenario_seq === seq);
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
    scenario_seq: run.scenarioSeq ?? null,
    params: record.params,
    pop_scale: record.popScale,
    warnings: record.warnings,
    data_sources: record.dataSources,
    repairs: result.repairs,
    diagnostics: result.ok ? (result.diagnostics ?? []) : [],
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
    async listForReport(conversationId, scenarioId, turnId, scenarioSeq) {
      const { data, error } = await admin
        .from("runs")
        .select("id, created_at, scenario_id, scenario_seq, turn_id, effective_params, stats, stats_agents, pop_scale, series, repairs, warnings, data_sources")
        .eq("conversation_id", conversationId)
        .is("error", null)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`runs read failed: ${error.message}`);
      // numbered before the scenario filter, as the Runs section numbers every successful run of the conversation
      return ((data ?? []) as ReportRunRow[])
        .map((row, i) => ({ row, index: i + 1 }))
        .filter(({ row }) => belongs(row, scenarioId, turnId, scenarioSeq))
        .flatMap(({ row, index }) => {
          // Stored rows may be v1; a row whose parameters no longer validate is left out of the report.
          const effectiveParams = coerceParams(row.effective_params);
          if (!effectiveParams) {
            console.error(`run ${row.id} has unusable effective_params`);
            return [];
          }
          return [{
            id: row.id,
            createdAt: row.created_at,
            index,
            effectiveParams,
            stats: row.stats,
            statsAgents: row.stats_agents,
            popScale: Number(row.pop_scale ?? 1),
            series: row.series ?? null,
            repairs: row.repairs ?? [],
            warnings: row.warnings ?? [],
            dataSources: row.data_sources ?? [],
          }];
        });
    },
    async seriesFor(ids) {
      const out = new Map<string, Record<string, number[]>>();
      if (ids.length === 0) return out;
      const { data, error } = await admin.from("runs").select("id, series").in("id", ids);
      if (error) throw new Error(`runs read failed: ${error.message}`);
      for (const row of (data ?? []) as { id: string; series: Record<string, number[]> | null }[]) if (row.series) out.set(row.id, row.series);
      return out;
    },
    async latest(conversationId, scenarioId, turnId, scenarioSeq) {
      const { data, error } = await admin
        .from("runs")
        .select("id, created_at, scenario_id, scenario_seq, turn_id, effective_params, stats, stats_agents, pop_scale, diagnostics")
        .eq("conversation_id", conversationId)
        .is("error", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`runs read failed: ${error.message}`);
      for (const row of (data ?? []) as PreviousRow[]) {
        if (!belongs(row, scenarioId, turnId, scenarioSeq)) continue;
        const effectiveParams = coerceParams(row.effective_params);
        if (!effectiveParams) continue; // an unusable row is no comparison; the next older one may be
        return {
          id: row.id, effectiveParams, stats: row.stats, statsAgents: row.stats_agents, popScale: Number(row.pop_scale ?? 1),
          diagnostics: Array.isArray(row.diagnostics) ? row.diagnostics : [],
        };
      }
      return null;
    },
  };
}
