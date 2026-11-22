import { describe, expect, it } from "vitest";

import { composeReport } from "@/lib/report/compose";
import { narrativeBlocks, type ReportBlock, type ReportDocument } from "@/lib/report/document";
import { renderMarkdown } from "@/lib/report/markdown";
import { FIXTURE } from "./fixture";

const docOf = (blocks: ReportBlock[]): ReportDocument => ({ version: 1, title: "T", subtitle: "S", generatedAt: "2026-11-21T00:00:00Z", language: "en", sections: [{ id: "summary", heading: "Summary", blocks }] });

describe("bold runs in Markdown (round-1 UI cleanup)", () => {
  it("keeps the bold marks and the list", () => {
    const md = renderMarkdown(docOf(narrativeBlocks("**Peak:** day 40\n\nOptions:\n- close schools\n- **vaccinate** early")));
    expect(md).toContain("**Peak:** day 40");
    expect(md).toContain("Options:\n\n- close schools\n- **vaccinate** early");
  });

  it("escapes inside runs and leaves a block without runs as it was", () => {
    expect(renderMarkdown(docOf([{ kind: "paragraph", text: "2 * 3" }]))).toContain("2 \\* 3");
    expect(renderMarkdown(docOf([{ kind: "paragraph", text: "a*b", runs: [{ text: "a*b", bold: true }] }]))).toContain("**a\\*b**");
  });
});

describe("renderMarkdown", () => {
  const md = renderMarkdown(composeReport(FIXTURE, new Date("2026-10-09T15:00:00Z")));

  it("writes the title, the subtitle, every heading, and GitHub tables", () => {
    expect(md.startsWith("# Measles in Kenya, SIR model, 1 year\n\n*EpiChat report · version 2 · 9 October 2026*\n")).toBe(true);
    for (const heading of ["## Summary", "## Key results", "## What the results mean", "## What was modelled", "## Decisions made", "## Limitations and assumptions", "## Suggested next steps", "## Appendix"]) {
      expect(md).toContain(heading);
    }
    expect(md).toContain("| Run | Peak day | Peak infections | Attack rate | Disease deaths |\n| --- | --- | --- | --- | --- |\n| Run 1 | Day 40 | 900 | 40.0% | 12 |");
    expect(md).toContain("- Run 2 beats run 1\n- Deaths stay low");
    expect(md).toContain("*Figure: People infected over time, every run. The chart is in the HTML and PDF versions of this report.*");
    expect(md).toContain("| Country | Kenya |");
    expect(md).toContain("**Data sources**");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("folds line breaks inside a table cell so the table survives", () => {
    const doc = composeReport({ ...FIXTURE, runs: [{ ...FIXTURE.runs[0], repairs: [{ attempt: 1, error: "Traceback (most recent call last):\n  File x\nValueError: bad", changes: [] }] }] }, new Date());
    const text = renderMarkdown(doc);
    expect(text).toContain("| Run 1 | 1 | Traceback (most recent call last): File x ValueError: bad |  |");
  });

  it("keeps pipes and markup literal", () => {
    const doc = composeReport({ ...FIXTURE, narrative: { ...FIXTURE.narrative, summary: "A | B and **now bold** and 2 * 3 <b>x</b>" } }, new Date());
    const text = renderMarkdown(doc);
    expect(text).toContain("A \| B and **now bold** and 2 \* 3 \<b\>x\</b\>");   // round-1 UI cleanup: paired bold marks are bold; a lone star stays literal
  });
});
