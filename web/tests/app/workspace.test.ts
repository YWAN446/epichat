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

describe("the bottom stack, the sidebar, and the header", () => {
  it("shows the decisions so far, collapsed to the first one", () => {
    const bar = read("components/RecapBar.tsx");
    for (const piece of ["Decisions so far", "aria-expanded", "items.length - 1", "more"]) expect(bar).toContain(piece);
  });

  it("marks the current stage and explains it", () => {
    const strip = read("components/StageStrip.tsx");
    for (const piece of ["STAGE_LABELS", "STAGE_HINTS", "STAGE_INDEX", "aria-current={", '"step"']) expect(strip).toContain(piece);
  });

  it("lists conversations by day with New at the top and a two-press delete", () => {
    const list = read("components/ConversationList.tsx");
    for (const piece of ["groupByDay(", "New conversation", "A conversation appears here after your first message.", "Delete?", "onRemoved(", "aria-current"]) expect(list).toContain(piece);
  });

  it("gives the header the two narrow-screen toggles and keeps New's reset", () => {
    const header = read("components/ChatHeader.tsx");
    for (const piece of ['aria-label="Conversations"', 'aria-label="Details"', "xl:hidden", "onClick={onNew}", "aria-expanded"]) expect(header).toContain(piece);
  });
});

describe("the shell", () => {
  it("lays out three regions, overlays on narrow screens, and closes them on Escape", () => {
    const shell = read("components/WorkspaceShell.tsx");
    for (const piece of ['aria-label="Conversations"', 'aria-label="Details"', "<main", "xl:static", "xl:hidden", '"Escape"', "overflow-y-auto", "h-dvh"]) expect(shell).toContain(piece);
  });

  it("composes the chat from the shell, the panel, the strip, the recap, and the chips, and reports the panel events", () => {
    const chat = read("components/Chat.tsx");
    for (const piece of ["<WorkspaceShell", "<DetailsPanel", "<StageStrip", "<RecapBar", "<Suggestions", "deriveArtifacts(", "chipsFor(", "lastRecap(", "summaryFor(", 'kind: "scenario_panel_opened"', 'kind: "chart_view_changed"', 'card: "activity"', 'card: "recap"', "source"]) expect(chat).toContain(piece);
    expect(chat).not.toContain("window.scrollTo");
    expect(chat).not.toContain("EXAMPLES");
    expect(chat).toContain("DRAFTS.understand");
  });
});
