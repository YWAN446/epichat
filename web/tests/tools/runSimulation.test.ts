import { describe, expect, it } from "vitest";

import type { SimSuccess } from "@/lib/sim/client";
import { validateParams } from "@/lib/sim/params";
import { configureSimulation } from "@/lib/tools/configureSimulation";
import { compareRuns, runSimulation } from "@/lib/tools/runSimulation";
import { makeDeps, params, rf } from "./helpers";

const STATS = { peak_infections: 900, peak_day: 40, total_infected: 6000, total_deaths: 12, n_agents: 50000, sim_days: 366 };
function success(over: Partial<SimSuccess> = {}): SimSuccess {
  return {
    ok: true, effective_params: params({ n_agents: 50000 }), population: 213_000_000,
    stats: { ...STATS, peak_infections: 900 * 4260, total_infected: 6000 * 4260, total_deaths: 12 * 4260 },
    stats_agents: STATS, series: { day: [0, 1], n_infectious: [500, 600], n_infected: [500, 600] }, pop_scale: 4260, repairs: [], attempts: 1,
    duration_ms: 7000, cold_start: false, starsim_version: "3.3.2", ...over,
  };
}

describe("run_simulation", () => {
  it("records the mode of the first run when none was chosen", async () => {
    const deps = makeDeps({ simulate: success() });
    await configureSimulation({ n_agents: 50000 } as never, deps);
    expect(deps.scenario.params?.run.solver).toBeNull();
    await runSimulation({}, deps);
    expect(deps.sent[0].run.solver).toBe("abm");
    expect(deps.scenario.params?.run.solver).toBe("abm");
  });

  it("keeps a mode the user chose", async () => {
    const deps = makeDeps({ simulate: success() });
    await configureSimulation({ n_agents: 50000, solver: "ode" } as never, deps);
    await runSimulation({}, deps);
    expect(deps.sent[0].run.solver).toBe("ode");
    expect(deps.scenario.params?.run.solver).toBe("ode");
  });

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

  it("warns that deaths count the disease only when demographics are on, and summarizes replicates without the bands", async () => {
    const replicates = { n: 3, seeds: [1, 2, 3], representative: 2, stats: [STATS, STATS, STATS], bands: { n_infectious: { p10: [1, 2], p90: [3, 4] }, cum_infections: { p10: [1, 2], p90: [3, 4] } } };
    const deps = makeDeps({ simulate: success({ replicates }) });
    await configureSimulation({ disease: "dengue", country_iso3: "KEN" } as never, deps);
    deps.scenario.params = params({ ...deps.scenario.params, demographics: { ...deps.scenario.params!.demographics, use_demographics: true } });
    const out = await runSimulation({}, deps);
    const body = JSON.parse(out.content);
    expect(body.warnings).toContain("Deaths in this run count disease deaths only; deaths from the background death rate are reported separately as cum_deaths_all.");
    expect(body.replicates).toEqual({ n: 3, seeds: [1, 2, 3], representative: 2, stats: [STATS, STATS, STATS] });
    expect(out.payload).toMatchObject({ kind: "run", replicates: { n: 3 } });
    expect((out.payload as { replicates?: { bands?: unknown } }).replicates?.bands).toBeUndefined();
  });

  it("requires configuration and tolerates a failed run insert", async () => {
    expect((await runSimulation({}, makeDeps())).content).toBe("Call configure_simulation first to establish the simulation before running.");
    const deps = makeDeps({ simulate: success(), runId: null });
    await configureSimulation({ disease: "dengue" } as never, deps);
    const out = await runSimulation({}, deps);
    expect(out.payload).toMatchObject({ kind: "run", run_id: null });
  });
});

describe("run_simulation: diagnostics and the comparison", () => {
  const diagnostics = [{
    id: "unfinished", severity: "warning" as const, title: "The run ended before the epidemic did", evidence: { last_infectious: 40 },
    levers: [{ patch: { "run.sim_dur_years": 2 }, current: { "run.sim_dur_years": 1 }, direction: "increase" as const, rationale: "r", basis: "rule" as const }],
  }];

  it("passes the diagnostics and the disease along, and compares with the previous run", async () => {
    const agents = { ...STATS, peak_infections: 800, peak_day: 35, total_infected: 5000, total_deaths: 10 };
    const previous = { id: "run-8", effectiveParams: params({ n_agents: 50000, dur_inf: 10 }), stats: { ...agents, peak_infections: 800 * 4260, total_infected: 5000 * 4260, total_deaths: 10 * 4260 }, statsAgents: agents, popScale: 4260, diagnostics: [] };
    const deps = makeDeps({ simulate: success({ diagnostics, effective_params: params({ n_agents: 50000, dur_inf: 8 }) }), previousRun: previous });
    await configureSimulation({ disease: "dengue", n_agents: 50000 } as never, deps);
    deps.scenario.totalPopulation = 213_000_000;
    deps.scenario.hasRun = true;
    const out = await runSimulation({}, deps);
    const body = JSON.parse(out.content);
    expect(deps.simulated).toEqual([{ popScale: 4260, contextText: "", disease: "dengue" }]);
    expect(body.diagnostics).toEqual(diagnostics);
    expect(body.compare).toEqual({
      previous_run_id: "run-8",
      changed: [{ path: "disease.dur_inf.mean_days", from: 10, to: 8 }],
      stats_delta: { peak_infections: 100 * 4260, peak_day: 5, total_infected: 1000 * 4260, total_deaths: 2 * 4260 },
      pop_scale: { from: 4260, to: 4260 },
    });
    expect(out.payload).toMatchObject({ kind: "run", diagnostics, compare: { previous_run_id: "run-8" } });
  });

  it("has no compare before the first run, reads the previous run only after one, and detects the disease from the text", async () => {
    const deps = makeDeps({ simulate: success(), previousRun: null, contextText: "whooping cough in Kenya" });
    await configureSimulation({ n_agents: 50000 } as never, deps);
    const body = JSON.parse((await runSimulation({}, deps)).content);
    expect(body.compare).toBeNull();
    expect(body.diagnostics).toEqual([]);
    expect(deps.previousReads).toBe(0);
    expect(deps.simulated[0].disease).toBe("pertussis");
    await runSimulation({}, deps);
    expect(deps.previousReads).toBe(1);
    expect(JSON.parse((await runSimulation({}, deps)).content).compare).toBeNull(); // the store had no previous run
  });

  it("caps the disease name it sends at the service's 80 characters", async () => {
    const deps = makeDeps({ simulate: success() });
    await configureSimulation({ disease: "a".repeat(100) } as never, deps);
    await runSimulation({}, deps);
    expect(deps.simulated[0].disease).toHaveLength(80);
  });

  it("compares across a change of population scale by rescaling the previous run to today's scale", async () => {
    const agents = { ...STATS, peak_infections: 800, peak_day: 35, total_infected: 5000, total_deaths: 10 };
    const previous = { id: "run-8", effectiveParams: params({ n_agents: 50000 }), stats: agents, statsAgents: agents, popScale: 1, diagnostics: [] };
    const deps = makeDeps({ simulate: success(), previousRun: previous });
    await configureSimulation({ disease: "dengue", n_agents: 50000 } as never, deps);
    deps.scenario.totalPopulation = 213_000_000; // fetched between the runs: scale 1 → 4260
    deps.scenario.hasRun = true;
    const body = JSON.parse((await runSimulation({}, deps)).content);
    expect(body.compare.pop_scale).toEqual({ from: 1, to: 4260 });
    expect(body.compare.stats_delta).toEqual({ peak_infections: 100 * 4260, peak_day: 5, total_infected: 1000 * 4260, total_deaths: 2 * 4260 });
  });

  it("compare holds when n_agents changes", () => {
    // round-1 spec 2: 10,000 agents at 5,000 people each, then 50,000 agents at 1,000 each, for the same 50 million people
    const before = { ...STATS, n_agents: 10_000, total_infected: 8_000 };
    const previous = { id: "run-1", effectiveParams: params({ n_agents: 10_000 }), stats: before, statsAgents: before, popScale: 5_000, diagnostics: [] };
    const now = { ...STATS, n_agents: 50_000, total_infected: 40_500 };
    const result = success({ effective_params: params({ n_agents: 50_000 }), stats_agents: now, stats: { ...now, total_infected: 40_500_000 }, pop_scale: 1_000 });
    expect(compareRuns(previous, result, 1_000).stats_delta.total_infected).toBe(500_000);
  });
});

describe("run_simulation and an ODE run", () => {
  it("passes the solver and Starsim's R0 through, and has no replicates or notes for a run that ran once", async () => {
    const result = success();
    result.stats = { ...result.stats, solver: "ode", r0_model: 2.5 };
    expect(result).not.toHaveProperty("replicates");
    const deps = makeDeps({ simulate: result, runId: "run-1" });
    deps.scenario.params = params({ disease_type: "sir" });
    const out = await runSimulation({}, deps);
    const body = JSON.parse(out.content);
    expect(body.stats).toMatchObject({ solver: "ode", r0_model: 2.5 });
    expect(body).not.toHaveProperty("replicates");
    expect(body).not.toHaveProperty("applied");
    expect(out.payload).toMatchObject({ kind: "run", stats: { solver: "ode" } });
    expect(out.payload).not.toHaveProperty("replicates");
  });
});

describe("run_simulation and a fitted lever (Part 2, 7.7)", () => {
  it("notes a fitted beta", async () => {
    const result = success();
    result.stats = { ...result.stats, fit: { target: "attack_rate", wanted: 0.3, achieved: 0.31, lever: "disease.beta", value: 9.5, runs: 4 } };
    result.effective_params = { ...result.effective_params, disease: { ...result.effective_params.disease, beta: 9.5 } };
    const deps = makeDeps({ simulate: result, runId: "run-3" });
    deps.scenario.params = params({ disease_type: "sir" });
    const out = await runSimulation({}, deps);
    expect((out.payload as { applied?: Record<string, unknown> }).applied).toEqual({ beta_fitted_to_attack_rate: 9.5 });
  });
});

describe("run_simulation and the levers that keep R0 (follow-up spec 6)", () => {
  const fitted = async (stats: Record<string, unknown>) => {
    const result = success();
    result.stats = { ...result.stats, ...stats } as typeof result.stats;
    const deps = makeDeps({ simulate: result, runId: "run-4" });
    deps.scenario.params = params({ disease_type: "sir" });
    const out = await runSimulation({}, deps);
    return (out.payload as { applied?: Record<string, unknown> }).applied;
  };

  it("notes a fitted variation, a fitted response, and the response's strongest reduction", async () => {
    expect(await fitted({ fit: { target: "attack_rate", wanted: 0.3, achieved: 0.31, lever: "disease.rel_sus_cv", value: 0.92, runs: 5 } })).toEqual({ rel_sus_cv_fitted_to_attack_rate: 0.92 });
    expect(await fitted({ fit: { target: "attack_rate", wanted: 0.3, achieved: 0.31, lever: "behavior_response.scale", value: 0.61, runs: 5 }, behavior: { min_factor: 0.53, min_day: 55 } })).toEqual({ behavior_response_fitted_to_attack_rate: 0.61, behavior_response_min_factor: 0.53 });
    expect(await fitted({ behavior: { min_factor: 0.53, min_day: 55 } })).toEqual({ behavior_response_min_factor: 0.53 });
    expect(await fitted({})).toBeUndefined();
  });
});

describe("run_simulation sends where each value came from (follow-up spec 8.4)", () => {
  it("says the run set what it changed, and keeps the configured sources for the rest", async () => {
    const result = success();
    const configured = params({ schema_version: 2, disease: { model: "sir", dur_inf: { mean_days: 8 } }, run: { n_agents: 5000 } });
    // as a calibration and the service's demographics leave it: beta corrected, births and deaths filled
    result.effective_params = params({ schema_version: 2, disease: { model: "sir", beta: 31.7, dur_inf: { mean_days: 8 } }, demographics: { use_demographics: true, birth_rate: 27.4, death_rate: 5.3 }, run: { n_agents: 5000 } });
    const deps = makeDeps({ simulate: result, runId: "run-5" });
    deps.scenario.params = configured;
    const payload = (await runSimulation({}, deps)).payload as { sources?: Record<string, string>; effective_params: { disease: { beta: number } } };
    expect(payload.effective_params.disease.beta).toBe(31.7);
    expect(payload.sources).toMatchObject({ "disease.beta": "run", "demographics.use_demographics": "run", "demographics.birth_rate": "run", "demographics.death_rate": "run", "run.n_agents": "user" });
    expect(payload.sources!["disease.dur_inf.mean_days"]).toBe("user");
    expect(payload.sources!["run.sim_dur_years"]).toBeUndefined();                            // unchanged and a default
  });
});

describe("run_simulation: counts in people (round-1 spec 3)", () => {
  const seeded = (value: number) => {
    const r = validateParams({ schema_version: 2, disease: { model: "sir", seed: { mode: "count", value, day: 0 } }, run: { n_agents: 10000 } });
    if (!r.ok) throw new Error(r.error);
    return r.params;
  };
  async function setUp(population: number, input: Record<string, unknown>, over: Partial<SimSuccess> = {}) {
    const deps = makeDeps({ simulate: success({ stats_agents: { ...STATS, n_agents: 10000 }, population, ...over }) });
    deps.scenario.totalPopulation = population;
    const configured = await configureSimulation({ n_agents: 10000, ...input } as never, deps);
    expect(configured.isError).toBeFalsy();
    return deps;
  }

  it("seeds are people", async () => {
    const deps = await setUp(2_000_000, { seed_count: 1000 });
    expect(deps.scenario.params!.disease.seed.value).toBe(1000);
    await runSimulation({}, deps);
    expect((deps.sent[0] as { disease: { seed: { value: number } } }).disease.seed.value).toBe(5);
  });

  it("smallest seed note, and effective params back in people", async () => {
    const deps = await setUp(50_000_000, { seed_count: 20 }, { effective_params: seeded(1) });
    const out = await runSimulation({}, deps);
    expect((deps.sent[0] as { disease: { seed: { value: number } } }).disease.seed.value).toBe(1);
    expect(JSON.parse(out.content).count_notes).toContain("20 initial cases is less than one agent at this run size; the run seeds 1 agent, about 5,000 people. More agents give a smaller seed.");
    expect((out.payload as { effective_params: { disease: { seed: { value: number } } } }).effective_params.disease.seed.value).toBe(20);   // the configured count is kept (final review 3)
  });

  it("capacity is people a day", async () => {
    const deps = await setUp(2_000_000, { treatment_capacity: 300 });
    const out = await runSimulation({}, deps);
    expect((deps.sent[0] as { interventions: { type: string; capacity: number }[] }).interventions.find((i) => i.type === "treatment")!.capacity).toBe(1);
    expect(JSON.parse(out.content).count_notes).toContain("Treatment capacity 300 people a day runs as 1 agent a day, about 200 people a day.");
  });

  it("capacity below one agent", async () => {
    const deps = await setUp(50_000_000, { treatment_capacity: 300 });
    const out = await runSimulation({}, deps);
    expect(JSON.parse(out.content).count_notes).toContain("Treatment capacity 300 people a day is below one agent a day at this run size; it runs as 1 agent a day, about 5,000 people a day.");
  });

  it("peak fit stored in people", async () => {
    const deps = await setUp(2_000_000, { fit: { target: "peak_infections", value: 20000 } });
    expect(deps.scenario.params!.run.fit?.value).toBe(20000);
    await runSimulation({}, deps);
    expect((deps.sent[0] as { run: { fit: { value: number } } }).run.fit.value).toBe(100);
  });

  it("a peak fit's wanted and achieved come back in people (final review 1)", async () => {
    const fit = { target: "peak_infections", wanted: 4, achieved: 5, lever: "disease.beta", value: 9.5, runs: 4 };
    const deps = await setUp(55_000_000, { fit: { target: "peak_infections", value: 20000 } }, { stats: { ...STATS, fit }, stats_agents: { ...STATS, n_agents: 10000, fit } });
    const body = JSON.parse((await runSimulation({}, deps)).content);
    expect(body.stats.fit).toMatchObject({ wanted: 20000, achieved: 27500 });
  });

  it("run_size", async () => {
    const deps = await setUp(2_000_000, {});
    const body = JSON.parse((await runSimulation({}, deps)).content);
    expect(body.run_size).toEqual({ agents: 10000, people_per_agent: 200, population: 2_000_000 });
    expect(body.count_notes).toEqual([]);
  });

  it("diagnostic levers come back in people", async () => {
    const diagnostics = [{ id: "early_dieout", severity: "warning" as const, title: "t", evidence: {},
      levers: [{ patch: { "disease.seed.mode": "count", "disease.seed.value": 5 }, current: { "disease.seed.mode": "count", "disease.seed.value": 1 }, direction: "increase" as const, rationale: "r", basis: "rule" as const }] }];
    const deps = await setUp(2_000_000, {}, { diagnostics });
    const body = JSON.parse((await runSimulation({}, deps)).content);
    expect(body.diagnostics[0].levers[0].patch).toEqual({ "disease.seed.mode": "count", "disease.seed.value": 1000 });
    expect(body.diagnostics[0].levers[0].current).toEqual({ "disease.seed.mode": "count", "disease.seed.value": 200 });
  });
});

describe("run_simulation: the replicate band (round-1 spec 5)", () => {
  it("run with replicates stores bands and says so", async () => {
    const replicates = { n: 3, seeds: [1, 2, 3], representative: 2, stats: [STATS, STATS, STATS], bands: { n_infectious: { p10: [400, 500], p90: [600, 700] } } };
    const deps = makeDeps({ simulate: success({ replicates }) });
    await configureSimulation({ n_agents: 50000 } as never, deps);
    const body = JSON.parse((await runSimulation({}, deps)).content);
    expect(body.band_shown).toBe(true);
    const stored = deps.runs[0].result;
    expect(stored.ok && stored.series.n_infectious_p10).toEqual([400, 500]);
    const single = makeDeps({ simulate: success() });
    await configureSimulation({ n_agents: 50000 } as never, single);
    expect(JSON.parse((await runSimulation({}, single)).content).band_shown).toBe(false);
  });
});
