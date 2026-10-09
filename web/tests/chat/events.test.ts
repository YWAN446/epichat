import { describe, expect, it } from "vitest";

import { blockOf, createEventSink, type ChatStreamEvent } from "@/lib/chat/events";
import { parseNext } from "@/lib/chat/next";
import type { ConfigPayload, RunPayload } from "@/lib/tools/types";
import { params } from "../tools/helpers";

/** A clock that moves one second per reading, from 15:00:00. */
function clock() {
  let t = Date.parse("2026-10-08T15:00:00Z");
  return () => new Date((t += 1000));
}

function sink(emit: (event: ChatStreamEvent) => void = () => {}) {
  const emitted: ChatStreamEvent[] = [];
  const s = createEventSink((event) => { emitted.push(event); emit(event); }, clock());
  return { s, emitted };
}

const CONFIG: ConfigPayload = {
  kind: "config", applied: { disease: "measles" }, approx_r0: 12,
  config: { disease: "measles", disease_type: "sir", country: null, n_agents: 10000, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] },
  warnings: [], new_scenario: false,
};
const STATS = { peak_infections: 9, peak_day: 3, total_infected: 40, total_deaths: 0, n_agents: 1000, sim_days: 365 };
const RUN: RunPayload = {
  kind: "run", run_id: "r1", stats: STATS, stats_agents: STATS, attack_rate_pct: 4, pop_scale: 1, population: 1000, effective_params: params({}),
  warnings: [], repairs: [], data_sources: [], duration_ms: 1200, cold_start: false, series: { day: [0, 1], n_infected: [1, 2] },
};
const USE = { kind: "tool_use", id: "tu_1", name: "configure_simulation", input: { disease: "measles" } } as const;
const RESULT = { kind: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: CONFIG } as const;

describe("event sink", () => {
  it("forwards text deltas at once and stores each prose segment whole, in order with the blocks between", () => {
    const { s, emitted } = sink();
    s.text("Let me ");
    s.text("configure it.");
    s.block(USE);
    s.block(RESULT);
    s.text("Done.");
    const stored = s.finish();
    expect(stored.map((e) => [e.seq, e.kind])).toEqual([[1, "text"], [2, "tool_use"], [3, "tool_result"], [4, "text"]]);
    expect(stored[0]).toMatchObject({ text: "Let me configure it.", at: "2026-10-08T15:00:01.000Z" });
    expect(stored[1]).toMatchObject({ ...USE, at: "2026-10-08T15:00:02.000Z" });
    expect(stored[3]).toMatchObject({ text: "Done.", at: "2026-10-08T15:00:04.000Z" });
    expect(emitted).toEqual([
      { type: "text", delta: "Let me " }, { type: "text", delta: "configure it." },
      { type: "tool_use", id: "tu_1", name: "configure_simulation", input: { disease: "measles" } },
      { type: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: CONFIG },
      { type: "text", delta: "Done." },
    ]);
  });

  it("stores thinking without streaming it, and streams a run payload with its series but stores it without", () => {
    const { s, emitted } = sink();
    s.block({ kind: "thinking", summary: "Plan the model" });
    s.block({ kind: "tool_result", id: "tu_2", name: "run_simulation", ok: true, payload: RUN });
    const stored = s.finish();
    expect(stored.map((e) => e.kind)).toEqual(["thinking", "tool_result"]);
    expect(stored[0]).toMatchObject({ summary: "Plan the model" });
    expect("series" in (stored[1] as { payload: object }).payload).toBe(false);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "tool_result", payload: { series: { day: [0, 1] } } });
  });

  it("parses suggestions from the last text segment and keeps inline code", () => {
    const { s } = sink();
    s.text("Use `beta` first.");
    s.block(USE);
    s.block(RESULT);
    s.text("Try `beta`.\n\n```next\nRun it\n```");
    expect(parseNext(s.lastText())).toEqual(["Run it"]);
    s.block({ kind: "suggestions", items: ["Run it"] });
    const stored = s.finish();
    expect(stored.map((e) => e.kind)).toEqual(["text", "tool_use", "tool_result", "text", "suggestions"]);
    expect(stored[0]).toMatchObject({ text: "Use `beta` first." });
    expect(stored[3]).toMatchObject({ text: "Try `beta`." });
    expect(stored[4]).toMatchObject({ items: ["Run it"] });
  });

  it("drops empty segments, survives a receiver that throws, and maps runTurn events to blocks", () => {
    const { s } = sink(() => { throw new Error("Invalid state: Controller is already closed"); });
    expect(() => s.text("hi")).not.toThrow();
    s.text("  ");
    expect(() => s.block({ kind: "notice", message: "WEB ERROR: unavailable" })).not.toThrow();
    s.text("\n");
    expect(s.finish().map((e) => e.kind)).toEqual(["text", "notice"]);
    expect(blockOf({ type: "web_fetch", url: "https://www.who.int", title: "WHO" })).toEqual({ kind: "web_fetch", url: "https://www.who.int", title: "WHO" });
    expect(blockOf({ type: "thinking", summary: "s" })).toEqual({ kind: "thinking", summary: "s" });
    expect(blockOf({ type: "tool_result", id: "tu_1", name: "lookup_disease", ok: false, payload: { kind: "tool_error", message: "x" } })).toEqual({ kind: "tool_result", id: "tu_1", name: "lookup_disease", ok: false, payload: { kind: "tool_error", message: "x" } });
  });
});
