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

describe("the details panel", () => {
  it("has four collapsible sections with the spec's empty states", () => {
    const panel = read("components/panel/DetailsPanel.tsx");
    for (const piece of ["<ScenarioSection", "<DataSection", "<RunsSection", "<ActivitySection", "runs.length"]) expect(panel).toContain(piece);
    expect(read("components/panel/ScenarioSection.tsx")).toContain("The configuration appears here once a scenario is set up.");
    expect(read("components/panel/DataSection.tsx")).toContain("Real data appears here once it is fetched.");
    expect(read("components/panel/RunsSection.tsx")).toContain("Results appear here after the first run.");
    expect(read("components/panel/ActivitySection.tsx")).toContain("Steps appear here as the assistant works.");
    const section = read("components/panel/Section.tsx");
    expect(section).toContain("aria-expanded");
    expect(section).toContain("aria-controls");
  });

  it("gives every run its tiles, a chart with the four views, its parameters, repairs, and sources", () => {
    const runs = read("components/panel/RunsSection.tsx");
    for (const piece of ["<StatTiles", "<Chart", "CHART_VIEWS", "useRunSeries(", "effective_params", "repairs", "data_sources", "onChartView("]) expect(runs).toContain(piece);
  });
});
