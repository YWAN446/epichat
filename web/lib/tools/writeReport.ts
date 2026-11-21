import { z } from "zod";
import { PARAMETERS, lookup, type ParameterSummary } from "@/lib/disease/db";
import { composeReport } from "@/lib/report/compose";
import { SECTION_HEADINGS, wordCount, type ReportPayload } from "@/lib/report/document";
import type { DiseasePayload, ToolDeps, ToolOutcome } from "./types";

export const WriteReportInput = z.strictObject({
  title: z.string().trim().min(3).max(120).optional(),
  summary: z.string().trim().min(80).max(1500),
  meaning: z.string().trim().min(40).max(4000),
  limitations: z.string().trim().min(40).max(4000),
  next_steps: z.string().trim().min(20).max(2000),
  /** Round-1 spec 8: the Runs section's numbers of the runs to cover; absent for every run of the scenario. */
  runs: z.array(z.number().int().min(1)).min(1).max(12).refine((r) => new Set(r).size === r.length, "no duplicates").optional(),
});
export type WriteReportArgs = z.infer<typeof WriteReportInput>;

export const NOT_READY = "REPORT NOT READY: run the simulation before writing a report.";
export const NOT_SAVED = "REPORT NOT SAVED: the report could not be stored. Say so and offer to try again.";

/** The same summaries lookup_disease returns, for the appendix. */
function literatureFor(disease: string | null): DiseasePayload | null {
  const entry = disease ? lookup(disease) : null;
  if (!entry) return null;
  const parameters: Record<string, ParameterSummary> = {};
  for (const p of PARAMETERS) {
    const summary = entry.summaries[p];
    if (summary) parameters[p] = summary;
  }
  return { kind: "disease", canonical_name: entry.key, display_name: entry.display_name, parameters };
}

/** "3", "3 and 5", "3, 4 and 5". */
const listText = (n: number[]): string => (n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`);

/** Report spec, section 6: the model narrates, code assembles, the store keeps every version. */
export async function writeReport(input: WriteReportArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.hasRun) return { content: NOT_READY };
  const all = await deps.reports.runs();
  if (all.length === 0) return { content: NOT_READY };
  // round-1 spec 8: only the runs asked for, by the panel's numbers
  const missing = (input.runs ?? []).filter((n) => !all.some((r) => r.index === n));
  if (missing.length > 0) {
    return { content: `REPORT NOT WRITTEN: run ${listText(missing)} ${missing.length === 1 ? "is" : "are"} not one of this scenario's runs; its runs are ${listText(all.map((r) => r.index))}.` };
  }
  const runs = input.runs ? all.filter((r) => input.runs!.includes(r.index)) : all;
  const [recap, version] = await Promise.all([deps.reports.recap(), deps.reports.nextVersion()]);
  const document = composeReport(
    { scenario, runs, recap, literature: literatureFor(scenario.disease), narrative: input, version, conversationTitle: deps.reports.conversationTitle, starsimVersion: null },
    new Date(),
  );
  const id = await deps.reports.insert({ version, title: document.title, language: document.language, narrative: input, document });
  if (!id) return { content: NOT_SAVED, isError: true, payload: { kind: "tool_error", message: NOT_SAVED } };
  scenario.hasReport = true;
  scenario.reportCurrent = true;
  const words = wordCount(input);
  const payload: ReportPayload = {
    kind: "report",
    report_id: id,
    version,
    title: document.title,
    sections: document.sections.map((s) => ({ id: s.id, heading: SECTION_HEADINGS[s.id] })),
    words,
  };
  return {
    content: `Report written: "${document.title}", version ${version}, ${document.sections.length} sections, ~${words} words. The participant can download it from the Dashboard's Report section as Markdown, HTML, Word, or PDF.`,
    payload,
  };
}
