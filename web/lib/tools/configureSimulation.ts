import { z } from "zod";
import { fitText } from "@/lib/client/format";
import type { PreviousRun } from "@/lib/db/runs";
import { detectDisease } from "@/lib/disease/db";
import { InterventionSchema, FitSchema, R0UnreachableError, approxR0, isV1Vaccine, recalibrateBeta, validateParams, withR0, type Duration, type Intervention, type SimParams } from "@/lib/sim/params";
import { changedPaths, setPath, type PathChange } from "@/lib/sim/paths";
import { fmtValue, pyRound } from "@/lib/sim/pyformat";
import { applyAdvanced } from "./advanced";
import { configView } from "./configView";
import { durationFor, type DurationName } from "./durations";
import { matchedLevers } from "./options";
import { errorOutcome, given, paramWarnings, upsertIntervention } from "./shared";
import { near, scenarioSources } from "./sources";
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
  network_type: opt(z.string()),
  household_size: opt(z.number()),
  interventions: opt(z.array(z.record(z.string(), z.unknown()))),
  remove_interventions: opt(z.array(z.string())),
  fit: z.record(z.string(), z.unknown()).nullable().optional(),
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
const BETA_FIT_LEVERS = ["disease.beta", "network.network_beta"];

/**
 * The scenario with its fit ended and the value the fitted run found written into the lever, or null when the last run was not a
 * run of this fit (another target, value or lever, or no fit at all). A fitted beta or network multiplier also switches the
 * measured-R0 calibration off: on a network where the pilot runs it would move the fitted value back to the formula's R0.
 */
function keepFittedValue(params: SimParams, previous: PreviousRun): { params: SimParams; note: string } | null {
  const fit = params.run.fit;
  const ran = previous.effectiveParams.run?.fit;
  const found = previous.stats.fit;
  if (!fit || !ran || !found || ran.target !== fit.target || ran.lever !== fit.lever || !near(ran.value, fit.value) || found.lever !== fit.lever) return null;
  const body = structuredClone(params) as unknown as Obj;
  (body.run as Obj).fit = null;
  if (fit.lever === "behavior_response.scale") {
    const response = (body.interventions as Obj[]).find((i) => i.type === "behavior_response");
    if (!response) return null;
    response.scale = found.value;
  } else {
    setPath(body, fit.lever, found.value);
    if (BETA_FIT_LEVERS.includes(fit.lever)) (body.run as Obj).calibrate_r0 = false;
  }
  const validated = validateParams(body);
  if (!validated.ok) return null;
  const calibration = BETA_FIT_LEVERS.includes(fit.lever) ? " The measured-R0 calibration is off for this scenario, since its beta is the fitted one." : "";
  return {
    params: validated.params,
    note: `This change to the interventions ended the fit (${fitText(fit.target, fit.value)}) and kept the fitted value of ${fit.lever} (${fmtValue(found.value)}), so the next run shows the change against the fitted baseline.${calibration} Pass fit again in the same call to fit with the change in place.`,
  };
}

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
  const network = block(base, "network");
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
  if (given(input.network_type)) {
    network.network_type = input.network_type;
    applied.network_type = input.network_type;
  }
  if (given(input.household_size)) {
    network.household_size = input.household_size;
    applied.household_size = input.household_size;
  }

  let interventions = [...((base.interventions as Obj[] | undefined) ?? [])];
  if (given(input.vaccine_coverage) || given(input.vaccine_start_day)) {
    // A day-0 vaccine lives in disease.initial_immune_frac (spec 6.1, section 18); a later start is a routine campaign. An entry with an
    // efficacy, a window, ages or waning (the database efficacy path, Part 2 7.4) keeps them and takes the new coverage or start (2C review, I6).
    const immune = Number(disease.initial_immune_frac ?? 0);
    const existing = interventions.find((i) => i.type === "vaccine");
    const campaignOnTop = immune > 0 && existing !== undefined && !isV1Vaccine(existing as unknown as Intervention);
    if (campaignOnTop && given(input.vaccine_start_day)) {
      // Review of the follow-up's phase B: routine immunity and a campaign on top of it (what_if offers one) are two things, and a
      // start day does not say which one moves.
      return errorOutcome(`CONFIG ERROR: the scenario has routine immunity (${fmtValue(immune)}) and a vaccination campaign (coverage ${fmtValue(existing.coverage)} from day ${fmtValue(existing.start_day)}); `
        + "vaccine_coverage alone sets the routine immunity, and the campaign is changed through interventions [{type: vaccine, ...}] or removed with remove_interventions.");
    }
    const current = existing ?? (immune > 0 ? { coverage: immune, start_day: 0 } : {});
    const coverage = given(input.vaccine_coverage) ? input.vaccine_coverage : (current.coverage as number | null | undefined);
    const startDay = given(input.vaccine_start_day) ? input.vaccine_start_day : ((current.start_day as number | undefined) ?? 0);
    if (!given(coverage)) {
      return errorOutcome("CONFIG ERROR: a vaccination campaign needs a coverage level — pass vaccine_coverage alongside vaccine_start_day.");
    }
    const rich = existing !== undefined && !isV1Vaccine(existing as unknown as Intervention);
    if (campaignOnTop) {
      disease.initial_immune_frac = Math.min(coverage, 0.99);        // the routine coverage; the campaign keeps its own
    } else if (rich) {
      interventions = interventions.filter((i) => i.type !== "vaccine");
      // the window moves with the start: a one-day campaign stays one day, a window that would end before the new start ends on it
      const endDay = existing.end_day as number | null | undefined;
      const end = endDay === null || endDay === undefined ? null : Math.max(endDay, startDay);
      interventions = upsertIntervention(interventions, "vaccine", { ...existing, coverage, start_day: startDay, end_day: end });
      disease.initial_immune_frac = 0;
    } else if (startDay > 0) {
      interventions = interventions.filter((i) => i.type !== "vaccine");
      interventions = upsertIntervention(interventions, "vaccine", { coverage, start_day: startDay });
      disease.initial_immune_frac = 0;
    } else {
      interventions = interventions.filter((i) => i.type !== "vaccine");
      disease.initial_immune_frac = Math.min(coverage, 0.99);
    }
    applied.vaccine_coverage = coverage;
    applied.vaccine_start_day = campaignOnTop ? 0 : startDay;
  }
  if (given(input.treatment_capacity)) {
    interventions = upsertIntervention(interventions, "treatment", { coverage: 1.0, capacity: input.treatment_capacity });
    applied.treatment_capacity = input.treatment_capacity;
  }
  if (given(input.seasonality_scale)) {
    interventions = upsertIntervention(interventions, "seasonality", { scale: input.seasonality_scale });
    applied.seasonality_scale = input.seasonality_scale;
  }
  if (given(input.interventions)) {
    // Part 2, 7.4: structured entries, each replacing the one of its type (and layer for a contact reduction)
    for (const raw of input.interventions) {
      const parsed = InterventionSchema.safeParse(raw);
      if (!parsed.success) return errorOutcome(`CONFIG ERROR: interventions entry ${JSON.stringify(raw)}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      const entry = parsed.data as unknown as Obj;
      interventions = upsertIntervention(interventions, String(entry.type), entry, entry.type === "contact_reduction" ? String(entry.layer) : undefined);
    }
    applied.interventions = input.interventions;
  }
  if (given(input.remove_interventions)) {
    for (const key of input.remove_interventions) {
      const [type, layer] = key.split(":");
      interventions = interventions.filter((i) => !(i.type === type && (layer === undefined || (i.layer ?? "all") === layer)));
    }
    applied.remove_interventions = input.remove_interventions;
  }
  base.interventions = interventions;
  if (input.fit !== undefined) {
    // Part 2, 7.7: one outcome the user knows; a peak size in people becomes agents when the population is known
    if (input.fit === null) {
      run.fit = null;
      applied.fit = null;
    } else {
      const parsed = FitSchema.safeParse(input.fit);
      if (!parsed.success) return errorOutcome(`CONFIG ERROR: fit: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      const fit = parsed.data;
      const nAgents = Number(run.n_agents ?? before?.run.n_agents ?? 10000);
      if (fit.target === "peak_infections" && scenario.totalPopulation) {
        const agents = Math.max(1, Math.round(fit.value / (scenario.totalPopulation / nAgents)));
        run.fit = { ...fit, value: agents };
        applied.fit = { ...input.fit, value_in_agents: agents };
      } else {
        run.fit = fit;
        applied.fit = input.fit;
      }
    }
  }

  if (given(input.advanced) && Object.keys(input.advanced).length > 0) {
    // After the core fields, so a path given both ways takes the patch's value (spec 19); checked whole before anything is written.
    const problem = applyAdvanced(base, input.advanced);
    if (problem) return errorOutcome(`CONFIG ERROR: ${problem}`);
    Object.assign(applied, input.advanced); // flat, by path, so the chat line reads them like the fields
    // Part 2, 6.1: a share the user edits is theirs; the builder draws uniform ages within the shares from then on.
    const keys = Object.keys(input.advanced);
    if (keys.some((k) => k.startsWith("demographics.age_pct_")) && !keys.includes("demographics.age_source")) (base.demographics as Obj).age_source = "shares";
    // Part 2, 5.3: an edited matrix cell is the user's matrix.
    if (keys.some((k) => k.startsWith("network.contacts.")) && !keys.includes("network.contacts_source")) (base.network as Obj).contacts_source = "user";
  }

  const validated = validateParams(base);
  if (!validated.ok) return errorOutcome(`CONFIG ERROR: ${validated.error}`);
  let params: SimParams = validated.params;
  if (before && !given(input.r0)) {
    // Part 2, 5.9: a change of the network's structure (its type, its matrix, the age shares) alters what R0 a beta implies; hold the R0
    // the user confirmed when the new network can carry it. A change of contact counts or multipliers keeps beta, as in Part 1.
    const r0Before = approxR0(before);
    const structural = (path: string) => path === "network.network_type" || path.startsWith("network.contacts") || path.startsWith("demographics.age_");
    const formulaInputsChanged = changedPaths(before as unknown as Obj, params as unknown as Obj).some((c) => structural(c.path));
    if (formulaInputsChanged && Math.abs(approxR0(params) - r0Before) > 1e-9 * Math.max(1, r0Before)) {
      const held = recalibrateBeta(params, r0Before, before);
      if (held.disease.beta !== params.disease.beta) {
        params = held;
        applied.beta_recalibrated_to_hold_r0 = pyRound(r0Before, 2);
      } else {
        applied.r0_unreachable_on_new_network = pyRound(r0Before, 2);
      }
    }
  }
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

  // Review of the follow-up's phase B: the scenario keeps its fit, so the next run would fit an added intervention away (a baseline
  // fitted to 45% infected still showed 45% with distancing). A change to the interventions after a fitted run ends the fit and
  // keeps the fitted value; a call that passes fit fits again with the change in place.
  let previous: PreviousRun | null | undefined;
  let fitEnded: string | null = null;
  if (before?.run.fit && params.run.fit && input.fit === undefined && scenario.hasRun
    && JSON.stringify(before.interventions) !== JSON.stringify(params.interventions)) {
    previous = await deps.previousRun();
    const kept = previous ? keepFittedValue(params, previous) : null;
    if (kept) {
      params = kept.params;
      fitEnded = kept.note;
    }
  }

  scenario.params = params;
  scenario.countryIso3 = params.demographics.country;
  const warnings = paramWarnings(scenario, params, deps.contextText);
  if (fitEnded) warnings.push(fitEnded);
  const approx_r0 = pyRound(approxR0(params), 2);
  if (given(input.r0) && Math.abs(approx_r0 - input.r0) > R0_CLAMP_TOLERANCE * input.r0) {
    warnings.push(`beta was clamped at ${params.disease.beta}, so the run's R0 is ${approx_r0} rather than the requested ${input.r0}; more contacts or a longer infectious period would reach it.`);
  }
  const changed: PathChange[] = before ? changedPaths(before as unknown as Obj, params as unknown as Obj) : [];
  if (scenario.hasRun && changed.length > 0) {
    // Spec 11: a lever is taken when the applied patch carries every one of its paths with its value.
    if (previous === undefined) previous = await deps.previousRun();
    for (const match of matchedLevers(previous, changed, params)) deps.onOptionChosen(previous!.id, match.diagnosticId, match.patch, match.interventions);
  }
  const config = configView(params, scenario.disease);
  return {
    content: JSON.stringify({ applied, changed, approx_r0, config, warnings }),
    payload: { kind: "config", applied, changed, approx_r0, config, warnings, new_scenario: newScenario, params, sources: scenarioSources(scenario, deps.contextText) },
  };
}
