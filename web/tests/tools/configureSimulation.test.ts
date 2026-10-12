import { describe, expect, it } from "vitest";

import { getVaccine } from "@/lib/sim/params";
import { configureSimulation } from "@/lib/tools/configureSimulation";
import { emptyScenario } from "@/lib/tools/types";
import { makeDeps, params } from "./helpers";

const run = (deps: ReturnType<typeof makeDeps>, input: Record<string, unknown>) => configureSimulation(input as never, deps);

describe("configure_simulation", () => {
  it("creates params from scratch", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "dengue", country_iso3: "BRA", disease_type: "sir", n_agents: 50000 })).content);
    expect(deps.scenario.params?.run.n_agents).toBe(50000);
    expect(deps.scenario.params?.demographics.country).toBe("BRA");
    expect(deps.scenario.params?.disease.beta).toBe(22.8125);
    expect(deps.scenario.params?.disease.dur_inf).toEqual({ mean_days: 10, dist: "gamma", sd_days: 0.75 }); // dengue infectious 2–5 days
    expect(out.applied.n_agents).toBe(50000);
    expect(out.applied.disease).toBe("dengue");
    expect(deps.scenario.disease).toBe("dengue");
    expect(deps.scenario.countryIso3).toBe("BRA");
  });

  it("merges without losing prior fields", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "dengue", country_iso3: "BRA", n_agents: 50000 });
    await run(deps, { n_agents: 100000 });
    expect(deps.scenario.params?.run.n_agents).toBe(100000);
    expect(deps.scenario.params?.demographics.country).toBe("BRA");
  });

  it("returns a CONFIG ERROR and preserves state on an invalid value", async () => {
    const deps = makeDeps();
    await run(deps, { n_agents: 50000 });
    const before = deps.scenario.params;
    const out = await run(deps, { n_agents: -5 });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/^CONFIG ERROR: 1 validation error for SimParams\nrun\.n_agents\n/);
    expect(out.payload).toMatchObject({ kind: "tool_error" });
    expect(deps.scenario.params).toBe(before);
  });

  it("calibrates beta to r0", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "measles", disease_type: "sir", r0: 15, dur_inf: 8 })).content);
    expect(out.approx_r0).toBe(15);
    // exact formula on a gamma 8-day infectious period (measles 8–8 gives sd 2.4): D_eff 7.5
    expect(deps.scenario.params?.disease.beta).toBeCloseTo(-365 * Math.log(1 - 15 / (4 * 7.5)), 5);
    expect(out.applied.r0).toBe(15);
  });

  it("produces literature warnings for out-of-range values", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "measles", r0: 25, dur_inf: 8 })).content); // 25 is outside 12–18 and within reach (max 30)
    expect(out.warnings.some((w: string) => w.includes("literature"))).toBe(true);
  });

  it("falls back to the conversation text for the disease the warnings use", async () => {
    const deps = makeDeps({ contextText: "please model whooping cough in Kenya" });
    const out = JSON.parse((await run(deps, { r0: 25, dur_inf: 8 })).content);
    expect(out.warnings[0]).toContain("for pertussis");
  });

  it("handles vaccine coverage and start day like the agent", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", vaccine_coverage: 0.8 });
    expect(deps.scenario.params!.disease.initial_immune_frac).toBe(0.8); // day 0 is pre-existing immunity
    expect(getVaccine(deps.scenario.params!)).toBeNull();
    await run(deps, { vaccine_start_day: 60 });
    expect(getVaccine(deps.scenario.params!)).toMatchObject({ coverage: 0.8, start_day: 60 });
    expect(deps.scenario.params!.disease.initial_immune_frac).toBe(0);
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
    expect(out.config.interventions).toEqual(["seasonality", "treatment"]); // the day-0 vaccine is initial immunity, not an intervention
    expect(deps.scenario.params!.disease.initial_immune_frac).toBe(0.6);
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
    expect(deps.scenario.params?.run.n_agents).toBe(10000);
    expect(deps.scenario.params?.demographics.country).toBeNull();
    expect(deps.scenario.dataSources).toEqual([]);
    expect(out.payload).toMatchObject({ kind: "config", new_scenario: true });
  });

  it("refuses an R0 the contacts and infectious period cannot carry, naming the levers", async () => {
    const deps = makeDeps();
    const out = await run(deps, { disease: "dengue", dur_inf: 2, r0: 10 });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/^CONFIG ERROR: R0 10 is not reachable: the most the contacts and infectious period can carry is \d+\.\d\d; raise network\.n_contacts or disease\.dur_inf\.mean_days\./);
    expect(deps.scenario.params).toBeNull();
  });

  it("keeps a constant duration constant when its mean changes, and seeds by fraction", async () => {
    const deps = makeDeps({ scenario: { ...emptyScenario(), params: params({ dur_inf: 10 }) } });
    await run(deps, { dur_inf: 12, init_prev: 0.02 });
    expect(deps.scenario.params?.disease.dur_inf).toEqual({ mean_days: 12, dist: "constant", sd_days: null });
    expect(deps.scenario.params?.disease.seed).toEqual({ mode: "fraction", value: 0.02, day: 0 });
  });
});
