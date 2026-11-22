import { describe, expect, it } from "vitest";

import { MAX_FIGURE_POINTS, SECTION_HEADINGS, figureLine, narrativeBlocks, textRuns, wordCount } from "@/lib/report/document";

describe("narrative text", () => {
  it("splits on blank lines into paragraphs, and a block of dash lines into bullets", () => {
    const text = "First paragraph\ncontinues here.\n\n- one\n- two\n\nLast.";
    expect(narrativeBlocks(text)).toEqual([
      { kind: "paragraph", text: "First paragraph continues here." },
      { kind: "bullets", items: ["one", "two"] },
      { kind: "paragraph", text: "Last." },
    ]);
    expect(narrativeBlocks("  \n\n ")).toEqual([]);
    expect(narrativeBlocks("* star\n* bullets")).toEqual([{ kind: "bullets", items: ["star", "bullets"] }]);
  });

  it("turns **bold** into runs and drops the marks from the text (round-1 UI cleanup)", () => {
    expect(textRuns("**Peak:** day 40")).toEqual({ text: "Peak: day 40", runs: [{ text: "Peak:", bold: true }, { text: " day 40" }] });
    expect(textRuns("The **peak** and the **end**.")).toEqual({ text: "The peak and the end.", runs: [{ text: "The " }, { text: "peak", bold: true }, { text: " and the " }, { text: "end", bold: true }, { text: "." }] });
    expect(textRuns("no marks")).toEqual({ text: "no marks" });
  });

  it("leaves unmatched or empty marks as typed", () => {
    for (const literal of ["a ** b", "****", "**open", "2 ** 3 ** 4", "** spaced **", "2**3 and 4**5", "***x***", "****a****"]) expect(textRuns(literal)).toEqual({ text: literal });
  });

  it("makes a list of dash lines that follow a lead-in line", () => {
    expect(narrativeBlocks("Two options:\n- close schools\n- **vaccinate** early")).toEqual([
      { kind: "paragraph", text: "Two options:" },
      { kind: "bullets", items: ["close schools", "vaccinate early"], itemRuns: [[{ text: "close schools" }], [{ text: "vaccinate", bold: true }, { text: " early" }]] },
    ]);
    expect(narrativeBlocks("- a\n- b\nThen prose\ncontinues.")).toEqual([{ kind: "bullets", items: ["a", "b"] }, { kind: "paragraph", text: "Then prose continues." }]);
  });

  it("keeps numbered lines apart", () => {
    expect(narrativeBlocks("1. Rerun with 70% coverage.\n2. Compare the peaks.")).toEqual([
      { kind: "paragraph", text: "1. Rerun with 70% coverage." },
      { kind: "paragraph", text: "2. Compare the peaks." },
    ]);
    expect(narrativeBlocks("In 2020. the count rose\nand fell.")).toEqual([{ kind: "paragraph", text: "In 2020. the count rose and fell." }]);
  });

  it("carries bold in a paragraph", () => {
    expect(narrativeBlocks("**Peak:** day 40")).toEqual([{ kind: "paragraph", text: "Peak: day 40", runs: [{ text: "Peak:", bold: true }, { text: " day 40" }] }]);
  });

  it("counts the words of the four sections", () => {
    expect(wordCount({ summary: "one two", meaning: "three", limitations: "four five six", next_steps: "seven" })).toBe(7);
  });

  it("names every section in reader order", () => {
    expect(Object.keys(SECTION_HEADINGS)).toEqual(["summary", "results", "meaning", "modelled", "decisions", "limitations", "next_steps", "appendix"]);
  });
});

describe("figure lines", () => {
  it("thins a three-year run to at most 401 points and keeps the last day", () => {
    const x = Array.from({ length: 1096 }, (_, i) => i);
    const y = x.map((d) => d * 2);
    const line = figureLine("Run 1", x, y);
    expect(line.label).toBe("Run 1");
    expect(line.x.length).toBeLessThanOrEqual(MAX_FIGURE_POINTS + 1);
    expect(line.x.at(-1)).toBe(1095);
    expect(line.y.at(-1)).toBe(2190);
    expect(figureLine("Short", [0, 1, 2], [5, 6, 7])).toEqual({ label: "Short", x: [0, 1, 2], y: [5, 6, 7] });
  });
});
