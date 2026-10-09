import { describe, expect, it } from "vitest";

import type { Block } from "@/lib/chat/events";
import { deriveArtifacts, emptyArtifacts } from "@/lib/client/artifacts";
import type { ReportPayload } from "@/lib/report/document";
import type { CardPayload, ConfigPayload, DataPayload, DiseasePayload, MemoryPayload, RunPayload } from "@/lib/tools/types";
import { params } from "../tools/helpers";

const STATS = { peak_infections: 900, peak_day: 40, total_infected: 4000, total_deaths: 12, n_agents: 10000, sim_days: 365 };
const DISEASE: DiseasePayload = { kind: "disease", canonical_name: "measles", display_name: "Measles", parameters: {} };
const CONFIG = (new_scenario: boolean): ConfigPayload => ({
  kind: "config", applied: {}, approx_r0: 12, warnings: [], new_scenario,
  config: { disease: "measles", disease_type: "sir", country: "KEN", n_agents: 10000, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] },
});
const DATA: DataPayload & { duration_ms?: number } = { kind: "data", source: "un_wpp", iso3: "KEN", applied: { birth_rate: 28.1 }, citations: ["UN WPP 2024"], duration_ms: 310 };
const RUN: RunPayload = {
  kind: "run", run_id: "run-1", stats: STATS, stats_agents: STATS, attack_rate_pct: 40, pop_scale: 1, population: 10000, effective_params: params({}),
  warnings: [], repairs: [], data_sources: [], duration_ms: 108000, cold_start: false,
};
const result = (name: string, payload: CardPayload, ok = true): Block => ({ kind: "tool_result", id: "tu", name, ok, payload });

describe("deriveArtifacts", () => {
  it("starts empty", () => {
    expect(deriveArtifacts([])).toEqual(emptyArtifacts());
  });

  it("keeps the latest disease and configuration, the data since the last new scenario, every run, and every step", () => {
    const turns = [
      { id: "t1", blocks: [result("lookup_disease", DISEASE), result("configure_simulation", CONFIG(true)), { kind: "web_search" as const, query: "measles Kenya 2026" }] },
      { id: "t2", blocks: [result("fetch_demographics", DATA), result("fetch_vaccination_coverage", { kind: "tool_error", message: "WHO timed out" }, false)] },
      { id: "t3", blocks: [result("run_simulation", RUN)] },
      { id: "t4", blocks: [result("configure_simulation", CONFIG(true)), result("run_simulation", { ...RUN, run_id: "run-2" })] },
    ];
    const a = deriveArtifacts(turns);
    expect(a.disease).toBe(DISEASE);
    expect(a.config?.new_scenario).toBe(true);
    expect(a.data).toEqual([]);
    expect(a.runs.map((r) => [r.turnId, r.index, r.payload.run_id])).toEqual([["t3", 1, "run-1"], ["t4", 2, "run-2"]]);
    expect(a.activity.map((s) => [s.turnId, s.kind, s.name, s.ok, s.durationMs])).toEqual([
      ["t1", "tool", "lookup_disease", true, null], ["t1", "tool", "configure_simulation", true, null], ["t1", "web_search", "web_search", true, null],
      ["t2", "tool", "fetch_demographics", true, 310], ["t2", "tool", "fetch_vaccination_coverage", false, null],
      ["t3", "tool", "run_simulation", true, 108000], ["t4", "tool", "configure_simulation", true, null], ["t4", "tool", "run_simulation", true, 108000],
    ]);
    expect(a.activity[2].detail).toBe("measles Kenya 2026");
    expect(a.activity[3].label).toBe("🔧 UN WPP demographics");
    expect(deriveArtifacts(turns.slice(0, 3)).data).toEqual([DATA]);
  });
});

describe("deriveArtifacts and the report", () => {
  const REPORT: ReportPayload = { kind: "report", report_id: "rep-1", version: 1, title: "T", sections: [{ id: "summary", heading: "Summary" }], words: 120 };

  it("keeps the latest report and clears it on a new scenario", () => {
    expect(emptyArtifacts().report).toBeNull();
    const turns = [
      { id: "t1", blocks: [result("run_simulation", RUN), result("write_report", REPORT)] },
      { id: "t2", blocks: [result("write_report", { ...REPORT, version: 2 })] },
    ];
    expect(deriveArtifacts(turns).report).toEqual({ ...REPORT, version: 2 });
    expect(deriveArtifacts([...turns, { id: "t3", blocks: [result("configure_simulation", CONFIG(true))] }]).report).toBeNull();
    expect(deriveArtifacts([...turns, { id: "t3", blocks: [result("write_report", { kind: "tool_error", message: "x" }, false)] }]).report).toEqual({ ...REPORT, version: 2 });
    expect(deriveArtifacts(turns).activity.map((s) => s.name)).toEqual(["run_simulation", "write_report", "write_report"]);
  });
});

describe("deriveArtifacts and the parameters", () => {
  const P1 = params({ n_agents: 5000 });
  const P2 = params({ n_agents: 7000 });

  it("keeps the parameters of the latest configuration, data step, or run: what the next run uses", () => {
    expect(emptyArtifacts().params).toBeNull();
    const turns = [
      { id: "t1", blocks: [result("configure_simulation", { ...CONFIG(true), params: P1 })] },
      { id: "t2", blocks: [result("fetch_demographics", { ...DATA, params: P2 })] },
      { id: "t3", blocks: [result("run_simulation", { ...RUN, effective_params: params({ n_agents: 9000 }) })] },
      { id: "t4", blocks: [result("configure_simulation", { ...CONFIG(false), params: P1 })] },
    ];
    expect(deriveArtifacts(turns.slice(0, 1)).params).toEqual(P1);
    expect(deriveArtifacts(turns.slice(0, 2)).params).toEqual(P2);
    expect(deriveArtifacts(turns.slice(0, 3)).params?.n_agents).toBe(9000);
    expect(deriveArtifacts(turns).params).toEqual(P1);
  });

  it("falls back to the latest run for conversations stored before the payloads carried parameters", () => {
    const turns = [
      { id: "t1", blocks: [result("configure_simulation", CONFIG(true))] },
      { id: "t2", blocks: [result("fetch_demographics", DATA)] },
    ];
    expect(deriveArtifacts(turns).params).toBeNull();
    const ran = [...turns, { id: "t3", blocks: [result("run_simulation", RUN)] }];
    expect(deriveArtifacts(ran).params).toEqual(RUN.effective_params);
    expect(deriveArtifacts([...ran, { id: "t4", blocks: [result("fetch_demographics", DATA)] }]).params).toEqual(RUN.effective_params);
    expect(deriveArtifacts([...ran, { id: "t4", blocks: [result("configure_simulation", CONFIG(true))] }]).params).toBeNull();
  });
});

describe("deriveArtifacts and the memory", () => {
  const MEMORY: MemoryPayload = { kind: "memory", memory_id: "m1", memory_kind: "preference", text: "Prefers tables", replaced: false };

  it("counts successful remember calls so the tab knows to re-read the list", () => {
    expect(emptyArtifacts().memoryWrites).toBe(0);
    const turns = [
      { id: "t1", blocks: [result("remember", MEMORY), result("remember", { ...MEMORY, memory_id: "m2" })] },
      { id: "t2", blocks: [result("remember", { kind: "tool_error", message: "x" }, false)] },
    ];
    expect(deriveArtifacts(turns).memoryWrites).toBe(2);
    expect(deriveArtifacts(turns).activity.map((s) => s.name)).toEqual(["remember", "remember", "remember"]);
    expect(deriveArtifacts([...turns, { id: "t3", blocks: [result("configure_simulation", CONFIG(true))] }]).memoryWrites).toBe(2);
  });
});
