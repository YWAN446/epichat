import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatHeader } from "@/components/ChatHeader";
import { Composer } from "@/components/Composer";
import { RunSummary } from "@/components/RunSummary";
import { Suggestions } from "@/components/Suggestions";
import { Turn } from "@/components/Turn";
import { Welcome } from "@/components/Welcome";
import { DetailsPanel, type DetailsSection } from "@/components/panel/DetailsPanel";
import { PracticeReport } from "@/components/panel/ReportSection";
import { ProfileSummary } from "@/components/tutorial/ProfileSummary";
import type { Block } from "@/lib/chat/events";
import { deriveArtifacts, emptyArtifacts } from "@/lib/client/artifacts";
import { EMPTY_PROFILE } from "@/lib/profile/schema";
import type { RunPayload } from "@/lib/tools/types";

const stats = { peak_infections: 800, peak_day: 60, total_infected: 8600, total_deaths: 0, n_agents: 10000, sim_days: 366 };
const run: RunPayload = {
  kind: "run", run_id: null, stats, stats_agents: stats, attack_rate_pct: 86, pop_scale: 1, population: 10000, warnings: [], repairs: [], data_sources: [], duration_ms: 1, cold_start: false,
  series: { day: [0, 1, 2], n_infectious: [10, 20, 5], n_susceptible: [9990, 9970, 9960], cum_infections: [10, 30, 40], new_infections: [10, 20, 10], n_recovered: [0, 10, 35], new_deaths: [0, 0, 0], cum_deaths: [0, 0, 0] },
  diagnostics: [],
} as unknown as RunPayload;
const runBlock = { kind: "tool_result", id: "t", name: "run_simulation", ok: true, payload: run } as unknown as Block;
const reportBlock = { kind: "tool_result", id: "r", name: "write_report", ok: true, payload: { kind: "report", report_id: "practice", version: 1, title: "Measles in Kenya", sections: [], words: 100 } } as unknown as Block;
const withRun = deriveArtifacts([{ id: "t1", blocks: [runBlock] }]);

const CLOSED: Record<DetailsSection, boolean> = { scenario: false, data: false, parameters: false, runs: false, report: false, activity: false };
const panel = (over: Record<string, unknown> = {}, artifacts = withRun) =>
  renderToStaticMarkup(createElement(DetailsPanel, { artifacts, onSectionOpen: () => {}, onChartView: () => {}, onReferencesOpen: () => {}, onUseReference: () => {}, busy: false, onExport: () => {}, preferredFormat: "pdf", ...over }));
const report = createElement("p", null, "PRACTICE REPORT");

describe("the practice hooks in the workspace components (tutorial spec)", () => {
  it("a practice Dashboard opens only what it is told to; the real one still opens Scenario and Runs", () => {
    expect(panel({ practice: { open: CLOSED, onToggle: () => {}, report } })).not.toContain('aria-expanded="true"');
    const reportOpen = panel({ practice: { open: { ...CLOSED, report: true }, onToggle: () => {}, report } });
    expect(reportOpen.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(reportOpen).toContain("PRACTICE REPORT");
    expect(panel().match(/aria-expanded="true"/g)!.length).toBeGreaterThanOrEqual(2);
    expect(panel({}, emptyArtifacts())).not.toContain("PRACTICE REPORT");
  });

  it("marks the tutorial's targets", () => {
    for (const id of ["panel-scenario", "panel-data", "panel-parameters", "panel-runs", "panel-report"]) expect(panel()).toContain(`data-tutorial="${id}"`);
    expect(panel()).toContain('data-tutorial="view-incidence"');
    const suggestions = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Suggestions, { items: ["Run it", "Change something"], disabled: false, onPick: () => {}, ...props }));
    expect(suggestions({ target: "Run it" }).match(/data-tutorial="reply"/g)).toHaveLength(1);
    expect(suggestions({})).not.toContain("data-tutorial");
    const welcome = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Welcome, { disabled: false, contactEmail: "", error: null, onPick: () => {}, ...props } as unknown as Parameters<typeof Welcome>[0], "COMPOSER"));
    expect(welcome({ target: "Model a measles outbreak in Kenya" }).match(/data-tutorial="example"/g)).toHaveLength(1);
    expect(welcome({})).not.toContain("data-tutorial");
    const summary = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(RunSummary, { payload: run, options: ["Add a vaccination campaign", "Close schools"], onPick: () => {}, ...props }));
    expect(summary({ optionTarget: "Add a vaccination campaign" }).match(/data-tutorial="option"/g)).toHaveLength(1);
    expect(summary({})).not.toContain("data-tutorial");
    const header = renderToStaticMarkup(createElement(ChatHeader, { busy: false, onShare: () => {}, canShare: false, onMenu: () => {}, onDashboard: () => {}, menuOpen: false, dashboardOpen: false, unseen: false }));
    expect(header).toContain('data-tutorial="dashboard-button"');
  });

  it("passes the option target down a turn to its latest run", () => {
    const withOptions = { ...runBlock, payload: { ...run, diagnostics: [{ id: "what_if", severity: "info", title: "t", evidence: {}, levers: [{ patch: {}, current: {}, direction: "change", rationale: "r", basis: "rule", interventions: [], label: "Add a vaccination campaign" }] }] } } as unknown as Block;
    const html = renderToStaticMarkup(createElement(Turn, { turn: { id: "t1", userText: "go", blocks: [withOptions], notice: null }, status: null, tryNext: { key: "t1:0", onPick: () => {} }, optionTarget: "Add a vaccination campaign" }));
    expect(html.match(/data-tutorial="option"/g)).toHaveLength(1);
  });

  it("shows a practice report with two working formats and no database links", () => {
    const html = renderToStaticMarkup(createElement(PracticeReport, { title: "Measles in Kenya", subtitle: "Practice report" }));
    expect(html).toContain("Measles in Kenya");
    expect(html).toContain('data-tutorial="practice-report"');
    expect(html).toContain('href="/tutorial/report?format=html"');
    expect(html).toContain('href="/tutorial/report?format=md"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain("Word and PDF are available in your own conversations.");
    expect(html).not.toContain("/api/reports");
  });

  it("shows the report line without downloads in practice, and with them otherwise", () => {
    const turn = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Turn, { turn: { id: "t1", userText: "report please", blocks: [reportBlock], notice: null }, status: null, ...props }));
    expect(turn({ practice: true })).toContain("Report ready:");
    expect(turn({ practice: true })).not.toContain("/api/reports");
    expect(turn({})).toContain("/api/reports/practice");
  });

  it("shows the participant's profile as plain text, with nothing to press", () => {
    const html = renderToStaticMarkup(createElement(ProfileSummary, { profile: { ...EMPTY_PROFILE, role: "student", experience: "some", goals: ["learning", "exploring"], diseaseInterest: "measles", countryInterest: "KEN" }, diseases: [] }));
    for (const piece of ["You can edit your profile in your own conversations.", "Some", "Learning", "Exploring scenarios", "Kenya"]) expect(html).toContain(piece);
    expect(html).not.toMatch(/<(input|button|select|textarea)/);
    expect(renderToStaticMarkup(createElement(ProfileSummary, { profile: EMPTY_PROFILE, diseases: [] }))).toContain("Not set");
  });

  it("lets the message box say why it is off", () => {
    const composer = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Composer, { value: "", onChange: () => {}, onSubmit: () => {}, onKeyDown: () => {}, disabled: true, maxLength: 100, inputRef: createRef<HTMLTextAreaElement>(), ...props }));
    expect(composer({ placeholder: "Typing is off in the practice run." })).toContain('placeholder="Typing is off in the practice run."');
    expect(composer({})).toContain('placeholder="Working…"');
  });
});
