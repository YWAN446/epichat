import { z } from "zod";
import type { PreviousRun } from "@/lib/db/runs";
import { detectDisease } from "@/lib/disease/db";
import type { SimSuccess } from "@/lib/sim/client";
import { changedPaths } from "@/lib/sim/paths";
import { pyRound } from "@/lib/sim/pyformat";
import { errorOutcome, paramWarnings, runNotes } from "./shared";
import type { RunCompare, RunPayload, ToolDeps, ToolOutcome } from "./types";

export const RunSimulationInput = z.strictObject({});
export type RunSimulationArgs = z.infer<typeof RunSimulationInput>;

type Obj = Record<string, unknown>;
/** sim/main.py caps the request's disease name; a longer one would fail every run. */
const DISEASE_NAME_MAX = 80;

/**
 * Spec 11: what changed since the previous run, by path, and the difference in the headline numbers in today's
 * population scale: the previous run's agent counts are rescaled to this run's scale, so a population fetched
 * between the runs does not show up as millions of extra infections.
 */
export function compareRuns(previous: PreviousRun, result: SimSuccess, popScale: number): RunCompare {
  const before = (key: keyof RunCompare["stats_delta"]) => (key === "peak_day" ? previous.statsAgents.peak_day : Math.round(previous.statsAgents[key] * popScale));
  const delta = (key: keyof RunCompare["stats_delta"]) => result.stats[key] - before(key);
  return {
    previous_run_id: previous.id,
    changed: changedPaths(previous.effectiveParams as unknown as Obj, result.effective_params as unknown as Obj),
    stats_delta: { peak_infections: delta("peak_infections"), peak_day: delta("peak_day"), total_infected: delta("total_infected"), total_deaths: delta("total_deaths") },
    pop_scale: { from: pyRound(previous.popScale, 2), to: pyRound(popScale, 2) },
  };
}

/** Ported from epichat/agent.py run_simulation; the executor is the simulation service, which also answers the diagnostics of spec 10. */
export async function runSimulation(_input: RunSimulationArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome("Call configure_simulation first to establish the simulation before running.");
  const params = scenario.params;
  const popScale = scenario.totalPopulation && params.run.n_agents > 0 ? scenario.totalPopulation / params.run.n_agents : 1.0;
  const disease = (scenario.disease ?? detectDisease(deps.contextText || ""))?.slice(0, DISEASE_NAME_MAX) ?? null;
  // Read before this run is inserted, so it is never its own previous run; the first run has none to read.
  const previous = scenario.hasRun ? await deps.previousRun() : null;
  const result = await deps.sim.simulate(params, popScale, deps.contextText, disease);
  const warnings = [...paramWarnings(scenario, params, deps.contextText), ...runNotes(params)];
  const dataSources = [...scenario.dataSources];
  const runId = await deps.onRun({ params, popScale, result, warnings, dataSources });

  if (!result.ok) {
    const detail = result.kind === "timeout" ? `${result.detail} Fewer agents or a shorter duration usually fixes this.` : result.detail;
    let message = `SIMULATION ERROR: ${detail}`;
    if (result.repairs.length > 0) message += `\nRepair log: ${JSON.stringify(result.repairs, null, 1)}`;
    return errorOutcome(message);
  }

  scenario.hasRun = true;
  scenario.reportCurrent = false; // the report, if any, no longer covers this run
  // Part 2, 5.7 and 7.7: the service corrected beta to the measured R0, or moved a lever to the participant's known outcome.
  const notes: Record<string, unknown> = {};
  if (result.stats.r0_calibration) notes.beta_calibrated_by_measurement = result.effective_params.disease.beta;
  if (result.stats.fit) {
    // the lever's last segment names the note, except the behaviour response's scale, which is the response (follow-up spec 6)
    const lever = result.stats.fit.lever === "behavior_response.scale" ? "behavior_response" : result.stats.fit.lever.split(".").pop();
    notes[`${lever}_fitted_to_${result.stats.fit.target}`] = result.stats.fit.value;
  }
  if (result.stats.behavior) notes.behavior_response_min_factor = result.stats.behavior.min_factor;          // 5.2: the strongest reduction reached
  const applied = Object.keys(notes).length > 0 ? notes : undefined;
  const agents = result.stats_agents;
  const n = agents.n_agents || params.run.n_agents || 1;
  // Agent counts: the scaled total over the real population is the same ratio.
  const attack_rate_pct = pyRound((agents.total_infected / n) * 100, 1);
  const pop_scale = pyRound(popScale, 2);
  const sources = dataSources.map((f) => ({ field: f.field, value: f.value, citation: f.citation }));
  // The per-replicate stats travel; the per-day bands wait for the workspace follow-up that draws them.
  const replicates = result.replicates ? { n: result.replicates.n, seeds: result.replicates.seeds, representative: result.replicates.representative, stats: result.replicates.stats } : undefined;
  const diagnostics = result.diagnostics ?? [];
  const compare = previous ? compareRuns(previous, result, popScale) : null;
  const payload: RunPayload = {
    kind: "run",
    run_id: runId,
    stats: result.stats,
    stats_agents: agents,
    attack_rate_pct,
    pop_scale,
    population: result.population,
    effective_params: result.effective_params,
    warnings,
    repairs: result.repairs,
    data_sources: dataSources,
    duration_ms: result.duration_ms,
    cold_start: result.cold_start,
    series: result.series,
    diagnostics,
    compare,
    ...(applied ? { applied } : {}),
    ...(replicates ? { replicates } : {}),
  };
  return {
    content: JSON.stringify({
      stats: result.stats, attack_rate_pct, pop_scale, effective_params: result.effective_params,
      warnings, repairs: result.repairs, data_sources: sources, diagnostics, compare, ...(applied ? { applied } : {}), ...(replicates ? { replicates } : {}),
    }),
    payload,
  };
}
