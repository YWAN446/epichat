import { describe, expect, it } from "vitest";

import { MAX_FIGURE_POINTS, SECTION_HEADINGS, figureLine, narrativeBlocks, wordCount } from "@/lib/report/document";

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
