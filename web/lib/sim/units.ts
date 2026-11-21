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

/** People treated a day as agents a day: floored so the run treats at most the people asked, and at least one (the schema's capacity is a whole number of at least 1). */
export function capacityAgents(peoplePerDay: number, popScale: number): number {
  return Math.max(1, Math.floor(peoplePerDay / popScale));
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

/**
 * The service's effective parameters with the three counts back in people. With the configured parameters, a count that converts
 * to the same agents the run used keeps the people the user gave (final review 2-3), so a run does not restate "20 cases" as the
 * thousands one agent stands for, and a later comparison or fit sees the value it was given; a count the service changed comes
 * back as its agents' people.
 */
export function toPeopleUnits(p: SimParams, popScale: number, configured?: SimParams): SimParams {
  const people = (agents: number) => Math.max(1, Math.round(agents * popScale));
  const n = p.run.n_agents;
  const body = structuredClone(p);
  const seed = configured?.disease.seed;
  if (body.disease.seed.mode === "count") {
    const agents = body.disease.seed.value;
    body.disease.seed.value = seed?.mode === "count" && seedAgents(seed.value, popScale, n) === agents ? seed.value : people(agents);
  }
  body.interventions = body.interventions.map((i, k) => {
    if (i.type !== "treatment" || i.capacity === null) return i;
    const given = configured?.interventions[k];
    const kept = given?.type === "treatment" && given.capacity !== null && capacityAgents(given.capacity, popScale) === i.capacity ? given.capacity : null;
    return { ...i, capacity: kept ?? people(i.capacity) };
  });
  const fit = configured?.run.fit;
  if (body.run.fit && body.run.fit.target === "peak_infections") {
    const agents = body.run.fit.value;
    body.run.fit = { ...body.run.fit, value: fit?.target === "peak_infections" && seedAgents(fit.value, popScale, n) === agents ? fit.value : people(agents) };
  }
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
