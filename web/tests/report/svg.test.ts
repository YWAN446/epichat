import { describe, expect, it } from "vitest";

import { figureSvg } from "@/lib/report/svg";

const FIGURE = {
  kind: "figure" as const,
  id: "infected",
  caption: "People infected",
  xLabel: "Day",
  yLabel: "People infected",
  lines: [
    { label: "Run 1", x: [0, 1, 2], y: [0, 10, 5] },
    { label: "Run 2", x: [0, 1, 2], y: [0, 4, 2] },
  ],
};

describe("figureSvg", () => {
  it("draws one path per line, a legend, axis labels, and ticks", () => {
    const svg = figureSvg(FIGURE);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain("Run 1");
    expect(svg).toContain("Run 2");
    expect(svg).toContain(">Day<");
    expect(svg).toContain("People infected");
    expect(svg).toContain(">10<");
    expect(svg).not.toContain("<script");
  });

  it("draws an empty frame for a figure without points, and escapes labels", () => {
    const svg = figureSvg({ ...FIGURE, lines: [{ label: "<Empty>", x: [], y: [] }] });
    expect(svg.match(/<path /g)).toBeNull();
    expect(svg).toContain("<svg");
    expect(svg).toContain("&lt;Empty&gt;");
  });
});
