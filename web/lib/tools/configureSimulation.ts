import { z } from "zod";
import { detectDisease } from "@/lib/disease/db";
import { R0UnreachableError, approxR0, validateParams, withR0, type Duration, type SimParams } from "@/lib/sim/params";
import { pyRound } from "@/lib/sim/pyformat";
import { configView } from "./configView";
import { durationFor, type DurationName } from "./durations";
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

type Obj = Record<string, unknown>;
const DURATIONS: DurationName[] = ["dur_inf", "dur_exp", "dur_immune"];

const block = (base: Obj, key: string): Obj => {
  if (typeof base[key] !== "object" || base[key] === null) base[key] = {};
  return base[key] as Obj;
};

/** Ported from epichat/agent.py configure_simulation, on schema v2, plus start_new_scenario and the gamma defaults of spec 7.3. */
export async function configureSimulation(input: ConfigureSimulationArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const newScenario = input.start_new_scenario === true;
  if (newScenario) {
    resetScenario(deps.scenario);
    deps.onScenarioStart();
  }
  const scenario = deps.scenario;
  const fresh = scenario.params === null;
  const base: Obj = scenario.params ? (structuredClone(scenario.params) as unknown as Obj) : { schema_version: 2 };
  const disease = block(base, "disease");
  const run = block(base, "run");
  const demographics = block(base, "demographics");
  const applied: Obj = {};

  if (given(input.disease)) {
    scenario.disease = detectDisease(input.disease) ?? input.disease.toLowerCase();
    applied.disease = scenario.disease;
  }
  if (given(input.disease_type)) {
    disease.model = input.disease_type;
    applied.disease_type = input.disease_type;
  }
  if (given(input.n_agents)) {
    run.n_agents = input.n_agents;
    applied.n_agents = input.n_agents;
  }
  if (given(input.sim_dur_years)) {
    run.sim_dur_years = input.sim_dur_years;
    applied.sim_dur_years = input.sim_dur_years;
  }
  for (const name of DURATIONS) {
    const value = input[name];
    if (given(value)) {
      disease[name] = durationFor(disease[name] as Duration | null | undefined, value, name, scenario.disease);
      applied[name] = value;
    }
  }
  if (fresh && !given(input.dur_inf)) disease.dur_inf = durationFor(undefined, 10, "dur_inf", scenario.disease);
  if (given(input.p_death)) {
    disease.p_death = input.p_death;
    applied.p_death = input.p_death;
  }
  if (given(input.p_asymp)) {
    disease.p_asymp = input.p_asymp;
    applied.p_asymp = input.p_asymp;
  }
  if (given(input.init_prev)) {
    disease.seed = { mode: "fraction", value: input.init_prev, day: 0 };
    applied.init_prev = input.init_prev;
  }
  if (given(input.country_iso3)) {
    demographics.country = input.country_iso3;
    applied.country = input.country_iso3;
  }

  let interventions = [...((base.interventions as Obj[] | undefined) ?? [])];
  if (given(input.vaccine_coverage) || given(input.vaccine_start_day)) {
    // A day-0 vaccine lives in disease.initial_immune_frac (spec 6.1, section 18); a later start is a routine campaign.
    const immune = Number(disease.initial_immune_frac ?? 0);
    const current = interventions.find((i) => i.type === "vaccine") ?? (immune > 0 ? { coverage: immune, start_day: 0 } : {});
    const coverage = given(input.vaccine_coverage) ? input.vaccine_coverage : (current.coverage as number | null | undefined);
    const startDay = given(input.vaccine_start_day) ? input.vaccine_start_day : ((current.start_day as number | undefined) ?? 0);
    if (!given(coverage)) {
      return errorOutcome("CONFIG ERROR: a vaccination campaign needs a coverage level — pass vaccine_coverage alongside vaccine_start_day.");
    }
    interventions = interventions.filter((i) => i.type !== "vaccine");
    if (startDay > 0) {
      interventions = upsertIntervention(interventions, "vaccine", { coverage, start_day: startDay });
      disease.initial_immune_frac = 0;
    } else {
      disease.initial_immune_frac = Math.min(coverage, 0.99);
    }
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
  let params: SimParams = validated.params;
  if (given(input.r0)) {
    try {
      params = withR0(params, input.r0);
    } catch (error) {
      if (error instanceof R0UnreachableError) return errorOutcome(`CONFIG ERROR: ${error.message}.`);
      throw error;
    }
    const revalidated = validateParams(params);
    if (!revalidated.ok) return errorOutcome(`CONFIG ERROR: ${revalidated.error}`);
    params = revalidated.params;
    applied.r0 = input.r0;
  }

  scenario.params = params;
  scenario.countryIso3 = params.demographics.country;
  const warnings = paramWarnings(scenario, params, deps.contextText);
  const config = configView(params, scenario.disease);
  const approx_r0 = pyRound(approxR0(params), 2);
  return {
    content: JSON.stringify({ applied, approx_r0, config, warnings }),
    payload: { kind: "config", applied, approx_r0, config, warnings, new_scenario: newScenario, params },
  };
}
