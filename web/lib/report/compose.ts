/**
 * The report's document from the scenario, its runs, the recap, the literature
 * summaries, and the model's narrative (report spec, section 5). Pure: numbers
 * are formatted here, once, and the renderers never touch them again.
 */
import { SOLVER_LABELS, configurationRows, nationalNote, sourceOfCitation, countryName, describeField, fitText, fitValueText, formatQuantity, formatRange, parameterLabel } from "@/lib/client/format";
import { parameterTable } from "@/lib/client/parameters";
import type { ReportRun } from "@/lib/db/runs";
import { lookup } from "@/lib/disease/db";
import { DOCUMENT_VERSION, SECTION_HEADINGS, figureLine, narrativeBlocks, type ReportBlock, type ReportDocument, type ReportNarrative, type ReportSection, type SectionId } from "@/lib/report/document";
import { approxR0, type SimParams } from "@/lib/sim/params";
import { commaInt, fmtValue, pyRound } from "@/lib/sim/pyformat";
import { configView } from "@/lib/tools/configView";
import { populationView } from "@/lib/tools/population";
import type { DiseasePayload, Scenario } from "@/lib/tools/types";

export type ComposeInput = {
  scenario: Scenario;
  /** The scenario's successful runs, oldest first. */
  runs: ReportRun[];
  /** The latest stored recap, or []. */
  recap: string[];
  /** The lookup summaries for the scenario's disease, when known. */
  literature: DiseasePayload | null;
  narrative: ReportNarrative;
  version: number;
  conversationTitle: string;
};

type Intervention = { type?: string; coverage?: number; capacity?: number };

function diseaseName(scenario: Scenario, literature: DiseasePayload | null): string {
  if (literature && scenario.disease && literature.canonical_name === scenario.disease) return literature.display_name;
  const entry = scenario.disease ? lookup(scenario.disease) : null;
  if (entry) return entry.display_name;
  return scenario.disease ? scenario.disease.charAt(0).toUpperCase() + scenario.disease.slice(1) : "Epidemic";
}

/** "Measles in Kenya, SIR model, 1 year", or "Measles in Example County, Kenya, …" for an area (round-1 spec 1). */
export function scenarioTitle(scenario: Scenario, name: string): string {
  const country = scenario.countryIso3 ? countryName(scenario.countryIso3) : null;
  const place = scenario.area ? (country ? `${scenario.area.name}, ${country}` : scenario.area.name) : country;
  const where = place ? ` in ${place}` : "";
  const model = scenario.params ? `, ${scenario.params.disease.model.toUpperCase()} model` : "";
  const years = scenario.params ? `, ${formatQuantity(scenario.params.run.sim_dur_years, "years")}` : "";
  return `${name}${where}${model}${years}`;
}

function intervention(run: ReportRun, type: string): Intervention | undefined {
  return (run.effectiveParams.interventions as Intervention[] | undefined)?.find((i) => i.type === type);
}

/** A day-0 vaccine is stored as initial immunity (spec 6.1); the label reads it as coverage. */
function immunity(run: ReportRun): number | undefined {
  const frac = run.effectiveParams.disease?.initial_immune_frac ?? 0;
  return frac > 0 ? frac : undefined;
}

/** "Run 1", then "Run 2, vaccine coverage 90%" when something a reader cares about changed from the previous run; numbered as the Runs section numbers them (round-1 spec 8). */
export function runLabels(runs: ReportRun[]): string[] {
  return runs.map((run, i) => {
    const base = `Run ${run.index}`;
    if (i === 0) return base;
    const prev = runs[i - 1];
    const changes: string[] = [];
    const cov = intervention(run, "vaccine")?.coverage ?? immunity(run);
    const prevCov = intervention(prev, "vaccine")?.coverage ?? immunity(prev);
    if (typeof cov === "number" && cov !== prevCov) changes.push(`vaccine coverage ${formatQuantity(cov, "fraction")}`);
    else if (cov === undefined && typeof prevCov === "number") changes.push("no vaccine");
    const cap = intervention(run, "treatment")?.capacity;
    const prevCap = intervention(prev, "treatment")?.capacity;
    if (typeof cap === "number" && cap !== prevCap) changes.push(`treatment capacity ${commaInt(cap)} people a day`);
    else if (cap === undefined && typeof prevCap === "number") changes.push("no treatment");
    // follow-up spec 4 and 5: the variation between people and the behaviour response, the two limits on spread
    const cv = run.effectiveParams.disease?.rel_sus_cv ?? 0;
    const prevCv = prev.effectiveParams.disease?.rel_sus_cv ?? 0;
    if (cv !== prevCv) changes.push(cv > 0 ? `variation CV ${fmtValue(cv)}` : "no variation");
    const response = intervention(run, "behavior_response");
    const prevResponse = intervention(prev, "behavior_response");
    if (response && !prevResponse) changes.push("behaviour response");
    else if (!response && prevResponse) changes.push("no behaviour response");
    const r0 = pyRound(approxR0(run.effectiveParams), 1);
    if (r0 !== pyRound(approxR0(prev.effectiveParams), 1)) changes.push(`R₀ ${r0}`);
    if (run.effectiveParams.run.n_agents !== prev.effectiveParams.run.n_agents) changes.push(`${commaInt(run.effectiveParams.run.n_agents)} agents`);
    const mode = run.stats.solver;                                    // "Rerun as agents" changes nothing else (spec 2026-11-20)
    if (mode && prev.stats.solver && mode !== prev.stats.solver) changes.push(mode === "abm" ? "as agents" : "as a compartmental model");
    return changes.length > 0 ? `${base}, ${changes.join(", ")}` : base;
  });
}

const attackRate = (run: ReportRun): string => `${pyRound((run.statsAgents.total_infected / (run.statsAgents.n_agents || 1)) * 100, 1).toFixed(1)}%`;

const curveKey = (run: ReportRun): "n_infectious" | "n_infected" => (run.series?.n_infectious ? "n_infectious" : "n_infected");
const curve = (run: ReportRun): number[] | undefined => run.series?.[curveKey(run)];
const hasCurve = (run: ReportRun): boolean => Array.isArray(run.series?.day) && Array.isArray(curve(run));

/** A replicate run's 10th and 90th percentiles of its curve, stored beside it as `<key>_p10` and `<key>_p90` (round-1 spec 6). */
function band(run: ReportRun): { lower: number[]; upper: number[] } | undefined {
  const key = curveKey(run);
  const lower = run.series?.[`${key}_p10`];
  const upper = run.series?.[`${key}_p90`];
  return Array.isArray(lower) && Array.isArray(upper) ? { lower, upper } : undefined;
}

/** "Run 3", "Run 3 and Run 5", "Run 1, Run 3 and Run 5". */
const andList = (items: string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

const FIGURE_CAPTION = "People infected over time, every run";

/** Live test 2026-11-21: the caption says whose replicates a shaded band shows. */
function figureCaption(banded: ReportRun[]): string {
  if (banded.length === 0) return FIGURE_CAPTION;
  const whose = banded.map((run) => {
    const n = run.effectiveParams.run.n_replicates;
    return typeof n === "number" && n > 1 ? `Run ${run.index}'s ${n} replicates` : `Run ${run.index}'s replicates`;
  });
  return `${FIGURE_CAPTION}. The shaded band is the 10th to 90th percentile of ${andList(whose)}.`;
}

/** Round-1 spec 4: a run's doses (or treatments) given, summed over its vaccine (or treatment) interventions; null when it has none. */
function delivered(run: ReportRun, type: "vaccine" | "treatment"): number | null {
  const entries = Object.entries(run.stats.delivered ?? {}).filter(([name]) => name.startsWith(`${type}_`));
  return entries.length > 0 ? entries.reduce((sum, [, n]) => sum + n, 0) : null;
}

function results(runs: ReportRun[], labels: string[]): ReportBlock[] {
  const extra = ([["vaccine", "Doses"], ["treatment", "Treatments given"]] as const).filter(([type]) => runs.some((run) => delivered(run, type) !== null));
  const blocks: ReportBlock[] = [
    {
      kind: "table",
      caption: "Results by run",
      columns: ["Run", "Peak day", "Peak infections", "Attack rate", "Disease deaths", ...extra.map(([, column]) => column)],
      rows: runs.map((run, i) => [labels[i], `Day ${run.stats.peak_day}`, commaInt(run.stats.peak_infections), attackRate(run), commaInt(run.stats.total_deaths ?? 0),
        ...extra.map(([type]) => { const n = delivered(run, type); return n === null ? "—" : commaInt(n); })]),
    },
  ];
  const drawn = runs.flatMap((run, i) => (hasCurve(run) ? [{ run, line: figureLine(labels[i], run.series!.day, curve(run)!, band(run)) }] : []));
  const lines = drawn.map((d) => d.line);
  const caption = figureCaption(drawn.filter((d) => d.line.band).map((d) => d.run));
  if (lines.length > 0) blocks.push({ kind: "figure", id: "infected", caption, xLabel: "Day", yLabel: "People infected", lines });
  runs.forEach((run, i) => {
    if (!hasCurve(run)) blocks.push({ kind: "note", text: `${labels[i]}'s curve is not available.` });
  });
  return blocks;
}

/**
 * Live test 2026-11-21: one row per label, in the order the runs give them; a value every run shares once, otherwise each
 * run's ("Run 1: 500,000; Run 3: 100,000"), "—" for a run without the row.
 */
function mergeRows(perRun: { name: string; rows: [string, string][] }[]): [string, string][] {
  const labels: string[] = [];
  for (const { rows } of perRun) {
    rows.forEach(([label], j) => {
      if (labels.includes(label)) return;
      labels.splice(j > 0 ? labels.indexOf(rows[j - 1][0]) + 1 : 0, 0, label);
    });
  }
  return labels.map((label) => {
    const values = perRun.map(({ rows }) => rows.find(([l]) => l === label)?.[1] ?? "—");
    return [label, values.every((v) => v === values[0]) ? values[0] : perRun.map(({ name }, i) => `${name}: ${values[i]}`).join("; ")];
  });
}

function modelled(scenario: Scenario, name: string, runs: ReportRun[]): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const rowsFor = (p: SimParams, solver?: "ode" | "abm"): [string, string][] => {
    const rows = configurationRows(configView(p, scenario.disease), approxR0(p), name);
    // how Starsim ran it: compartments (deterministic, one run) or agents on a network
    if (solver) rows.push(["Ran as", SOLVER_LABELS[solver]]);
    return rows;
  };
  // live test 2026-11-21: what the covered runs ran, not the configuration as it stands now
  const merged = runs.length > 0 ? mergeRows(runs.map((run) => ({ name: `Run ${run.index}`, rows: rowsFor(run.effectiveParams, run.stats.solver) }))) : null;
  const rows = merged ?? (scenario.params ? rowsFor(scenario.params) : null);
  if (rows) {
    // round-1 spec 1: an area's population and where it came from; otherwise the country's total
    const view = populationView(scenario);
    if (view && !view.national && scenario.area) rows.splice(3, 0, ["Population", `${commaInt(view.value)}, ${scenario.area.name} (${view.origin})`]);
    else if (scenario.totalPopulation) rows.splice(3, 0, ["Population", commaInt(scenario.totalPopulation)]);
    // Part 2, 7.7: the latest run's fit, after the R0 rows: what was asked for, what the search reached, in how many runs.
    const fit = runs.at(-1)?.stats.fit;
    if (fit) {
      const after = rows.map(([label]) => label.startsWith("R₀")).lastIndexOf(true) + 1;
      rows.splice(after, 0, ["Fitted to", `${fitText(fit.target, fit.wanted)} (reached ${fitValueText(fit.target, fit.achieved)} in ${fit.runs} runs)`]);
    }
    blocks.push({ kind: "keyValues", items: rows });
  }
  if (scenario.dataSources.length > 0) {
    blocks.push({
      kind: "table",
      caption: "Data sources",
      columns: ["Source", "Field", "Value", "Citation"],
      rows: scenario.dataSources.map((f) => {
        const d = describeField(f.field, f.value);
        return [f.field.startsWith("ref:") ? "Literature" : sourceOfCitation(f.citation), d.label, d.value, f.citation];
      }),
    });
  }
  // a chosen literature reference is a row of that table, and still no real data
  if (!scenario.dataSources.some((f) => !f.field.startsWith("ref:"))) {
    blocks.push({ kind: "paragraph", text: "No real data was fetched; every value is a literature value or an assumption." });
  }
  return blocks;
}

/** Live test 2026-11-21: the version each covered run was stored with; one value when they agree, else grouped by run. */
function starsimText(runs: ReportRun[]): string {
  const groups = new Map<string, number[]>();
  for (const run of runs) {
    const version = run.stats.starsim_version ?? "not recorded";
    groups.set(version, [...(groups.get(version) ?? []), run.index]);
  }
  if (groups.size === 0) return "not recorded";
  if (groups.size === 1) return [...groups.keys()][0];
  return [...groups].map(([version, indexes]) => `${version} (${indexes.map((i) => `Run ${i}`).join(", ")})`).join("; ");
}

function appendix(runs: ReportRun[], labels: string[], literature: DiseasePayload | null): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  if (runs.length > 0) {
    // follow-up spec 8.5: the Parameters section's rows (core, and whatever a run changed from the defaults), not a fixed list of paths
    const table = parameterTable(runs.map((run) => run.effectiveParams));
    blocks.push({ kind: "table", caption: "Effective parameters", columns: ["Parameter", ...labels], rows: table.map((row) => [row.label, ...row.values.map((value) => value ?? "—")]) });
    const repairs = runs.flatMap((run, i) => run.repairs.map((r) => [labels[i], String(r.attempt), r.error, (r.changes ?? []).map((c) => `${c.field}: ${fmtValue(c.from)} → ${fmtValue(c.to)}`).join("; ")]));
    if (repairs.length > 0) blocks.push({ kind: "table", caption: "Repairs", columns: ["Run", "Attempt", "Error", "Changes"], rows: repairs });
  }
  if (literature) {
    const rows = Object.entries(literature.parameters).map(([name, p]) => [
      parameterLabel(name),
      p.typical !== undefined ? formatQuantity(p.typical, p.unit) : "—",
      p.min !== undefined && p.max !== undefined ? formatRange(p.min, p.max, p.unit) : "—",
      p.status.replace(/_/g, " "),
      p.source ?? "—",
    ]);
    if (rows.length > 0) blocks.push({ kind: "table", caption: "Literature parameters", columns: ["Parameter", "Typical", "Range", "Status", "Consensus source"], rows });
  }
  blocks.push({ kind: "keyValues", items: [["EpiChat", "web"], ["Starsim", starsimText(runs)], ["Report format", String(DOCUMENT_VERSION)]] });
  return blocks;
}

/** Round-1 spec 1: an area scenario's limitations always say what stays national. */
function nationalBlock(scenario: Scenario): ReportBlock[] {
  const view = populationView(scenario);
  const note = view && scenario.countryIso3 ? nationalNote(view, scenario.countryIso3) : null;
  return note ? [{ kind: "paragraph", text: note }] : [];
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function composeReport(input: ComposeInput, now: Date): ReportDocument {
  const name = diseaseName(input.scenario, input.literature);
  const labels = runLabels(input.runs);
  const section = (id: SectionId, blocks: ReportBlock[]): ReportSection => ({ id, heading: SECTION_HEADINGS[id], blocks });
  return {
    version: DOCUMENT_VERSION,
    title: input.narrative.title?.trim() || scenarioTitle(input.scenario, name),
    subtitle: `EpiChat report · version ${input.version} · ${DATE.format(now)}`,
    generatedAt: now.toISOString(),
    language: "en",
    sections: [
      section("summary", narrativeBlocks(input.narrative.summary)),
      section("results", results(input.runs, labels)),
      section("meaning", narrativeBlocks(input.narrative.meaning)),
      section("modelled", modelled(input.scenario, name, input.runs)),
      section("decisions", input.recap.length > 0 ? [{ kind: "bullets", items: input.recap }] : [{ kind: "paragraph", text: "The conversation recorded no decisions." }]),
      section("limitations", [...narrativeBlocks(input.narrative.limitations), ...nationalBlock(input.scenario)]),
      section("next_steps", narrativeBlocks(input.narrative.next_steps)),
      section("appendix", appendix(input.runs, labels, input.literature)),
    ],
  };
}
