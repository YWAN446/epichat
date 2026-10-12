import { z } from "zod";
import { detectDisease } from "@/lib/disease/db";
import { R0UnreachableError, approxR0, validateParams, withR0, type Duration, type SimParams } from "@/lib/sim/params";
import { changedPaths, type PathChange } from "@/lib/sim/paths";
import { pyRound } from "@/lib/sim/pyformat";
import { applyAdvanced } from "./advanced";
import { configView } from "./configView";
import { durationFor, type DurationName } from "./durations";
import { matchedLevers } from "./options";
import { errorOutcome, given, paramWarnings, upsertIntervention } from "./shared";
import { resetScenario, type ToolDeps, type ToolOutcome } from "./types";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish();

export const ConfigureSimulationInput = z.strictObject({
  disease: opt(z.string()),
  country_iso3: opt(z.string()),
  model: opt(z.string()),
  disease_type: opt(z.string()),
  n_agents: opt(z.number()),
  sim_dur_years: opt(z.number()),
  r0: opt(z.number()),
  dur_inf_days: opt(z.number()),
  dur_exp_days: opt(z.number()),
  dur_immune_days: opt(z.number()),
  p_death: opt(z.number()),
  p_asymp: opt(z.number()),
  seed_fraction: opt(z.number()),
  seed_count: opt(z.number()),
  vaccine_coverage: opt(z.number()),
  vaccine_start_day: opt(z.number()),
  treatment_capacity: opt(z.number()),
  seasonality_scale: opt(z.number()),
  advanced: opt(z.record(z.string(), z.unknown())),
  start_new_scenario: opt(z.boolean()),
});
export type ConfigureSimulationArgs = z.infer<typeof ConfigureSimulationInput>;

type Obj = Record<string, unknown>;
type DurationField = "dur_inf_days" | "dur_exp_days" | "dur_immune_days";
const DURATION_FIELDS: [DurationName, DurationField][] = [["dur_inf", "dur_inf_days"], ["dur_exp", "dur_exp_days"], ["dur_immune", "dur_immune_days"]];
/** A beta clamped at the registry bound carries less R0 than asked; above this relative gap the tool says so. */
const R0_CLAMP_TOLERANCE = 0.01;

const block = (base: Obj, key: string): Obj => {
  if (typeof base[key] !== "object" || base[key] === null) base[key] = {};
  return base[key] as Obj;
};

/**
 * Ported from epichat/agent.py configure_simulation, on schema v2 with the
 * field names of spec 9.1, the advanced patch (applied after the fields,
 * validated once), `changed`, start_new_scenario, and the gamma defaults of
 * spec 7.3.
 */
export async function configureSimulation(input: ConfigureSimulationArgs, deps: ToolDeps): Promise<ToolOutcome> {
  if (given(input.seed_fraction) && given(input.seed_count)) return errorOutcome("CONFIG ERROR: seed_fraction and seed_count are mutually exclusive; pass one of them.");
  const newScenario = input.start_new_scenario === true;
  if (newScenario) {
    resetScenario(deps.scenario);
    deps.onScenarioStart();
  }
  const scenario = deps.scenario;
  const before = scenario.params;
  const fresh = before === null;
  const base: Obj = before ? (structuredClone(before) as unknown as Obj) : { schema_version: 2 };
  const disease = block(base, "disease");
  const run = block(base, "run");
  const demographics = block(base, "demographics");
  const applied: Obj = {};

  if (given(input.disease)) {
    scenario.disease = detectDisease(input.disease) ?? input.disease.toLowerCase();
    applied.disease = scenario.disease;
  }
  const model = given(input.model) ? input.model : input.disease_type;
  if (given(model)) {
    disease.model = model;
    applied.model = model;
  }
  if (given(input.n_agents)) {
    run.n_agents = input.n_agents;
    applied.n_agents = input.n_agents;
  }
  if (given(input.sim_dur_years)) {
    run.sim_dur_years = input.sim_dur_years;
    applied.sim_dur_years = input.sim_dur_years;
  }
  for (const [name, field] of DURATION_FIELDS) {
    const value = input[field];
    if (given(value)) {
      disease[name] = durationFor(disease[name] as Duration | null | undefined, value, name, scenario.disease);
      applied[field] = value;
    }
  }
  if (fresh && !given(input.dur_inf_days)) disease.dur_inf = durationFor(undefined, 10, "dur_inf", scenario.disease);
  if (given(input.p_death)) {
    disease.p_death = input.p_death;
    applied.p_death = input.p_death;
  }
  if (given(input.p_asymp)) {
    disease.p_asymp = input.p_asymp;
    applied.p_asymp = input.p_asymp;
  }
  const seedDay = ((disease.seed as Obj | undefined)?.day as number | undefined) ?? 0;
  if (given(input.seed_fraction)) {
    disease.seed = { mode: "fraction", value: input.seed_fraction, day: seedDay };
    applied.seed_fraction = input.seed_fraction;
  }
  if (given(input.seed_count)) {
    disease.seed = { mode: "count", value: input.seed_count, day: seedDay };
    applied.seed_count = input.seed_count;
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

  if (given(input.advanced) && Object.keys(input.advanced).length > 0) {
    // After the core fields, so a path given both ways takes the patch's value (spec 19); checked whole before anything is written.
    const problem = applyAdvanced(base, input.advanced);
    if (problem) return errorOutcome(`CONFIG ERROR: ${problem}`);
    Object.assign(applied, input.advanced); // flat, by path, so the chat line reads them like the fields
  }

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
  const approx_r0 = pyRound(approxR0(params), 2);
  if (given(input.r0) && Math.abs(approx_r0 - input.r0) > R0_CLAMP_TOLERANCE * input.r0) {
    warnings.push(`beta was clamped at ${params.disease.beta}, so the run's R0 is ${approx_r0} rather than the requested ${input.r0}; more contacts or a longer infectious period would reach it.`);
  }
  const changed: PathChange[] = before ? changedPaths(before as unknown as Obj, params as unknown as Obj) : [];
  if (scenario.hasRun && changed.length > 0) {
    // Spec 11: a lever is taken when the applied patch carries every one of its paths with its value.
    const previous = await deps.previousRun();
    for (const match of matchedLevers(previous, changed, params)) deps.onOptionChosen(previous!.id, match.diagnosticId, match.patch);
  }
  const config = configView(params, scenario.disease);
  return {
    content: JSON.stringify({ applied, changed, approx_r0, config, warnings }),
    payload: { kind: "config", applied, changed, approx_r0, config, warnings, new_scenario: newScenario, params },
  };
}
