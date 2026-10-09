import type { Adapters, ResolvedField } from "@/lib/data/types";
import type { ReportRun } from "@/lib/db/runs";
import type { ReportDocument, ReportNarrative } from "@/lib/report/document";
import type { SimClient, SimResult } from "@/lib/sim/client";
import { validateParams, type SimParams } from "@/lib/sim/params";
import { emptyScenario, type RunRecord, type Scenario, type ToolDeps } from "@/lib/tools/types";

export function params(input: Record<string, unknown>): SimParams {
  const r = validateParams({ beta: 22.8125, ...input });
  if (!r.ok) throw new Error(r.error);
  return r.params;
}

export function rf(field: string, value: unknown, citation = "test source"): ResolvedField {
  return { field, value, citation, description: "", alternatives: [] };
}

export type WrittenReport = { version: number; title: string; language: string; narrative: ReportNarrative; document: ReportDocument };
export type FakeDeps = ToolDeps & { runs: RunRecord[]; starts: number; queries: unknown[]; reportsWritten: WrittenReport[] };

export function makeDeps(over: Partial<{
  scenario: Scenario; unWpp: ResolvedField[] | Error; whoGho: ResolvedField[] | Error; wbData360: ResolvedField[] | Error;
  simulate: SimResult | Error; fallback: { birth_rate: number; death_rate: number; source: string } | null; contextText: string; runId: string | null;
  reportRuns: ReportRun[]; recap: string[]; nextVersion: number; reportId: string | null;
}> = {}): FakeDeps {
  const answer = (v: ResolvedField[] | Error | undefined) => async (q: unknown) => { deps.queries.push(q); if (v instanceof Error) throw v; return v ?? []; };
  const sim: SimClient = {
    async simulate() { if (over.simulate instanceof Error) throw over.simulate; if (!over.simulate) throw new Error("no simulate result configured"); return over.simulate; },
    async demographicsFallback() { return over.fallback ?? null; },
  };
  const deps: FakeDeps = {
    scenario: over.scenario ?? emptyScenario(),
    sim,
    adapters: { unWpp: answer(over.unWpp), whoGho: answer(over.whoGho), wbData360: answer(over.wbData360) } as Adapters,
    contextText: over.contextText ?? "",
    turnId: "turn-1",
    runs: [],
    starts: 0,
    queries: [],
    reportsWritten: [],
    async onRun(run) { deps.runs.push(run); return over.runId === undefined ? "run-1" : over.runId; },
    onScenarioStart() { deps.starts++; },
    reports: {
      async runs() { return over.reportRuns ?? []; },
      async recap() { return over.recap ?? []; },
      async nextVersion() { return over.nextVersion ?? 1; },
      async insert(report) { deps.reportsWritten.push(report); return over.reportId === undefined ? "rep-1" : over.reportId; },
      conversationTitle: "Measles in Kenya",
    },
  };
  return deps;
}
