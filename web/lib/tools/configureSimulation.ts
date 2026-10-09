import { z } from "zod";
import { detectDisease } from "@/lib/disease/db";
import { DEFAULT_BETA, approxR0, calibrateBeta, clampBeta, validateParams } from "@/lib/sim/params";
import { pyRound } from "@/lib/sim/pyformat";
import { configView } from "./configView";
import { errorOutcome, given, paramWarnings, upsertIntervention } from "./shared";
import { resetScenario, type ToolDeps, type ToolOutcome } from "./types";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish();

export const ConfigureSimulationInput = z.strictObject({
  disease: opt(z.string()),
  country_iso3: opt(z.string()),
  disease_type: opt(z.string()),
  n_agents: opt(z.number()),
  sim_dur_years: opt(z.number()),
  r0: opt(z.number()),
  dur_inf: opt(z.number()),
  dur_exp: opt(z.number()),
  dur_immune: opt(z.number()),
  p_death: opt(z.number()),
  p_asymp: opt(z.number()),
  init_prev: opt(z.number()),
  vaccine_coverage: opt(z.number()),
  vaccine_start_day: opt(z.number()),
  treatment_capacity: opt(z.number()),
  seasonality_scale: opt(z.number()),
  start_new_scenario: opt(z.boolean()),
});
export type ConfigureSimulationArgs = z.infer<typeof ConfigureSimulationInput>;

const DIRECT = ["disease_type", "n_agents", "sim_dur_years", "dur_inf", "dur_exp", "dur_immune", "p_death", "p_asymp", "init_prev"] as const;

/** Ported from epichat/agent.py configure_simulation, plus start_new_scenario. */
export async function configureSimulation(input: ConfigureSimulationArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const newScenario = input.start_new_scenario === true;
  if (newScenario) {
    resetScenario(deps.scenario);
    deps.onScenarioStart();
  }
  const scenario = deps.scenario;
  const base: Record<string, unknown> = scenario.params ? { ...scenario.params } : { beta: DEFAULT_BETA };
  const applied: Record<string, unknown> = {};
  for (const key of DIRECT) {
    const value = input[key];
    if (given(value)) {
      base[key] = value;
      applied[key] = value;
    }
  }
  if (given(input.country_iso3)) {
    base.country = input.country_iso3;
    applied.country = input.country_iso3;
  }

  let interventions = [...((base.interventions as Record<string, unknown>[] | undefined) ?? [])];
  if (given(input.vaccine_coverage) || given(input.vaccine_start_day)) {
    const current = interventions.find((i) => i.type === "vaccine") ?? {};
    const coverage = given(input.vaccine_coverage) ? input.vaccine_coverage : (current.coverage as number | null | undefined);
    const startDay = given(input.vaccine_start_day) ? input.vaccine_start_day : ((current.start_day as number | undefined) ?? 0);
    if (!given(coverage)) {
      return errorOutcome("CONFIG ERROR: a vaccination campaign needs a coverage level — pass vaccine_coverage alongside vaccine_start_day.");
    }
    interventions = upsertIntervention(interventions, "vaccine", { coverage, start_day: startDay });
    applied.vaccine_coverage = coverage;
    applied.vaccine_start_day = startDay;
  }
  if (given(input.treatment_capacity)) {
    interventions = upsertIntervention(interventions, "treatment", { coverage: 1.0, capacity: input.treatment_capacity });
    applied.treatment_capacity = input.treatment_capacity;
  }
  if (given(input.seasonality_scale)) {
    interventions = upsertIntervention(interventions, "seasonality", { scale: input.seasonality_scale });
    applied.seasonality_scale = input.seasonality_scale;
  }
  base.interventions = interventions;

  const validated = validateParams(base);
  if (!validated.ok) return errorOutcome(`CONFIG ERROR: ${validated.error}`);
  let params = validated.params;
  if (given(input.r0)) {
    const beta = clampBeta(calibrateBeta(params, input.r0));
    const revalidated = validateParams({ ...params, beta });
    if (!revalidated.ok) return errorOutcome(`CONFIG ERROR: ${revalidated.error}`);
    params = revalidated.params;
    applied.r0 = input.r0;
  }

  if (given(input.disease)) {
    scenario.disease = detectDisease(input.disease) ?? input.disease.toLowerCase();
    applied.disease = scenario.disease;
  }
  scenario.params = params;
  scenario.countryIso3 = params.country;
  const warnings = paramWarnings(scenario, params, deps.contextText);
  const config = configView(params, scenario.disease);
  const approx_r0 = pyRound(approxR0(params), 2);
  return {
    content: JSON.stringify({ applied, approx_r0, config, warnings }),
    payload: { kind: "config", applied, approx_r0, config, warnings, new_scenario: newScenario, params },
  };
}
