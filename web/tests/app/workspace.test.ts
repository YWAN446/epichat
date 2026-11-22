import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Suggestions } from "@/components/Suggestions";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { DEFAULT_LAYOUT } from "@/lib/client/layout";

const read = (file: string) => readFileSync(file, "utf8");

describe("the Dashboard's name (round-1 UI cleanup)", () => {
  it("calls the right-hand panel the Dashboard, with tabs This conversation and Profile", () => {
    const tabs = read("components/panel/PanelTabs.tsx");
    expect(tabs).toContain(">This conversation</Tab>");
    expect(tabs).toContain('aria-label="Dashboard"');
    expect(tabs).not.toContain(">Details</Tab>");
    expect(read("components/SharedConversation.tsx")).toContain('<aside aria-label="Dashboard"');
    expect(read("components/Welcome.tsx")).toContain("Edit it in the Dashboard&apos;s Profile tab.");
    expect(read("components/ProfileSetup.tsx")).toContain("the Dashboard&apos;s Profile tab");
  });
});

describe("the columns by screen width (round-1 UI cleanup)", () => {
  const shell = (over: Partial<Parameters<typeof WorkspaceShell>[0]>) =>
    renderToStaticMarkup(createElement(WorkspaceShell, { header: null, sidebar: "LIST", panel: "DASH", drawerOpen: false, sheetOpen: false, onClose: () => {}, columnRef: { current: null }, layout: DEFAULT_LAYOUT, onResize: () => {}, ...over } as Parameters<typeof WorkspaceShell>[0], "MAIN"));
  const aside = (html: string, label: string) => html.match(new RegExp(`<aside aria-label="${label}"[^>]*>`))![0];

  it("shows the Dashboard as a column from lg and the list from xl", () => {
    const html = shell({});
    expect(aside(html, "Dashboard")).toContain("lg:flex");
    expect(aside(html, "Dashboard")).toContain("lg:static");
    expect(aside(html, "Dashboard")).not.toContain("xl:");
    expect(aside(html, "Conversations")).toContain("xl:flex");
    expect(aside(html, "Conversations")).not.toContain("lg:");
  });

  it("keeps 480 px for the conversation however wide the Dashboard was left", () => {
    expect(aside(shell({ layout: { ...DEFAULT_LAYOUT, right: { open: true, width: 640 } } }), "Dashboard")).toContain("lg:max-w-[calc(100vw-30rem)]");
  });

  it("puts a backdrop behind the list drawer up to xl, and behind the Dashboard sheet only below lg", () => {
    expect(shell({ drawerOpen: true })).toMatch(/aria-label="Close"[^>]*xl:hidden/);
    expect(shell({ sheetOpen: true })).toMatch(/aria-label="Close"[^>]*lg:hidden/);
    expect(shell({})).not.toContain('aria-label="Close"');
  });

  it("lets the drawer's backdrop cover the Dashboard column: no stacking order of its own from lg (final review 1)", () => {
    expect(aside(shell({ drawerOpen: true }), "Dashboard")).toContain("lg:z-auto");
  });

  it("collapses the Dashboard column when it is closed, and sizes each handle at its own breakpoint", () => {
    const html = shell({ layout: { ...DEFAULT_LAYOUT, right: { open: false, width: 384 } } });
    expect(aside(html, "Dashboard")).toContain("lg:hidden");
    const open = shell({});
    expect(open).toMatch(/aria-label="Resize the conversations column"[^>]*xl:block/);
    expect(open).toMatch(/aria-label="Resize the dashboard column"[^>]*lg:block/);
  });

  it("reads each side's own breakpoint in the chat", () => {
    const chat = read("components/Chat.tsx");
    expect(chat).toContain('useColumn("left")');
    expect(chat).toContain('useColumn("right")');
    expect(chat).not.toContain("useWide");
  });
});

describe("the suggested replies (round-1 UI cleanup)", () => {
  it("wrap instead of scrolling sideways", () => {
    const html = renderToStaticMarkup(createElement(Suggestions, { items: ["Run it with a school closure from day 30 and compare the peaks"], disabled: false, onPick: () => {} }));
    for (const gone of ["overflow-x-auto", "whitespace-nowrap", "shrink-0"]) expect(html).not.toContain(gone);
    expect(html).toContain("flex-wrap");
    expect(html).toContain("text-left");
    expect(html).toContain("max-w-full");
  });

  it("reports every chart view, the infected one included", () => {
    expect(read("components/Chat.tsx")).not.toContain('view !== "infected"');
  });
});

describe("the Dashboard says what it is (tutorial spec, outside the tutorial)", () => {
  it("describes itself above its sections, once, and its old empty-state lines are gone", () => {
    const panel = read("components/panel/DetailsPanel.tsx");
    expect(panel.match(/What this conversation has set up and produced: the scenario, its data, every run, and the report\./g)).toHaveLength(1);
    expect(panel.indexOf("What this conversation has set up and produced")).toBeLessThan(panel.indexOf('title="Scenario"'));
    const sources = ["ScenarioSection", "DataSection", "ParametersSection", "RunsSection", "ReportSection", "ActivitySection"].map((name) => read(`components/panel/${name}.tsx`)).join("");
    for (const old of ["The configuration appears here once", "Real data appears here once it is fetched", "Parameters appear here once a scenario", "Results appear here after the first run", "The report appears here once you ask", "Steps appear here as the assistant works"]) expect(sources).not.toContain(old);
  });
});

describe("the reply in the middle column", () => {
  it("has no thumbs and no typing animation (round-1 UI cleanup)", () => {
    expect(existsSync("components/FeedbackControl.tsx")).toBe(false);
    expect(read("components/Turn.tsx")).not.toContain("FeedbackControl");
    const welcome = read("components/Welcome.tsx");
    for (const gone of ["useTypewriter", "animate-pulse", "WELCOME_PHRASES", "prefers-reduced-motion"]) expect(welcome).not.toContain(gone);
    expect(welcome).toContain("{WELCOME_HEADING}");
  });

  it("renders the user's bubble, one activity line, the blocks, and the thumbs", () => {
    const turn = read("components/Turn.tsx");
    for (const piece of ["<ActivityLine", "<TurnBlocks", "turn.userText", "export type DisplayTurn"]) expect(turn).toContain(piece);
  });

  it("offers what_if's replies under the latest run only, never while a reply streams and never on the share page (follow-up spec 7.4)", () => {
    const summary = read("components/RunSummary.tsx");
    for (const piece of ["Try next", "options.map(", "onPick(label)", 'type="button"']) expect(summary).toContain(piece);
    const blocks = read("components/TurnBlocks.tsx");
    for (const piece of ["tryNextLabels(", "tryNext?.key ===", "onPick={offered?.onPick}"]) expect(blocks).toContain(piece);
    expect(read("components/Turn.tsx")).toContain("tryNext={tryNext}");
    const chat = read("components/Chat.tsx");
    for (const piece of ["tryNextKey(turns, live !== null)", 'send(label, "option")']) expect(chat).toContain(piece);
    expect(chat.match(/tryNext=\{tryNext\}/g)).toHaveLength(1);                             // the stored turns; the live turn gets none
    expect(read("components/SharedConversation.tsx")).not.toContain("tryNext");
  });

  it("lets the participant apply a literature estimate from the reference list, not on the share page (follow-up spec 9.2)", () => {
    const list = read("components/panel/ReferenceList.tsx");
    for (const piece of ["Use this value", "referenceUsable(", "referenceMessage(parameter, index + 1, ref, unit, disease)", "disabled={busy}"]) expect(list).toContain(piece);
    expect(read("components/panel/DetailsPanel.tsx")).toContain("canUseReferences(");
    for (const file of ["components/panel/LiteratureTable.tsx", "components/panel/DataSection.tsx", "components/panel/DetailsPanel.tsx"]) expect(read(file)).toContain("onUseReference");
    const chat = read("components/Chat.tsx");
    for (const piece of ['send(message, "reference")', "busy={live !== null}"]) expect(chat).toContain(piece);
    expect(read("components/SharedConversation.tsx")).not.toContain("onUseReference");
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
  it("has six collapsible sections, Parameters between Data and Runs, with the spec's empty states", () => {
    const panel = read("components/panel/DetailsPanel.tsx");
    for (const piece of ["<ScenarioSection", "<DataSection", "<ParametersSection", "<RunsSection", "<ReportSection", "<ActivitySection", "runs.length"]) expect(panel).toContain(piece);
    const order = ['title="Scenario"', 'title="Data"', 'title="Parameters"', 'title="Runs"', 'title="Report"', 'title="Activity"'].map((title) => panel.indexOf(title));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(read("components/panel/ScenarioSection.tsx")).toContain("The outbreak you describe appears here: the disease, the place, the population and any interventions.");
    expect(read("components/panel/DataSection.tsx")).toContain("Once the assistant looks up real data, each figure and its source is listed here.");
    expect(read("components/panel/ParametersSection.tsx")).toContain("The exact values a run will use appear here once a scenario is set up.");
    expect(read("components/panel/RunsSection.tsx")).toContain("Each simulation you run appears here with its key numbers and chart.");
    expect(read("components/panel/ActivitySection.tsx")).toContain("Each step the assistant takes is listed here as it works.");
    const section = read("components/panel/Section.tsx");
    expect(section).toContain("aria-expanded");
    expect(section).toContain("aria-controls");
  });

  it("shows the current parameters in words, with the interventions, and opens when they change after a run", () => {
    const section = read("components/panel/ParametersSection.tsx");
    for (const piece of ["parameterGroups(", "group.lines", "No interventions.", "the next run", "Show all ("]) expect(section).toContain(piece);
    const panel = read("components/panel/DetailsPanel.tsx");
    for (const piece of ["artifacts.params", "parameters: true", "PARAMETER_TOOLS", "artifacts.runs.length > 0"]) expect(panel).toContain(piece);
  });

  it("tells the truth about a scenario stored before the payloads carried parameters", () => {
    const section = read("components/panel/ParametersSection.tsx");
    expect(section).toContain("configured");
    expect(section).toContain("This scenario's parameters were not recorded; they appear after the next change or run.");
    expect(read("components/panel/DetailsPanel.tsx")).toContain("configured={artifacts.config !== null}");
    expect(read("components/SharedConversation.tsx")).toContain("configured={artifacts.config !== null}");
    // follow-up spec 8.4: both pages hand the section the sources that came with the parameters
    expect(read("components/panel/DetailsPanel.tsx")).toContain("sources={artifacts.sources}");
    expect(read("components/SharedConversation.tsx")).toContain("sources={artifacts.sources}");
  });

  it("keeps the literature table out of Scenario and puts it at the top of Data", () => {
    const scenario = read("components/panel/ScenarioSection.tsx");
    for (const piece of ["in the literature", "<ReferenceList", "<table"]) expect(scenario).not.toContain(piece);
    const literature = read("components/panel/LiteratureTable.tsx");
    for (const piece of ["in the literature", "<ReferenceList", "referenceButtonLabel(", "references = true"]) expect(literature).toContain(piece);
    const data = read("components/panel/DataSection.tsx");
    expect(data).toContain("<LiteratureTable");
    expect(data.indexOf("<LiteratureTable")).toBeLessThan(data.indexOf("Once the assistant looks up real data, each figure and its source is listed here."));
  });

  it("gives every run its tiles, a chart with the four views, its parameters, repairs, and sources", () => {
    const runs = read("components/panel/RunsSection.tsx");
    for (const piece of ["<StatTiles", "<Chart", "CHART_VIEWS", "useRunSeries(", "run.effective", "defaultRows(", "repairs", "data_sources", "onChartView("]) expect(runs).toContain(piece);
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

  it("gives the header the two toggles at every width; New's reset lives in the sidebar", () => {
    const header = read("components/ChatHeader.tsx");
    for (const piece of ['aria-label="Conversations"', 'aria-label="Dashboard"', "aria-expanded"]) expect(header).toContain(piece);
    expect(header).not.toContain("xl:hidden");
    expect(read("components/ConversationList.tsx")).toContain("onClick={onNew}");
  });
});

describe("the shell", () => {
  it("lays out three regions, overlays on narrow screens, and closes them on Escape", () => {
    const shell = read("components/WorkspaceShell.tsx");
    for (const piece of ['aria-label="Conversations"', 'aria-label="Dashboard"', "<main", "xl:static", "lg:static", "xl:hidden", "lg:hidden", '"Escape"', "overflow-y-auto", "h-dvh"]) expect(shell).toContain(piece);
  });

  it("composes the chat from the shell, the panel, the strip, the recap, and the chips, and reports the panel events", () => {
    const chat = read("components/Chat.tsx");
    for (const piece of ["<WorkspaceShell", "<DetailsPanel", "<AccountMenu", "<StageStrip", "<RecapBar", "<Suggestions", "deriveArtifacts(", "chipsFor(", "lastRecap(", "summaryFor(", 'kind: "scenario_panel_opened"', 'kind: "chart_view_changed"', 'card: "activity"', 'card: "recap"', "source"]) expect(chat).toContain(piece);
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
    expect(read("components/panel/ScenarioSection.tsx")).toContain("scenarioRows(");
    const literature = read("components/panel/LiteratureTable.tsx");
    for (const piece of ["parameterLabel(", "formatQuantity(", "formatRange("]) expect(literature).toContain(piece);
    expect(literature).not.toContain("${p.unit}");
    expect(literature).not.toContain("{name}</td>");
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
    const literature = read("components/panel/LiteratureTable.tsx");
    for (const piece of ["<ReferenceList", "aria-expanded", "aria-controls", "referenceButtonLabel(", "onReferencesOpen"]) expect(literature).toContain(piece);
    expect(literature).not.toContain("p.n_estimates > 0 &&");
    expect(literature).not.toContain("` (${p.n_estimates})`");
  });

  it("heads the column with what it holds: the references, not a status", () => {
    const literature = read("components/panel/LiteratureTable.tsx");
    expect(literature).toContain(">References</th>");
    expect(literature).not.toContain(">Status</th>");
    for (const word of ["under review", "estimates only", "no source"]) expect(literature).toContain(word); // the status words stay beside the button
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
  it("centers the heading, the composer, the four introduction questions, and the examples while the conversation is empty", () => {
    const welcome = read("components/Welcome.tsx");
    for (const piece of ["WELCOME_HEADING", "INTRO_QUESTIONS", "DRAFTS.understand", "Or try an example", "justify-center"]) {
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
    for (const piece of ["useLayout(", "useColumn(", "layoutStore.toggle(", "layoutStore.resize(", "rightColumn ?", "leftColumn ?"]) expect(chat).toContain(piece);
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
    for (const piece of ["Ask the assistant for a report and it appears here, with downloads.", 'format: "md"', 'format: "html"', 'format: "docx"', 'format: "pdf"', "?format=${format}", "download", 'target="_blank"', "onExport(", "Version"]) {
      expect(section).toContain(piece);
    }
    const panel = read("components/panel/DetailsPanel.tsx");
    for (const piece of ["<ReportSection", 'title="Report"', "artifacts.report", "onExport"]) expect(panel).toContain(piece);
    const chat = read("components/Chat.tsx");
    expect(chat).toContain('kind: "export"');
    expect(chat).toContain("artifacts.report ? 1 : 0");
  });
});

describe("the report line in the conversation", () => {
  it("tells the participant the report is ready under the tool call, with the same downloads", () => {
    const line = read("components/ReportLine.tsx");
    for (const piece of ["Report ready", "<ReportDownloads", "onExport"]) expect(line).toContain(piece);
    const blocks = read("components/TurnBlocks.tsx");
    expect(blocks).toContain("<ReportLine");
    expect(blocks).toContain('block.payload.kind === "report"');
    expect(read("components/Turn.tsx")).toContain("onExport");
    const chat = read("components/Chat.tsx");
    expect(chat.match(/onExport=\{onExport\}/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe("review fixes (report)", () => {
  it("fetches Word and PDF so a 503 shows its message under the buttons for a minute, and keeps Markdown and HTML as plain links", () => {
    const section = read("components/panel/ReportSection.tsx");
    for (const piece of ["fetchReport(", "createObjectURL", "60_000", 'role="status"', 'format === "md" || format === "html"']) expect(section).toContain(piece);
  });
});
