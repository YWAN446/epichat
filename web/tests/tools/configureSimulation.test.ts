import { describe, expect, it } from "vitest";

import { getVaccine } from "@/lib/sim/params";
import { configureSimulation } from "@/lib/tools/configureSimulation";
import { makeDeps } from "./helpers";

const run = (deps: ReturnType<typeof makeDeps>, input: Record<string, unknown>) => configureSimulation(input as never, deps);

describe("configure_simulation", () => {
  it("creates params from scratch", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "dengue", country_iso3: "BRA", disease_type: "sir", n_agents: 50000 })).content);
    expect(deps.scenario.params?.n_agents).toBe(50000);
    expect(deps.scenario.params?.country).toBe("BRA");
    expect(deps.scenario.params?.beta).toBe(22.8125);
    expect(out.applied.n_agents).toBe(50000);
    expect(out.applied.disease).toBe("dengue");
    expect(deps.scenario.disease).toBe("dengue");
    expect(deps.scenario.countryIso3).toBe("BRA");
  });

  it("merges without losing prior fields", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "dengue", country_iso3: "BRA", n_agents: 50000 });
    await run(deps, { n_agents: 100000 });
    expect(deps.scenario.params?.n_agents).toBe(100000);
    expect(deps.scenario.params?.country).toBe("BRA");
  });

  it("returns a CONFIG ERROR and preserves state on an invalid value", async () => {
    const deps = makeDeps();
    await run(deps, { n_agents: 50000 });
    const before = deps.scenario.params;
    const out = await run(deps, { n_agents: -5 });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/^CONFIG ERROR: 1 validation error for SimParams\nn_agents\n/);
    expect(out.payload).toMatchObject({ kind: "tool_error" });
    expect(deps.scenario.params).toBe(before);
  });

  it("calibrates beta to r0", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "measles", disease_type: "sir", r0: 15, dur_inf: 8 })).content);
    expect(out.approx_r0).toBe(15);
    expect(deps.scenario.params?.beta).toBe(171.09375);
    expect(out.applied.r0).toBe(15);
  });

  it("produces literature warnings for out-of-range values", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "measles", r0: 100, dur_inf: 8 })).content);
    expect(out.warnings.some((w: string) => w.includes("literature"))).toBe(true);
  });

  it("falls back to the conversation text for the disease the warnings use", async () => {
    const deps = makeDeps({ contextText: "please model whooping cough in Kenya" });
    const out = JSON.parse((await run(deps, { r0: 100, dur_inf: 8 })).content);
    expect(out.warnings[0]).toContain("for pertussis");
  });

  it("handles vaccine coverage and start day like the agent", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", vaccine_coverage: 0.8 });
    expect(getVaccine(deps.scenario.params!)).toMatchObject({ coverage: 0.8, start_day: 0 });
    await run(deps, { vaccine_start_day: 60 });
    expect(getVaccine(deps.scenario.params!)).toMatchObject({ coverage: 0.8, start_day: 60 });
    const fresh = makeDeps();
    await run(fresh, { disease: "measles", n_agents: 5000 });
    const rejected = await run(fresh, { vaccine_start_day: 30 });
    expect(rejected.content).toBe("CONFIG ERROR: a vaccination campaign needs a coverage level — pass vaccine_coverage alongside vaccine_start_day.");
    expect(rejected.isError).toBe(true);
    expect(getVaccine(fresh.scenario.params!)).toBeNull();
  });

  it("upserts treatment and seasonality and lists intervention types in order", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", vaccine_coverage: 0.5, treatment_capacity: 20, seasonality_scale: 0.3 });
    await run(deps, { treatment_capacity: 40 });
    const out = JSON.parse((await run(deps, { vaccine_coverage: 0.6 })).content);
    expect(out.config.interventions).toEqual(["seasonality", "treatment", "vaccine"]);
    expect(deps.scenario.params!.interventions.find((i) => i.type === "treatment")).toMatchObject({ coverage: 1, capacity: 40 });
    expect(deps.scenario.params!.interventions.find((i) => i.type === "seasonality")).toMatchObject({ scale: 0.3, shift: 0 });
  });

  it("carries the full parameters for the Parameters section, not for the model", async () => {
    const deps = makeDeps();
    const out = await run(deps, { disease: "measles", r0: 15, dur_inf: 8, vaccine_coverage: 0.8 });
    expect(out.payload).toMatchObject({ kind: "config", params: deps.scenario.params });
    expect(JSON.parse(out.content).params).toBeUndefined();
  });

  it("starts a new scenario when asked", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", n_agents: 5000, country_iso3: "KEN" });
    deps.scenario.dataSources.push({ field: "birth_rate", value: 1, citation: "x", description: "", alternatives: [] });
    const out = await run(deps, { disease: "dengue", start_new_scenario: true });
    expect(deps.starts).toBe(1);
    expect(deps.scenario.seq).toBe(2);
    expect(deps.scenario.params?.n_agents).toBe(10000);
    expect(deps.scenario.params?.country).toBeNull();
    expect(deps.scenario.dataSources).toEqual([]);
    expect(out.payload).toMatchObject({ kind: "config", new_scenario: true });
  });
});
