import type { Adapters, ResolvedField } from "@/lib/data/types";
import type { PreviousRun, ReportRun } from "@/lib/db/runs";
import { lookup, type ParameterSummary } from "@/lib/disease/db";
import type { Memory } from "@/lib/profile/about";
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
export type Remembered = { kind: string; text: string; replaces?: string };
export type FakeDeps = ToolDeps & {
  runs: RunRecord[]; starts: number; queries: unknown[]; reportsWritten: WrittenReport[]; remembered: Remembered[];
  simulated: { popScale: number; contextText: string; disease: string | null }[]; options: { runId: string; diagnosticId: string; patch: Record<string, unknown> }[]; previousReads: number;
};

export function makeDeps(over: Partial<{
  scenario: Scenario; unWpp: ResolvedField[] | Error; whoGho: ResolvedField[] | Error; wbData360: ResolvedField[] | Error;
  simulate: SimResult | Error; fallback: { birth_rate: number; death_rate: number; source: string } | null; contextText: string; runId: string | null;
  reportRuns: ReportRun[]; recap: string[]; nextVersion: number; reportId: string | null;
  memoryEnabled: boolean; memories: Memory[]; memoryAdd: "full" | "not_found" | Error; previousRun: PreviousRun | null;
  lookup: Record<string, Record<string, ParameterSummary>>;
}> = {}): FakeDeps {
  const answer = (v: ResolvedField[] | Error | undefined) => async (q: unknown) => { deps.queries.push(q); if (v instanceof Error) throw v; return v ?? []; };
  const sim: SimClient = {
    async simulate(_params, popScale, contextText, disease) {
      deps.simulated.push({ popScale, contextText, disease: disease ?? null });
      if (over.simulate instanceof Error) throw over.simulate;
      if (!over.simulate) throw new Error("no simulate result configured");
      return over.simulate;
    },
    async demographicsFallback() { return over.fallback ?? null; },
    async export() { return { ok: false, status: 0, kind: "unavailable", detail: "no export in tests" }; },
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
    remembered: [],
    simulated: [],
    options: [],
    previousReads: 0,
    async onRun(run) { deps.runs.push(run); return over.runId === undefined ? "run-1" : over.runId; },
    onScenarioStart() { deps.starts++; },
    async previousRun() { deps.previousReads++; return over.previousRun ?? null; },
    onOptionChosen(runId, diagnosticId, patch) { deps.options.push({ runId, diagnosticId, patch }); },
    lookupDisease(name) {
      const base = lookup(name);
      const extra = over.lookup?.[name];
      if (!extra) return base;
      return { ...(base ?? { key: name, display_name: name, aliases: [], summaries: {}, flat: {} }), summaries: { ...(base?.summaries ?? {}), ...extra } };
    },
    reports: {
      async runs() { return over.reportRuns ?? []; },
      async recap() { return over.recap ?? []; },
      async nextVersion() { return over.nextVersion ?? 1; },
      async insert(report) { deps.reportsWritten.push(report); return over.reportId === undefined ? "rep-1" : over.reportId; },
      conversationTitle: "Measles in Kenya",
    },
    memory: {
      enabled: over.memoryEnabled ?? true,
      added: 0,
      async list() { return over.memories ?? []; },
      async add(kind, text, replaces) {
        deps.remembered.push({ kind, text, replaces });
        if (over.memoryAdd instanceof Error) throw over.memoryAdd;
        return over.memoryAdd ?? { id: "m-new" };
      },
    },
  };
  return deps;
}
