/**
 * The simulation parameter schema, a field-for-field port of epichat/schema.py
 * (pydantic), plus the R0 math from schema.py and parser.py. The sim service
 * validates again with the Python schema; this copy exists so the agent's
 * tools can merge, validate, and calibrate without a round trip.
 */
import { z } from "zod";
import { pyRound } from "./pyformat";

export const DEFAULT_BETA = 22.8125;
export const DISEASE_TYPES = ["sir", "seir", "sis", "sirs", "seirs", "seiar"] as const;
export type DiseaseType = (typeof DISEASE_TYPES)[number];
export const NETWORK_TYPES = ["random", "age_structured"] as const;
export const INTERVENTION_TYPES = ["vaccine", "treatment", "seasonality"] as const;

const TYPE_ALIASES: Record<string, string> = {
  vaccination: "vaccine",
  vaccinate: "vaccine",
  treat: "treatment",
  treatment_intervention: "treatment",
  seasonal: "seasonality",
};

const nullable = <T extends z.ZodTypeAny>(inner: T) => inner.nullable().default(null);

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

const country = z
  .preprocess((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().toUpperCase();
    return /^[A-Z]{3}$/.test(s) ? s : null;
  }, z.string().nullable())
  .default(null);

export const SimParamsSchema = z
  .object({
    disease_type: z.enum(DISEASE_TYPES).default("sir"),
    n_agents: z.number().int().min(10).max(1_000_000).default(10000),
    n_contacts: z.number().int().min(1).max(100).default(4),
    network_type: z.enum(NETWORK_TYPES).default("random"),
    network_beta: z.number().gt(0).max(10).default(1),
    beta: z.number().gt(0).max(1000),
    init_prev: z.number().gt(0).lt(1).default(0.01),
    dur_inf: z.number().gt(0).default(10),
    dur_exp: nullable(z.number().gt(0)),
    dur_immune: nullable(z.number().gt(0)),
    p_death: z.number().min(0).max(1).default(0),
    p_asymp: z.number().min(0).max(1).default(0.3),
    rel_trans_asymp: z.number().min(0).max(1).default(0.5),
    sim_dur_years: z.number().gt(0).max(20).default(1),
    interventions: z.array(InterventionSchema).default([]),
    rand_seed: nullable(z.number().int()),
    use_demographics: z.boolean().default(false),
    birth_rate: z.number().gt(0).default(20),
    death_rate: z.number().gt(0).default(10),
    age_pct_under18: nullable(z.number().min(0).max(100)),
    age_pct_18_64: nullable(z.number().min(0).max(100)),
    age_pct_over65: nullable(z.number().min(0).max(100)),
    country,
    auto_demographics: z.boolean().default(true),
    demographics_year: z.number().int().min(1950).max(2100).default(2022),
    demographics_source: nullable(z.string()),
  })
  .superRefine((p, ctx) => {
    const pcts = [p.age_pct_under18, p.age_pct_18_64, p.age_pct_over65];
    if (pcts.every((x) => x !== null)) {
      const total = (pcts as number[]).reduce((a, b) => a + b, 0);
      if (Math.abs(total - 100) > 1) {
        ctx.addIssue({ code: "custom", message: `Value error, age_pct fields must sum to 100 (got ${total.toFixed(1)})`, path: [] });
      }
    }
    if (["seir", "seirs", "seiar"].includes(p.disease_type) && p.dur_exp === null) {
      ctx.addIssue({ code: "custom", message: "Value error, dur_exp is required when disease_type is 'seir', 'seirs', or 'seiar'", path: [] });
    }
    if (["sirs", "seirs"].includes(p.disease_type) && p.dur_immune === null) {
      ctx.addIssue({ code: "custom", message: "Value error, dur_immune is required when disease_type is 'sirs' or 'seirs'", path: [] });
    }
  });
export type SimParams = z.infer<typeof SimParamsSchema>;

export type ParamsResult = { ok: true; params: SimParams } | { ok: false; error: string };

/** Validate like pydantic's model_validate; the error text has pydantic's shape so CONFIG ERROR results read the same. */
export function validateParams(input: unknown): ParamsResult {
  const r = SimParamsSchema.safeParse(input);
  if (r.success) return { ok: true, params: r.data };
  const issues = r.error.issues;
  const lines = issues.map((i) => `${i.path.length ? i.path.join(".") : "SimParams"}\n  ${i.message}`);
  const n = issues.length;
  return { ok: false, error: `${n} validation error${n === 1 ? "" : "s"} for SimParams\n${lines.join("\n")}` };
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

/** The POLYMOD-inspired three-group contact matrix shared with the templates. */
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

function asympFactor(p: SimParams): number {
  return p.disease_type === "seiar" ? 1 - p.p_asymp * (1 - p.rel_trans_asymp) : 1;
}

function hasAgeShares(p: SimParams): p is SimParams & { age_pct_under18: number; age_pct_18_64: number; age_pct_over65: number } {
  return p.age_pct_under18 !== null && p.age_pct_18_64 !== null && p.age_pct_over65 !== null;
}

function ngmUnit(p: SimParams): number[][] {
  if (!hasAgeShares(p)) return CONTACT_MATRIX;
  const pop = [p.age_pct_under18 / 100, p.age_pct_18_64 / 100, p.age_pct_over65 / 100];
  return CONTACT_MATRIX.map((row) => row.map((c, j) => c * pop[j]));
}

/** schema.py SimParams.approx_r0 */
export function approxR0(p: SimParams): number {
  const scale = p.beta * p.network_beta * asympFactor(p) * (p.dur_inf / 365);
  if (p.network_type === "age_structured") return scale * spectralRadius3(ngmUnit(p));
  return scale * p.n_contacts;
}

/** parser.py _calibrate_beta: the beta whose approx_r0 is target_r0 on the current network. Unclamped. */
export function calibrateBeta(p: SimParams, targetR0: number): number {
  const denomBase = p.network_beta * asympFactor(p) * (p.dur_inf / 365);
  const denom = p.network_type === "age_structured" ? denomBase * spectralRadius3(ngmUnit(p)) : denomBase * p.n_contacts;
  return targetR0 / denom;
}

/** The agent's clamp-and-round applied to every calibrated beta. */
export function clampBeta(beta: number): number {
  return pyRound(Math.max(0.001, Math.min(1000, beta)), 6);
}

/** parser.py recalibrate_beta */
export function recalibrateBeta(p: SimParams, r0Before: number, before: SimParams): SimParams {
  const target =
    Math.abs(p.beta - before.beta) > 1e-4
      ? p.beta * p.network_beta * asympFactor(p) * (p.dur_inf / 365) * p.n_contacts
      : r0Before;
  return { ...p, beta: clampBeta(calibrateBeta(p, target)) };
}
