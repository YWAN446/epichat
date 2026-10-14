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
export const NETWORK_TYPES = ["random", "age_structured", "hybrid"] as const;
export const CONTACTS_DISTS = ["constant", "poisson"] as const;
export const AGE_SOURCES = ["default", "shares", "un_wpp"] as const;
export const INTERVENTION_TYPES = ["vaccine", "treatment", "seasonality", "contact_reduction", "transmission_reduction", "behavior_response"] as const;
export const LAYERS = ["all", "household", "school", "work", "community"] as const;
export const FIT_TARGETS = ["attack_rate", "peak_day", "peak_infections"] as const;
export const FIT_LEVERS = ["disease.beta", "network.network_beta", "disease.rel_sus_cv", "behavior_response.scale"] as const;
/** The two levers that set R0; the other two leave it where it was set (follow-up spec, 6). */
export const BETA_LEVERS: readonly string[] = ["disease.beta", "network.network_beta"];
export const DISTS = ["constant", "lognormal", "gamma"] as const;

const TYPE_ALIASES: Record<string, string> = {
  vaccination: "vaccine",
  vaccinate: "vaccine",
  treat: "treatment",
  treatment_intervention: "treatment",
  seasonal: "seasonality",
  school_closure: "contact_reduction",
  distancing: "contact_reduction",
  "contact-reduction": "contact_reduction",
  masks: "transmission_reduction",
  "transmission-reduction": "transmission_reduction",
  behaviour_response: "behavior_response",
  behavior: "behavior_response",
  behaviour: "behavior_response",
  behavior_change: "behavior_response",
  behaviour_change: "behavior_response",
  awareness: "behavior_response",
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

export const InterventionSchema = z.preprocess(
  (v) => {
    // peak_day is an input alias of shift (a day of the year)
    if (typeof v === "object" && v !== null && "peak_day" in v) {
      const { peak_day, ...rest } = v as Record<string, unknown>;
      return peak_day === null || peak_day === undefined || "shift" in rest ? rest : { ...rest, shift: (Number(peak_day) / 365) % 1 };
    }
    return v;
  },
  z
    .object({
      type: z.preprocess((v) => (typeof v === "string" ? (TYPE_ALIASES[v.toLowerCase()] ?? v) : v), z.enum(INTERVENTION_TYPES)),
      coverage: nullable(z.number().min(0).max(1)),
      start_day: z.number().int().min(0).default(0),
      end_day: nullable(z.number().int().min(0)),
      efficacy: z.number().min(0).max(1).default(1),
      kind: z.enum(["routine", "campaign"]).default("routine"),
      leaky: z.boolean().default(true),
      age_min: nullable(z.number().int().min(0).max(120)),
      age_max: nullable(z.number().int().min(0).max(120)),
      protection_days: nullable(z.number().int().min(1)),
      capacity: nullable(
        z.preprocess((v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v) : v), z.number().int().min(1)),
      ),
      delay_days: z.number().int().min(0).max(365).default(0),
      rel_trans_treated: z.number().min(0).max(1).default(1),
      symptomatic_only: z.boolean().default(false),
      scale: z.number().min(0).max(1).default(0.2),
      shift: z.number().min(0).max(1).default(0),
      layer: z.enum(LAYERS).default("all"),
      half_prevalence: z.number().min(0.0001).max(0.5).default(0.01),
      memory_days: z.number().int().min(1).max(90).default(7),
    })
    .superRefine((i, ctx) => {
      if (i.end_day !== null && i.end_day < i.start_day) issue(ctx, "interventions[].end_day must not be before start_day");
      if (i.age_min !== null && i.age_max !== null && i.age_min >= i.age_max) issue(ctx, "interventions[].age_min must be below age_max");
      if (i.type === "behavior_response" && i.layer !== "all") issue(ctx, "interventions[].layer must be all for a behavior_response");
    }),
);
export type Intervention = z.infer<typeof InterventionSchema>;
/** A vaccine entry the v1 shape can express: routine, full efficacy, leaky, no window, no ages, no waning. */
export const isV1Vaccine = (i: Intervention): boolean =>
  i.type === "vaccine" && i.kind === "routine" && i.end_day === null && i.efficacy >= 1 && i.leaky && i.age_min === null && i.age_max === null && i.protection_days === null;
/** Part 1 section 18 and Part 2 7.1: a v1-shaped day-0 vaccine is disease.initial_immune_frac; any other day-0 entry keeps its fields (2C review, I4). */
export const isDay0Immunity = (i: Intervention): boolean => isV1Vaccine(i) && i.start_day <= 0;
/** A treatment entry the v1 SimpleTreatment can run (the parity baseline depends on it). */
export const isV1Treatment = (i: Intervention): boolean =>
  i.type === "treatment" && i.delay_days === 0 && i.efficacy >= 1 && i.rel_trans_treated >= 1 && !i.symptomatic_only && i.end_day === null;
export const FitSchema = z
  .object({
    target: z.enum(FIT_TARGETS),
    value: z.number().gt(0),
    lever: z.enum(FIT_LEVERS).default("disease.beta"),
  })
  .superRefine((f, ctx) => {
    if (f.target === "attack_rate" && f.value > 1) issue(ctx, "run.fit.value is a fraction for attack_rate");
    if (f.target === "peak_day" && f.value < 1) issue(ctx, "run.fit.value is a day for peak_day");
    if (f.target === "peak_day" && !BETA_LEVERS.includes(f.lever)) issue(ctx, `run.fit.target peak_day can be fitted with disease.beta or network.network_beta, not with ${f.lever}`);
  });
export type Fit = z.infer<typeof FitSchema>;

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

export const AGE_GROUPS = ["children", "adults", "elderly"] as const;
export const AgeMultipliersSchema = z.object({
  children: withDefault("disease.rel_sus_age.children"),
  adults: withDefault("disease.rel_sus_age.adults"),
  elderly: withDefault("disease.rel_sus_age.elderly"),
});
export const AgeFractionsSchema = z.object({
  children: nullable(bounded("disease.p_death_age.children")),
  adults: nullable(bounded("disease.p_death_age.adults")),
  elderly: nullable(bounded("disease.p_death_age.elderly")),
});

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
    rel_sus_age: AgeMultipliersSchema.prefault({}),
    rel_sus_cv: withDefault("disease.rel_sus_cv"),
    p_death_age: AgeFractionsSchema.prefault({}),
    rel_trans_exposed: withDefault("disease.rel_trans_exposed"),
    sis_waning: withDefault("disease.sis_waning"),
    sis_imm_boost: withDefault("disease.sis_imm_boost"),
    seed: SeedSchema.prefault({ value: defaultOf<number>("disease.seed.value") }),
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

export const ContactMatrixSchema = z.object({
  children_children: withDefault("network.contacts.children_children"),
  children_adults: withDefault("network.contacts.children_adults"),
  children_elderly: withDefault("network.contacts.children_elderly"),
  adults_children: withDefault("network.contacts.adults_children"),
  adults_adults: withDefault("network.contacts.adults_adults"),
  adults_elderly: withDefault("network.contacts.adults_elderly"),
  elderly_children: withDefault("network.contacts.elderly_children"),
  elderly_adults: withDefault("network.contacts.elderly_adults"),
  elderly_elderly: withDefault("network.contacts.elderly_elderly"),
});
export type ContactMatrix = z.infer<typeof ContactMatrixSchema>;
/** The nine matrix leaves in registry order: source group, then target group (Part 2, 5.3). */
export const CONTACT_PAIRS = AGE_GROUPS.flatMap((s) => AGE_GROUPS.map((t) => `${s}_${t}` as keyof ContactMatrix));
/** Rows source, columns target, as Starsim's MixingPools reads them (Part 2, 5.3). */
export function contactRows(c: ContactMatrix): number[][] {
  return AGE_GROUPS.map((s) => AGE_GROUPS.map((t) => c[`${s}_${t}` as keyof ContactMatrix]));
}
export const LayerBetaSchema = z.object({
  household: withDefault("network.layer_beta.household"),
  school: withDefault("network.layer_beta.school"),
  work: withDefault("network.layer_beta.work"),
  community: withDefault("network.layer_beta.community"),
});
export const NetworkSchema = z
  .object({
    network_type: z.enum(NETWORK_TYPES).default("random"),
    n_contacts: withDefault("network.n_contacts", true),
    network_beta: withDefault("network.network_beta"),
    contacts_dist: z.enum(CONTACTS_DISTS).default("constant"),
    contact_duration_days: withDefault("network.contact_duration_days"),
    contacts: ContactMatrixSchema.prefault({}),
    contacts_source: z.string().default("polymod_default"),
    household_size: withDefault("network.household_size"),
    school_contacts: withDefault("network.school_contacts", true),
    work_contacts: withDefault("network.work_contacts", true),
    community_contacts: withDefault("network.community_contacts", true),
    layer_beta: LayerBetaSchema.prefault({}),
    school_age_min: withDefault("network.school_age_min", true),
    school_age_max: withDefault("network.school_age_max", true),
    work_age_min: withDefault("network.work_age_min", true),
    work_age_max: withDefault("network.work_age_max", true),
  })
  .superRefine((n, ctx) => {
    if (n.school_age_min >= n.school_age_max) issue(ctx, "network.school_age_min must be below network.school_age_max");
    if (n.work_age_min >= n.work_age_max) issue(ctx, "network.work_age_min must be below network.work_age_max");
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
    age_source: z.enum(AGE_SOURCES).default("default"),
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
  calibrate_r0: z.boolean().default(true),
  fit: nullable(FitSchema),
  n_replicates: withDefault("run.n_replicates", true),
});

const isDayZeroVaccine = (i: Intervention) => isDay0Immunity(i);

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
    const responses = p.interventions.filter((i) => i.type === "behavior_response");
    if (responses.length > 1) issue(ctx, "interventions may hold one behavior_response entry");
    if (p.run.fit && p.run.fit.lever === "behavior_response.scale" && responses.length === 0) issue(ctx, "run.fit.lever behavior_response.scale needs a behavior_response entry in interventions");
    if (p.network.network_type !== "hybrid") {
      for (const i of p.interventions) {
        if (i.type === "contact_reduction" && i.layer !== "all") issue(ctx, `interventions[].layer ${i.layer} needs the hybrid network; the ${p.network.network_type} network has no layers, use all`);
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
      seed: { mode: "fraction", value: flat.init_prev ?? 0.01, day: 0 },      // v1's own default: a v1 row without init_prev meant 1% (migrate.py)
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
export const HYBRID_LEVERS = ["network.household_size", "network.community_contacts", "disease.dur_inf.mean_days"] as const;
/** The shares path draws ages uniformly within these bands (the builder). */
const AGE_BANDS: [number, number][] = [[0, 18], [18, 65], [65, 95]];

export function contactMatrix(p: SimParams): number[][] {
  return contactRows(p.network.contacts);
}

/** The share of agents aged lo to hi (hi excluded) when ages are uniform within the three bands. */
export function ageRangeShare(shares: readonly [number, number, number], lo: number, hi: number): number {
  return AGE_BANDS.reduce((total, [a, b], i) => total + (shares[i] * Math.max(0, Math.min(hi, b) - Math.max(lo, a))) / (b - a), 0);
}

/** Part 2, 5.5: the sum over the layers of beta_l × c_l, c_l the agent-weighted mean daily contacts of layer l (the household size itself for households). */
export function hybridContacts(p: SimParams): number {
  const n = p.network;
  const s = ageShares(p);
  const lb = n.layer_beta;
  return lb.household * n.household_size + lb.school * n.school_contacts * ageRangeShare(s, n.school_age_min, n.school_age_max)
    + lb.work * n.work_contacts * ageRangeShare(s, n.work_age_min, n.work_age_max) + lb.community * n.community_contacts;
}

/** No closed form holds with lasting contacts or on the hybrid network; the measured R0 is the one to quote (Part 2, 5.2, 5.5). */
export function r0IsApproximate(p: SimParams): boolean {
  return p.network.network_type === "hybrid" || p.network.contact_duration_days > 0;
}

/** Starsim's per-contact daily transmission probability for a per-year beta. */
export function perContactProb(beta: number): number {
  return 1 - Math.exp(-beta / 365);
}

export function asympFactor(d: DiseaseParams): number {
  return d.model === "seiar" ? 1 - d.p_asymp * (1 - d.rel_trans_asymp) : 1;
}

/** Starsim's default ages are uniform on 0 to 60: no elderly (Part 2, section 4.1). */
export const DEFAULT_AGE_SHARES: [number, number, number] = [0.3, 0.7, 0];

/** The share of agents in each age group: the fetched shares when all three are set, else the default ages'. */
export function ageShares(p: SimParams): [number, number, number] {
  const g = p.demographics;
  if (g.age_pct_under18 !== null && g.age_pct_18_64 !== null && g.age_pct_over65 !== null) return [g.age_pct_under18 / 100, g.age_pct_18_64 / 100, g.age_pct_over65 / 100];
  return DEFAULT_AGE_SHARES;
}

/** Each group's case fatality ratio: its own value, or the scalar. */
export function deathProbabilities(d: DiseaseParams): [number, number, number] {
  return [d.p_death_age.children ?? d.p_death, d.p_death_age.adults ?? d.p_death, d.p_death_age.elderly ?? d.p_death];
}

/** The population case fatality ratio, the groups weighted by their shares. */
export function weightedCfr(p: SimParams): number {
  const s = ageShares(p);
  const q = deathProbabilities(p.disease);
  return s[0] * q[0] + s[1] * q[1] + s[2] * q[2];
}

/** Days an exposed agent can transmit on a daily step, by the infectious period's offsets; 0 outside the latent models. */
export function exposedDays(d: DiseaseParams): number {
  if (!LATENT_MODELS.includes(d.model) || !d.dur_exp) return 0;
  const exp = d.dur_exp;
  return Math.max(0, exp.dist === "constant" ? Math.ceil(exp.mean_days) - 1 : exp.mean_days - 0.5);
}

/** Days an infectious agent transmits on a daily step (spec 7.4). */
export function infectiousDays(d: DiseaseParams): number {
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

/** The transmission-weighted days of one infection: the infectious days scaled by the asymptomatic factor (seiar) plus the exposed days at rel_trans_exposed, whatever the track (Part 2, 4.3 and 4.4). */
export function effectiveDays(d: DiseaseParams): number {
  return infectiousDays(d) * asympFactor(d) + d.rel_trans_exposed * exposedDays(d);
}

/** The R0 reached if every contact transmitted: contacts × network_beta × D_eff, with the susceptibility multipliers, on the three networks (Part 2, 4.4, 5.5). */
export function contactScale(p: SimParams): number {
  const n = p.network;
  const r = [p.disease.rel_sus_age.children, p.disease.rel_sus_age.adults, p.disease.rel_sus_age.elderly];
  const s = ageShares(p);
  const meanR = s[0] * r[0] + s[1] * r[1] + s[2] * r[2];
  let contacts: number;
  if (n.network_type === "age_structured") contacts = spectralRadius3(contactMatrix(p).map((row) => row.map((v, j) => v * r[j])));
  else if (n.network_type === "hybrid") contacts = hybridContacts(p) * meanR;
  else contacts = n.n_contacts * meanR;
  return contacts * n.network_beta * effectiveDays(p.disease);
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
  if (scale <= 0 || targetR0 >= scale) {
    const levers = p.network.network_type === "hybrid" ? HYBRID_LEVERS : p.network.network_type === "age_structured" ? AGE_LEVERS : RANDOM_LEVERS;
    throw new R0UnreachableError(targetR0, scale, levers);
  }
  return -365 * Math.log(1 - targetR0 / scale);
}

/** The agent's clamp-and-round applied to every calibrated beta. */
export function clampBeta(beta: number): number {
  return pyRound(Math.max(0.001, Math.min(1000, beta)), 6);
}

export function withR0(p: SimParams, targetR0: number): SimParams {
  return { ...p, disease: { ...p.disease, beta: clampBeta(calibrateBeta(p, targetR0)) } };
}

/** After a change, hold the R0 the user confirmed; a changed beta means a new intended R0, read on the network it was set on (so the beta comes back unchanged). Unchanged when unreachable. */
export function recalibrateBeta(p: SimParams, r0Before: number, before: SimParams): SimParams {
  const target = Math.abs(p.disease.beta - before.disease.beta) > 1e-4 ? approxR0(p) : r0Before;
  try {
    return withR0(p, target);
  } catch (e) {
    if (e instanceof R0UnreachableError) return p;
    throw e;
  }
}
