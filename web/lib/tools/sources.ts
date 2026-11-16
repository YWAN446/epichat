/**
 * Where a scenario's values came from (spec 9.2), derived as section 19
 * says: a fetched data source that still carries the value, the database
 * consensus, an illustrative spread the configure tool computed, the
 * registry default, or else the user.
 */
import { detectDisease, lookup, type DiseaseEntry } from "@/lib/disease/db";
import { countryDemographics } from "@/lib/data/countryDemographics";
import { CONTACT_PAIRS, DEFAULT_BETA, approxR0, type SimParams } from "@/lib/sim/params";
import { flattenParams } from "@/lib/sim/paths";
import { PARAM_REGISTRY, appliesOn, appliesTo, specFor } from "@/lib/sim/registry";
import { REFERENCE_TARGETS } from "./chosenReference";
import { illustrativeSd } from "./durations";
import type { Scenario } from "./types";

/** run: a value the run itself changed from what was configured (a calibrated beta, a fitted lever, demographics the service filled); only a run's payload carries it. */
export type ParamSource = "user" | "database" | "fetch" | "default" | "illustrative" | "run" | "reference";
export type DbRange = { min: number | null; max: number | null; typical: number | null; unit: string | null; source: string };

const DAYS_PER_UNIT: Record<string, number> = { days: 1, weeks: 7, months: 30.44, years: 365.25 };
/** How close a configured R0 must be to the database typical to count as the database's. */
const R0_TOLERANCE = 0.01;
/** Follow-up spec 4.5: the coefficient of variation the agent offers is an assumption, not a value the user knows. */
export const ILLUSTRATIVE_CV = 1;

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
const bundledAges = (scenario: Scenario) => scenario.dataSources.find((f) => f.field === "age_distribution_pct")?.citation.includes("bundled") ?? false;
/** The nine matrix cells fetch_demographics applied from the bundled Prem table, when it did. */
const bundledContacts = (scenario: Scenario): number[] | undefined => {
  const source = sourceValue(scenario, "contact_matrix");
  const iso3 = typeof source === "string" ? source.split(":")[1] : undefined;
  return iso3 ? (countryDemographics(iso3)?.contacts ?? undefined) : undefined;
};

/** What each fetch tool writes, by path (lib/tools/fetch*.ts): the value is a fetch only while it still equals what was fetched. */
const FETCHED: Record<string, (scenario: Scenario) => unknown> = {
  "demographics.birth_rate": (s) => sourceValue(s, "birth_rate"),
  "demographics.death_rate": (s) => sourceValue(s, "death_rate"),
  "demographics.use_demographics": (s) => (sourceValue(s, "birth_rate") === undefined ? undefined : true),
  "demographics.age_pct_under18": (s) => ages(s)?.["0-17"],
  "demographics.age_pct_18_64": (s) => ages(s)?.["18-64"],
  "demographics.age_pct_over65": (s) => ages(s)?.["65+"],
  "network.network_type": (s) => (ages(s) === undefined ? undefined : "age_structured"),
  "demographics.age_source": (s) => (bundledAges(s) ? "un_wpp" : undefined),
  "network.household_size": (s) => sourceValue(s, "household_size"),
  "network.contacts_source": (s) => sourceValue(s, "contact_matrix"),
  ...Object.fromEntries(CONTACT_PAIRS.map((pair, i) => [`network.contacts.${pair}`, (s: Scenario) => bundledContacts(s)?.[i]])),
  "disease.initial_immune_frac": (s) => {
    const coverage = s.dataSources.find((f) => f.field.endsWith("_coverage"));
    return coverage ? Math.min(0.99, Number(coverage.value) / 100) : undefined;
  },
};

const DURATIONS = ["dur_exp", "dur_inf", "dur_immune"] as const;

/**
 * Follow-up spec 9.4: the paths whose value is still the one a chosen literature reference set (the data source
 * ref:<parameter>, in the unit it was applied in; beta by the R0 it implies), each with the reference's title and year.
 */
export function referenceNotes(p: SimParams, scenario: Scenario): Record<string, string> {
  const flat = flattenParams(p as unknown as Record<string, unknown>);
  const notes: Record<string, string> = {};
  for (const source of scenario.dataSources) {
    if (!source.field.startsWith("ref:") || typeof source.value !== "number") continue;
    const name = source.field.slice(4);
    if (!Object.hasOwn(REFERENCE_TARGETS, name)) continue;
    const path = REFERENCE_TARGETS[name as keyof typeof REFERENCE_TARGETS].path;
    const spec = specFor(path);
    // it stands while the value is still the recorded one and the path is still a parameter of the scenario's model and network
    const applies = spec !== null && appliesTo(spec, p.disease.model) && appliesOn(spec, p.network.network_type);
    const stands = applies && (name === "r0" ? Math.abs(approxR0(p) - source.value) <= R0_TOLERANCE * source.value : near(flat[path], source.value));
    if (stands) notes[path] = source.citation.replace(/\.( https?:\/\/\S+)?$/, "");
  }
  return notes;
}

/** A data source that is a chosen literature reference, not fetched data: it does not ground a scenario in real data. */
export const isChosenReference = (field: string): boolean => field.startsWith("ref:");

/**
 * Review of the follow-up's phase D: a chosen reference stays among the data sources only while its value stands. One the user
 * overrode, or whose parameter the network no longer has, would otherwise still be cited by the run card and the report for a
 * scenario that runs on another value.
 */
export function pruneReferences(scenario: Scenario): void {
  if (!scenario.params || !scenario.dataSources.some((f) => isChosenReference(f.field))) return;
  const standing = new Set(Object.keys(referenceNotes(scenario.params, scenario)));
  scenario.dataSources = scenario.dataSources.filter((f) => {
    if (!isChosenReference(f.field)) return true;
    const name = f.field.slice(4);
    return Object.hasOwn(REFERENCE_TARGETS, name) && standing.has(REFERENCE_TARGETS[name as keyof typeof REFERENCE_TARGETS].path);
  });
}

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
  if (near(p.disease.rel_sus_cv, ILLUSTRATIVE_CV)) out["disease.rel_sus_cv"] = "illustrative";
  // a value a chosen reference set is the reference's for as long as it stands, whatever else it happens to equal
  for (const path of Object.keys(referenceNotes(p, scenario))) out[path] = "reference";
  return out;
}

/** The titles behind the reference tags, for the payloads that carry the sources; undefined when no chosen reference stands. */
export function scenarioReferences(scenario: Scenario): Record<string, string> | undefined {
  if (!scenario.params) return undefined;
  const notes = referenceNotes(scenario.params, scenario);
  return Object.keys(notes).length > 0 ? notes : undefined;
}

/**
 * The sources of the scenario's own parameters, for the payloads that carry them (follow-up spec 8.4): the panel tags each row
 * with where its value came from. Only what is not a default is sent, a tenth of the whole map; with sources present, a path
 * that is not among them is a default. Empty before a scenario is configured.
 */
export function scenarioSources(scenario: Scenario, contextText: string): Record<string, ParamSource> {
  if (!scenario.params) return {};
  const all = valueSources(scenario.params, scenario, scenario.disease ?? detectDisease(contextText || ""));
  return Object.fromEntries(Object.entries(all).filter(([, source]) => source !== "default"));
}
