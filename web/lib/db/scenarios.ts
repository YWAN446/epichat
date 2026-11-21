import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedField } from "@/lib/data/types";
import { STAGES, type Stage } from "@/lib/enums";
import { validateParams } from "@/lib/sim/params";
import type { Area, Scenario, WebSource } from "@/lib/tools/types";

/** The scenario as finish_turn's `p.scenario` and as the row reads back. */
export type ScenarioJson = {
  id: string | null;
  seq: number;
  params: unknown;
  disease: string | null;
  country_iso3: string | null;
  total_population: number | null;
  /** Round-1 spec 1: absent on rows read before migration 0008's column existed in the select. */
  area?: Area | null;
  data_sources: unknown;
  web_sources: unknown;
  stage: string | null;
  stage_reached: string | null;
  has_run: boolean;
  has_report: boolean;
  report_current: boolean;
};

export interface ScenarioStore {
  get(id: string): Promise<Scenario | null>;
}

const COLUMNS = "id, seq, params, disease, country_iso3, total_population, area, data_sources, web_sources, stage, stage_reached, has_run, has_report, report_current";

function stageOf(value: unknown, fallback: Stage): Stage {
  return (STAGES as readonly string[]).includes(value as string) ? (value as Stage) : fallback;
}

/** A stored area, or null for none or for one that no longer reads as an area (logged). */
function areaOf(value: unknown, id: string | null): Area | null {
  if (value === null || value === undefined) return null;
  const a = value as Partial<Area>;
  const ok = typeof a.name === "string" && a.name.trim() !== "" && typeof a.population === "number" && Number.isInteger(a.population) && a.population > 0
    && typeof a.source === "object" && a.source !== null && (a.source.kind === "user" || a.source.kind === "web");
  if (!ok) {
    console.error(`scenario ${id} has an unusable area`);
    return null;
  }
  return { name: a.name!, population: a.population!, countryIso3: a.countryIso3 ?? null, source: a.source! };
}

/** A row as the tools use it. Params that no longer validate are treated as absent, so an old row cannot break a turn. */
export function scenarioFromRow(row: ScenarioJson): Scenario {
  let params: Scenario["params"] = null;
  if (row.params !== null && row.params !== undefined) {
    const result = validateParams(row.params);
    if (result.ok) params = result.params;
    else console.error(`scenario ${row.id} has unusable params: ${result.error}`);
  }
  const stage = stageOf(row.stage, "understand");
  return {
    id: row.id,
    seq: Number(row.seq),
    params,
    disease: row.disease ?? null,
    countryIso3: row.country_iso3 ?? null,
    totalPopulation: row.total_population === null || row.total_population === undefined ? null : Number(row.total_population),
    area: areaOf(row.area, row.id),
    dataSources: Array.isArray(row.data_sources) ? (row.data_sources as ResolvedField[]) : [],
    webSources: Array.isArray(row.web_sources) ? (row.web_sources as WebSource[]) : [],
    stage,
    stageReached: stageOf(row.stage_reached, stage),
    hasRun: Boolean(row.has_run),
    hasReport: Boolean(row.has_report),
    reportCurrent: Boolean(row.report_current),
  };
}

/** The scenario as finish_turn stores it. */
export function scenarioToJson(s: Scenario): ScenarioJson {
  return {
    id: s.id, seq: s.seq, params: s.params, disease: s.disease, country_iso3: s.countryIso3, total_population: s.totalPopulation, area: s.area,
    data_sources: s.dataSources, web_sources: s.webSources, stage: s.stage, stage_reached: s.stageReached, has_run: s.hasRun,
    has_report: s.hasReport, report_current: s.reportCurrent,
  };
}

export function supabaseScenarioStore(admin: SupabaseClient): ScenarioStore {
  return {
    async get(id) {
      const { data, error } = await admin.from("scenarios").select(COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error(`scenarios read failed: ${error.message}`);
      return data ? scenarioFromRow(data as ScenarioJson) : null;
    },
  };
}
