/**
 * The report's document from the scenario, its runs, the recap, the literature
 * summaries, and the model's narrative (report spec, section 5). Pure: numbers
 * are formatted here, once, and the renderers never touch them again.
 */
import { EFFECTIVE_PARAM_PATHS, SOURCE_LABELS, configurationRows, countryName, describeField, effectiveParameterLabel, fitText, fitValueText, formatQuantity, formatRange, parameterLabel } from "@/lib/client/format";
import type { ReportRun } from "@/lib/db/runs";
import { lookup } from "@/lib/disease/db";
import { DOCUMENT_VERSION, SECTION_HEADINGS, figureLine, narrativeBlocks, type ReportBlock, type ReportDocument, type ReportNarrative, type ReportSection, type SectionId } from "@/lib/report/document";
import { approxR0 } from "@/lib/sim/params";
import { getPath } from "@/lib/sim/paths";
import { commaInt, fmtValue, pyRound } from "@/lib/sim/pyformat";
import { configView } from "@/lib/tools/configView";
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
  starsimVersion: string | null;
};

type Intervention = { type?: string; coverage?: number; capacity?: number };

function diseaseName(scenario: Scenario, literature: DiseasePayload | null): string {
  if (literature && scenario.disease && literature.canonical_name === scenario.disease) return literature.display_name;
  const entry = scenario.disease ? lookup(scenario.disease) : null;
  if (entry) return entry.display_name;
  return scenario.disease ? scenario.disease.charAt(0).toUpperCase() + scenario.disease.slice(1) : "Epidemic";
}

/** "Measles in Kenya, SIR model, 1 year". */
export function scenarioTitle(scenario: Scenario, name: string): string {
  const where = scenario.countryIso3 ? ` in ${countryName(scenario.countryIso3)}` : "";
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

/** "Run 1", then "Run 2, vaccine coverage 90%" when something a reader cares about changed from the previous run. */
export function runLabels(runs: ReportRun[]): string[] {
  return runs.map((run, i) => {
    const base = `Run ${i + 1}`;
    if (i === 0) return base;
    const prev = runs[i - 1];
    const changes: string[] = [];
    const cov = intervention(run, "vaccine")?.coverage ?? immunity(run);
    const prevCov = intervention(prev, "vaccine")?.coverage ?? immunity(prev);
    if (typeof cov === "number" && cov !== prevCov) changes.push(`vaccine coverage ${formatQuantity(cov, "fraction")}`);
    else if (cov === undefined && typeof prevCov === "number") changes.push("no vaccine");
    const cap = intervention(run, "treatment")?.capacity;
    const prevCap = intervention(prev, "treatment")?.capacity;
    if (typeof cap === "number" && cap !== prevCap) changes.push(`treatment capacity ${commaInt(cap)}`);
    else if (cap === undefined && typeof prevCap === "number") changes.push("no treatment");
    const r0 = pyRound(approxR0(run.effectiveParams), 1);
    if (r0 !== pyRound(approxR0(prev.effectiveParams), 1)) changes.push(`R₀ ${r0}`);
    if (run.effectiveParams.run.n_agents !== prev.effectiveParams.run.n_agents) changes.push(`${commaInt(run.effectiveParams.run.n_agents)} agents`);
    return changes.length > 0 ? `${base}, ${changes.join(", ")}` : base;
  });
}

const attackRate = (run: ReportRun): string => `${pyRound((run.statsAgents.total_infected / (run.statsAgents.n_agents || 1)) * 100, 1).toFixed(1)}%`;

const curve = (run: ReportRun): number[] | undefined => run.series?.n_infectious ?? run.series?.n_infected;
const hasCurve = (run: ReportRun): boolean => Array.isArray(run.series?.day) && Array.isArray(curve(run));

function results(runs: ReportRun[], labels: string[]): ReportBlock[] {
  const blocks: ReportBlock[] = [
    {
      kind: "table",
      caption: "Results by run",
      columns: ["Run", "Peak day", "Peak infections", "Attack rate", "Disease deaths"],
      rows: runs.map((run, i) => [labels[i], `Day ${run.stats.peak_day}`, commaInt(run.stats.peak_infections), attackRate(run), commaInt(run.stats.total_deaths ?? 0)]),
    },
  ];
  const lines = runs.flatMap((run, i) => (hasCurve(run) ? [figureLine(labels[i], run.series!.day, curve(run)!)] : []));
  if (lines.length > 0) blocks.push({ kind: "figure", id: "infected", caption: "People infected over time, every run", xLabel: "Day", yLabel: "People infected", lines });
  runs.forEach((run, i) => {
    if (!hasCurve(run)) blocks.push({ kind: "note", text: `${labels[i]}'s curve is not available.` });
  });
  return blocks;
}

/** Which data source a citation came from, by its address. */
function sourceOf(citation: string): string {
  const url = citation.toLowerCase();
  if (url.includes("population.un.org") || url.includes("un wpp")) return SOURCE_LABELS.un_wpp;
  if (url.includes("who.int")) return SOURCE_LABELS.who_gho;
  if (url.includes("worldbank") || url.includes("data360")) return SOURCE_LABELS.wb_data360;
  return "Source";
}

function modelled(scenario: Scenario, name: string, runs: ReportRun[]): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  if (scenario.params) {
    const rows = configurationRows(configView(scenario.params, scenario.disease), approxR0(scenario.params), name);
    if (scenario.totalPopulation) rows.splice(3, 0, ["Population", commaInt(scenario.totalPopulation)]);
    // Part 2, 5.6 as amended: the latest run's measured R0 beside the configured one, never an earlier run's (a withheld value is
    // expected at a high R0); when the live value was withheld and a pilot ran, the pilot's first-generation measurement.
    const latest = runs.at(-1)?.stats;
    const pilot = latest?.r0_calibration?.measured;
    const measured = typeof latest?.r0_measured === "number" ? latest.r0_measured : typeof pilot === "number" ? pilot : null;
    if (measured !== null) rows.splice(rows.findIndex(([label]) => label.startsWith("R₀")) + 1, 0, ["R₀ measured", measured.toFixed(1)]);
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
        return [sourceOf(f.citation), d.label, d.value, f.citation];
      }),
    });
  } else {
    blocks.push({ kind: "paragraph", text: "No real data was fetched; every value is a literature value or an assumption." });
  }
  return blocks;
}

function appendix(runs: ReportRun[], labels: string[], literature: DiseasePayload | null, starsimVersion: string | null): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  if (runs.length > 0) {
    const at = (run: ReportRun, path: string) => getPath(run.effectiveParams as unknown as Record<string, unknown>, path);
    const present = EFFECTIVE_PARAM_PATHS.filter((path) => runs.some((run) => at(run, path) !== undefined && at(run, path) !== null));
    blocks.push({ kind: "table", caption: "Effective parameters", columns: ["Parameter", ...labels], rows: present.map((path) => [effectiveParameterLabel(path), ...runs.map((run) => fmtValue(at(run, path) ?? null))]) });
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
  blocks.push({ kind: "keyValues", items: [["EpiChat", "web"], ["Starsim", starsimVersion ?? "unknown"], ["Report format", String(DOCUMENT_VERSION)]] });
  return blocks;
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
      section("limitations", narrativeBlocks(input.narrative.limitations)),
      section("next_steps", narrativeBlocks(input.narrative.next_steps)),
      section("appendix", appendix(input.runs, labels, input.literature, input.starsimVersion)),
    ],
  };
}
