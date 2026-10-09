import { describe, expect, it } from "vitest";

import type { Block } from "@/lib/chat/events";
import { formatDuration, summarizeActivity } from "@/lib/client/activity";

const STATS = { peak_infections: 9, peak_day: 4, total_infected: 40, total_deaths: 0, n_agents: 100, sim_days: 30 };
const run = (duration_ms: number, ok = true): Block => ({
  kind: "tool_result", id: "tu", name: "run_simulation", ok,
  payload: ok
    ? { kind: "run", run_id: null, stats: STATS, stats_agents: STATS, attack_rate_pct: 40, pop_scale: 1, population: 100, effective_params: {} as never, warnings: [], repairs: [], data_sources: [], duration_ms, cold_start: false }
    : { kind: "tool_error", message: "boom" },
});
const tool = (name: string, payload: Extract<Block, { kind: "tool_result" }>["payload"], ok = true): Block => ({ kind: "tool_result", id: "tu", name, ok, payload });

describe("summarizeActivity", () => {
  it("names each step in order and counts the fetches, searches, and pages", () => {
    const blocks: Block[] = [
      tool("lookup_disease", { kind: "disease", canonical_name: "measles", display_name: "Measles", parameters: {} }),
      tool("configure_simulation", { kind: "config", applied: {}, approx_r0: 12, warnings: [], new_scenario: true, config: { disease: "measles", disease_type: "sir", country: null, n_agents: 1, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] } }),
      tool("fetch_demographics", { kind: "data", source: "un_wpp", iso3: "KEN", applied: {}, citations: [] }),
      tool("fetch_health_system", { kind: "data", source: "wb_data360", iso3: "KEN", applied: {}, citations: [] }),
      tool("fetch_vaccination_coverage", { kind: "data", source: "who_gho", iso3: "KEN", applied: {}, citations: [] }),
      run(108000),
    ];
    expect(summarizeActivity(blocks)).toBe("Looked up Measles · Started a new scenario · Fetched 3 data sources · Ran the simulation, 1.8 min");
    expect(summarizeActivity([{ kind: "web_search", query: "a" }, { kind: "web_search", query: "b" }, { kind: "web_fetch", url: "https://x", title: "X" }])).toBe("Searched the web (2) · Read 1 page");
    expect(summarizeActivity([tool("configure_simulation", { kind: "config", applied: {}, approx_r0: 2, warnings: [], new_scenario: false, config: { disease: null, disease_type: "sir", country: null, n_agents: 1, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] } }), tool("fetch_demographics", { kind: "data", source: "un_wpp", iso3: "KEN", applied: {}, citations: [] })])).toBe("Configured the simulation · Fetched 1 data source");
    expect(summarizeActivity([run(0, false)])).toBe("⚠ Simulation failed");
    expect(summarizeActivity([tool("fetch_vaccination_coverage", { kind: "tool_error", message: "x" }, false)])).toBe("⚠ WHO vaccination coverage failed");
    expect(summarizeActivity([{ kind: "text", text: "hi" }])).toBe("");
  });

  it("formats durations as seconds under a minute and minutes with one decimal above", () => {
    expect(formatDuration(300)).toBe("1 s");
    expect(formatDuration(42000)).toBe("42 s");
    expect(formatDuration(108000)).toBe("1.8 min");
    expect(formatDuration(120000)).toBe("2 min");
  });
});

describe("summarizeActivity for the report", () => {
  it("says the report was written, with its version", () => {
    const payload = { kind: "report" as const, report_id: "rep-1", version: 2, title: "T", sections: [], words: 100 };
    expect(summarizeActivity([tool("write_report", payload)])).toBe("Wrote the report, version 2");
    expect(summarizeActivity([tool("write_report", { kind: "tool_error", message: "x" }, false)])).toBe("⚠ Report failed");
  });
});
