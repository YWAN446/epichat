/**
 * Follow-up spec 9.3: one literature estimate chosen from the Data section's reference list, read from the reference
 * data by the tool. Which registry path each database parameter sets, which models and network have it, and how its
 * unit becomes the simulation's, in one table that the tool and the source tags share.
 */
import { referenceValue, type Reference } from "@/lib/client/references";
import { PARAMETERS, lookup, type ParameterName } from "@/lib/disease/db";
import { references } from "@/lib/disease/refs";

type Target = {
  /** The registry path the reference sets; an R0 sets beta, compared by the R0 it implies. */
  path: string;
  /** The models that have the parameter (all when absent), and what to say for one that does not. */
  models?: string[];
  lacking?: string;
};

export const REFERENCE_TARGETS: Record<ParameterName, Target> = {
  r0: { path: "disease.beta" },
  incubation_days: { path: "disease.dur_exp.mean_days", models: ["seir", "seirs", "seiar"], lacking: "has no latent period; switch to seir first" },
  infectious_days: { path: "disease.dur_inf.mean_days" },
  fatality_rate: { path: "disease.p_death", models: ["sir", "seir", "sirs", "seirs", "seiar"], lacking: "has no deaths" },
  average_contacts_daily: { path: "network.n_contacts" },
  immunity_duration: { path: "disease.dur_immune.mean_days", models: ["sirs", "seirs"], lacking: "has no waning immunity; switch to sirs first" },
  asymptomatic_fraction: { path: "disease.p_asymp", models: ["seiar"], lacking: "has no asymptomatic infections; switch to seiar first" },
};

const DAYS_PER_UNIT: Record<string, number> = { days: 1, weeks: 7, months: 30.44, years: 365.25 };
const SHARES = new Set<ParameterName>(["fatality_rate", "asymptomatic_fraction"]);

/** The database's unit for a disease's parameter: its summary's, else its consensus entry's. */
export function referenceUnit(disease: string, parameter: string): string | undefined {
  const entry = lookup(disease);
  return entry?.summaries[parameter]?.unit ?? entry?.flat[parameter]?.unit ?? undefined;
}

/** An estimate's value in the simulation's unit: a fraction of 1, days, a whole number of contacts. */
export function toSimulationUnit(parameter: ParameterName, value: number, unit: string | undefined): number {
  if (SHARES.has(parameter)) return unit === "fraction" ? value : unit === "percentage" || value > 1 ? value / 100 : value;
  if (parameter === "immunity_duration") return value * (DAYS_PER_UNIT[unit ?? "days"] ?? 1);
  if (parameter === "average_contacts_daily") return Math.round(value);
  return value;
}

export type ChosenReference = { parameter: ParameterName; index: number; estimate: Reference; value: number; unit: string | undefined; path: string };

const isParameter = (name: unknown): name is ParameterName => typeof name === "string" && (PARAMETERS as readonly string[]).includes(name);

/** The estimate to apply, or the sentence that says why it cannot be applied and what to do. Nothing is written here. */
export function chosenReference(use: unknown, disease: string | null, model: string, network: string): ChosenReference | string {
  const names = PARAMETERS.join(", ");
  if (typeof use !== "object" || use === null) return `use_reference takes {parameter, index}: the parameter's database name (${names}) and the number shown in the reference list`;
  const { parameter, index } = use as { parameter?: unknown; index?: unknown };
  if (!isParameter(parameter)) return `use_reference: unknown parameter ${JSON.stringify(parameter)}; it is one of ${names}`;
  if (!disease) return "use_reference needs a disease from the database; none is set";
  const entry = references(disease);
  if (!entry) return `use_reference: the database has no references for ${disease}`;
  const list = Object.hasOwn(entry.parameters, parameter) ? entry.parameters[parameter].estimates : [];
  if (list.length === 0) return `use_reference: ${disease} has no estimate for ${parameter}`;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > list.length) {
    return `use_reference: ${parameter} has ${list.length} ${list.length === 1 ? "estimate" : "estimates"}; index must be 1 to ${list.length}`;
  }
  const estimate = list[index - 1];
  const unit = referenceUnit(disease, parameter);
  if (typeof estimate.value !== "number" || estimate.special_value) {
    return `use_reference: reference ${index} for ${parameter} has no single value (it gives ${referenceValue(estimate, unit) || "no number"}); set the value yourself`;
  }
  const target = REFERENCE_TARGETS[parameter];
  if (target.models && !target.models.includes(model)) return `use_reference: the ${model} model ${target.lacking}`;
  if (parameter === "average_contacts_daily" && network !== "random") {
    return `use_reference: contacts per day is a parameter of the random network; the ${network.replace(/_/g, "-")} network takes its contacts from its matrix or its layers`;
  }
  return { parameter, index, estimate, value: toSimulationUnit(parameter, estimate.value, unit), unit, path: target.path };
}
