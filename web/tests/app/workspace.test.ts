import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("the reply in the middle column", () => {
  it("renders the user's bubble, one activity line, the blocks, and the thumbs", () => {
    const turn = read("components/Turn.tsx");
    for (const piece of ["<ActivityLine", "<TurnBlocks", "<FeedbackControl", "turn.userText", "export type DisplayTurn"]) expect(turn).toContain(piece);
  });

  it("shows prose, the run summary, and notices only; tool lines live in the activity list", () => {
    const blocks = read("components/TurnBlocks.tsx");
    expect(blocks).toContain("withoutHidden(");
    expect(blocks).toContain("<RunSummary");
    expect(blocks).not.toContain("<ToolLine");
    expect(blocks).not.toContain("Web search");
    const line = read("components/ActivityLine.tsx");
    for (const piece of ["summarizeActivity(", "aria-expanded", "<ToolLine", "Web search", "Read page"]) expect(line).toContain(piece);
  });

  it("draws the run's tiles and curve, fetching a replayed series through the loader", () => {
    const summary = read("components/RunSummary.tsx");
    for (const piece of ["Peak day", "Peak infections", "Attack rate", "Deaths", "loadSeries(", "initialSeriesState(", "Series unavailable.", 'view="infected"']) expect(summary).toContain(piece);
    const chart = read("components/Chart.tsx");
    for (const piece of ["<svg", "viewBox", "seriesFor(", "thinPoints(", "niceTicks(", "linePath(", "nearestIndex(", "onPointerMove", "Series unavailable."]) expect(chart).toContain(piece);
    expect(existsSync("components/Chart.tsx")).toBe(true);
  });
});
