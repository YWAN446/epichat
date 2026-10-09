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
    for (const piece of ["Peak day", "Peak infections", "Attack rate", "Disease deaths", "loadSeries(", "initialSeriesState(", "Series unavailable.", 'view="infected"']) expect(summary).toContain(piece);
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
    for (const piece of ["groupsFor(", "New conversation", "A conversation appears here after your first message.", "Delete?", "onRemoved(", "aria-current"]) expect(list).toContain(piece);
  });

  it("gives the header the two toggles at every width and keeps New's reset", () => {
    const header = read("components/ChatHeader.tsx");
    for (const piece of ['aria-label="Conversations"', 'aria-label="Details"', "onClick={onNew}", "aria-expanded"]) expect(header).toContain(piece);
    expect(header).not.toContain("xl:hidden");
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
    expect(chat).not.toContain("DRAFTS.understand");
  });
});

describe("review fixes", () => {
  it("deleting the current conversation resets the chat the way New does, not only the address", () => {
    const chat = read("components/Chat.tsx");
    expect(chat).toContain("function resetConversation(");
    const removed = /function onRemoved\(id: string\) \{[\s\S]*?\n  \}/.exec(chat)?.[0] ?? "";
    expect(removed).toContain("resetConversation()");
    expect(removed).toContain('router.push("/chat")');
    const fresh = /function startNew\(\) \{[\s\S]*?\n  \}/.exec(chat)?.[0] ?? "";
    expect(fresh).toContain("resetConversation()");
  });

  it("groups the sidebar by day only once the browser's clock is known", () => {
    const list = read("components/ConversationList.tsx");
    expect(list).toContain("useClientNow()");
    expect(list).toContain("useSyncExternalStore(");
    expect(list).toContain("groupsFor(items, now)");
    expect(list).not.toContain("groupByDay(items, new Date())");
  });

  it("draws the panel chart at the panel's width and lets vertical swipes scroll", () => {
    const chart = read("components/Chart.tsx");
    expect(chart).toContain("width = 640");
    expect(chart).toContain("touch-pan-y");
    expect(chart).not.toContain("touch-none");
    expect(read("components/panel/RunsSection.tsx")).toContain("width={320}");
  });
});

describe("readable values", () => {
  it("writes the scenario in words: country names, parameter labels, units", () => {
    const scenario = read("components/panel/ScenarioSection.tsx");
    for (const piece of ["configurationRows(", "parameterLabel(", "formatQuantity(", "formatRange("]) expect(scenario).toContain(piece);
    expect(scenario).not.toContain("${p.unit}");
    expect(scenario).not.toContain("{name}</td>");
  });

  it("writes every applied data field with a label and a unit, under the country's name", () => {
    const data = read("components/panel/DataSection.tsx");
    for (const piece of ["describeField(", "countryName("]) expect(data).toContain(piece);
    expect(data).not.toContain("{key}</dt>");
    expect(data).not.toContain("{entry.iso3}");
  });

  it("calls deaths what they are: deaths the disease caused", () => {
    expect(read("components/panel/RunsSection.tsx")).toContain('deaths: "Disease deaths"');
    expect(read("components/RunSummary.tsx")).not.toContain('["Deaths",');
  });
});

describe("references behind a parameter", () => {
  it("turns the estimate count into a button that opens the list under the row", () => {
    const scenario = read("components/panel/ScenarioSection.tsx");
    for (const piece of ["<ReferenceList", "aria-expanded", "aria-controls", "referenceButtonLabel(", "onReferencesOpen"]) expect(scenario).toContain(piece);
    expect(scenario).not.toContain("p.n_estimates > 0 &&");
    expect(scenario).not.toContain("` (${p.n_estimates})`");
  });

  it("lists the consensus source first, then every estimate with its link, value, and study line", () => {
    const list = read("components/panel/ReferenceList.tsx");
    for (const piece of ["loadReferences(", "referenceHref(", "referenceMeta(", "referenceValue(", "Consensus", "Loading references…", "References unavailable.", 'rel="noreferrer"']) {
      expect(list).toContain(piece);
    }
  });

  it("reports an opened reference list as a card expansion", () => {
    expect(read("components/panel/DetailsPanel.tsx")).toContain("onReferencesOpen");
    expect(read("components/Chat.tsx")).toContain('card: "references"');
  });
});

describe("the welcome", () => {
  it("centers the typewriter line, the composer, the four introduction questions, and the examples while the conversation is empty", () => {
    const welcome = read("components/Welcome.tsx");
    for (const piece of ["WELCOME_PHRASES", "INTRO_QUESTIONS", "DRAFTS.understand", "typewriterStep(", "typewriterText(", "prefers-reduced-motion", "aria-hidden", "sr-only", "Or try an example", "justify-center"]) {
      expect(welcome).toContain(piece);
    }
    expect(welcome).toContain('"intro"');
    const chat = read("components/Chat.tsx");
    for (const piece of ["<Welcome", "<Composer", "empty ? (", "<footer"]) expect(chat).toContain(piece);
    expect(chat).not.toContain("<textarea");
    expect(chat).not.toContain("What would you like to model?");
  });

  it("shares one composer between the welcome and the footer", () => {
    const composer = read("components/Composer.tsx");
    for (const piece of ["<textarea", 'aria-label="Message"', "Message EpiChat", "Working…", "maxLength", "onKeyDown", "Send"]) expect(composer).toContain(piece);
  });

  it("records a pressed chip on the first turn too, once the conversation exists", () => {
    const chat = read("components/Chat.tsx");
    const first = /if \(!startedWith\) \{[\s\S]*?\n        \}/.exec(chat)?.[0] ?? "";
    expect(first).toContain('kind: "suggestion_used"');
    expect(first).toContain("conversationId: id");
  });
});

describe("collapsible, resizable columns", () => {
  it("lets each side column collapse and be dragged or keyed to a width on wide screens", () => {
    const shell = read("components/WorkspaceShell.tsx");
    for (const piece of ['role="separator"', 'aria-orientation="vertical"', "aria-valuenow", "aria-valuemin", "aria-valuemax", "onPointerDown", "onKeyDown", "dragWidth(", "nudgeWidth(", "layout.left.open", "layout.right.open", "xl:w-(--column)", "setPointerCapture"]) {
      expect(shell).toContain(piece);
    }
    expect(shell).toContain('"Escape"');
  });

  it("remembers the layout per browser and routes the header toggles by screen width", () => {
    const chat = read("components/Chat.tsx");
    for (const piece of ["useLayout(", "useWide(", "layoutStore.toggle(", "layoutStore.resize(", "wide ?"]) expect(chat).toContain(piece);
    expect(chat).toContain("panelVisible");
  });
});

describe("review fixes", () => {
  it("keeps a drag local to the shell and commits the width once, on release", () => {
    const shell = read("components/WorkspaceShell.tsx");
    for (const piece of ["const [dragging, setDragging]", "onDrag(side, latest)", "onDrop(side, latest)", "setDragging(null)", '"pointerup"']) expect(shell).toContain(piece);
    expect(shell).not.toMatch(/const move = [^\n]*onResize\(/);
  });
});

describe("the report in the panel", () => {
  it("shows the latest report with four downloads and Open, and the empty state", () => {
    const section = read("components/panel/ReportSection.tsx");
    for (const piece of ["The report appears here once you ask for one.", 'format: "md"', 'format: "html"', 'format: "docx"', 'format: "pdf"', "?format=${format}", "download", 'target="_blank"', "onExport(", "Version"]) {
      expect(section).toContain(piece);
    }
    const panel = read("components/panel/DetailsPanel.tsx");
    for (const piece of ["<ReportSection", 'title="Report"', "artifacts.report", "onExport"]) expect(panel).toContain(piece);
    const chat = read("components/Chat.tsx");
    expect(chat).toContain('kind: "export"');
    expect(chat).toContain("artifacts.report ? 1 : 0");
  });
});
