import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RunSummary } from "@/components/RunSummary";
import { TurnBlocks } from "@/components/TurnBlocks";
import type { Block } from "@/lib/chat/events";
import type { RunPayload } from "@/lib/tools/types";

const stats = { peak_infections: 800, peak_day: 60, total_infected: 8600, total_deaths: 0, n_agents: 10000, sim_days: 366 };
const lever = (label: string) => ({ patch: {}, current: {}, direction: "change" as const, rationale: "r", basis: "rule" as const, interventions: [{ type: "behavior_response", scale: 0.5 }], label });
const payload = (labels: string[]): RunPayload => ({
  kind: "run", run_id: null, stats, stats_agents: stats, attack_rate_pct: 86, pop_scale: 1, population: 10000, warnings: [], repairs: [], data_sources: [], duration_ms: 1, cold_start: false,
  series: { day: [0, 1, 2], n_infectious: [10, 20, 5], n_susceptible: [9990, 9970, 9960], cum_infections: [10, 30, 40], new_infections: [10, 20, 10], n_recovered: [0, 10, 35], new_deaths: [0, 0, 0], cum_deaths: [0, 0, 0] },
  diagnostics: [{ id: "what_if", severity: "info", title: "Interventions to try", evidence: {}, levers: labels.map(lever) }],
} as unknown as RunPayload);
const runBlock = (labels: string[]): Block => ({ kind: "tool_result", id: "t", name: "run_simulation", ok: true, payload: payload(labels) } as unknown as Block);

describe("the Try next buttons as they render (follow-up spec 7.4)", () => {
  it("shows a button per option under the run, and nothing without options or without a handler", () => {
    const html = renderToStaticMarkup(createElement(RunSummary, { payload: payload([]), options: ["Add masks and rerun", "Close schools and rerun"], onPick: () => {} }));
    expect(html).toContain('aria-label="Try next"');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain("Add masks and rerun");
    expect(renderToStaticMarkup(createElement(RunSummary, { payload: payload([]) }))).not.toContain("Try next");
    expect(renderToStaticMarkup(createElement(RunSummary, { payload: payload([]), options: [], onPick: () => {} }))).not.toContain("Try next");
    expect(renderToStaticMarkup(createElement(RunSummary, { payload: payload([]), options: ["A and rerun"] }))).not.toContain("Try next");
  });

  it("gives the buttons to the run the key names and to no other", () => {
    const blocks = [runBlock(["Old and rerun"]), { kind: "text", text: "then" } as Block, runBlock(["Add masks and rerun", "B and rerun", "C and rerun", "D and rerun"])];
    const latest = renderToStaticMarkup(createElement(TurnBlocks, { blocks, turnId: "turn-9", tryNext: { key: "turn-9:2", onPick: () => {} } }));
    expect(latest.match(/aria-label="Try next"/g)).toHaveLength(1);
    expect(latest).toContain("Add masks and rerun");
    expect(latest).not.toContain("Old and rerun");
    expect(latest).not.toContain("D and rerun");                                             // three at most
    for (const tryNext of [undefined, { key: null, onPick: () => {} }, { key: "turn-8:2", onPick: () => {} }]) {
      expect(renderToStaticMarkup(createElement(TurnBlocks, { blocks, turnId: "turn-9", tryNext }))).not.toContain("Try next");
    }
  });
});
