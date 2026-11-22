import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Turn } from "@/components/Turn";
import { DetailsPanel, type DetailsSection } from "@/components/panel/DetailsPanel";
import { deriveArtifacts } from "@/lib/client/artifacts";
import { lastSuggestions } from "@/lib/client/turn";
import { renderHtml } from "@/lib/report/html";
import { renderMarkdown } from "@/lib/report/markdown";
import { loadRecording, readRecording, type Recording } from "@/lib/tutorial/recording";
import { STEPS } from "@/lib/tutorial/steps";
// @ts-expect-error a plain Node module shared with the export script; it has no type declarations
import { toRecording } from "../../scripts/recordingLib.mjs";

const FILE = "data/tutorial/recording.json";
const raw = (): Recording => JSON.parse(readFileSync(FILE, "utf8")) as Recording;
const ALL_OPEN: Record<DetailsSection, boolean> = { scenario: true, data: true, parameters: true, runs: true, report: true, activity: true };
const panel = (turns: Recording["turns"]) =>
  createElement(DetailsPanel, {
    artifacts: deriveArtifacts(turns), onSectionOpen: () => {}, onChartView: () => {}, onReferencesOpen: () => {}, onUseReference: () => {}, busy: false, onExport: () => {}, preferredFormat: "pdf",
    practice: { open: ALL_OPEN, onToggle: () => {}, report: null },
  });

describe("the tutorial's recording", () => {
  it("can be played by today's components, turn by turn", () => {
    const recording = loadRecording();
    expect(recording).not.toBeNull();
    for (let shown = 1; shown <= recording!.turns.length; shown++) {
      const turns = recording!.turns.slice(0, shown);
      const conversation = renderToStaticMarkup(createElement("div", null, turns.map((turn) => createElement(Turn, { key: turn.id, turn, status: null, practice: true }))));
      expect(conversation).toContain(turns[shown - 1].userText.replace(/&/g, "&amp;"));
      expect(conversation).not.toContain("/api/");
      expect(renderToStaticMarkup(panel(turns))).toContain("Scenario");
    }
    const artifacts = deriveArtifacts(recording!.turns);
    expect(artifacts.config).not.toBeNull();
    expect(artifacts.data.length).toBeGreaterThan(0);
    expect(artifacts.runs).toHaveLength(2);
    expect(artifacts.params).not.toBeNull();
    expect(artifacts.report).not.toBeNull();
    const dashboard = renderToStaticMarkup(panel(recording!.turns));
    for (const piece of ["Kenya", "Run 1", "Run 2", "Currently infected", "<svg"]) expect(dashboard).toContain(piece);
    expect(dashboard).not.toContain("Loading the curve");
    expect(renderHtml(recording!.report)).toContain("<h2>Summary</h2>");
    expect(renderMarkdown(recording!.report)).toContain("## Summary");
  });

  it("offers, at each step, the chip the step asks the participant to press", () => {
    const recording = loadRecording()!;
    const keys = STEPS.flatMap((step) => step.parts).map((part) => part.press).filter(Boolean);
    expect(keys).toEqual(Object.keys(recording.press));
    expect(recording.turns.map((turn) => turn.userText)).toEqual(Object.values(recording.press));
    expect(lastSuggestions(recording.turns.slice(0, 1))).toContain(recording.press.dataReply);
    expect(lastSuggestions(recording.turns.slice(0, 2))).toContain(recording.press.runReply);
    expect(lastSuggestions(recording.turns.slice(0, 4))).toContain(recording.press.reportReply);
    const shown = STEPS.flatMap((step) => step.parts).map((part) => part.showTurns).filter((n) => n !== undefined);
    expect(shown).toEqual([1, 2, 3, 4, 5]);
  });

  it("holds no database id, no email address and no run that would be fetched", () => {
    const text = readFileSync(FILE, "utf8");
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    for (const turn of raw().turns) {
      for (const block of turn.blocks) {
        if (block.kind === "tool_result" && block.payload.kind === "run") {
          expect(block.payload.run_id).toBeNull();
          expect(block.payload.series).toBeTruthy();
        }
      }
    }
  });

  it("refuses a recording the steps cannot play", () => {
    const good = raw();
    expect(readRecording(good)).not.toBeNull();
    const broken: unknown[] = [
      null,
      {},
      { ...good, version: 2 },
      { ...good, turns: good.turns.slice(0, 4) },
      { ...good, press: { ...good.press, runReply: "A reply nobody suggested" } },
      { ...good, press: { ...good.press, example: "Not an example" } },
      { ...good, press: { ...good.press, option: "An option the run never offered" } },
      { ...good, report: {} },
      { ...good, turns: good.turns.map((turn) => ({ ...turn, blocks: turn.blocks.filter((block) => !(block.kind === "tool_result" && block.payload.kind === "report")) })) },
      { ...good, turns: good.turns.map((turn) => ({ ...turn, blocks: turn.blocks.map((block) => (block.kind === "tool_result" && block.payload.kind === "run" ? { ...block, payload: { ...block.payload, series: undefined } } : block)) })) },
    ];
    for (const value of broken) expect(readRecording(value)).toBeNull();
  });

  it("is built from database rows: ids removed, each run's series embedded, leftovers refused", () => {
    const good = raw();
    const RUN_A = "11111111-1111-4111-8111-111111111111";
    const RUN_B = "22222222-2222-4222-8222-222222222222";
    const series: Record<string, unknown> = {};
    let n = 0;
    const rows = good.turns.map((turn) => ({
      userText: turn.userText,
      blocks: turn.blocks.map((block) => {
        if (block.kind === "tool_result" && block.payload.kind === "run") {
          const id = n++ === 0 ? RUN_A : RUN_B;
          series[id] = block.payload.series;
          return { ...block, payload: { ...block.payload, series: undefined, run_id: id } };
        }
        if (block.kind === "tool_result" && block.payload.kind === "report") return { ...block, payload: { ...block.payload, report_id: "33333333-3333-4333-8333-333333333333" } };
        return block;
      }),
    }));
    const input = { title: good.title, turns: rows, series, report: good.report, press: good.press, forbidden: ["owner@example.org", "owner"] };
    const made = toRecording(input) as Recording;
    expect(readRecording(made)).not.toBeNull();
    expect(JSON.stringify(made)).not.toMatch(/11111111-|22222222-|33333333-/);
    expect(made.turns.map((turn) => turn.id)).toEqual(["practice-1", "practice-2", "practice-3", "practice-4", "practice-5"]);
    expect(() => toRecording({ ...input, title: "Asked by Owner@Example.org" })).toThrow(/owner@example.org/);
    expect(() => toRecording({ ...input, series: {} })).toThrow(/no chart series/);
  });
});
