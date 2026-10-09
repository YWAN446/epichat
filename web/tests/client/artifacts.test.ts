import { describe, expect, it } from "vitest";

import type { Block } from "@/lib/chat/events";
import { deriveArtifacts, emptyArtifacts } from "@/lib/client/artifacts";
import type { CardPayload, ConfigPayload, DataPayload, DiseasePayload, RunPayload } from "@/lib/tools/types";
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
