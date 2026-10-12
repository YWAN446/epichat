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

/** Spec 11: what changed since the previous run, by path, and the difference in the headline numbers (population-scaled, like stats). */
export function compareRuns(previous: PreviousRun, result: SimSuccess): RunCompare {
  const delta = (key: keyof RunCompare["stats_delta"]) => result.stats[key] - previous.stats[key];
  return {
    previous_run_id: previous.id,
    changed: changedPaths(previous.effectiveParams as unknown as Obj, result.effective_params as unknown as Obj),
    stats_delta: { peak_infections: delta("peak_infections"), peak_day: delta("peak_day"), total_infected: delta("total_infected"), total_deaths: delta("total_deaths") },
  };
}

/** Ported from epichat/agent.py run_simulation; the executor is the simulation service, which also answers the diagnostics of spec 10. */
export async function runSimulation(_input: RunSimulationArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome("Call configure_simulation first to establish the simulation before running.");
  const params = scenario.params;
  const popScale = scenario.totalPopulation && params.run.n_agents > 0 ? scenario.totalPopulation / params.run.n_agents : 1.0;
  const disease = scenario.disease ?? detectDisease(deps.contextText || "");
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
  const agents = result.stats_agents;
  const n = agents.n_agents || params.run.n_agents || 1;
  // Agent counts: the scaled total over the real population is the same ratio.
  const attack_rate_pct = pyRound((agents.total_infected / n) * 100, 1);
  const pop_scale = pyRound(popScale, 2);
  const sources = dataSources.map((f) => ({ field: f.field, value: f.value, citation: f.citation }));
  // The per-replicate stats travel; the per-day bands wait for the workspace follow-up that draws them.
  const replicates = result.replicates ? { n: result.replicates.n, seeds: result.replicates.seeds, representative: result.replicates.representative, stats: result.replicates.stats } : undefined;
  const diagnostics = result.diagnostics ?? [];
  const compare = previous ? compareRuns(previous, result) : null;
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
    ...(replicates ? { replicates } : {}),
  };
  return {
    content: JSON.stringify({
      stats: result.stats, attack_rate_pct, pop_scale, effective_params: result.effective_params,
      warnings, repairs: result.repairs, data_sources: sources, diagnostics, compare, ...(replicates ? { replicates } : {}),
    }),
    payload,
  };
}
