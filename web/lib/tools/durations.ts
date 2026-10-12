import { lookup } from "@/lib/disease/db";
import type { Duration } from "@/lib/sim/params";
import { pyRound } from "@/lib/sim/pyformat";

export type DurationName = "dur_exp" | "dur_inf" | "dur_immune";
const DB_FIELD: Record<DurationName, string> = { dur_exp: "incubation_days", dur_inf: "infectious_days", dur_immune: "immunity_duration" };
const DAYS_PER_UNIT: Record<string, number> = { days: 1, weeks: 7, months: 30.44, years: 365.25 };

/** Spec 7.3: (max − min) / 4 from the database consensus range when the disease is known and min < max, else 0.3 × mean. Capped at the mean so the spread stays sensible (the schema allows up to twice the mean). The sd is an illustrative assumption either way. */
export function illustrativeSd(name: DurationName, mean: number, disease: string | null): number {
  const flat = disease ? (lookup(disease)?.flat[DB_FIELD[name]] ?? null) : null;
  let sd = 0.3 * mean;
  if (flat && flat.min !== null && flat.max !== null && flat.min < flat.max) sd = ((flat.max - flat.min) * (DAYS_PER_UNIT[flat.unit ?? "days"] ?? 1)) / 4;
  return pyRound(Math.min(sd, mean), 4);
}

/** A created duration is gamma with the illustrative sd; an existing one keeps its distribution, with the sd recomputed when it is not constant. */
export function durationFor(existing: Duration | null | undefined, mean: number, name: DurationName, disease: string | null): Duration {
  if (!existing) return { mean_days: mean, dist: "gamma", sd_days: illustrativeSd(name, mean, disease) };
  if (existing.dist === "constant") return { mean_days: mean, dist: "constant", sd_days: null };
  return { mean_days: mean, dist: existing.dist, sd_days: illustrativeSd(name, mean, disease) };
}
