import { describe, expect, it } from "vitest";

import { wordCount } from "@/lib/report/document";
import { NOT_READY, NOT_SAVED, writeReport } from "@/lib/tools/writeReport";
import { FIXTURE } from "../report/fixture";
import { makeDeps } from "./helpers";

const NARRATIVE = FIXTURE.narrative;
const SECTIONS = ["summary", "results", "meaning", "modelled", "decisions", "limitations", "next_steps", "appendix"];

describe("write_report", () => {
  it("refuses before a run", async () => {
    const deps = makeDeps();
    const out = await writeReport(NARRATIVE, deps);
    expect(out).toEqual({ content: NOT_READY });
    expect(NOT_READY).toBe("REPORT NOT READY: run the simulation before writing a report.");
    expect(deps.reportsWritten).toHaveLength(0);
  });

  it("composes, stores a version, flags the scenario, and answers the model with the payload", async () => {
    const deps = makeDeps({ scenario: { ...FIXTURE.scenario }, reportRuns: FIXTURE.runs, recap: FIXTURE.recap, nextVersion: 3, reportId: "rep-3" });
    const out = await writeReport(NARRATIVE, deps);
    expect(out.isError).toBeUndefined();
    expect(out.content).toBe(
      `Report written: "Measles in Kenya, SIR model, 1 year", version 3, 8 sections, ~${wordCount(NARRATIVE)} words. The participant can download it from the Dashboard's Report section as Markdown, HTML, Word, or PDF.`,
    );
    expect(out.payload).toMatchObject({ kind: "report", report_id: "rep-3", version: 3, title: "Measles in Kenya, SIR model, 1 year", words: wordCount(NARRATIVE) });
    expect((out.payload as { sections: { id: string }[] }).sections.map((s) => s.id)).toEqual(SECTIONS);
    expect(deps.scenario.hasReport).toBe(true);
    expect(deps.scenario.reportCurrent).toBe(true);
    expect(deps.reportsWritten[0]).toMatchObject({ version: 3, title: "Measles in Kenya, SIR model, 1 year", language: "en", narrative: NARRATIVE });
    expect(deps.reportsWritten[0].document.sections).toHaveLength(8);
    const literature = deps.reportsWritten[0].document.sections.find((s) => s.id === "appendix")!.blocks.find((b) => b.kind === "table" && b.caption === "Literature parameters");
    expect(literature).toBeDefined();
  });

  it("refuses when the scenario has no successful run even though it ran once", async () => {
    const deps = makeDeps({ scenario: { ...FIXTURE.scenario, hasRun: true }, reportRuns: [] });
    expect((await writeReport(NARRATIVE, deps)).content).toBe(NOT_READY);
    expect(deps.reportsWritten).toHaveLength(0);
  });

  it("reports a storage failure as an error and leaves the flags alone", async () => {
    const deps = makeDeps({ scenario: { ...FIXTURE.scenario }, reportRuns: FIXTURE.runs, reportId: null });
    const out = await writeReport(NARRATIVE, deps);
    expect(out.isError).toBe(true);
    expect(out.content).toBe(NOT_SAVED);
    expect(out.payload).toEqual({ kind: "tool_error", message: NOT_SAVED });
    expect(deps.scenario.hasReport).toBe(false);
    expect(deps.scenario.reportCurrent).toBe(false);
  });
});
