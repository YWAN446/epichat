/**
 * The panel's Parameters section, generated from the registry (follow-up spec, section 8): one row per parameter
 * or per natural bundle of parameters, each naming the registry paths it covers, in five groups in the registry's
 * module order. A test walks the registry and fails when a parameter that applies to a scenario is covered by no
 * row or by two, so the section cannot fall behind the registry. The same rows feed the runs panel and the
 * report's appendix.
 */
import { AGE_GROUPS, approxR0, deathProbabilities, type SimParams } from "@/lib/sim/params";
import { flattenParams, getPath } from "@/lib/sim/paths";
import { commaInt, fmtValue } from "@/lib/sim/pyformat";
import { appliesOn, appliesTo, specFor } from "@/lib/sim/registry";
import { AGE_SOURCE_LABELS, LEVER_LABELS, ageStructure, contactsSourceLabel, countryName, durationText, fitText, formatQuantity, interventionLines, networkLabel, seedText } from "./format";

/** Where a value came from, in the user's words (spec 8.4); reference arrives with the chosen references of section 9. */
export type SourceTag = "database" | "fetched" | "default" | "assumption" | "you" | "reference";
export type ParameterGrid = { columns: string[]; rows: string[][] };
export type ParameterRow = {
  label: string;
  value: string;
  /** The registry paths the row covers on this scenario; empty for a derived row. */
  paths: string[];
  /** In the default view: a derived row, a core parameter, or a value that is not the registry default. */
  shown: boolean;
  source: SourceTag | null;
  grid?: ParameterGrid;
};
export type GroupId = "disease" | "network" | "demographics" | "interventions" | "run";
export type ParameterGroup = { id: GroupId; title: string; rows: ParameterRow[]; lines?: string[] };

type RowSpec = {
  label: string;
  /** Registry paths, the leading one first. */
  paths: string[];
  text: (p: SimParams) => string;
  grid?: (p: SimParams) => ParameterGrid;
  /** A derived row's own rule for the default view; a row with paths follows the registry's tiers and defaults. */
  show?: (p: SimParams) => boolean;
};

const at = (p: SimParams, path: string): unknown => getPath(p as unknown as Record<string, unknown>, path);
const yesNo = (value: unknown): string => (value ? "yes" : "no");
const times = (value: unknown): string => `×${fmtValue(value)}`;
const duration = (p: SimParams, name: "dur_exp" | "dur_inf" | "dur_immune"): string => {
  const d = p.disease[name];
  return d ? durationText(d) : "not set";
};
const three = (base: string): string[] => ["children", "adults", "elderly"].map((group) => `${base}.${group}`);
const CONTACT_GROUPS = ["children", "adults", "elderly"] as const;
const CONTACT_CELLS = CONTACT_GROUPS.flatMap((source) => CONTACT_GROUPS.map((target) => `network.contacts.${source}_${target}`));

const DISEASE: RowSpec[] = [
  { label: "R₀ (approx.)", paths: [], text: (p) => approxR0(p).toFixed(1), show: () => true },
  { label: "Model", paths: ["disease.model"], text: (p) => p.disease.model.toUpperCase() },
  { label: "Transmission rate (β)", paths: ["disease.beta"], text: (p) => fmtValue(p.disease.beta) },
  { label: "Infectious period", paths: ["disease.dur_inf.mean_days", "disease.dur_inf.dist", "disease.dur_inf.sd_days"], text: (p) => duration(p, "dur_inf") },
  { label: "Exposed period", paths: ["disease.dur_exp.mean_days", "disease.dur_exp.dist", "disease.dur_exp.sd_days"], text: (p) => duration(p, "dur_exp") },
  { label: "Immunity duration", paths: ["disease.dur_immune.mean_days", "disease.dur_immune.dist", "disease.dur_immune.sd_days"], text: (p) => duration(p, "dur_immune") },
  { label: "Death probability", paths: ["disease.p_death"], text: (p) => formatQuantity(p.disease.p_death, "fraction") },
  {
    label: "Fatality by age", paths: three("disease.p_death_age"),
    text: (p) => (Object.values(p.disease.p_death_age).some((v) => v !== null) ? deathProbabilities(p.disease).map((q, i) => `${AGE_GROUPS[i]} ${formatQuantity(q, "fraction")}`).join(", ") : "same for every age"),
  },
  { label: "Asymptomatic share", paths: ["disease.p_asymp"], text: (p) => formatQuantity(p.disease.p_asymp, "fraction") },
  { label: "Asymptomatic transmission", paths: ["disease.rel_trans_asymp"], text: (p) => `${formatQuantity(p.disease.rel_trans_asymp, "fraction")} of symptomatic` },
  { label: "Presymptomatic transmission", paths: ["disease.rel_trans_exposed"], text: (p) => (p.disease.rel_trans_exposed > 0 ? `${formatQuantity(p.disease.rel_trans_exposed, "fraction")} of the infectious value` : "none") },
  { label: "Variation in susceptibility", paths: ["disease.rel_sus_cv"], text: (p) => (p.disease.rel_sus_cv > 0 ? `CV ${fmtValue(p.disease.rel_sus_cv)}` : "none") },
  { label: "Susceptibility by age", paths: three("disease.rel_sus_age"), text: (p) => `children ${times(p.disease.rel_sus_age.children)}, adults ${times(p.disease.rel_sus_age.adults)}, elderly ${times(p.disease.rel_sus_age.elderly)}` },
  { label: "Immunity waning", paths: ["disease.sis_waning"], text: (p) => `${fmtValue(p.disease.sis_waning)} per year` },
  { label: "Immunity boost", paths: ["disease.sis_imm_boost"], text: (p) => fmtValue(p.disease.sis_imm_boost) },
  { label: "Initial infections", paths: ["disease.seed.value", "disease.seed.mode", "disease.seed.day"], text: (p) => seedText(p.disease.seed) },
  { label: "Initially immune", paths: ["disease.initial_immune_frac"], text: (p) => formatQuantity(p.disease.initial_immune_frac, "fraction") },
];

const NETWORK: RowSpec[] = [
  { label: "Contact network", paths: ["network.network_type"], text: (p) => networkLabel(p.network) },
  { label: "Contacts per day", paths: ["network.n_contacts"], text: (p) => fmtValue(p.network.n_contacts) },
  { label: "Contacts distribution", paths: ["network.contacts_dist"], text: (p) => (p.network.contacts_dist === "poisson" ? "Poisson" : "constant") },
  { label: "Contact duration", paths: ["network.contact_duration_days"], text: (p) => (p.network.contact_duration_days > 0 ? formatQuantity(p.network.contact_duration_days, "days") : "a fresh contact every day") },
  { label: "Network transmission multiplier", paths: ["network.network_beta"], text: (p) => times(p.network.network_beta) },
  {
    label: "Contact matrix", paths: ["network.contacts_source", ...CONTACT_CELLS],
    text: (p) => contactsSourceLabel(p.network.contacts_source),
    grid: (p) => ({ columns: ["", ...CONTACT_GROUPS], rows: CONTACT_GROUPS.map((source) => [source, ...CONTACT_GROUPS.map((target) => fmtValue(at(p, `network.contacts.${source}_${target}`)))]) }),
  },
  { label: "Household size", paths: ["network.household_size"], text: (p) => `${fmtValue(p.network.household_size)} people` },
  {
    label: "Layers",
    paths: ["network.school_contacts", "network.work_contacts", "network.community_contacts", "network.layer_beta.household", "network.layer_beta.school", "network.layer_beta.work", "network.layer_beta.community"],
    text: (p) => `school ${fmtValue(at(p, "network.school_contacts"))}, work ${fmtValue(at(p, "network.work_contacts"))}, community ${fmtValue(at(p, "network.community_contacts"))} contacts a day`,
    grid: (p) => ({
      columns: ["Layer", "Contacts per day", "Transmissibility"],
      rows: [
        ["Household", "the household", times(at(p, "network.layer_beta.household"))],
        ["School", fmtValue(at(p, "network.school_contacts")), times(at(p, "network.layer_beta.school"))],
        ["Workplace", fmtValue(at(p, "network.work_contacts")), times(at(p, "network.layer_beta.work"))],
        ["Community", fmtValue(at(p, "network.community_contacts")), times(at(p, "network.layer_beta.community"))],
      ],
    }),
  },
  {
    label: "School and working ages", paths: ["network.school_age_min", "network.school_age_max", "network.work_age_min", "network.work_age_max"],
    text: (p) => `school ${fmtValue(at(p, "network.school_age_min"))} to ${fmtValue(at(p, "network.school_age_max"))}, work ${fmtValue(at(p, "network.work_age_min"))} to ${fmtValue(at(p, "network.work_age_max"))}`,
  },
];

const DEMOGRAPHICS: RowSpec[] = [
  {
    label: "Births and deaths", paths: ["demographics.use_demographics", "demographics.birth_rate", "demographics.death_rate"],
    text: (p) => (p.demographics.use_demographics ? `${fmtValue(p.demographics.birth_rate)} and ${fmtValue(p.demographics.death_rate)} per 1,000 per year` : "not modelled"),
  },
  {
    label: "Age structure", paths: ["demographics.age_pct_under18", "demographics.age_pct_18_64", "demographics.age_pct_over65"],
    text: (p) => {
      const g = p.demographics;
      return g.age_pct_under18 !== null && g.age_pct_18_64 !== null && g.age_pct_over65 !== null ? ageStructure({ "0-17": g.age_pct_under18, "18-64": g.age_pct_18_64, "65+": g.age_pct_over65 }) : "Starsim's default ages";
    },
  },
  { label: "Country", paths: ["demographics.country"], text: (p) => (p.demographics.country ? countryName(p.demographics.country) : "not set") },
  { label: "Fill demographics from the country", paths: ["demographics.auto_demographics"], text: (p) => yesNo(at(p, "demographics.auto_demographics")) },
  { label: "Demographics year", paths: ["demographics.demographics_year"], text: (p) => String(at(p, "demographics.demographics_year")) },
  { label: "Demographics source", paths: ["demographics.demographics_source"], text: (p) => String(at(p, "demographics.demographics_source") ?? "none") },
  { label: "Age source", paths: ["demographics.age_source"], text: (p) => AGE_SOURCE_LABELS[String(at(p, "demographics.age_source"))] ?? String(at(p, "demographics.age_source")) },
];

const RUN: RowSpec[] = [
  { label: "Agents", paths: ["run.n_agents"], text: (p) => commaInt(p.run.n_agents) },
  { label: "Duration", paths: ["run.sim_dur_years"], text: (p) => formatQuantity(p.run.sim_dur_years, "years") },
  { label: "Replicates", paths: ["run.n_replicates"], text: (p) => fmtValue(p.run.n_replicates) },
  { label: "Random seed", paths: ["run.rand_seed"], text: (p) => (p.run.rand_seed === null ? "a new one each run" : fmtValue(p.run.rand_seed)) },
  { label: "Calibrate beta by measurement", paths: ["run.calibrate_r0"], text: (p) => yesNo(p.run.calibrate_r0) },
  {
    label: "Fitted to", paths: ["run.fit.target", "run.fit.value", "run.fit.lever"],
    text: (p) => (p.run.fit ? `${fitText(p.run.fit.target, p.run.fit.value)} by moving ${LEVER_LABELS[p.run.fit.lever] ?? p.run.fit.lever}` : "not fitted"),
    show: (p) => p.run.fit !== null,
  },
];

const GROUPS: { id: GroupId; title: string; specs: RowSpec[] }[] = [
  { id: "disease", title: "Disease", specs: DISEASE },
  { id: "network", title: "Contact network", specs: NETWORK },
  { id: "demographics", title: "Demographics", specs: DEMOGRAPHICS },
  { id: "interventions", title: "Interventions", specs: [] },
  { id: "run", title: "Run", specs: RUN },
];

/** Equal, with a relative tolerance for numbers; null and an absent value are the same. */
function same(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  return a === b;
}

const TAGS: Record<string, SourceTag> = { user: "you", database: "database", fetch: "fetched", illustrative: "assumption", default: "default", reference: "reference" };

/**
 * A row's tag from its paths' sources (spec 8.4): none without sources or when none of its paths has a known one; "you" as
 * soon as the user set one of them; otherwise the first path's that is not the default; otherwise the default.
 */
export function sourceTag(paths: string[], sources?: Record<string, string> | null): SourceTag | null {
  if (!sources) return null;
  const tags = paths.map((path) => TAGS[sources[path]]).filter((tag): tag is SourceTag => tag !== undefined);
  if (tags.length === 0) return null;
  if (tags.includes("you")) return "you";
  return tags.find((tag) => tag !== "default") ?? "default";
}

/** The scenario's parameters in five groups, every row that applies to its model and network. */
export function parameterGroups(p: SimParams, sources?: Record<string, string> | null): ParameterGroup[] {
  const flat = flattenParams(p as unknown as Record<string, unknown>);
  const model = p.disease.model;
  const network = p.network.network_type;
  return GROUPS.map(({ id, title, specs }) => {
    const rows: ParameterRow[] = [];
    for (const spec of specs) {
      const covered = spec.paths.filter((path) => {
        const entry = specFor(path);
        return entry !== null && appliesTo(entry, model) && appliesOn(entry, network);
      });
      if (spec.paths.length > 0 && covered.length === 0) continue;                  // not a parameter of this model or network
      const shown = spec.show
        ? spec.show(p)
        : covered.some((path) => {
            const entry = specFor(path)!;
            // an absent block (no latent period set, no fit) holds its defaults
            return entry.tier === "core" || !same(path in flat ? flat[path] : entry.default, entry.default);
          });
      rows.push({ label: spec.label, value: spec.text(p), paths: covered, shown, source: sourceTag(covered, sources), ...(spec.grid ? { grid: spec.grid(p) } : {}) });
    }
    return id === "interventions" ? { id, title, rows, lines: interventionLines(p) } : { id, title, rows };
  });
}

/** The default view as label and value pairs, in group order: the runs panel's and the report's list. */
export function defaultRows(p: SimParams): [string, string][] {
  return parameterGroups(p).flatMap((group) => group.rows.filter((row) => row.shown).map((row) => [row.label, row.value] as [string, string]));
}

/** Every registry path the scenario's rows cover (the coverage test compares it with the registry). */
export function coveredPaths(p: SimParams): string[] {
  return parameterGroups(p).flatMap((group) => group.rows.flatMap((row) => row.paths));
}

/**
 * The report's "Effective parameters" table (spec 8.5): every row at least one run shows by default, in group order, with each
 * run's own value; null where the row is not a parameter of that run's model or network.
 */
export function parameterTable(runs: SimParams[]): { label: string; values: (string | null)[] }[] {
  const perRun = runs.map((p) => parameterGroups(p));
  const table: { label: string; values: (string | null)[] }[] = [];
  GROUPS.forEach((group, index) => {
    for (const spec of group.specs) {
      const rows = perRun.map((groups) => groups[index].rows.find((row) => row.label === spec.label));
      if (rows.some((row) => row?.shown)) table.push({ label: spec.label, values: rows.map((row) => row?.value ?? null) });
    }
  });
  return table;
}
