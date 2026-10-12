/**
 * Where a scenario's values came from (spec 9.2), derived as section 19
 * says: a fetched data source that still carries the value, the database
 * consensus, an illustrative spread the configure tool computed, the
 * registry default, or else the user.
 */
import { lookup, type DiseaseEntry } from "@/lib/disease/db";
import { DEFAULT_BETA, approxR0, type SimParams } from "@/lib/sim/params";
import { flattenParams } from "@/lib/sim/paths";
import { PARAM_REGISTRY } from "@/lib/sim/registry";
import { illustrativeSd } from "./durations";
import type { Scenario } from "./types";

export type ParamSource = "user" | "database" | "fetch" | "default" | "illustrative";
export type DbRange = { min: number | null; max: number | null; typical: number | null; unit: string | null; source: string };

const DAYS_PER_UNIT: Record<string, number> = { days: 1, weeks: 7, months: 30.44, years: 365.25 };
/** How close a configured R0 must be to the database typical to count as the database's. */
const R0_TOLERANCE = 0.01;

/** The database consensus for a registry db_field in simulation units: fractions of 1 and days. */
export function dbRange(entry: DiseaseEntry | null, dbField: string | null): DbRange | null {
  const flat = dbField && entry ? entry.flat[dbField] : null;
  if (!flat) return null;
  let factor = 1;
  let unit = flat.unit;
  if ((dbField === "fatality_rate" || dbField === "asymptomatic_fraction") && flat.unit === "percentage") {
    factor = 0.01;
    unit = "fraction";
  } else if (dbField === "immunity_duration") {
    factor = DAYS_PER_UNIT[flat.unit ?? "days"] ?? 1;
    unit = "days";
  }
  const scale = (v: number | null) => (v === null ? null : v * factor);
  return { min: scale(flat.min), max: scale(flat.max), typical: scale(flat.typical), unit, source: flat.source };
}

/** Equal, with a relative tolerance for numbers (a patch value and a stored value must compare as the same). */
export function near(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  return a === b;
}

const sourceValue = (scenario: Scenario, field: string) => scenario.dataSources.find((f) => f.field === field)?.value;
const ages = (scenario: Scenario) => sourceValue(scenario, "age_distribution_pct") as Record<string, number> | undefined;

/** What each fetch tool writes, by path (lib/tools/fetch*.ts): the value is a fetch only while it still equals what was fetched. */
const FETCHED: Record<string, (scenario: Scenario) => unknown> = {
  "demographics.birth_rate": (s) => sourceValue(s, "birth_rate"),
  "demographics.death_rate": (s) => sourceValue(s, "death_rate"),
  "demographics.use_demographics": (s) => (sourceValue(s, "birth_rate") === undefined ? undefined : true),
  "demographics.age_pct_under18": (s) => ages(s)?.["0-17"],
  "demographics.age_pct_18_64": (s) => ages(s)?.["18-64"],
  "demographics.age_pct_over65": (s) => ages(s)?.["65+"],
  "network.network_type": (s) => (ages(s) === undefined ? undefined : "age_structured"),
  "disease.initial_immune_frac": (s) => {
    const coverage = s.dataSources.find((f) => f.field.endsWith("_coverage"));
    return coverage ? Math.min(0.99, Number(coverage.value) / 100) : undefined;
  },
};

const DURATIONS = ["dur_exp", "dur_inf", "dur_immune"] as const;

/** One source per set path of the scenario's parameters. */
export function valueSources(p: SimParams, scenario: Scenario, disease: string | null): Record<string, ParamSource> {
  const entry = disease ? lookup(disease) : null;
  const flat = flattenParams(p as unknown as Record<string, unknown>);
  const out: Record<string, ParamSource> = {};
  for (const spec of PARAM_REGISTRY) {
    if (!(spec.path in flat)) continue;
    const value = flat[spec.path];
    const fetched = FETCHED[spec.path]?.(scenario);
    if (fetched !== undefined && near(value, fetched)) {
      out[spec.path] = "fetch";
      continue;
    }
    const typical = dbRange(entry, spec.db_field)?.typical ?? null;
    if (typical !== null && near(value, typical)) {
      out[spec.path] = "database";
      continue;
    }
    out[spec.path] = near(value, spec.default) ? "default" : "user";
  }
  // beta is set from an R0, so it is attributed by the R0 it implies.
  const r0Typical = dbRange(entry, "r0")?.typical ?? null;
  const r0 = approxR0(p);
  out["disease.beta"] = near(p.disease.beta, DEFAULT_BETA) ? "default" : r0Typical !== null && Math.abs(r0 - r0Typical) <= R0_TOLERANCE * r0Typical ? "database" : "user";
  // A spread the configure tool computed, and the gamma it came with, are an illustrative assumption (spec 7.3).
  for (const name of DURATIONS) {
    const d = p.disease[name];
    if (d && d.sd_days !== null && d.dist !== "constant" && near(d.sd_days, illustrativeSd(name, d.mean_days, disease))) {
      out[`disease.${name}.sd_days`] = "illustrative";
      out[`disease.${name}.dist`] = "illustrative";
    }
  }
  return out;
}
