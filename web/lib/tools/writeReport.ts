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

/** Report spec, section 6: the model narrates, code assembles, the store keeps every version. */
export async function writeReport(input: WriteReportArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.hasRun) return { content: NOT_READY };
  const runs = await deps.reports.runs();
  if (runs.length === 0) return { content: NOT_READY };
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
