import type { ResolvedField } from "@/lib/data/types";
import { checkParams } from "@/lib/disease/checkParams";
import { detectDisease } from "@/lib/disease/db";
import { approxR0, type SimParams } from "@/lib/sim/params";
import type { Scenario, ToolOutcome } from "./types";

export const NEEDS_CONFIG = "Call configure_simulation first to establish the simulation before fetching data.";

export function given<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

/** epichat/agent.py _upsert_intervention: drop every intervention of the kind, append the new one. */
export function upsertIntervention(list: Record<string, unknown>[], kind: string, fields: Record<string, unknown>): Record<string, unknown>[] {
  return [...list.filter((i) => i.type !== kind), { type: kind, ...fields }];
}

/** epichat/agent.py _param_warnings */
export function paramWarnings(scenario: Scenario, params: SimParams, contextText: string): string[] {
  const disease = scenario.disease ?? detectDisease(contextText || "");
  if (!disease) return [];
  return checkParams(disease, approxR0(params), params.dur_inf, params.dur_exp, {
    pDeath: params.p_death || null,
    nContacts: params.n_contacts,
    durImmune: params.dur_immune,
    pAsymp: params.disease_type === "seiar" ? params.p_asymp : null,
  });
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
