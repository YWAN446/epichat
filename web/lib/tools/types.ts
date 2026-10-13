import type { Adapters, ResolvedField } from "@/lib/data/types";
import type { PreviousRun, ReportRun } from "@/lib/db/runs";
import type { ReportDocument, ReportNarrative, ReportPayload } from "@/lib/report/document";
import type { ParameterSummary } from "@/lib/disease/db";
import type { MemoryKind, Stage } from "@/lib/enums";
import type { Memory } from "@/lib/profile/about";
import type { Diagnostic, RepairRecord, SimClient, SimResult, SimStats } from "@/lib/sim/client";
import type { DiseaseEntry } from "@/lib/disease/db";
import type { SimParams } from "@/lib/sim/params";
import type { PathChange } from "@/lib/sim/paths";
import type { ParamSource } from "./sources";

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
  /** Spec 9.1: what this call changed, by path; absent on payloads stored before it existed, empty on a fresh scenario. */
  changed?: PathChange[];
  approx_r0: number;
  config: { disease: string | null; disease_type: string; country: string | null; n_agents: number; sim_dur_years: number; dur_inf: number; dur_exp: number | null; interventions: string[] };
  warnings: string[];
  new_scenario: boolean;
  /** The scenario's full parameters after this step, for the panel's Parameters section; absent on payloads stored before it existed. */
  params?: SimParams;
  /** Follow-up spec 8.4: where each of those values came from, by registry path; absent on payloads stored before it existed. */
  sources?: Record<string, ParamSource>;
};
export type DataPayload = {
  kind: "data";
  source: "un_wpp" | "wb_data360" | "who_gho" | "sim_fallback";
  iso3: string;
  applied: Record<string, unknown>;
  citations: string[];
  warnings?: string[];
  approx_r0?: number;
  /** The scenario's full parameters after this step (see ConfigPayload.params). */
  params?: SimParams;
  /** Where each of those values came from (see ConfigPayload.sources). */
  sources?: Record<string, ParamSource>;
};
/** Spec 11: this run against the scenario's previous successful run. */
export type RunCompare = {
  previous_run_id: string;
  changed: PathChange[];
  stats_delta: { peak_infections: number; peak_day: number; total_infected: number; total_deaths: number };
  /** The population scale of each run; the delta is in today's scale, the previous run rescaled to it. */
  pop_scale: { from: number; to: number };
};
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
  /** Per-replicate stats when run.n_replicates > 1 (spec 8.7); the bands wait for the workspace follow-up. */
  replicates?: { n: number; seeds: number[]; representative: number; stats: SimStats[] };
  /** Spec 10: what the run's shape suggests about the configuration; absent on payloads stored before phase 4. */
  diagnostics?: Diagnostic[];
  /** Spec 11: against the previous run, or null for the scenario's first run. */
  compare?: RunCompare | null;
  /** Part 2, 5.7: beta_calibrated_by_measurement when the service corrected beta to the measured R0. */
  applied?: Record<string, unknown>;
  /** Follow-up spec 8.4: where each configured value came from, by registry path: the scenario's own parameters, so a beta the run calibrated or a lever it fitted keeps the source of what was configured. */
  sources?: Record<string, ParamSource>;
};
export type ToolErrorPayload = { kind: "tool_error"; message: string };
/** A remember call (profile spec, section 9). */
export type MemoryPayload = { kind: "memory"; memory_id: string; memory_kind: MemoryKind; text: string; replaced: boolean };
/** A describe_parameters call (sim-parameters spec 9.2): the list itself is the tool's content for the model. */
export type ParametersPayload = { kind: "parameters"; model: string; disease: string | null; count: number };
export type CardPayload = (DiseasePayload | ConfigPayload | DataPayload | RunPayload | ReportPayload | MemoryPayload | ParametersPayload | ToolErrorPayload) & { duration_ms?: number };

/** What a tool sends back: `content` for the model, `payload` for the card and the event store. */
export type ToolOutcome = { content: string; isError?: boolean; payload?: CardPayload };

export type RunRecord = { params: SimParams; popScale: number; result: SimResult; warnings: string[]; dataSources: ResolvedField[] };

/** What write_report reads and writes; built by the chat handler from the stores (report spec, section 7.2). */
export type ReportDeps = {
  runs(): Promise<ReportRun[]>;
  recap(): Promise<string[]>;
  nextVersion(): Promise<number>;
  /** The id, or null when the insert failed (the handler logs it). */
  insert(report: { version: number; title: string; language: string; narrative: ReportNarrative; document: ReportDocument }): Promise<string | null>;
  conversationTitle: string;
};

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
  /** The scenario's latest successful run (this turn's included), for the comparison and the option matching; null when there is none or the read failed. */
  previousRun: () => Promise<PreviousRun | null>;
  /** The next configuration applied a diagnostic's lever (spec 11); the handler records option_chosen. */
  onOptionChosen: (runId: string, diagnosticId: string, patch: Record<string, unknown>, interventions?: Record<string, unknown>[]) => void;
  /** The disease database as the tools read it; tests substitute entries (Part 2, 7.4: the vaccine efficacy path). */
  lookupDisease?: (name: string) => DiseaseEntry | null;
  reports: ReportDeps;
  /** The participant's memory (profile spec, section 9); `added` counts this turn's remember calls. */
  memory: {
    enabled: boolean;
    added: number;
    list(): Promise<Memory[]>;
    /** `replaces` is the earlier memory's text as the About block shows it. */
    add(kind: MemoryKind, text: string, replaces?: string): Promise<{ id: string } | "full" | "not_found">;
  };
};
