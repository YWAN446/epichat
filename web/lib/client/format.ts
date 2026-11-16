/**
 * Words for what the details panel shows: country names for ISO3 codes, the
 * literature parameters and their units, and the fields the data tools apply.
 * Values are formatted the way the Python app prints them (lib/sim/pyformat).
 */
import names from "@/data/country_names.json";
import type { Duration, Seed, SimParams } from "@/lib/sim/params";
import { commaInt, fmtValue } from "@/lib/sim/pyformat";
import type { ConfigPayload, DataPayload } from "@/lib/tools/types";

const NAMES = names as Record<string, string>;

/** The data sources, by the field's source key. */
export const SOURCE_LABELS: Record<DataPayload["source"], string> = {
  un_wpp: "UN World Population Prospects",
  wb_data360: "World Bank Data360",
  who_gho: "WHO Global Health Observatory",
  sim_fallback: "Built-in fallback",
};

/** The UN's English name for an ISO3 code; the code itself when it is not a UN location. */
export function countryName(iso3: string): string {
  return NAMES[iso3.trim().toUpperCase()] ?? iso3;
}

const PARAMETER_LABELS: Record<string, string> = {
  r0: "R₀",
  incubation_days: "Incubation period",
  infectious_days: "Infectious period",
  fatality_rate: "Case fatality",
  average_contacts_daily: "Contacts per day",
  immunity_duration: "Immunity duration",
  asymptomatic_fraction: "Asymptomatic share",
};

/** snake_case to a sentence-case phrase. */
function words(key: string): string {
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function parameterLabel(name: string): string {
  return PARAMETER_LABELS[name] ?? words(name);
}

const plain = (value: number): string => fmtValue(value);
const PERIODS = new Set(["days", "weeks", "months", "years"]);

/** 15 (dimensionless), "10 days", "1 day", "0.1%" for a fraction, "15%" for a percentage. */
export function formatQuantity(value: number, unit?: string): string {
  if (unit === undefined || unit === "dimensionless") return plain(value);
  if (unit === "fraction") return `${plain(value * 100)}%`;
  if (unit === "percentage") return `${plain(value)}%`;
  if (PERIODS.has(unit)) return `${plain(value)} ${value === 1 ? unit.slice(0, -1) : unit}`;
  return `${plain(value)} ${unit}`;
}

/** The configuration as label and value pairs, shared by the panel's Scenario section and the report. */
export function configurationRows(c: ConfigPayload["config"], approxR0: number, diseaseName: string): [string, string][] {
  return [
    ["Disease", diseaseName],
    ["Model", c.disease_type.toUpperCase()],
    ["Country", c.country ? countryName(c.country) : "—"],
    ["Agents", commaInt(c.n_agents)],
    ["Duration", formatQuantity(c.sim_dur_years, "years")],
    ["R₀ (approx.)", approxR0.toFixed(1)],
    ["Infectious period", formatQuantity(c.dur_inf, "days")],
    ...(c.dur_exp ? ([["Exposed period", formatQuantity(c.dur_exp, "days")]] as [string, string][]) : []),
    ["Interventions", c.interventions.length > 0 ? c.interventions.join(", ") : "none"],
  ];
}

/** What is being modelled, for the panel's Scenario section: the values live in Parameters. */
export function scenarioRows(c: ConfigPayload["config"], diseaseName: string): [string, string][] {
  return [
    ["Disease", diseaseName],
    ["Model", c.disease_type.toUpperCase()],
    ["Country", c.country ? countryName(c.country) : "—"],
    ["Duration", formatQuantity(c.sim_dur_years, "years")],
    ["Interventions", c.interventions.length > 0 ? c.interventions.join(", ") : "none"],
  ];
}

/** "8 days", or "8 days, gamma (sd 2.4)" for a distributed period. */
export function durationText(d: Duration): string {
  const mean = formatQuantity(d.mean_days, "days");
  return d.dist === "constant" ? mean : `${mean}, ${d.dist} (sd ${fmtValue(d.sd_days ?? 0)})`;
}

/** "1%", "20 agents", "20 agents on day 5". */
export function seedText(s: Seed): string {
  const size = s.mode === "count" ? `${commaInt(s.value)} agents` : formatQuantity(s.value, "fraction");
  return s.day > 0 ? `${size} on day ${fmtValue(s.day)}` : size;
}

export const AGE_SOURCE_LABELS: Record<string, string> = { default: "Starsim's default ages", shares: "the three shares", un_wpp: "UN WPP 2024 pyramid" };

export function networkLabel(n: SimParams["network"]): string {
  return n.network_type === "hybrid" ? "hybrid (households, schools, workplaces, community)" : n.network_type.replace(/_/g, "-");
}

/** "POLYMOD default (European)", "Prem 2021, Kenya" or "user-set" (Part 2, 5.3). */
export function contactsSourceLabel(source: string): string {
  if (source === "polymod_default") return "POLYMOD default (European)";
  const prem = /^prem_2021:([A-Z]{3})$/.exec(source);
  if (prem) return `Prem 2021, ${countryName(prem[1])}`;
  return source === "user" ? "user-set" : source;
}

const FIT_TARGET_LABELS: Record<string, string> = { attack_rate: "attack rate", peak_day: "peak day", peak_infections: "peak infections" };
export const LEVER_LABELS: Record<string, string> = {
  "disease.beta": "the transmission rate",
  "network.network_beta": "the network multiplier",
  "disease.rel_sus_cv": "the variation in susceptibility",
  "behavior_response.scale": "the behaviour response",
};
const LEVER_NAMES: Record<string, string> = { beta: "Transmission rate", network_beta: "Network multiplier", rel_sus_cv: "Variation in susceptibility", behavior_response: "Behaviour response" };
const LAYER_WORDS: Record<string, string> = { all: "All", household: "Household", school: "School", work: "Workplace", community: "Community" };

/** A fit outcome in its unit: "30%" for an attack rate, "60" for a peak day, "500 agents" for a peak size (Part 2, 7.7). */
export function fitValueText(target: string, value: number): string {
  if (target === "attack_rate") return formatQuantity(value, "fraction");
  if (target === "peak_day") return fmtValue(value);
  return `${commaInt(value)} agents`;
}

/** "attack rate 30%", "peak day 60", "peak infections 500 agents". */
export function fitText(target: string, value: number): string {
  return `${FIT_TARGET_LABELS[target] ?? words(target).toLowerCase()} ${fitValueText(target, value)}`;
}

/** " from day 30" (open), " on day 0" (one day) or ", days 10–40" (a window), as the suffix of an intervention line. */
function windowText(start: number, end: number | null): string {
  if (end === null) return ` from day ${fmtValue(start)}`;
  return end === start ? ` on day ${fmtValue(start)}` : `, days ${fmtValue(start)}–${fmtValue(end)}`;
}

function agesText(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `ages ${fmtValue(min)}–${fmtValue(max)}`;
  return min !== null ? `ages ${fmtValue(min)} and over` : `ages under ${fmtValue(max)}`;
}

/** "from day 30 to day 72", or "from day 30" when the reduction runs to the end. */
function spanText(start: number, end: number | null): string {
  return end === null ? `from day ${fmtValue(start)}` : `from day ${fmtValue(start)} to day ${fmtValue(end)}`;
}

/**
 * One line per intervention (Part 2, 7.1): "Vaccination campaign: 70% coverage, days 10–40, efficacy 80%, ages 5–17, protection 180 days",
 * "Treatment: 100% coverage, capacity 20 agents, after 3 days, efficacy 70%, half transmissibility while waiting, symptomatic only",
 * "School contacts reduced by 100% from day 30 to day 72", "Transmission reduced by 30% from day 0 to day 90", "Seasonality: amplitude 0.3, shift 0".
 */
export function interventionLines(p: SimParams): string[] {
  return p.interventions.map((i) => {
    const coverage = i.coverage === null ? "coverage not set" : `${formatQuantity(i.coverage, "fraction")} coverage`;
    const efficacy = i.efficacy < 1 ? [`efficacy ${formatQuantity(i.efficacy, "fraction")}`] : [];
    if (i.type === "vaccine") {
      // A day-0 vaccine at full efficacy is disease.initial_immune_frac after validation (spec 18); a listed one has a window or a partial efficacy.
      const head = `Vaccination${i.kind === "campaign" ? " campaign" : ""}: ${coverage}${windowText(i.start_day, i.end_day)}`;
      const rest = [
        ...efficacy,
        ...(i.age_min !== null || i.age_max !== null ? [agesText(i.age_min, i.age_max)] : []),
        ...(i.protection_days !== null ? [`protection ${formatQuantity(i.protection_days, "days")}`] : []),
        ...(i.leaky ? [] : ["all-or-nothing"]),
      ];
      return [head, ...rest].join(", ");
    }
    if (i.type === "treatment") {
      const waiting = i.rel_trans_treated < 1 ? [`${i.rel_trans_treated === 0.5 ? "half" : `×${fmtValue(i.rel_trans_treated)}`} transmissibility while waiting`] : [];
      const parts = [
        `Treatment: ${coverage}`,
        i.capacity === null ? "no capacity limit" : `capacity ${fmtValue(i.capacity)} agents`,
        ...(i.delay_days > 0 ? [`after ${formatQuantity(i.delay_days, "days")}`] : []),
        ...efficacy,
        ...waiting,
        ...(i.symptomatic_only ? ["symptomatic only"] : []),
      ];
      const window = i.start_day > 0 || i.end_day !== null ? windowText(i.start_day, i.end_day).replace(/^, /, "").trim() : "";
      return window ? `${parts.join(", ")}, ${window}` : parts.join(", ");
    }
    if (i.type === "contact_reduction") return `${LAYER_WORDS[i.layer] ?? words(i.layer)} contacts reduced by ${formatQuantity(i.scale, "fraction")} ${spanText(i.start_day, i.end_day)}`;
    if (i.type === "transmission_reduction") return `Transmission reduced by ${formatQuantity(i.scale, "fraction")} ${spanText(i.start_day, i.end_day)}`;
    if (i.type === "behavior_response") {
      // follow-up spec 5.5: people being careful as infections rise; the window only when it has one
      const window = i.start_day > 0 || i.end_day !== null ? windowText(i.start_day, i.end_day) : "";
      return `Behaviour response: transmission falls by up to ${formatQuantity(i.scale, "fraction")} as infections rise (half of that at ${formatQuantity(i.half_prevalence, "fraction")} infectious, ${fmtValue(i.memory_days)}-day memory)${window}`;
    }
    return `Seasonality: amplitude ${fmtValue(i.scale)}, shift ${fmtValue(i.shift)}`;
  });
}

/** "12–18", "7–21 days", "0.1–0.3%": the unit once, at the end. */
export function formatRange(min: number, max: number, unit?: string): string {
  if (min === max) return formatQuantity(min, unit);
  if (unit === undefined || unit === "dimensionless") return `${plain(min)}–${plain(max)}`;
  if (unit === "fraction") return `${plain(min * 100)}–${plain(max * 100)}%`;
  if (unit === "percentage") return `${plain(min)}–${plain(max)}%`;
  return `${plain(min)}–${plain(max)} ${unit}`;
}

type FieldSpec = { label: string; unit?: string; kind?: "percent_of_one" | "reduction" | "age" | "network" | "contacts" | "age_source" | "fit" | "interventions" | "intervention_keys" };

/** WHO routine-immunization indicators, by the prefix of the field the adapter names. */
const VACCINES: Record<string, string> = {
  bcg: "BCG",
  dtp3: "DTP3",
  polio: "Polio (Pol3)",
  hepb3: "Hepatitis B (HepB3)",
  hib3: "Hib3",
  mcv1: "Measles, first dose (MCV1)",
  mcv2: "Measles, second dose (MCV2)",
  pcv3: "Pneumococcal (PCV3)",
  rotac: "Rotavirus",
  hpv: "HPV",
  menga: "Meningococcal A (MenA)",
  yfv: "Yellow fever",
  pab: "Tetanus, protected at birth (PAB)",
};

/** Every field the demographics, health-system, and vaccination tools can apply (lib/data, lib/tools). */
const FIELDS: Record<string, FieldSpec> = {
  birth_rate: { label: "Birth rate", unit: "per 1,000 per year" },
  death_rate: { label: "Death rate", unit: "per 1,000 per year" },
  total_population: { label: "Population" },
  age_structure_pct: { label: "Age structure", kind: "age" },
  network_type: { label: "Contact network", kind: "network" },
  beta_recalibrated_to_hold_r0: { label: "Transmission rate recalibrated to hold R₀" },
  household_size: { label: "Household size", unit: "people" },
  contact_matrix: { label: "Contact matrix", kind: "contacts" },
  age_source: { label: "Age source", kind: "age_source" },
  beta_calibrated_by_measurement: { label: "Transmission rate calibrated to the measured R₀" },
  treatment_capacity: { label: "Treatment capacity", unit: "per 1,000 people" },
  applied_treatment_capacity: { label: "Treatment capacity applied", unit: "agents" },
  uhc_coverage: { label: "UHC service coverage index", unit: "of 100" },
  applied_vaccine_coverage: { label: "Vaccine coverage applied", kind: "percent_of_one" },
  applied_vaccine_efficacy: { label: "Vaccine efficacy applied", kind: "percent_of_one" },
  behavior_response_min_factor: { label: "Strongest reduction by the behaviour response", kind: "reduction" },
  fit: { label: "Fit", kind: "fit" },
  interventions: { label: "Interventions set", kind: "interventions" },
  remove_interventions: { label: "Interventions removed", kind: "intervention_keys" },
  tb_incidence: { label: "TB incidence", unit: "per 100,000 per year" },
  malaria_incidence: { label: "Malaria incidence", unit: "per 1,000 at risk per year" },
  hiv_prevalence: { label: "HIV prevalence" },
  diabetes_prevalence: { label: "Diabetes prevalence", unit: "% of adults" },
  hepb_prevalence: { label: "Hepatitis B prevalence", unit: "%" },
};

export function ageStructure(value: unknown): string {
  if (typeof value !== "object" || value === null) return fmtValue(value);
  return Object.entries(value as Record<string, unknown>)
    .map(([band, share]) => `${band.replace("-", "–")}: ${Math.round(Number(share))}%`)
    .join(", ");
}

/** "contact reduction (school)" for "contact_reduction:school" or an entry with a layer; "vaccine" otherwise. */
function interventionName(type: string, layer?: unknown): string {
  const name = type.replace(/_/g, " ");
  return layer && layer !== "all" ? `${name} (${layer})` : name;
}

function fitFieldText(value: unknown): string {
  if (value === null || value === undefined) return "cleared";
  const f = value as { target?: string; value?: number; value_in_agents?: number };
  if (typeof f.target !== "string" || typeof f.value !== "number") return fmtValue(value);
  if (typeof f.value_in_agents === "number") return `${FIT_TARGET_LABELS[f.target] ?? f.target} ${commaInt(f.value)} people (${commaInt(f.value_in_agents)} agents)`;
  return fitText(f.target, f.value);
}

/** The simulation's unit of each database parameter a chosen reference sets (lib/tools/chosenReference.ts converts into it). */
const REFERENCE_UNITS: Record<string, string> = { incubation_days: "days", infectious_days: "days", immunity_duration: "days", fatality_rate: "fraction", asymptomatic_fraction: "fraction" };

/** A label and a readable value for a field a data tool applied; unknown fields fall back to the key in words. */
export function describeField(key: string, value: unknown): { label: string; value: string } {
  const vaccine = /^([a-z0-9]+)_coverage$/.exec(key);
  if (vaccine && VACCINES[vaccine[1]]) return { label: `${VACCINES[vaccine[1]]} coverage`, value: `${fmtValue(value)}%` };
  const fitted = /^(\w+)_fitted_to_(\w+)$/.exec(key);
  if (fitted) {
    const label = `${LEVER_NAMES[fitted[1]] ?? words(fitted[1])} fitted to ${FIT_TARGET_LABELS[fitted[2]] ?? words(fitted[2]).toLowerCase()}`;
    return { label, value: fitted[1] === "behavior_response" ? `${plain(Number(value) * 100)}%` : fmtValue(value) };      // the response's scale is a share
  }
  const chosen = /^ref:(\w+)$/.exec(key);
  if (chosen) {
    // follow-up spec 9.4: a literature reference the participant chose, its value in the unit it was applied in
    const unit = REFERENCE_UNITS[chosen[1]];
    return { label: `${parameterLabel(chosen[1])} (literature)`, value: unit && typeof value === "number" ? formatQuantity(value, unit) : fmtValue(value) };
  }
  const spec = FIELDS[key];
  if (!spec) return { label: words(key), value: fmtValue(value) };
  if (spec.kind === "fit") return { label: spec.label, value: fitFieldText(value) };
  if (spec.kind === "interventions" && Array.isArray(value)) return { label: spec.label, value: value.map((i) => interventionName(String((i as { type?: unknown })?.type ?? "?"), (i as { layer?: unknown })?.layer)).join(", ") };
  if (spec.kind === "intervention_keys" && Array.isArray(value)) return { label: spec.label, value: value.map((k) => { const [type, layer] = String(k).split(":"); return interventionName(type, layer); }).join(", ") };
  if (spec.kind === "age") return { label: spec.label, value: ageStructure(value) };
  if (spec.kind === "network") return { label: spec.label, value: String(value).replace(/_/g, "-") };
  if (spec.kind === "contacts") return { label: spec.label, value: contactsSourceLabel(String(value)) };
  if (spec.kind === "age_source") return { label: spec.label, value: AGE_SOURCE_LABELS[String(value)] ?? String(value) };
  if (spec.kind === "percent_of_one") return { label: spec.label, value: `${plain(Number(value) * 100)}%` };
  if (spec.kind === "reduction") return { label: spec.label, value: `${plain(Math.round((1 - Number(value)) * 1000) / 10)}%` };          // a factor of 0.53 is a reduction of 47%
  if (!spec.unit) return { label: spec.label, value: fmtValue(value) };
  return { label: spec.label, value: `${fmtValue(value)}${spec.unit.startsWith("%") ? "" : " "}${spec.unit}` };
}
