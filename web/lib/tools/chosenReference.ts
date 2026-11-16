/**
 * Follow-up spec 9.3: one literature estimate chosen from the Data section's reference list, read from the reference
 * data by the tool. Which registry path each database parameter sets, which models and network have it, and how its
 * unit becomes the simulation's, in one table that the tool and the source tags share.
 */
import { referenceValue, type Reference } from "@/lib/client/references";
import { PARAMETERS, detectDisease, lookup, type ParameterName } from "@/lib/disease/db";
import { estimateAt, references } from "@/lib/disease/refs";

type Target = {
  /** The registry path the reference sets; an R0 sets beta, compared by the R0 it implies. */
  path: string;
  /** configure_simulation's own field for the same value, which may not be passed beside the reference. */
  field: string | null;
  /** The models that have the parameter (all when absent), and what to say for one that does not. */
  models?: string[];
  lacking?: string;
};

export const REFERENCE_TARGETS: Record<ParameterName, Target> = {
  r0: { path: "disease.beta", field: "r0" },
  incubation_days: { path: "disease.dur_exp.mean_days", field: "dur_exp_days", models: ["seir", "seirs", "seiar"], lacking: "has no latent period; switch to seir first" },
  infectious_days: { path: "disease.dur_inf.mean_days", field: "dur_inf_days" },
  fatality_rate: { path: "disease.p_death", field: "p_death", models: ["sir", "seir", "sirs", "seirs", "seiar"], lacking: "has no deaths" },
  average_contacts_daily: { path: "network.n_contacts", field: null },
  immunity_duration: { path: "disease.dur_immune.mean_days", field: "dur_immune_days", models: ["sirs", "seirs"], lacking: "has no waning immunity; switch to sirs first" },
  asymptomatic_fraction: { path: "disease.p_asymp", field: "p_asymp", models: ["seiar"], lacking: "has no asymptomatic infections; switch to seiar first" },
};

const DAYS_PER_UNIT: Record<string, number> = { days: 1, weeks: 7, months: 30.44, years: 365.25 };
const SHARES = new Set<ParameterName>(["fatality_rate", "asymptomatic_fraction"]);
/** A conversion leaves no binary noise in the stored value (2.21% is 0.0221, ten months 304.4 days). */
const clean = (value: number): number => Number(value.toPrecision(12));

export const isParameter = (name: unknown): name is ParameterName => typeof name === "string" && (PARAMETERS as readonly string[]).includes(name);

/** The database's unit for a disease's parameter: its summary's, else its consensus entry's. */
export function referenceUnit(disease: string, parameter: string): string | undefined {
  const entry = lookup(disease);
  return entry?.summaries[parameter]?.unit ?? entry?.flat[parameter]?.unit ?? undefined;
}

/**
 * An estimate's value in the simulation's unit: a fraction of 1, days, a whole number of contacts. Null for a duration
 * in a unit the table does not know: a wrong guess would be applied silently.
 */
export function toSimulationUnit(parameter: ParameterName, value: number, unit: string | undefined): number | null {
  if (SHARES.has(parameter)) return clean(unit === "fraction" ? value : unit === "percentage" || value > 1 ? value / 100 : value);
  if (parameter === "immunity_duration") {
    const days = DAYS_PER_UNIT[unit ?? "days"];
    return days === undefined ? null : clean(value * days);
  }
  if (parameter === "average_contacts_daily") return Math.round(value);
  return value;
}

export type ChosenReference = { parameter: ParameterName; index: number; estimate: Reference; value: number; unit: string | undefined; path: string };

/**
 * The estimate to apply, or the sentence that says why it cannot be applied and what to do. Nothing is written here.
 * `use` is {parameter, index} and, as checks, the disease whose list the number came from and the value that list shows:
 * the panel lists the last disease looked up, which need not be the scenario's, and a list cached before a data update
 * may number its estimates differently. The value applied is always the data's own.
 */
export function chosenReference(use: unknown, disease: string | null, model: string, network: string): ChosenReference | string {
  const names = PARAMETERS.join(", ");
  if (typeof use !== "object" || use === null) return `use_reference takes {parameter, index}: the parameter's database name (${names}) and the number shown in the reference list`;
  const { parameter, index, disease: listed, value: shown } = use as { parameter?: unknown; index?: unknown; disease?: unknown; value?: unknown };
  if (!isParameter(parameter)) return `use_reference: unknown parameter ${JSON.stringify(parameter)}; it is one of ${names}`;
  if (!disease) return "use_reference needs a disease from the database; none is set";
  if (typeof listed === "string" && listed.trim() !== "") {
    const key = detectDisease(listed) ?? listed.trim().toLowerCase();
    if (key !== disease) return `use_reference: that reference is from the list of ${key}, and this scenario is ${disease}; choose from ${disease}'s list (look ${disease} up to show it), or start a scenario for ${key}`;
  }
  const entry = references(disease);
  if (!entry) return `use_reference: the database has no references for ${disease}`;
  const count = Object.hasOwn(entry.parameters, parameter) ? entry.parameters[parameter].estimates.length : 0;
  if (count === 0) return `use_reference: ${disease} has no estimate for ${parameter}`;
  const estimate = typeof index === "number" ? estimateAt(disease, parameter, index) : null;
  if (!estimate || typeof index !== "number") return `use_reference: ${parameter} has ${count} ${count === 1 ? "estimate" : "estimates"}; index must be 1 to ${count}`;
  const unit = referenceUnit(disease, parameter);
  if (typeof estimate.value !== "number" || estimate.special_value) {
    return `use_reference: reference ${index} for ${parameter} has no single value (it gives ${referenceValue(estimate, unit) || "no number"}); set the value yourself`;
  }
  if (typeof shown === "number" && Math.abs(shown - estimate.value) > 0.01 * Math.max(Math.abs(shown), Math.abs(estimate.value), 1e-9)) {
    return `use_reference: reference ${index} for ${parameter} is ${referenceValue(estimate, unit)} in the database, which does not match the ${shown} of the message; the list may have changed: open it again and choose from it`;
  }
  const target = REFERENCE_TARGETS[parameter];
  if (target.models && !target.models.includes(model)) return `use_reference: the ${model} model ${target.lacking}`;
  if (parameter === "average_contacts_daily" && network !== "random") {
    return `use_reference: contacts per day is a parameter of the random network; the ${network.replace(/_/g, "-")} network takes its contacts from its matrix or its layers`;
  }
  const value = toSimulationUnit(parameter, estimate.value, unit);
  if (value === null) return `use_reference: reference ${index} for ${parameter} is in ${unit}, a unit the tool does not convert; set the value yourself in days`;
  return { parameter, index, estimate, value, unit, path: target.path };
}
