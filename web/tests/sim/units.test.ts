import { describe, expect, it } from "vitest";
import { validateParams, type SimParams } from "@/lib/sim/params";
import { leverToPeople, popScaleFor, scalingPopulation, seedAgents, toAgentUnits, toPeopleUnits } from "@/lib/sim/units";
import type { Area } from "@/lib/tools/types";

function v2(body: Record<string, unknown>): SimParams {
  const r = validateParams({ schema_version: 2, ...body });
  if (!r.ok) throw new Error(r.error);
  return r.params;
}

const AREA: Area = { name: "Example County", population: 2_000_000, countryIso3: "KEN", source: { kind: "user" } };

describe("scalingPopulation", () => {
  it("prefers the area", () => {
    expect(scalingPopulation({ area: AREA, totalPopulation: 55_000_000 })).toBe(2_000_000);
    expect(scalingPopulation({ area: null, totalPopulation: 55_000_000 })).toBe(55_000_000);
    expect(scalingPopulation({ area: null, totalPopulation: null })).toBeNull();
  });
});

describe("popScaleFor", () => {
  it("is people per agent, or 1 without a population", () => {
    expect(popScaleFor(2_000_000, 10_000)).toBe(200);
    expect(popScaleFor(null, 10_000)).toBe(1);
  });
});

describe("seedAgents", () => {
  it("rounds and never drops below one", () => {
    expect(seedAgents(20, 200, 10_000)).toBe(1);
    expect(seedAgents(1_000, 200, 10_000)).toBe(5);
    expect(seedAgents(5_000_000, 200, 10_000)).toBe(10_000);
  });
});

describe("toAgentUnits", () => {
  it("converts only the three counts", () => {
    const p = v2({
      disease: { model: "sir", seed: { mode: "count", value: 1000, day: 0 } },
      interventions: [{ type: "treatment", capacity: 300 }],
      run: { n_agents: 10_000, fit: { target: "peak_infections", value: 20_000 } },
    });
    const a = toAgentUnits(p, 200);
    expect(a.disease.seed.value).toBe(5);
    expect(a.interventions[0].capacity).toBe(2);
    expect(a.run.fit?.value).toBe(100);
    expect(a.run.n_agents).toBe(10_000);
    expect(p.disease.seed.value).toBe(1000); // a new object; the input is untouched

    const other = v2({ disease: { model: "sir", seed: { mode: "fraction", value: 0.001, day: 0 } }, run: { n_agents: 10_000, fit: { target: "attack_rate", value: 0.4 } } });
    const b = toAgentUnits(other, 200);
    expect(b.disease.seed).toEqual(other.disease.seed);
    expect(b.run.fit).toEqual(other.run.fit);
  });
});

describe("toPeopleUnits", () => {
  it("inverts toAgentUnits for exact multiples", () => {
    const agents = v2({ disease: { model: "sir", seed: { mode: "count", value: 5, day: 0 } }, run: { n_agents: 10_000 } });
    expect(toPeopleUnits(agents, 200).disease.seed.value).toBe(1000);
  });
});

describe("leverToPeople", () => {
  it("scales seed, capacity and peak-fit values only", () => {
    expect(leverToPeople({ "disease.seed.value": 5, "run.sim_dur_years": 2 }, 200)).toEqual({ "disease.seed.value": 1000, "run.sim_dur_years": 2 });
  });

  it("leaves a seed given as a share alone", () => {
    const share = { "disease.seed.mode": "fraction", "disease.seed.value": 0.0005 };
    expect(leverToPeople(share, 200)).toEqual(share);
    expect(leverToPeople({ "disease.seed.value": 0.0005 }, 200, "fraction")).toEqual({ "disease.seed.value": 0.0005 });
    expect(leverToPeople({ "disease.seed.mode": "count", "disease.seed.value": 25 }, 200, "fraction")).toEqual({ "disease.seed.mode": "count", "disease.seed.value": 5000 });
  });
});
