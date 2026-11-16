import { describe, expect, it } from "vitest";

import { CUT_OFF_NOTICE } from "@/lib/chat/handleChat";
import type { ReplayTurn } from "@/lib/db/turns";
import { SNAPSHOT_MAX_BYTES, buildSnapshot, snapshotBytes } from "@/lib/share/snapshot";
import type { RunPayload } from "@/lib/tools/types";
import { params } from "../tools/helpers";

const STATS = { peak_infections: 900, peak_day: 40, total_infected: 4000, total_deaths: 12, n_agents: 10000, sim_days: 366 };
const RUN: RunPayload = {
  kind: "run", run_id: "run-1", stats: STATS, stats_agents: STATS, attack_rate_pct: 40, pop_scale: 1, population: 10000, effective_params: params({}),
  warnings: [], repairs: [], data_sources: [], duration_ms: 1000, cold_start: false,
};
const DAYS = Array.from({ length: 1096 }, (_, i) => i);
const replay: ReplayTurn[] = [
  { id: "t1", seq: 1, userText: "Model measles in Kenya", stop: "end_turn", blocks: [{ kind: "text", text: "Sure." }, { kind: "tool_result", id: "tu", name: "run_simulation", ok: true, payload: RUN }] },
  { id: "t2", seq: 2, userText: "And again", stop: "max_tokens", blocks: [{ kind: "tool_result", id: "tu2", name: "run_simulation", ok: true, payload: { ...RUN, run_id: "run-2" } }] },
];
const NOW = new Date("2026-10-09T18:00:00Z");

describe("buildSnapshot", () => {
  it("copies the turns, embeds and thins each run's series, keeps the cut-off notice, and copies the report", () => {
    const series = new Map([["run-1", { day: DAYS, n_infected: DAYS.map((d) => d % 7) }]]);
    const snapshot = buildSnapshot({ title: "Measles in Kenya", replay, series, report: null }, NOW);
    expect(snapshot).toMatchObject({ version: 1, title: "Measles in Kenya", takenAt: NOW.toISOString(), report: null });
    expect(snapshot.turns.map((t) => [t.id, t.userText, t.notice])).toEqual([["t1", "Model measles in Kenya", null], ["t2", "And again", CUT_OFF_NOTICE]]);
    const first = snapshot.turns[0].blocks[1];
    if (first.kind !== "tool_result" || first.payload.kind !== "run") throw new Error("run");
    expect(first.payload.series?.day.length).toBeLessThanOrEqual(401);
    expect(first.payload.series?.day.at(-1)).toBe(1095);
    expect(first.payload.series?.n_infected.length).toBe(first.payload.series?.day.length);
    const second = snapshot.turns[1].blocks[0];
    if (second.kind !== "tool_result" || second.payload.kind !== "run") throw new Error("run");
    expect(second.payload.series).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain("@");
  });

  it("keeps a report result but without its id, so the public page offers no participant-only downloads", () => {
    const report = { kind: "report" as const, report_id: "rep-1", version: 2, title: "T", sections: [{ id: "summary" as const, heading: "Summary" }], words: 50 };
    const withReport: ReplayTurn[] = [{ ...replay[0], blocks: [{ kind: "tool_result", id: "tu3", name: "write_report", ok: true, payload: report }] }];
    const snapshot = buildSnapshot({ title: "T", replay: withReport, series: new Map(), report: null }, NOW);
    const block = snapshot.turns[0].blocks[0];
    if (block.kind !== "tool_result" || block.payload.kind !== "report") throw new Error("report");
    expect(block.payload).toEqual({ ...report, report_id: null });
    expect(JSON.stringify(snapshot)).not.toContain("rep-1");
  });

  it("drops thinking blocks that slipped in", () => {
    const withThinking: ReplayTurn[] = [{ ...replay[0], blocks: [{ kind: "thinking", summary: "plan" } as never, ...replay[0].blocks] }];
    const snapshot = buildSnapshot({ title: "T", replay: withThinking, series: new Map(), report: null }, NOW);
    expect(snapshot.turns[0].blocks.map((b) => b.kind)).toEqual(["text", "tool_result"]);
  });

  it("thins harder, then drops series, to stay under the size limit", () => {
    const huge = Array.from({ length: 400 }, (_, i) => i);
    const bigReplay: ReplayTurn[] = Array.from({ length: 60 }, (_, i) => ({
      id: `t${i}`, seq: i + 1, userText: "x", stop: "end_turn",
      blocks: [{ kind: "tool_result", id: "tu", name: "run_simulation", ok: true, payload: { ...RUN, run_id: `run-${i}` } }],
    }));
    const series = new Map(
      bigReplay.map((turn, i) => [`run-${i}`, { day: huge, ...Object.fromEntries(Array.from({ length: 30 }, (_, k) => [`k${k}`, huge.map((d) => d * 1000.123)])) } as Record<string, number[]>]),
    );
    const snapshot = buildSnapshot({ title: "T", replay: bigReplay, series, report: null }, NOW);
    expect(snapshotBytes(snapshot)).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
    expect(snapshot.turns).toHaveLength(60);
  });
});
