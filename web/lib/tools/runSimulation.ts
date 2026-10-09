import { z } from "zod";
import { pyRound } from "@/lib/sim/pyformat";
import { errorOutcome, paramWarnings } from "./shared";
import type { RunPayload, ToolDeps, ToolOutcome } from "./types";

export const RunSimulationInput = z.strictObject({});
export type RunSimulationArgs = z.infer<typeof RunSimulationInput>;

/** Ported from epichat/agent.py run_simulation; the executor is the simulation service. */
export async function runSimulation(_input: RunSimulationArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome("Call configure_simulation first to establish the simulation before running.");
  const params = scenario.params;
  const popScale = scenario.totalPopulation && params.n_agents > 0 ? scenario.totalPopulation / params.n_agents : 1.0;
  const result = await deps.sim.simulate(params, popScale, deps.contextText);
  const warnings = paramWarnings(scenario, params, deps.contextText);
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
  const n = agents.n_agents || params.n_agents || 1;
  // Agent counts: the scaled total over the real population is the same ratio.
  const attack_rate_pct = pyRound((agents.total_infected / n) * 100, 1);
  const pop_scale = pyRound(popScale, 2);
  const sources = dataSources.map((f) => ({ field: f.field, value: f.value, citation: f.citation }));
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
  };
  return {
    content: JSON.stringify({
      stats: result.stats, attack_rate_pct, pop_scale, effective_params: result.effective_params,
      warnings, repairs: result.repairs, data_sources: sources,
    }),
    payload,
  };
}
