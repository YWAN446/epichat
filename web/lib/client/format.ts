/**
 * Words for what the details panel shows: country names for ISO3 codes, the
 * literature parameters and their units, and the fields the data tools apply.
 * Values are formatted the way the Python app prints them (lib/sim/pyformat).
 */
import names from "@/data/country_names.json";
import { approxR0, type SimParams } from "@/lib/sim/params";
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

/**
 * The scenario's current parameters as label and value pairs for the panel's
 * Parameters section: what the next run uses, in words with units. Rows a
 * model or a data step does not bring are left out.
 */
export function parameterRows(p: SimParams): [string, string][] {
  const asymptomatic = p.disease_type === "seiar";
  const ages = p.age_pct_under18 !== null && p.age_pct_18_64 !== null && p.age_pct_over65 !== null;
  return [
    ["R₀ (approx.)", approxR0(p).toFixed(1)],
    ["Transmission rate (β)", fmtValue(p.beta)],
    ["Contacts per day", fmtValue(p.n_contacts)],
    ["Contact network", p.network_type.replace(/_/g, "-")],
    ["Initial prevalence", formatQuantity(p.init_prev, "fraction")],
    ["Infectious period", formatQuantity(p.dur_inf, "days")],
    ...(p.dur_exp !== null ? ([["Exposed period", formatQuantity(p.dur_exp, "days")]] as [string, string][]) : []),
    ...(p.dur_immune !== null ? ([["Immunity duration", formatQuantity(p.dur_immune, "days")]] as [string, string][]) : []),
    ["Death probability", formatQuantity(p.p_death, "fraction")],
    ...(asymptomatic ? ([["Asymptomatic share", formatQuantity(p.p_asymp, "fraction")], ["Asymptomatic transmission", `${formatQuantity(p.rel_trans_asymp, "fraction")} of symptomatic`]] as [string, string][]) : []),
    ["Agents", commaInt(p.n_agents)],
    ["Duration", formatQuantity(p.sim_dur_years, "years")],
    ["Births and deaths", p.use_demographics ? `${fmtValue(p.birth_rate)} and ${fmtValue(p.death_rate)} per 1,000 per year` : "not modelled"],
    ...(ages ? ([["Age structure", ageStructure({ "0-17": p.age_pct_under18, "18-64": p.age_pct_18_64, "65+": p.age_pct_over65 })]] as [string, string][]) : []),
    ...(p.rand_seed !== null ? ([["Random seed", fmtValue(p.rand_seed)]] as [string, string][]) : []),
  ];
}

/** One line per intervention: "Vaccination: 72% coverage from day 60", "Treatment: 100% coverage, capacity 252 agents", "Seasonality: amplitude 0.3, shift 0". */
export function interventionLines(p: SimParams): string[] {
  return p.interventions.map((i) => {
    const coverage = i.coverage === null ? "coverage not set" : `${formatQuantity(i.coverage, "fraction")} coverage`;
    if (i.type === "vaccine") return `Vaccination: ${coverage} from ${i.start_day > 0 ? `day ${fmtValue(i.start_day)}` : "the start"}`;
    if (i.type === "treatment") return `Treatment: ${coverage}, ${i.capacity === null ? "no capacity limit" : `capacity ${fmtValue(i.capacity)} agents`}`;
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

type FieldSpec = { label: string; unit?: string; kind?: "percent_of_one" | "age" | "network" };

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
  treatment_capacity: { label: "Treatment capacity", unit: "per 1,000 people" },
  applied_treatment_capacity: { label: "Treatment capacity applied", unit: "agents" },
  uhc_coverage: { label: "UHC service coverage index", unit: "of 100" },
  applied_vaccine_coverage: { label: "Vaccine coverage applied", kind: "percent_of_one" },
  tb_incidence: { label: "TB incidence", unit: "per 100,000 per year" },
  malaria_incidence: { label: "Malaria incidence", unit: "per 1,000 at risk per year" },
  hiv_prevalence: { label: "HIV prevalence" },
  diabetes_prevalence: { label: "Diabetes prevalence", unit: "% of adults" },
  hepb_prevalence: { label: "Hepatitis B prevalence", unit: "%" },
};

function ageStructure(value: unknown): string {
  if (typeof value !== "object" || value === null) return fmtValue(value);
  return Object.entries(value as Record<string, unknown>)
    .map(([band, share]) => `${band.replace("-", "–")}: ${Math.round(Number(share))}%`)
    .join(", ");
}

/** A label and a readable value for a field a data tool applied; unknown fields fall back to the key in words. */
export function describeField(key: string, value: unknown): { label: string; value: string } {
  const vaccine = /^([a-z0-9]+)_coverage$/.exec(key);
  if (vaccine && VACCINES[vaccine[1]]) return { label: `${VACCINES[vaccine[1]]} coverage`, value: `${fmtValue(value)}%` };
  const spec = FIELDS[key];
  if (!spec) return { label: words(key), value: fmtValue(value) };
  if (spec.kind === "age") return { label: spec.label, value: ageStructure(value) };
  if (spec.kind === "network") return { label: spec.label, value: String(value).replace(/_/g, "-") };
  if (spec.kind === "percent_of_one") return { label: spec.label, value: `${plain(Number(value) * 100)}%` };
  if (!spec.unit) return { label: spec.label, value: fmtValue(value) };
  return { label: spec.label, value: `${fmtValue(value)}${spec.unit.startsWith("%") ? "" : " "}${spec.unit}` };
}
