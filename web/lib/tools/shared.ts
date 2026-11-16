import type { ResolvedField } from "@/lib/data/types";
import { checkParams } from "@/lib/disease/checkParams";
import { detectDisease } from "@/lib/disease/db";
import { approxR0, weightedCfr, type SimParams } from "@/lib/sim/params";
import type { Scenario, ToolOutcome } from "./types";

export const NEEDS_CONFIG = "Call configure_simulation first to establish the simulation before fetching data.";

export function given<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

/** epichat/agent.py _upsert_intervention: drop every intervention of the kind, append the new one. */
export function upsertIntervention(list: Record<string, unknown>[], kind: string, fields: Record<string, unknown>, layer?: string): Record<string, unknown>[] {
  // one entry per type; contact reductions are one per layer (Part 2, 7.4)
  const same = (i: Record<string, unknown>) => i.type === kind && (layer === undefined || (i.layer ?? "all") === layer);
  return [...list.filter((i) => !same(i)), { type: kind, ...fields }];
}

/** epichat/agent.py _param_warnings, on schema v2 */
export function paramWarnings(scenario: Scenario, params: SimParams, contextText: string): string[] {
  const disease = scenario.disease ?? detectDisease(contextText || "");
  if (!disease) return [];
  const d = params.disease;
  return checkParams(disease, approxR0(params), d.dur_inf.mean_days, d.dur_exp?.mean_days ?? null, {
    pDeath: weightedCfr(params) || null,
    nContacts: params.network.n_contacts,
    durImmune: d.dur_immune?.mean_days ?? null,
    pAsymp: d.model === "seiar" ? d.p_asymp : null,
  });
}

/** Notes about how a run is read, beside the literature warnings (spec 8.6: deaths are disease deaths only). */
export function runNotes(params: SimParams): string[] {
  return params.demographics.use_demographics
    ? ["Deaths in this run count disease deaths only; deaths from the background death rate are reported separately as cum_deaths_all."]
    : [];
}

export function errorOutcome(message: string): ToolOutcome {
  return { content: message, isError: true, payload: { kind: "tool_error", message } };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The agent's _record: remember the fields as data sources and return their citations. */
export function recordSources(scenario: Scenario, fields: ResolvedField[]): string[] {
  scenario.dataSources.push(...fields);
  return fields.map((f) => f.citation);
}
