import { z } from "zod";
import type { PreviousRun } from "@/lib/db/runs";
import { detectDisease } from "@/lib/disease/db";
import type { SimResult, SimSuccess } from "@/lib/sim/client";
import type { SimParams } from "@/lib/sim/params";
import { changedPaths } from "@/lib/sim/paths";
import { pyRound } from "@/lib/sim/pyformat";
import { recommendSolver } from "@/lib/sim/solver";
import { capacityAgents, leverToPeople, popScaleFor, scalingPopulation, toAgentUnits, toPeopleUnits } from "@/lib/sim/units";
import { commaInt } from "@/lib/sim/pyformat";
import { mergeBands } from "@/lib/sim/bands";
import { errorOutcome, paramWarnings, runNotes } from "./shared";
import { scenarioReferences, scenarioSources } from "./sources";
import type { RunCompare, RunPayload, ToolDeps, ToolOutcome } from "./types";

export const RunSimulationInput = z.strictObject({});
export type RunSimulationArgs = z.infer<typeof RunSimulationInput>;

type Obj = Record<string, unknown>;
/** sim/main.py caps the request's disease name; a longer one would fail every run. */
const DISEASE_NAME_MAX = 80;

/**
 * Spec 11: what changed since the previous run, by path, and the difference in the headline numbers at today's population.
 * Round-1 spec 2: the previous run's counts are taken as shares of its own agents and multiplied by today's population, so
 * neither a change of n_agents nor a population fetched between the runs shows up as millions of extra infections.
 */
export function compareRuns(previous: PreviousRun, result: SimSuccess, popScale: number): RunCompare {
  const prevN = previous.statsAgents.n_agents || previous.effectiveParams.run.n_agents;
  const curN = result.stats_agents.n_agents || result.effective_params.run.n_agents;
  const before = (key: keyof RunCompare["stats_delta"]) => (key === "peak_day" ? previous.statsAgents.peak_day : Math.round((previous.statsAgents[key] * popScale * curN) / prevN));
  const delta = (key: keyof RunCompare["stats_delta"]) => result.stats[key] - before(key);
  return {
    previous_run_id: previous.id,
    changed: changedPaths(previous.effectiveParams as unknown as Obj, result.effective_params as unknown as Obj),
    stats_delta: { peak_infections: delta("peak_infections"), peak_day: delta("peak_day"), total_infected: delta("total_infected"), total_deaths: delta("total_deaths") },
    pop_scale: { from: pyRound(previous.popScale, 2), to: pyRound(popScale, 2) },
  };
}

/** Round-1 spec 3: the service answers in agents; its effective parameters and its levers' seeds, capacities and peak fits come back in people. */
function inPeople(result: SimResult, popScale: number): SimResult {
  if (!result.ok) return result;
  let effective = result.effective_params;
  try {
    effective = toPeopleUnits(result.effective_params, popScale);
  } catch (error) {
    console.error("effective params kept in agents", error);
  }
  const mode = result.effective_params.disease.seed.mode;
  const diagnostics = result.diagnostics?.map((d) => ({ ...d, levers: d.levers.map((l) => ({ ...l, patch: leverToPeople(l.patch, popScale, mode), current: leverToPeople(l.current, popScale, mode) })) }));
  // round-1 spec 5: the replicate bands are stored with the series the chart reads
  const series = mergeBands(result.series, result.replicates?.bands);
  return { ...result, series, effective_params: effective, ...(diagnostics ? { diagnostics } : {}) };
}

/** What a count in people became at this run's scale, when that is not what was asked (round-1 spec 3). */
export function countNotes(params: SimParams, popScale: number): string[] {
  const notes: string[] = [];
  const seed = params.disease.seed;
  if (seed.mode === "count" && seed.value < popScale) {
    notes.push(`${commaInt(seed.value)} initial cases is less than one agent at this run size; the run seeds 1 agent, about ${commaInt(Math.round(popScale))} people. More agents give a smaller seed.`);
  }
  for (const i of params.interventions) {
    if (i.type !== "treatment" || i.capacity === null) continue;
    const agents = capacityAgents(i.capacity, popScale);
    const people = commaInt(Math.round(agents * popScale));
    if (i.capacity < popScale) notes.push(`Treatment capacity ${commaInt(i.capacity)} people a day is below one agent a day at this run size; it runs as 1 agent a day, about ${people} people a day.`);
    else if (Math.round(agents * popScale) !== i.capacity) notes.push(`Treatment capacity ${commaInt(i.capacity)} people a day runs as ${commaInt(agents)} agents a day, about ${people} people a day.`);
  }
  return notes;
}

/** Ported from epichat/agent.py run_simulation; the executor is the simulation service, which also answers the diagnostics of spec 10. */
export async function runSimulation(_input: RunSimulationArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome("Call configure_simulation first to establish the simulation before running.");
  // The first run records its mode (spec 2026-11-20): running with the recommendation on screen accepts it, so a later change never
  // switches the mode silently
  // round-1 spec 3: the people the scenario holds are agents for the service and the solver rule
  const popScale = popScaleFor(scalingPopulation(scenario), scenario.params.run.n_agents);
  if (scenario.params.run.solver === null) scenario.params = { ...scenario.params, run: { ...scenario.params.run, solver: recommendSolver(toAgentUnits(scenario.params, popScale)).recommended } };
  const params = scenario.params;
  const disease = (scenario.disease ?? detectDisease(deps.contextText || ""))?.slice(0, DISEASE_NAME_MAX) ?? null;
  // Read before this run is inserted, so it is never its own previous run; the first run has none to read.
  const previous = scenario.hasRun ? await deps.previousRun() : null;
  const result = inPeople(await deps.sim.simulate(toAgentUnits(params, popScale), popScale, deps.contextText, disease), popScale);
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
  // Part 2, 7.7: the service moved a lever to the participant's known outcome.
  const notes: Record<string, unknown> = {};
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
  const run_size = { agents: n, people_per_agent: pop_scale, population: result.population };
  const count_notes = countNotes(params, popScale);
  const band_shown = (result.replicates?.n ?? 0) > 1;
  const sources = dataSources.map((f) => ({ field: f.field, value: f.value, citation: f.citation }));
  // The per-replicate stats travel; the bands went into the series the chart draws (round-1 spec 5). An ODE run has none.
  const replicates = result.replicates ? { n: result.replicates.n, seeds: result.replicates.seeds, representative: result.replicates.representative, stats: result.replicates.stats } : undefined;
  const diagnostics = result.diagnostics ?? [];
  const compare = previous ? compareRuns(previous, result, popScale) : null;
  // Follow-up spec 8.4, as reviewed: the panel shows the run's effective values after a run, so a value the run changed from what
  // was configured (a fitted lever, demographics the service filled, a repair) is tagged as the run's, and
  // every other value keeps the source of what was configured.
  const valueTags = scenarioSources(deps.scenario, deps.contextText);
  if (deps.scenario.params) {
    for (const change of changedPaths(deps.scenario.params as unknown as Record<string, unknown>, result.effective_params as unknown as Record<string, unknown>)) valueTags[change.path] = "run";
  }
  // a chosen reference's note goes with its tag: not for a path the run then changed
  const stillReferenced = Object.entries(scenarioReferences(deps.scenario) ?? {}).filter(([path]) => valueTags[path] === "reference");
  const runReferences = stillReferenced.length > 0 ? Object.fromEntries(stillReferenced) : undefined;
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
    sources: valueTags,
    ...(runReferences ? { references: runReferences } : {}),
  };
  return {
    content: JSON.stringify({
      stats: result.stats, attack_rate_pct, pop_scale, run_size, count_notes, band_shown, effective_params: result.effective_params,
      warnings, repairs: result.repairs, data_sources: sources, diagnostics, compare, ...(applied ? { applied } : {}), ...(replicates ? { replicates } : {}),
    }),
    payload,
  };
}
