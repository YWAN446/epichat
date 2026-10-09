import type { Adapters, ResolvedField } from "@/lib/data/types";
import type { ParameterSummary } from "@/lib/disease/db";
import type { Stage } from "@/lib/enums";
import type { RepairRecord, SimClient, SimResult, SimStats } from "@/lib/sim/client";
import type { SimParams } from "@/lib/sim/params";

export type WebSource = { title: string; url: string };

/** The deterministic simulation state (parent spec 9.4); replaces the Python AgentState. */
export type Scenario = {
  id: string | null;
  seq: number;
  params: SimParams | null;
  disease: string | null;
  countryIso3: string | null;
  totalPopulation: number | null;
  dataSources: ResolvedField[];
  webSources: WebSource[];
  stage: Stage;
  stageReached: Stage;
  hasRun: boolean;
  /** A report exists for this scenario. */
  hasReport: boolean;
  /** The latest report was written after the latest run; a run resets it. */
  reportCurrent: boolean;
};

export function emptyScenario(seq = 1): Scenario {
  return { id: null, seq, params: null, disease: null, countryIso3: null, totalPopulation: null, dataSources: [], webSources: [], stage: "understand", stageReached: "understand", hasRun: false, hasReport: false, reportCurrent: false };
}

/** start_new_scenario: the same object becomes the next, empty scenario. */
export function resetScenario(scenario: Scenario): void {
  Object.assign(scenario, emptyScenario(scenario.seq + 1));
}

export type DiseasePayload = { kind: "disease"; canonical_name: string; display_name: string; parameters: Record<string, ParameterSummary> };
export type ConfigPayload = {
  kind: "config";
  applied: Record<string, unknown>;
  approx_r0: number;
  config: { disease: string | null; disease_type: string; country: string | null; n_agents: number; sim_dur_years: number; dur_inf: number; dur_exp: number | null; interventions: string[] };
  warnings: string[];
  new_scenario: boolean;
};
export type DataPayload = { kind: "data"; source: "un_wpp" | "wb_data360" | "who_gho" | "sim_fallback"; iso3: string; applied: Record<string, unknown>; citations: string[]; warnings?: string[]; approx_r0?: number };
export type RunPayload = {
  kind: "run";
  run_id: string | null;
  stats: SimStats;
  stats_agents: SimStats;
  attack_rate_pct: number;
  pop_scale: number;
  population: number;
  effective_params: SimParams;
  warnings: string[];
  repairs: RepairRecord[];
  data_sources: ResolvedField[];
  duration_ms: number;
  cold_start: boolean;
  /** Only on the live stream event; stored without it (the runs row keeps it). */
  series?: Record<string, number[]>;
};
export type ToolErrorPayload = { kind: "tool_error"; message: string };
export type CardPayload = (DiseasePayload | ConfigPayload | DataPayload | RunPayload | ToolErrorPayload) & { duration_ms?: number };

/** What a tool sends back: `content` for the model, `payload` for the card and the event store. */
export type ToolOutcome = { content: string; isError?: boolean; payload?: CardPayload };

export type RunRecord = { params: SimParams; popScale: number; result: SimResult; warnings: string[]; dataSources: ResolvedField[] };

/** Everything a tool may touch. Built fresh for each chat request. */
export type ToolDeps = {
  /** Mutable; tools update it in place and the handler saves it at the end. */
  scenario: Scenario;
  sim: SimClient;
  adapters: Adapters;
  /** The conversation's user texts joined with spaces plus the current text (the Python agent's context_text). */
  contextText: string;
  turnId: string;
  /** Insert the runs row; returns its id or null when the insert failed. */
  onRun: (run: RunRecord) => Promise<string | null>;
  /** The scenario was just reset; the handler records new_scenario. */
  onScenarioStart: () => void;
};
