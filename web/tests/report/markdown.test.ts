import { describe, expect, it } from "vitest";

import { composeReport } from "@/lib/report/compose";
import { renderMarkdown } from "@/lib/report/markdown";
import { FIXTURE } from "./fixture";

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

  it("keeps pipes and markup literal", () => {
    const doc = composeReport({ ...FIXTURE, narrative: { ...FIXTURE.narrative, summary: "A | B and **not bold** <b>x</b>" } }, new Date());
    const text = renderMarkdown(doc);
    expect(text).toContain("A \\| B and \\*\\*not bold\\*\\* \\<b\\>x\\</b\\>");
  });
});
