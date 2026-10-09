import { describe, expect, it } from "vitest";

import type { SimSuccess } from "@/lib/sim/client";
import { configureSimulation } from "@/lib/tools/configureSimulation";
import { runSimulation } from "@/lib/tools/runSimulation";
import { makeDeps, params, rf } from "./helpers";

const STATS = { peak_infections: 900, peak_day: 40, total_infected: 6000, total_deaths: 12, n_agents: 50000, sim_days: 366 };
function success(over: Partial<SimSuccess> = {}): SimSuccess {
  return {
    ok: true, effective_params: params({ n_agents: 50000 }), population: 213_000_000,
    stats: { ...STATS, peak_infections: 900 * 4260, total_infected: 6000 * 4260, total_deaths: 12 * 4260 },
    stats_agents: STATS, series: { day: [0, 1], n_infected: [500, 600] }, pop_scale: 4260, repairs: [], attempts: 1,
    duration_ms: 7000, cold_start: false, starsim_version: "3.3.2", ...over,
  };
}

describe("run_simulation", () => {
  it("runs with the population scale, records the run, and returns stats without the series", async () => {
    const deps = makeDeps({ simulate: success(), runId: "run-9" });
    await configureSimulation({ disease: "dengue", n_agents: 50000 } as never, deps);
    deps.scenario.totalPopulation = 213_000_000;
    deps.scenario.dataSources.push(rf("total_population", 213_000_000, "UN WPP 2024"));
    deps.scenario.reportCurrent = true;
    const out = await runSimulation({}, deps);
    expect(out.isError).toBeUndefined();
    const body = JSON.parse(out.content);
    expect(body.stats).toEqual(success().stats);
    expect(body.attack_rate_pct).toBe(12);
    expect(body.pop_scale).toBe(4260);
    expect(body.series).toBeUndefined();
    expect(body.data_sources).toEqual([{ field: "total_population", value: 213_000_000, citation: "UN WPP 2024" }]);
    expect(out.payload).toMatchObject({ kind: "run", run_id: "run-9", attack_rate_pct: 12, pop_scale: 4260, population: 213_000_000, series: { day: [0, 1] } });
    expect(deps.scenario.hasRun).toBe(true);
    expect(deps.scenario.reportCurrent).toBe(false);
    expect(deps.runs).toHaveLength(1);
    expect(deps.runs[0].popScale).toBe(4260);
    expect(deps.runs[0].result.ok).toBe(true);
  });

  it("uses pop_scale 1 without a population and rounds the reported scale", async () => {
    const deps = makeDeps({ simulate: success({ population: 10000, pop_scale: 1 }) });
    await configureSimulation({ disease: "dengue" } as never, deps);
    deps.scenario.totalPopulation = 12345;
    await runSimulation({}, deps);
    expect(deps.runs[0].popScale).toBeCloseTo(1.2345, 9);
    const unscaled = await runSimulation({}, makeDeps({ simulate: success(), scenario: { ...deps.scenario, totalPopulation: null } }));
    expect(JSON.parse(unscaled.content).pop_scale).toBe(1);
  });

  it("reports a failed run as a SIMULATION ERROR with the repair log and still records it", async () => {
    const repairs = [{ attempt: 1, error: "KeyError: dur_exp", changes: [{ field: "dur_exp", from: null, to: 5 }], usage: { model: "claude-opus-5-5", input_tokens: 10, output_tokens: 5 } }];
    const deps = makeDeps({ simulate: { ok: false, status: 500, kind: "execution_failed", detail: "Traceback …", repairs, attempts: 2 } });
    await configureSimulation({ disease: "dengue" } as never, deps);
    const out = await runSimulation({}, deps);
    expect(out.isError).toBe(true);
    expect(out.content.startsWith("SIMULATION ERROR: Traceback …")).toBe(true);
    expect(out.content).toContain('"attempt": 1');
    expect(out.payload).toMatchObject({ kind: "tool_error" });
    expect(deps.scenario.hasRun).toBe(false);
    expect(deps.runs[0].result.ok).toBe(false);
  });

  it("explains a timeout and a cap refusal in terms the model can act on", async () => {
    const timeout = makeDeps({ simulate: { ok: false, status: 504, kind: "timeout", detail: "The simulation timed out after 120 seconds.", repairs: [], attempts: 1, seconds: 120 } });
    await configureSimulation({ disease: "dengue" } as never, timeout);
    expect((await runSimulation({}, timeout)).content).toBe("SIMULATION ERROR: The simulation timed out after 120 seconds. Fewer agents or a shorter duration usually fixes this.");
    const capped = makeDeps({ simulate: { ok: false, status: 422, kind: "too_large", detail: "n_agents × sim_dur_years = 2,000,000 exceeds the cap of 500,000 agent-years; reduce n_agents or sim_dur_years", repairs: [], attempts: null } });
    await configureSimulation({ disease: "dengue" } as never, capped);
    expect((await runSimulation({}, capped)).content).toBe("SIMULATION ERROR: n_agents × sim_dur_years = 2,000,000 exceeds the cap of 500,000 agent-years; reduce n_agents or sim_dur_years");
  });

  it("requires configuration and tolerates a failed run insert", async () => {
    expect((await runSimulation({}, makeDeps())).content).toBe("Call configure_simulation first to establish the simulation before running.");
    const deps = makeDeps({ simulate: success(), runId: null });
    await configureSimulation({ disease: "dengue" } as never, deps);
    const out = await runSimulation({}, deps);
    expect(out.payload).toMatchObject({ kind: "run", run_id: null });
  });
});
