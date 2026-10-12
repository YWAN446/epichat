/**
 * Schema v2 of the simulation parameters, a port of epichat/params/schema_v2.py
 * (pydantic) with bounds and defaults read from the exported registry, the v1
 * migration (epichat/params/migrate.py) and the exact R0 math
 * (epichat/params/r0.py). The sim service validates again in Python; this
 * copy exists so the agent's tools can merge, validate, and calibrate without
 * a round trip. web/tests/fixtures/parity.json pins the two sides together.
 */
import { z } from "zod";
import { pyRound } from "./pyformat";
import { boundsOf, defaultOf } from "./registry";

export const DEFAULT_BETA = 22.8125;
export const DISEASE_TYPES = ["sir", "seir", "sis", "sirs", "seirs", "seiar"] as const;
export type DiseaseType = (typeof DISEASE_TYPES)[number];
export const LATENT_MODELS: readonly DiseaseType[] = ["seir", "seirs", "seiar"];
export const WANING_MODELS: readonly DiseaseType[] = ["sirs", "seirs"];
export const NETWORK_TYPES = ["random", "age_structured"] as const;
export const INTERVENTION_TYPES = ["vaccine", "treatment", "seasonality"] as const;
export const DISTS = ["constant", "lognormal", "gamma"] as const;

const TYPE_ALIASES: Record<string, string> = {
  vaccination: "vaccine",
  vaccinate: "vaccine",
  treat: "treatment",
  treatment_intervention: "treatment",
  seasonal: "seasonality",
};

const nullable = <T extends z.ZodTypeAny>(inner: T) => inner.nullable().default(null);
const issue = (ctx: z.RefinementCtx, message: string) => ctx.addIssue({ code: "custom", message: `Value error, ${message}`, path: [] });

/** A numeric leaf whose inclusive bounds come from the registry. */
function bounded(path: string, int = false) {
  const [lo, hi] = boundsOf(path);
  return (int ? z.number().int() : z.number()).min(lo).max(hi);
}
const withDefault = (path: string, int = false) => bounded(path, int).default(defaultOf<number>(path));

export function simDays(years: number): number {
  return Math.max(1, pyRound(365 * years, 0));
}

export const InterventionSchema = z.object({
  type: z.preprocess((v) => (typeof v === "string" ? (TYPE_ALIASES[v.toLowerCase()] ?? v) : v), z.enum(INTERVENTION_TYPES)),
  coverage: nullable(z.number().min(0).max(1)),
  start_day: z.number().int().min(0).default(0),
  capacity: nullable(
    z.preprocess((v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v) : v), z.number().int().min(1)),
  ),
  scale: z.number().min(0).max(1).default(0.2),
  shift: z.number().min(0).max(1).default(0),
});
export type Intervention = z.infer<typeof InterventionSchema>;

export const DurationSchema = z
  .object({
    mean_days: z.number().gt(0),
    dist: z.enum(DISTS).default("constant"),
    sd_days: nullable(z.number().gt(0)),
  })
  .superRefine((d, ctx) => {
    if (d.dist !== "constant" && d.sd_days === null) issue(ctx, `sd_days is required when dist is '${d.dist}'`);
    if (d.sd_days !== null && d.sd_days > 2 * d.mean_days) issue(ctx, "sd_days must be at most 2 × mean_days");
  });
export type Duration = z.infer<typeof DurationSchema>;

export const SeedSchema = z
  .object({
    mode: z.enum(["fraction", "count"]).default("fraction"),
    value: z.number().gt(0),
    day: withDefault("disease.seed.day", true),
  })
  .superRefine((s, ctx) => {
    if (s.mode === "fraction" && !(s.value > 0 && s.value < 1)) issue(ctx, "value must be between 0 and 1 (exclusive) when mode is 'fraction'");
    if (s.mode === "count" && (s.value < 1 || !Number.isInteger(s.value))) issue(ctx, "value must be an integer count of at least 1 when mode is 'count'");
  });
export type Seed = z.infer<typeof SeedSchema>;

const DURATIONS = ["dur_exp", "dur_inf", "dur_immune"] as const;

export const DiseaseSchema = z
  .object({
    model: z.enum(DISEASE_TYPES).default("sir"),
    beta: withDefault("disease.beta"),
    dur_exp: nullable(DurationSchema),
    dur_inf: DurationSchema.prefault({ mean_days: 10 }),
    dur_immune: nullable(DurationSchema),
    p_death: withDefault("disease.p_death"),
    p_asymp: withDefault("disease.p_asymp"),
    rel_trans_asymp: withDefault("disease.rel_trans_asymp"),
    sis_waning: withDefault("disease.sis_waning"),
    sis_imm_boost: withDefault("disease.sis_imm_boost"),
    seed: SeedSchema.prefault({ value: 0.01 }),
    initial_immune_frac: withDefault("disease.initial_immune_frac"),
  })
  .superRefine((d, ctx) => {
    if (LATENT_MODELS.includes(d.model) && d.dur_exp === null) issue(ctx, "disease.dur_exp is required when disease.model is 'seir', 'seirs', or 'seiar'");
    if (WANING_MODELS.includes(d.model) && d.dur_immune === null) issue(ctx, "disease.dur_immune is required when disease.model is 'sirs' or 'seirs'");
    for (const name of DURATIONS) {
      const duration = d[name];
      if (!duration) continue;
      for (const [leaf, value] of [["mean_days", duration.mean_days], ["sd_days", duration.sd_days]] as const) {
        if (value === null) continue;
        const path = `disease.${name}.${leaf}`;
        const [lo, hi] = boundsOf(path);
        if (value < lo || value > hi) issue(ctx, `${path} must be between ${lo} and ${hi} days`);
      }
    }
  });

export const NetworkSchema = z.object({
  network_type: z.enum(NETWORK_TYPES).default("random"),
  n_contacts: withDefault("network.n_contacts", true),
  network_beta: withDefault("network.network_beta"),
});

const country = z
  .preprocess((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().toUpperCase();
    return /^[A-Z]{3}$/.test(s) ? s : null;
  }, z.string().nullable())
  .default(null);

export const DemographicsSchema = z
  .object({
    use_demographics: z.boolean().default(false),
    birth_rate: withDefault("demographics.birth_rate"),
    death_rate: withDefault("demographics.death_rate"),
    age_pct_under18: nullable(bounded("demographics.age_pct_under18")),
    age_pct_18_64: nullable(bounded("demographics.age_pct_18_64")),
    age_pct_over65: nullable(bounded("demographics.age_pct_over65")),
    country,
    auto_demographics: z.boolean().default(true),
    demographics_year: withDefault("demographics.demographics_year", true),
    demographics_source: nullable(z.string()),
  })
  .superRefine((d, ctx) => {
    const pcts = [d.age_pct_under18, d.age_pct_18_64, d.age_pct_over65];
    if (pcts.every((x) => x !== null)) {
      const total = (pcts as number[]).reduce((a, b) => a + b, 0);
      if (Math.abs(total - 100) > 1) issue(ctx, `age_pct fields must sum to 100 (got ${total.toFixed(1)})`);
    }
  });

export const RunSchema = z.object({
  n_agents: withDefault("run.n_agents", true),
  sim_dur_years: withDefault("run.sim_dur_years"),
  rand_seed: nullable(z.number().int()),
  n_replicates: withDefault("run.n_replicates", true),
});

const isDayZeroVaccine = (i: { type: string; start_day: number }) => i.type === "vaccine" && i.start_day <= 0;

export const SimParamsSchema = z
  .object({
    schema_version: z.literal(2).default(2),
    disease: DiseaseSchema.prefault({}),
    network: NetworkSchema.prefault({}),
    demographics: DemographicsSchema.prefault({}),
    interventions: z.array(InterventionSchema).default([]),
    run: RunSchema.prefault({}),
  })
  .superRefine((p, ctx) => {
    const seed = p.disease.seed;
    if (seed.mode === "count" && seed.value > p.run.n_agents) issue(ctx, `disease.seed.value (${seed.value}) must not exceed run.n_agents (${p.run.n_agents})`);
    const days = simDays(p.run.sim_dur_years);
    if (seed.day > days) issue(ctx, `disease.seed.day (${seed.day}) must be within the simulation (${days} days)`);
    if (p.network.network_beta * (1 - Math.exp(-p.disease.beta / 365)) > 1) issue(ctx, "network.network_beta × (1 - exp(-disease.beta / 365)) must not exceed 1: lower network.network_beta or disease.beta");
    const day0 = p.interventions.filter(isDayZeroVaccine);
    if (day0.length > 0) {
      const coverage = Math.min(day0[day0.length - 1].coverage ?? 0, 0.99);
      if (p.disease.initial_immune_frac > 0 && Math.abs(p.disease.initial_immune_frac - coverage) > 1e-9) {
        issue(ctx, "a vaccine with start_day 0 and disease.initial_immune_frac were both given with different values; set one of them");
      }
    }
  })
  .transform((p) => {
    const day0 = p.interventions.filter(isDayZeroVaccine);
    if (day0.length === 0) return p;
    const coverage = Math.min(day0[day0.length - 1].coverage ?? 0, 0.99);
    return { ...p, disease: { ...p.disease, initial_immune_frac: coverage }, interventions: p.interventions.filter((i) => !isDayZeroVaccine(i)) };
  });
export type SimParams = z.infer<typeof SimParamsSchema>;
export type DiseaseParams = SimParams["disease"];

export type ParamsResult = { ok: true; params: SimParams } | { ok: false; error: string };

/** A v1 row is any object without schema_version (spec 6.1). */
export function isV1(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) && !("schema_version" in input);
}

const VACCINE_ALIASES = new Set(["vaccine", "vaccination", "vaccinate"]);
const NETWORK_KEYS = ["network_type", "n_contacts", "network_beta"];
const DEMOGRAPHICS_KEYS = ["use_demographics", "birth_rate", "death_rate", "age_pct_under18", "age_pct_18_64", "age_pct_over65", "country", "auto_demographics", "demographics_year", "demographics_source"];
const RUN_KEYS = ["n_agents", "sim_dur_years", "rand_seed"];

const constantDuration = (days: unknown) => (days === null || days === undefined ? null : { mean_days: days, dist: "constant", sd_days: null });
const isV1DayZeroVaccine = (i: Record<string, unknown>) => VACCINE_ALIASES.has(String(i.type ?? "").toLowerCase()) && Number(i.start_day ?? 0) <= 0;

/** epichat/params/migrate.py migrate_v1: a flat v1 object becomes a v2-shaped object (not yet validated). */
export function migrateV1(flat: Record<string, unknown>): Record<string, unknown> {
  const interventions = (Array.isArray(flat.interventions) ? (flat.interventions as Record<string, unknown>[]) : []).map((i) => ({ ...i }));
  const day0 = interventions.filter(isV1DayZeroVaccine);
  const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => k in flat).map((k) => [k, flat[k]]));
  return {
    schema_version: 2,
    disease: {
      model: flat.disease_type ?? "sir",
      beta: flat.beta ?? DEFAULT_BETA,
      dur_exp: constantDuration(flat.dur_exp),
      dur_inf: constantDuration(flat.dur_inf ?? 10),
      dur_immune: constantDuration(flat.dur_immune),
      p_death: flat.p_death ?? 0,
      p_asymp: flat.p_asymp ?? 0.3,
      rel_trans_asymp: flat.rel_trans_asymp ?? 0.5,
      sis_waning: 0,
      sis_imm_boost: 0,
      seed: { mode: "fraction", value: flat.init_prev ?? 0.01, day: 0 },
      initial_immune_frac: day0.length > 0 ? Math.min(Number(day0[day0.length - 1].coverage ?? 0), 0.99) : 0,
    },
    network: pick(NETWORK_KEYS),
    demographics: pick(DEMOGRAPHICS_KEYS),
    interventions: interventions.filter((i) => !isV1DayZeroVaccine(i)),
    run: pick(RUN_KEYS),
  };
}

/** Validate like pydantic's model_validate, migrating a v1 object first; the error text has pydantic's shape so CONFIG ERROR results read the same. */
export function validateParams(input: unknown): ParamsResult {
  const data = isV1(input) ? migrateV1(input) : input;
  const r = SimParamsSchema.safeParse(data);
  if (r.success) return { ok: true, params: r.data };
  const issues = r.error.issues;
  const lines = issues.map((i) => `${i.path.length ? i.path.join(".") : "SimParams"}\n  ${i.message}`);
  const n = issues.length;
  return { ok: false, error: `${n} validation error${n === 1 ? "" : "s"} for SimParams\n${lines.join("\n")}` };
}

/** Stored parameters of either shape, or null when they no longer validate. */
export function coerceParams(input: unknown): SimParams | null {
  if (input === null || input === undefined) return null;
  const r = validateParams(input);
  return r.ok ? r.params : null;
}

export function getVaccine(p: SimParams): Intervention | null {
  return p.interventions.find((i) => i.type === "vaccine") ?? null;
}
export function getTreatment(p: SimParams): Intervention | null {
  return p.interventions.find((i) => i.type === "treatment") ?? null;
}
export function getSeasonality(p: SimParams): Intervention | null {
  return p.interventions.find((i) => i.type === "seasonality") ?? null;
}

/** The POLYMOD-inspired three-group contact matrix shared with the builder. */
export const CONTACT_MATRIX: number[][] = [
  [7.0, 2.5, 0.5],
  [2.5, 9.0, 1.5],
  [0.5, 1.5, 3.5],
];

/** Largest eigenvalue of a non-negative 3×3 matrix (its Perron root), by power iteration with Rayleigh refinement. */
export function spectralRadius3(m: number[][]): number {
  let v = [1, 1, 1];
  let lambda = 0;
  for (let k = 0; k < 2000; k++) {
    const w = m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
    const norm = Math.hypot(w[0], w[1], w[2]);
    if (norm === 0) return 0;
    const next = w.map((x) => x / norm);
    const num = next.reduce((s, x, i) => s + x * (m[i][0] * next[0] + m[i][1] * next[1] + m[i][2] * next[2]), 0);
    const den = next.reduce((s, x) => s + x * x, 0);
    const estimate = num / den;
    const converged = Math.abs(estimate - lambda) <= 1e-16 * Math.abs(estimate);
    lambda = estimate;
    v = next;
    if (converged && k > 50) break;
  }
  return lambda;
}

export const CONTACT_SPECTRAL_RADIUS = spectralRadius3(CONTACT_MATRIX);
export const RANDOM_LEVERS = ["network.n_contacts", "disease.dur_inf.mean_days"] as const;
export const AGE_LEVERS = ["network.network_beta", "disease.dur_inf.mean_days"] as const;

/** Starsim's per-contact daily transmission probability for a per-year beta. */
export function perContactProb(beta: number): number {
  return 1 - Math.exp(-beta / 365);
}

export function asympFactor(d: DiseaseParams): number {
  return d.model === "seiar" ? 1 - d.p_asymp * (1 - d.rel_trans_asymp) : 1;
}

/** Days an infected agent transmits on a daily step (spec 7.4). */
export function effectiveDays(d: DiseaseParams): number {
  const inf = d.dur_inf;
  let days: number;
  if (LATENT_MODELS.includes(d.model)) {
    const exp = d.dur_exp!;
    if (exp.dist === "constant" && inf.dist === "constant") days = Math.ceil(exp.mean_days + inf.mean_days) - Math.ceil(exp.mean_days);
    else if (exp.dist === "constant") days = inf.mean_days + 0.5;
    else days = inf.mean_days;
  } else if (inf.dist === "constant") days = Math.ceil(inf.mean_days) - 1;
  else days = inf.mean_days - 0.5;
  return Math.max(0, days);
}

/** The R0 reached if every contact transmitted: contacts × network_beta × D_eff × asymp_factor. */
export function contactScale(p: SimParams): number {
  const contacts = p.network.network_type === "age_structured" ? CONTACT_SPECTRAL_RADIUS : p.network.n_contacts;
  return contacts * p.network.network_beta * effectiveDays(p.disease) * asympFactor(p.disease);
}

export function approxR0(p: SimParams): number {
  return contactScale(p) * perContactProb(p.disease.beta);
}

export function maxR0(p: SimParams): number {
  return contactScale(p);
}

export class R0UnreachableError extends Error {
  constructor(
    public readonly target: number,
    public readonly maximum: number,
    public readonly levers: readonly string[],
  ) {
    super(`R0 ${target} is not reachable: the most the contacts and infectious period can carry is ${maximum.toFixed(2)}; raise ${levers.join(" or ")}`);
    this.name = "R0UnreachableError";
  }
}

/** The beta whose approxR0 is targetR0 on the current network; throws R0UnreachableError when none exists. Unclamped. */
export function calibrateBeta(p: SimParams, targetR0: number): number {
  const scale = contactScale(p);
  if (scale <= 0 || targetR0 >= scale) throw new R0UnreachableError(targetR0, scale, p.network.network_type === "age_structured" ? AGE_LEVERS : RANDOM_LEVERS);
  return -365 * Math.log(1 - targetR0 / scale);
}

/** The agent's clamp-and-round applied to every calibrated beta. */
export function clampBeta(beta: number): number {
  return pyRound(Math.max(0.001, Math.min(1000, beta)), 6);
}

export function withR0(p: SimParams, targetR0: number): SimParams {
  return { ...p, disease: { ...p.disease, beta: clampBeta(calibrateBeta(p, targetR0)) } };
}

/** After a change, hold the R0 the user confirmed; a changed beta means a new intended R0, read with the random-network formula. Unchanged when unreachable. */
export function recalibrateBeta(p: SimParams, r0Before: number, before: SimParams): SimParams {
  const target =
    Math.abs(p.disease.beta - before.disease.beta) > 1e-4
      ? p.network.n_contacts * p.network.network_beta * effectiveDays(p.disease) * asympFactor(p.disease) * perContactProb(p.disease.beta)
      : r0Before;
  try {
    return withR0(p, target);
  } catch (e) {
    if (e instanceof R0UnreachableError) return p;
    throw e;
  }
}
