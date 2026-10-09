/**
 * The report's document from the scenario, its runs, the recap, the literature
 * summaries, and the model's narrative (report spec, section 5). Pure: numbers
 * are formatted here, once, and the renderers never touch them again.
 */
import { SOURCE_LABELS, configurationRows, countryName, describeField, formatQuantity, formatRange, parameterLabel } from "@/lib/client/format";
import type { ReportRun } from "@/lib/db/runs";
import { lookup } from "@/lib/disease/db";
import { DOCUMENT_VERSION, SECTION_HEADINGS, figureLine, narrativeBlocks, type ReportBlock, type ReportDocument, type ReportNarrative, type ReportSection, type SectionId } from "@/lib/report/document";
import { approxR0 } from "@/lib/sim/params";
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

const PARAM_KEYS = ["disease_type", "n_agents", "sim_dur_years", "beta", "n_contacts", "init_prev", "dur_inf", "dur_exp", "dur_immune", "p_death", "network_type", "birth_rate", "death_rate", "use_demographics", "rand_seed"] as const;

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
  const model = scenario.params ? `, ${scenario.params.disease_type.toUpperCase()} model` : "";
  const years = scenario.params ? `, ${formatQuantity(scenario.params.sim_dur_years, "years")}` : "";
  return `${name}${where}${model}${years}`;
}

function intervention(run: ReportRun, type: string): Intervention | undefined {
  return (run.effectiveParams.interventions as Intervention[] | undefined)?.find((i) => i.type === type);
}

/** "Run 1", then "Run 2, vaccine coverage 90%" when something a reader cares about changed from the previous run. */
export function runLabels(runs: ReportRun[]): string[] {
  return runs.map((run, i) => {
    const base = `Run ${i + 1}`;
    if (i === 0) return base;
    const prev = runs[i - 1];
    const changes: string[] = [];
    const cov = intervention(run, "vaccine")?.coverage;
    const prevCov = intervention(prev, "vaccine")?.coverage;
    if (typeof cov === "number" && cov !== prevCov) changes.push(`vaccine coverage ${formatQuantity(cov, "fraction")}`);
    else if (cov === undefined && typeof prevCov === "number") changes.push("no vaccine");
    const cap = intervention(run, "treatment")?.capacity;
    const prevCap = intervention(prev, "treatment")?.capacity;
    if (typeof cap === "number" && cap !== prevCap) changes.push(`treatment capacity ${commaInt(cap)}`);
    else if (cap === undefined && typeof prevCap === "number") changes.push("no treatment");
    const r0 = pyRound(approxR0(run.effectiveParams), 1);
    if (r0 !== pyRound(approxR0(prev.effectiveParams), 1)) changes.push(`R₀ ${r0}`);
    if (run.effectiveParams.n_agents !== prev.effectiveParams.n_agents) changes.push(`${commaInt(run.effectiveParams.n_agents)} agents`);
    return changes.length > 0 ? `${base}, ${changes.join(", ")}` : base;
  });
}

const attackRate = (run: ReportRun): string => `${pyRound((run.statsAgents.total_infected / (run.statsAgents.n_agents || 1)) * 100, 1).toFixed(1)}%`;

const hasCurve = (run: ReportRun): boolean => Array.isArray(run.series?.day) && Array.isArray(run.series?.n_infected);

function results(runs: ReportRun[], labels: string[]): ReportBlock[] {
  const blocks: ReportBlock[] = [
    {
      kind: "table",
      caption: "Results by run",
      columns: ["Run", "Peak day", "Peak infections", "Attack rate", "Disease deaths"],
      rows: runs.map((run, i) => [labels[i], `Day ${run.stats.peak_day}`, commaInt(run.stats.peak_infections), attackRate(run), commaInt(run.stats.total_deaths ?? 0)]),
    },
  ];
  const lines = runs.flatMap((run, i) => (hasCurve(run) ? [figureLine(labels[i], run.series!.day, run.series!.n_infected)] : []));
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

function modelled(scenario: Scenario, name: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  if (scenario.params) {
    const rows = configurationRows(configView(scenario.params, scenario.disease), approxR0(scenario.params), name);
    if (scenario.totalPopulation) rows.splice(3, 0, ["Population", commaInt(scenario.totalPopulation)]);
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
    const present = PARAM_KEYS.filter((key) => runs.some((run) => (run.effectiveParams as Record<string, unknown>)[key] !== undefined));
    blocks.push({ kind: "table", caption: "Effective parameters", columns: ["Parameter", ...labels], rows: present.map((key) => [key, ...runs.map((run) => fmtValue((run.effectiveParams as Record<string, unknown>)[key]))]) });
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
      section("modelled", modelled(input.scenario, name)),
      section("decisions", input.recap.length > 0 ? [{ kind: "bullets", items: input.recap }] : [{ kind: "paragraph", text: "The conversation recorded no decisions." }]),
      section("limitations", narrativeBlocks(input.narrative.limitations)),
      section("next_steps", narrativeBlocks(input.narrative.next_steps)),
      section("appendix", appendix(input.runs, labels, input.literature, input.starsimVersion)),
    ],
  };
}
