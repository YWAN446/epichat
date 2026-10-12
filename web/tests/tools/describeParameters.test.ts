import { describe, expect, it } from "vitest";

import { configureSimulation } from "@/lib/tools/configureSimulation";
import { describeParameters, type DescribedParam } from "@/lib/tools/describeParameters";
import { fetchDemographics } from "@/lib/tools/fetchDemographics";
import { valueSources } from "@/lib/tools/sources";
import { emptyScenario } from "@/lib/tools/types";
import { makeDeps, params, rf } from "./helpers";

type Body = { note: string; model: string; disease: string | null; interventions: string[]; parameters: DescribedParam[] };
const configure = (deps: ReturnType<typeof makeDeps>, input: Record<string, unknown>) => configureSimulation(input as never, deps);
const describe_ = async (deps: ReturnType<typeof makeDeps>, input: Record<string, unknown> = {}): Promise<Body> => JSON.parse((await describeParameters(input as never, deps)).content);
const byPath = (body: Body) => Object.fromEntries(body.parameters.map((p) => [p.path, p]));

describe("describe_parameters", () => {
  it("lists the sir defaults and says no scenario exists", async () => {
    const body = await describe_(makeDeps());
    expect(body.note).toMatch(/^No scenario is configured yet/);
    expect(body.note).toContain("configure_simulation's own fields");
    expect(body.model).toBe("sir");
    const p = byPath(body);
    expect(p["disease.dur_exp.mean_days"]).toBeUndefined();
    expect(p["run.n_agents"]).toMatchObject({ label: "Agents", current: 10000, source: null, tier: "core", bounds: [10, 1000000], db_range: null, affects: ["stochasticity"] });
    expect(p["disease.dur_inf.dist"]).toMatchObject({ current: "constant", choices: ["constant", "lognormal", "gamma"], requires: ["disease.dur_inf.sd_days"] });
    expect(p["interventions[].coverage"]).toBeUndefined();
    expect(body.interventions).toEqual([]);
    expect(body.parameters.map((x) => x.path)).toEqual(body.parameters.map((x) => x.path).filter((x) => !x.startsWith("interventions")));
  });

  it("attributes each value to the user, the database, a default or an illustrative spread", async () => {
    const deps = makeDeps();
    await configure(deps, { disease: "measles", r0: 15, dur_inf_days: 8, n_agents: 50000, treatment_capacity: 20 });
    const body = await describe_(deps);
    expect(body.note).toMatch(/^Parameters of the current sir scenario \(measles\)/);
    expect(body.disease).toBe("measles");
    expect(body.interventions).toEqual(["treatment"]);
    const p = byPath(body);
    expect(p["disease.beta"].source).toBe("database"); // R0 15 is the measles consensus
    expect(p["disease.dur_inf.mean_days"]).toMatchObject({ current: 8, source: "database", db_range: { min: 8, max: 8, typical: 8, unit: "days" } });
    expect(p["disease.dur_inf.sd_days"]).toMatchObject({ current: 2.4, source: "illustrative" });
    expect(p["disease.dur_inf.dist"]).toMatchObject({ current: "gamma", source: "illustrative" });
    expect(p["run.n_agents"].source).toBe("user");
    expect(p["run.sim_dur_years"].source).toBe("default");
    expect(p["disease.p_death"]).toMatchObject({ current: 0, source: "default" });
    expect(p["disease.p_death"].db_range).toMatchObject({ unit: "fraction" });
    expect(p["disease.p_death"].db_range?.min).toBeCloseTo(0.005, 9);
    expect(p["disease.p_death"].db_range?.max).toBeCloseTo(0.06, 9);
    expect(p["disease.p_death"].db_range?.typical).toBeCloseTo(0.015, 9);
    await configure(deps, { r0: 12, advanced: { "disease.dur_inf.sd_days": 1 } });
    const again = byPath(await describe_(deps));
    expect(again["disease.beta"].source).toBe("user");
    expect(again["disease.dur_inf.sd_days"].source).toBe("user");
    expect(again["disease.dur_inf.dist"].source).toBe("user");
  });

  it("marks fetched values as fetch until the user changes them, and filters by module and tier", async () => {
    const kenya = [
      rf("age_distribution_pct", { "0-17": 38.6, "18-64": 57.6, "65+": 3.8 }, "UN WPP"),
      rf("total_population", 55_000_000, "UN WPP"),
      rf("birth_rate", 27.3, "UN WPP"),
      rf("death_rate", 7.2, "UN WPP"),
    ];
    const deps = makeDeps({ unWpp: kenya });
    await configure(deps, { disease: "measles", r0: 15, dur_inf_days: 8 });
    await fetchDemographics({ country_iso3: "KEN" }, deps);
    let p = byPath(await describe_(deps, { module: "demographics" }));
    expect(p["demographics.birth_rate"]).toMatchObject({ current: 27.3, source: "fetch" });
    expect(p["demographics.use_demographics"].source).toBe("fetch");
    expect(p["demographics.age_pct_under18"]).toMatchObject({ current: 38.6, source: "fetch" });
    expect(p["demographics.country"]).toMatchObject({ current: "KEN", source: "user" });
    expect(p["disease.beta"]).toBeUndefined();
    expect(byPath(await describe_(deps, { module: "network" }))["network.network_type"]).toMatchObject({ current: "age_structured", source: "fetch" });
    await configure(deps, { advanced: { "demographics.birth_rate": 30 } });
    p = byPath(await describe_(deps));
    expect(p["demographics.birth_rate"].source).toBe("user");
    expect(p["demographics.death_rate"].source).toBe("fetch");
    expect(Object.keys(byPath(await describe_(deps, { tier: "expert" })))).toEqual(["demographics.auto_demographics", "demographics.demographics_year", "demographics.demographics_source", "run.rand_seed"]);
    expect((await describe_(deps, { module: "interventions" })).parameters).toEqual([]);
  });

  it("handles a migrated v1 scenario with an unknown disease", async () => {
    const deps = makeDeps({ scenario: { ...emptyScenario(), params: params({ disease_type: "seir", dur_exp: 5, dur_inf: 7, beta: 50, n_agents: 2000 }), disease: "mystery pox" } });
    const body = await describe_(deps);
    expect(body.disease).toBe("mystery pox");
    expect(body.model).toBe("seir");
    const p = byPath(body);
    expect(p["disease.dur_exp.mean_days"]).toMatchObject({ current: 5, source: "user", db_range: null });
    expect(p["disease.dur_exp.dist"]).toMatchObject({ current: "constant", source: "default" });
    expect(p["disease.beta"]).toMatchObject({ current: 50, source: "user", db_range: null });
    expect(p["run.n_agents"].source).toBe("user");
    expect(p["run.rand_seed"]).toMatchObject({ current: null, source: "default" });
    expect(body.parameters.every((x) => x.db_range === null)).toBe(true);
  });

  it("carries a small parameters payload for the card and the activity line", async () => {
    const deps = makeDeps();
    await configure(deps, { disease: "measles", model: "seir", dur_exp_days: 11 });
    const out = await describeParameters({} as never, deps);
    const body = JSON.parse(out.content) as Body;
    expect(out.payload).toEqual({ kind: "parameters", model: "seir", disease: "measles", count: body.parameters.length });
    expect((await describeParameters({ tier: "expert" } as never, makeDeps())).payload).toMatchObject({ kind: "parameters", model: "sir", disease: null, count: 4 });
  });

  it("valueSources covers every set path", () => {
    const p = params({ disease_type: "sirs", dur_immune: 200, dur_inf: 10 });
    const sources = valueSources(p, { ...emptyScenario(), params: p }, null);
    expect(sources["disease.dur_immune.mean_days"]).toBe("user");
    expect(sources["disease.sis_waning"]).toBe("default");
    expect(sources["demographics.country"]).toBe("default");
    expect(sources["disease.initial_immune_frac"]).toBe("default");
    expect(sources["disease.beta"]).toBe("default");
    expect(sources["disease.dur_exp.mean_days"]).toBeUndefined();
  });
});
