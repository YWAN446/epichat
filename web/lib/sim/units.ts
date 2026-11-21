/**
 * Round-1 spec 1 and 3: the web app holds three counts in people (the seed count, a treatment's capacity a day and a peak-size
 * fit target) and the simulation service takes agents. These functions pick the population every count is scaled to and convert
 * at the boundary: toAgentUnits on the way to the service and the solver rule, toPeopleUnits and leverToPeople on the way back.
 */
import { validateParams, type SimParams } from "@/lib/sim/params";
import type { Scenario } from "@/lib/tools/types";

/** The area's population when an area is set, otherwise the country's total, otherwise none. */
export function scalingPopulation(s: Pick<Scenario, "area" | "totalPopulation">): number | null {
  return s.area?.population ?? s.totalPopulation ?? null;
}

/** People per agent; 1 when there is no population to scale to. */
export function popScaleFor(population: number | null, nAgents: number): number {
  return population && population > 0 && nAgents > 0 ? population / nAgents : 1;
}

/** A count of people as agents: rounded, at least one, at most the run's agents. */
export function seedAgents(people: number, popScale: number, nAgents: number): number {
  return Math.min(nAgents, Math.max(1, Math.round(people / popScale)));
}

/** People treated a day as agents a day: rounded, at least one (the schema's capacity is a whole number of at least 1). */
export function capacityAgents(peoplePerDay: number, popScale: number): number {
  return Math.max(1, Math.round(peoplePerDay / popScale));
}

/** The agent-years a run costs the simulation service (sim/service.py agent_years). */
export function agentYears(p: SimParams): number {
  return p.run.n_agents * p.run.sim_dur_years * p.run.n_replicates;
}

function revalidated(body: SimParams): SimParams {
  const r = validateParams(body);
  if (!r.ok) throw new Error(`unit conversion produced invalid params: ${r.error}`);
  return r.params;
}

/** The parameters with the three counts in agents, for the simulation service and the solver rule. */
export function toAgentUnits(p: SimParams, popScale: number): SimParams {
  const n = p.run.n_agents;
  const body = structuredClone(p);
  if (body.disease.seed.mode === "count") body.disease.seed.value = seedAgents(body.disease.seed.value, popScale, n);
  body.interventions = body.interventions.map((i) => (i.type === "treatment" && i.capacity !== null ? { ...i, capacity: capacityAgents(i.capacity, popScale) } : i));
  if (body.run.fit && body.run.fit.target === "peak_infections") body.run.fit = { ...body.run.fit, value: seedAgents(body.run.fit.value, popScale, n) };
  return revalidated(body);
}

/** The service's effective parameters with the three counts back in people. */
export function toPeopleUnits(p: SimParams, popScale: number): SimParams {
  const people = (agents: number) => Math.max(1, Math.round(agents * popScale));
  const body = structuredClone(p);
  if (body.disease.seed.mode === "count") body.disease.seed.value = people(body.disease.seed.value);
  body.interventions = body.interventions.map((i) => (i.type === "treatment" && i.capacity !== null ? { ...i, capacity: people(i.capacity) } : i));
  if (body.run.fit && body.run.fit.target === "peak_infections") body.run.fit = { ...body.run.fit, value: people(body.run.fit.value) };
  return revalidated(body);
}

/**
 * A diagnostic lever's patch with its seed count, capacities and peak-fit value in people. A seed value is a count only when the
 * patch's own seed mode, or the run's (`seedMode`) when the patch has none, is "count"; a share stays a share.
 */
export function leverToPeople(patch: Record<string, unknown>, popScale: number, seedMode: "fraction" | "count" = "count"): Record<string, unknown> {
  const isCount = (path: string): boolean => {
    if (path.endsWith("seed.value")) return (patch[path.replace(/value$/, "mode")] ?? seedMode) === "count";
    return path.endsWith(".capacity") || path === "run.fit.value";
  };
  return Object.fromEntries(Object.entries(patch).map(([path, value]) => [path, isCount(path) && typeof value === "number" ? Math.round(value * popScale) : value]));
}
