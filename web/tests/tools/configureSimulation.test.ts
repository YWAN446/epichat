import { describe, expect, it } from "vitest";

import { approxR0, getVaccine, type SimParams } from "@/lib/sim/params";
import { configureSimulation } from "@/lib/tools/configureSimulation";
import type { PreviousRun } from "@/lib/db/runs";
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
    const out = JSON.parse((await run(deps, { disease: "measles", disease_type: "sir", r0: 15, dur_inf_days: 8 })).content);
    expect(out.approx_r0).toBe(15);
    // exact formula on a gamma 8-day infectious period (measles 8–8 gives sd 2.4): D_eff 7.5
    expect(deps.scenario.params?.disease.beta).toBeCloseTo(-365 * Math.log(1 - 15 / (4 * 7.5)), 5);
    expect(out.applied.r0).toBe(15);
  });

  it("produces literature warnings for out-of-range values", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "measles", r0: 25, dur_inf_days: 8 })).content); // 25 is outside 12–18 and within reach (max 30)
    expect(out.warnings.some((w: string) => w.includes("literature"))).toBe(true);
  });

  it("falls back to the conversation text for the disease the warnings use", async () => {
    const deps = makeDeps({ contextText: "please model whooping cough in Kenya" });
    const out = JSON.parse((await run(deps, { r0: 25, dur_inf_days: 8 })).content);
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
    const out = await run(deps, { disease: "measles", r0: 15, dur_inf_days: 8, vaccine_coverage: 0.8 });
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
    const out = await run(deps, { disease: "dengue", dur_inf_days: 2, r0: 10 });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/^CONFIG ERROR: R0 10 is not reachable: the most the contacts and infectious period can carry is \d+\.\d\d; raise network\.n_contacts or disease\.dur_inf\.mean_days\./);
    expect(deps.scenario.params).toBeNull();
  });

  it("keeps a constant duration constant when its mean changes, and seeds by fraction", async () => {
    const deps = makeDeps({ scenario: { ...emptyScenario(), params: params({ dur_inf: 10 }) } });
    await run(deps, { dur_inf_days: 12, seed_fraction: 0.02 });
    expect(deps.scenario.params?.disease.dur_inf).toEqual({ mean_days: 12, dist: "constant", sd_days: null });
    expect(deps.scenario.params?.disease.seed).toEqual({ mode: "fraction", value: 0.02, day: 0 });
  });
});

describe("configure_simulation: the spec's field names, advanced and changed", () => {
  it("accepts model and its alias disease_type, and the _days duration fields", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "measles", model: "seir", dur_exp_days: 11, dur_inf_days: 8 })).content);
    expect(deps.scenario.params?.disease.model).toBe("seir");
    expect(deps.scenario.params?.disease.dur_exp).toEqual({ mean_days: 11, dist: "gamma", sd_days: 3.5 }); // measles incubation 7–21: (21 − 7) / 4
    expect(out.applied).toEqual({ disease: "measles", model: "seir", dur_exp_days: 11, dur_inf_days: 8 });
    await run(deps, { disease_type: "sir" });
    expect(deps.scenario.params?.disease.model).toBe("sir");
    const fresh = makeDeps();
    await run(fresh, { disease: "measles" });
    const switched = JSON.parse((await run(fresh, { model: "seir", dur_exp_days: 11 })).content);
    expect(switched.changed).toEqual(expect.arrayContaining([{ path: "disease.model", from: "sir", to: "seir" }, { path: "disease.dur_exp.mean_days", from: null, to: 11 }]));
    expect(switched.changed.some((c: { path: string }) => c.path === "disease.dur_exp")).toBe(false); // the latent period's creation is its leaves, not a null-to-null ghost
  });

  it("seeds by count or by fraction, never both, keeping the seeding day", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", seed_count: 20 });
    expect(deps.scenario.params?.disease.seed).toEqual({ mode: "count", value: 20, day: 0 });
    await run(deps, { advanced: { "disease.seed.day": 5 } });
    await run(deps, { seed_fraction: 0.02 });
    expect(deps.scenario.params?.disease.seed).toEqual({ mode: "fraction", value: 0.02, day: 5 });
    const both = await run(deps, { seed_fraction: 0.02, seed_count: 5 });
    expect(both.content).toBe("CONFIG ERROR: seed_fraction and seed_count are mutually exclusive; pass one of them.");
    expect(both.isError).toBe(true);
  });

  it("applies a multi-path advanced patch with the core fields, validates once, and reports changed", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", n_agents: 50000 });
    const out = JSON.parse((await run(deps, { n_agents: 100000, advanced: { "disease.dur_inf.dist": "lognormal", "disease.dur_inf.sd_days": 2, "run.n_replicates": 3 } })).content);
    expect(deps.scenario.params?.disease.dur_inf).toEqual({ mean_days: 10, dist: "lognormal", sd_days: 2 });
    expect(deps.scenario.params?.run.n_replicates).toBe(3);
    expect(out.applied).toEqual({ n_agents: 100000, "disease.dur_inf.dist": "lognormal", "disease.dur_inf.sd_days": 2, "run.n_replicates": 3 }); // the patch's paths, flat, so the chat line reads them
    expect(out.changed).toEqual(expect.arrayContaining([
      { path: "run.n_agents", from: 50000, to: 100000 },
      { path: "disease.dur_inf.dist", from: "gamma", to: "lognormal" },
      { path: "disease.dur_inf.sd_days", from: 3, to: 2 },
      { path: "run.n_replicates", from: 1, to: 3 },
    ]));
    expect(out.changed).toHaveLength(4);
    await run(deps, { dur_inf_days: 8, advanced: { "disease.dur_inf.sd_days": 1 } }); // the patch wins over the field it overlaps
    expect(deps.scenario.params?.disease.dur_inf).toEqual({ mean_days: 8, dist: "lognormal", sd_days: 1 });
  });

  it("reports no changes on a fresh scenario and carries changed on the payload", async () => {
    const deps = makeDeps();
    const out = await run(deps, { disease: "measles" });
    expect(JSON.parse(out.content).changed).toEqual([]);
    expect(out.payload).toMatchObject({ kind: "config", changed: [] });
    const next = await run(deps, { sim_dur_years: 2 });
    expect(JSON.parse(next.content).changed).toEqual([{ path: "run.sim_dur_years", from: 1, to: 2 }]);
  });

  it("refuses an advanced patch that names the wrong path, model, kind, bound or partner, and leaves the scenario alone", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles" });
    const before = deps.scenario.params;
    const cases: [Record<string, unknown>, string][] = [
      [{ "disease.nope": 1 }, 'CONFIG ERROR: unknown parameter path "disease.nope"; call describe_parameters for the list'],
      [{ "disease.p_asymp": 0.2 }, "CONFIG ERROR: disease.p_asymp does not apply to the sir model (it applies to seiar)"],
      [{ "run.n_replicates": 2.5 }, "CONFIG ERROR: run.n_replicates must be a whole number"],
      [{ "run.n_replicates": "5" }, "CONFIG ERROR: run.n_replicates must be a whole number"],
      [{ "run.n_replicates": 9 }, "CONFIG ERROR: run.n_replicates must be between 1 and 5"],
      [{ "disease.dur_inf.mean_days": 5000 }, "CONFIG ERROR: disease.dur_inf.mean_days must be between 0.5 and 365 days"],
      [{ "disease.dur_inf.dist": "normal" }, "CONFIG ERROR: disease.dur_inf.dist must be one of constant, lognormal, gamma"],
      [{ "demographics.use_demographics": "yes" }, "CONFIG ERROR: demographics.use_demographics must be true or false"],
      [{ "interventions[].coverage": 0.5 }, "CONFIG ERROR: interventions[].coverage is set through configure_simulation's interventions field, not through advanced"],
      [{ "disease.dur_inf.mean_days": null }, "CONFIG ERROR: disease.dur_inf.mean_days cannot be unset"],
      [{ "run.n_agents": 20000, "disease.seed.mode": "count", "disease.seed.value": 50000 }, "schema"],
    ];
    for (const [advanced, message] of cases) {
      const out = await run(deps, { advanced });
      expect(out.isError).toBe(true);
      if (message === "schema") expect(out.content).toMatch(/^CONFIG ERROR: 1 validation error for SimParams\n[\s\S]*must not exceed run\.n_agents \(20000\)/);
      else expect(out.content).toBe(message);
    }
    expect(deps.scenario.params).toBe(before);
  });

  it("needs the requires partner in the same call unless it is already set", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles" });
    await run(deps, { advanced: { "disease.dur_inf.dist": "constant", "disease.dur_inf.sd_days": null } });
    expect(deps.scenario.params?.disease.dur_inf).toEqual({ mean_days: 10, dist: "constant", sd_days: null });
    const missing = await run(deps, { advanced: { "disease.dur_inf.dist": "gamma" } });
    expect(missing.content).toBe("CONFIG ERROR: disease.dur_inf.dist needs disease.dur_inf.sd_days in the same call");
    const together = await run(deps, { advanced: { "disease.dur_inf.dist": "gamma", "disease.dur_inf.sd_days": 2 } });
    expect(together.isError).toBeUndefined();
    const kept = await run(deps, { advanced: { "disease.dur_inf.dist": "lognormal" } }); // the sd is already set
    expect(kept.isError).toBeUndefined();
    expect(deps.scenario.params?.disease.dur_inf).toEqual({ mean_days: 10, dist: "lognormal", sd_days: 2 });
  });

  it("says when the clamped beta carries less R0 than asked", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "dengue", dur_inf_days: 2, r0: 5.99 })).content); // the most 4 contacts × 1.5 days carry is 6: beta 2335 clamps to 1000
    expect(deps.scenario.params?.disease.beta).toBe(1000);
    expect(out.approx_r0).toBeLessThan(5.7);
    expect(out.warnings.some((w: string) => w.startsWith("beta was clamped at 1000"))).toBe(true);
    const fine = JSON.parse((await run(deps, { r0: 3 })).content);
    expect(fine.warnings.some((w: string) => w.includes("clamped"))).toBe(false);
  });
});

describe("configure_simulation records a taken option", () => {
  const lever = { patch: { "disease.dur_inf.dist": "gamma", "disease.dur_inf.sd_days": 2.4 }, current: {}, direction: "change" as const, rationale: "r", basis: "rule" as const };
  const previous = () => ({
    id: "run-3", effectiveParams: params({}), stats: { peak_infections: 1, peak_day: 1, total_infected: 1, total_deaths: 0, n_agents: 10000, sim_days: 366 },
    statsAgents: { peak_infections: 1, peak_day: 1, total_infected: 1, total_deaths: 0, n_agents: 10000, sim_days: 366 }, popScale: 1,
    diagnostics: [
      { id: "sharp_curve", severity: "info" as const, title: "t", evidence: {}, levers: [lever] },
      { id: "unfinished", severity: "warning" as const, title: "u", evidence: {}, levers: [{ ...lever, patch: { "run.sim_dur_years": 2 } }] },
    ],
  });

  it("matches a lever on every path of its patch, once per diagnostic", async () => {
    const deps = makeDeps({ previousRun: previous() });
    await run(deps, { disease: "measles", advanced: { "disease.dur_inf.dist": "constant", "disease.dur_inf.sd_days": null } });
    deps.scenario.hasRun = true;
    await run(deps, { advanced: { "disease.dur_inf.dist": "gamma", "disease.dur_inf.sd_days": 2.4 }, sim_dur_years: 2 });
    expect(deps.options).toEqual([
      { runId: "run-3", diagnosticId: "sharp_curve", patch: lever.patch },
      { runId: "run-3", diagnosticId: "unfinished", patch: { "run.sim_dur_years": 2 } },
    ]);
    expect(deps.previousReads).toBe(1);
  });

  it("records nothing for a partial match, a failed patch, an unchanged call, or before any run", async () => {
    const deps = makeDeps({ previousRun: previous() });
    await run(deps, { disease: "measles", advanced: { "disease.dur_inf.dist": "constant", "disease.dur_inf.sd_days": null } });
    await run(deps, { advanced: { "disease.dur_inf.dist": "gamma", "disease.dur_inf.sd_days": 2.4 } }); // no run yet
    expect(deps.previousReads).toBe(0);
    deps.scenario.hasRun = true;
    await run(deps, { advanced: { "disease.dur_inf.dist": "lognormal", "disease.dur_inf.sd_days": 3 } }); // a different value
    const failed = await run(deps, { advanced: { "run.sim_dur_years": 2, "run.n_replicates": 9 } }); // out of bounds: nothing applied
    expect(failed.isError).toBe(true);
    await run(deps, { n_agents: 10000 }); // unchanged: nothing to match
    expect(deps.options).toEqual([]);
    expect(deps.previousReads).toBe(1);
  });

  it("matches a lever whose path already holds the suggested value, as long as one of its paths was applied now", async () => {
    const seiar = { patch: { "disease.model": "seiar", "disease.p_asymp": 0.3, "disease.dur_exp.mean_days": 2 }, current: {}, direction: "change" as const, rationale: "r", basis: "disease_db" as const };
    const seeds = { patch: { "disease.seed.mode": "count", "disease.seed.value": 10 }, current: {}, direction: "decrease" as const, rationale: "r", basis: "rule" as const };
    const prev = { ...previous(), diagnostics: [{ id: "fatality_on_all_infections", severity: "info" as const, title: "f", evidence: {}, levers: [seiar] }, { id: "instant_peak", severity: "warning" as const, title: "i", evidence: {}, levers: [seeds] }] };
    const deps = makeDeps({ previousRun: prev });
    await run(deps, { disease: "influenza", p_death: 0.001, seed_count: 300 }); // p_asymp is already the default 0.3; the seed is already a count
    deps.scenario.hasRun = true;
    await run(deps, { advanced: { "disease.model": "seiar", "disease.p_asymp": 0.3, "disease.dur_exp.mean_days": 2 } });
    await run(deps, { seed_count: 10 });
    expect(deps.options.map((o) => o.diagnosticId)).toEqual(["fatality_on_all_infections", "instant_peak"]);
    await run(deps, { n_agents: 20000 }); // every lever path already holds its value, but none was applied by this call
    expect(deps.options).toHaveLength(2);
  });
});

describe("configure_simulation and the fatality by age", () => {
  it("checks the fatality ratio against the literature as the population-weighted value", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "measles", r0: 15, dur_inf_days: 8, p_death: 0.001, advanced: { "disease.p_death_age.elderly": 0.5 } })).content);
    // default shares have no elderly: the weighted CFR is 0.1%, below the 0.5–6% range
    expect(out.warnings.some((w: string) => w.startsWith("Fatality rate 0.1%"))).toBe(true);
    const withElderly = JSON.parse((await run(deps, { advanced: { "demographics.age_pct_under18": 40, "demographics.age_pct_18_64": 50, "demographics.age_pct_over65": 10 } })).content);
    expect(withElderly.warnings.some((w: string) => w.startsWith("Fatality rate"))).toBe(false); // 0.9 × 0.1% + 0.1 × 50% = 5.09%
  });
});

describe("configure_simulation network fields (Part 2, 5.9)", () => {
  it("sets the network type and household size as fields and holds the confirmed R0 across the switch", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", r0: 3 });
    const before = deps.scenario.params!;
    const out = JSON.parse((await run(deps, { network_type: "hybrid", household_size: 4 })).content);
    const p = deps.scenario.params!;
    expect(p.network.network_type).toBe("hybrid");
    expect(p.network.household_size).toBe(4);
    expect(out.applied.network_type).toBe("hybrid");
    expect(out.applied.beta_recalibrated_to_hold_r0).toBe(3);
    expect(approxR0(p)).toBeCloseTo(3, 6);
    expect(p.disease.beta).not.toBe(before.disease.beta);
    const bad = await run(deps, { network_type: "cluster" });
    expect(bad.isError).toBe(true);
    expect(bad.content).toContain("network_type");
  });

  it("marks the ages as user shares when the advanced patch edits a share", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", advanced: { "demographics.age_source": "un_wpp", "demographics.age_pct_under18": 40, "demographics.age_pct_18_64": 50, "demographics.age_pct_over65": 10 } });
    expect(deps.scenario.params!.demographics.age_source).toBe("un_wpp");
    await run(deps, { advanced: { "demographics.age_pct_over65": 12, "demographics.age_pct_18_64": 48 } });
    expect(deps.scenario.params!.demographics.age_source).toBe("shares");
  });
});

describe("edited matrix cells and contact counts (review of 2B)", () => {
  it("marks an edited matrix as the user's and holds the R0, but a contact-count edit keeps beta", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", r0: 3, network_type: "age_structured" });
    const beta = deps.scenario.params!.disease.beta;
    const out = JSON.parse((await run(deps, { advanced: { "network.contacts.adults_adults": 12 } })).content);
    let p = deps.scenario.params!;
    expect(p.network.contacts_source).toBe("user");
    expect(p.network.contacts.adults_adults).toBe(12);
    expect(approxR0(p)).toBeCloseTo(3, 6);
    expect(out.applied.beta_recalibrated_to_hold_r0).toBe(3);
    expect(p.disease.beta).not.toBe(beta);
    await run(deps, { advanced: { "network.contacts.children_children": 8, "network.contacts_source": "prem_2021:KEN" } });
    expect(deps.scenario.params!.network.contacts_source).toBe("prem_2021:KEN");                    // an explicit source wins
    const random = makeDeps();
    await run(random, { disease: "measles", r0: 3 });
    const before = random.scenario.params!;
    const more = JSON.parse((await run(random, { advanced: { "network.n_contacts": 8 } })).content);
    p = random.scenario.params!;
    expect(p.disease.beta).toBe(before.disease.beta);                                                // twice the contacts: twice the R0, as in Part 1
    expect(approxR0(p)).toBeCloseTo(6, 6);
    expect(more.applied.beta_recalibrated_to_hold_r0).toBeUndefined();
  });
});

describe("configure_simulation interventions and fit (Part 2, 7.4, 7.7)", () => {
  it("upserts structured entries by type and layer, removes by type, and keeps the shortcut fields", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", network_type: "hybrid", interventions: [
      { type: "contact_reduction", layer: "school", scale: 0, start_day: 30, end_day: 72 }, { type: "transmission_reduction", scale: 0.3, start_day: 0, end_day: 90 },
      { type: "vaccine", kind: "campaign", coverage: 0.7, start_day: 10, end_day: 40, efficacy: 0.8 }] });
    let p = deps.scenario.params!;
    expect(p.interventions.map((i) => `${i.type}:${i.layer}`)).toEqual(["contact_reduction:school", "transmission_reduction:all", "vaccine:all"]);
    await run(deps, { interventions: [{ type: "contact_reduction", layer: "community", scale: 0.5 }, { type: "vaccine", kind: "campaign", coverage: 0.9, start_day: 10, end_day: 40, efficacy: 0.8 }] });
    p = deps.scenario.params!;
    expect(p.interventions.filter((i) => i.type === "contact_reduction").map((i) => i.layer)).toEqual(["school", "community"]);
    expect(p.interventions.find((i) => i.type === "vaccine")).toMatchObject({ coverage: 0.9, efficacy: 0.8, kind: "campaign" });
    const out = JSON.parse((await run(deps, { remove_interventions: ["transmission_reduction", "contact_reduction:school"], seasonality_scale: 0.2 })).content);
    p = deps.scenario.params!;
    expect(p.interventions.map((i) => `${i.type}:${i.layer}`)).toEqual(["contact_reduction:community", "vaccine:all", "seasonality:all"]);
    expect(out.applied.remove_interventions).toEqual(["transmission_reduction", "contact_reduction:school"]);
    expect(out.config.interventions).toEqual(["contact_reduction", "vaccine", "seasonality"]);
    const bad = await run(deps, { interventions: [{ type: "contact_reduction", layer: "roads", scale: 0.5 }] });
    expect(bad.isError).toBe(true);
    const random = makeDeps();
    const refused = await run(random, { disease: "measles", interventions: [{ type: "contact_reduction", layer: "school", scale: 0 }] });
    expect(refused.content).toContain("layer school needs the hybrid network");
  });

  it("sets and clears the fit, converting a peak size in people to agents when a population is known", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", n_agents: 10000, fit: { target: "attack_rate", value: 0.3 } });
    expect(deps.scenario.params!.run.fit).toEqual({ target: "attack_rate", value: 0.3, lever: "disease.beta" });
    deps.scenario.totalPopulation = 1_000_000;
    const out = JSON.parse((await run(deps, { fit: { target: "peak_infections", value: 50000 } })).content);
    expect(deps.scenario.params!.run.fit).toEqual({ target: "peak_infections", value: 500, lever: "disease.beta" });
    expect(out.applied.fit).toEqual({ target: "peak_infections", value: 50000, value_in_agents: 500 });
    await run(deps, { fit: null });
    expect(deps.scenario.params!.run.fit).toBeNull();
    const bad = await run(deps, { fit: { target: "attack_rate", value: 3 } });
    expect(bad.isError).toBe(true);
  });
});

describe("the vaccine shortcut fields and a rich vaccine entry (2C review, I6)", () => {
  it("keeps the entry's efficacy and window when the shortcuts change its coverage or start", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", interventions: [{ type: "vaccine", kind: "campaign", coverage: 0.88, start_day: 0, end_day: 0, efficacy: 0.93 }] });
    const out = JSON.parse((await run(deps, { vaccine_coverage: 0.95 })).content);
    let p = deps.scenario.params!;
    expect(p.disease.initial_immune_frac).toBe(0);
    expect(getVaccine(p)).toMatchObject({ kind: "campaign", coverage: 0.95, start_day: 0, end_day: 0, efficacy: 0.93 });
    expect(out.applied).toMatchObject({ vaccine_coverage: 0.95, vaccine_start_day: 0 });
    await run(deps, { vaccine_start_day: 60 });
    p = deps.scenario.params!;
    expect(getVaccine(p)).toMatchObject({ kind: "campaign", coverage: 0.95, start_day: 60, end_day: 60, efficacy: 0.93 });
    expect(p.disease.initial_immune_frac).toBe(0);
  });
});

describe("configure_simulation and the limits on spread (follow-up spec 4.5, 5.5, 6)", () => {
  it("sets and removes the behaviour response, and sets the variation without moving R0", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", r0: 3, interventions: [{ type: "behaviour_response", scale: 0.5 }] });
    expect(deps.scenario.params!.interventions).toMatchObject([{ type: "behavior_response", scale: 0.5, half_prevalence: 0.01, memory_days: 7 }]);
    await run(deps, { interventions: [{ type: "behavior_response", scale: 0.7, half_prevalence: 0.02 }] });
    expect(deps.scenario.params!.interventions).toHaveLength(1);
    expect(deps.scenario.params!.interventions[0]).toMatchObject({ scale: 0.7, half_prevalence: 0.02 });
    const before = approxR0(deps.scenario.params!);
    const out = JSON.parse((await run(deps, { advanced: { "disease.rel_sus_cv": 1 } })).content);
    expect(deps.scenario.params!.disease.rel_sus_cv).toBe(1);
    expect(approxR0(deps.scenario.params!)).toBeCloseTo(before, 9);
    expect(out.config.interventions).toEqual(["behavior_response"]);
    await run(deps, { remove_interventions: ["behavior_response"] });
    expect(deps.scenario.params!.interventions).toEqual([]);
  });

  it("refuses a fit on the response without the entry, and a peak day on a lever that keeps R0", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", r0: 3 });
    const missing = await run(deps, { fit: { target: "attack_rate", value: 0.3, lever: "behavior_response.scale" } });
    expect(missing.isError).toBe(true);
    expect(missing.content).toContain("needs a behavior_response entry");
    const day = await run(deps, { fit: { target: "peak_day", value: 40, lever: "disease.rel_sus_cv" } });
    expect(day.isError).toBe(true);
    expect(day.content).toContain("peak_day can be fitted with disease.beta or network.network_beta");
    await run(deps, { fit: { target: "attack_rate", value: 0.3, lever: "disease.rel_sus_cv" } });
    expect(deps.scenario.params!.run.fit).toEqual({ target: "attack_rate", value: 0.3, lever: "disease.rel_sus_cv" });
  });
});

describe("configure_simulation and a lever that carries entries (follow-up spec 7.5)", () => {
  const closure = { type: "contact_reduction", layer: "school", scale: 1, start_day: 20, end_day: 62 };
  const whatIf = { id: "what_if", severity: "info" as const, title: "Interventions to try", evidence: {}, levers: [
    { patch: {}, current: {}, direction: "change" as const, rationale: "r", basis: "rule" as const, interventions: [closure], label: "Close schools from day 20 for six weeks and rerun" },
    { patch: {}, current: {}, direction: "change" as const, rationale: "r", basis: "rule" as const, interventions: [{ type: "transmission_reduction", scale: 0.2, start_day: 20, end_day: 110 }], label: "Add masks" },
  ] };
  const previous = (diagnostics: unknown[]) => ({
    id: "run-7", effectiveParams: params({}), stats: { peak_infections: 1, peak_day: 1, total_infected: 1, total_deaths: 0, n_agents: 10000, sim_days: 366 },
    statsAgents: { peak_infections: 1, peak_day: 1, total_infected: 1, total_deaths: 0, n_agents: 10000, sim_days: 366 }, popScale: 1, diagnostics,
  }) as unknown as PreviousRun;

  it("records the lever when its entries were applied, and not when something else was", async () => {
    const deps = makeDeps({ previousRun: previous([whatIf]) });
    await run(deps, { disease: "measles", r0: 3, network_type: "hybrid" });
    deps.scenario.hasRun = true;
    await run(deps, { interventions: [closure] });
    expect(deps.options).toEqual([{ runId: "run-7", diagnosticId: "what_if", patch: {}, interventions: [closure] }]);
    deps.options.length = 0;
    await run(deps, { interventions: [{ ...closure, scale: 0.5 }] });                      // a different size is the user's own change
    await run(deps, { interventions: [{ type: "contact_reduction", layer: "community", scale: 1, start_day: 20, end_day: 62 }] });   // another layer
    expect(deps.options).toEqual([]);
    await run(deps, { interventions: [closure] });                                         // back to the lever's entry: taken again
    expect(deps.options).toEqual([{ runId: "run-7", diagnosticId: "what_if", patch: {}, interventions: [closure] }]);
    deps.options.length = 0;
    await run(deps, { n_agents: 5000 });                                                   // the entry is there, but this call did not touch the interventions
    expect(deps.options).toEqual([]);
  });

  it("needs the patch and the entries of a lever that has both", async () => {
    const both = { id: "x", severity: "info" as const, title: "t", evidence: {}, levers: [
      { patch: { "network.network_type": "hybrid" }, current: {}, direction: "change" as const, rationale: "r", basis: "rule" as const, interventions: [closure] }] };
    const deps = makeDeps({ previousRun: previous([both]) });
    await run(deps, { disease: "measles", r0: 3 });
    deps.scenario.hasRun = true;
    await run(deps, { network_type: "hybrid" });                                           // the patch alone
    expect(deps.options).toEqual([]);
    await run(deps, { network_type: "random" });
    await run(deps, { network_type: "hybrid", interventions: [closure] });
    expect(deps.options).toEqual([{ runId: "run-7", diagnosticId: "x", patch: { "network.network_type": "hybrid" }, interventions: [closure] }]);
  });

  it("still matches a stored lever without the new fields, and never a lever with nothing in it", async () => {
    const stored = { id: "early_fadeout", severity: "warning" as const, title: "t", evidence: {}, levers: [
      { patch: {}, current: {}, direction: "change" as const, rationale: "keep it", basis: "rule" as const },
      { patch: { "run.n_replicates": 5 }, current: { "run.n_replicates": 1 }, direction: "increase" as const, rationale: "r", basis: "rule" as const }] };
    const deps = makeDeps({ previousRun: previous([stored]) });
    await run(deps, { disease: "measles", r0: 3 });
    deps.scenario.hasRun = true;
    await run(deps, { advanced: { "run.n_replicates": 5 } });
    expect(deps.options).toEqual([{ runId: "run-7", diagnosticId: "early_fadeout", patch: { "run.n_replicates": 5 } }]);
  });
});

describe("configure_simulation and two changes to the interventions after one run (review of phase B)", () => {
  const masks = { type: "transmission_reduction", scale: 0.2, start_day: 20, end_day: 110 };
  const distancing = { type: "contact_reduction", layer: "all", scale: 0.3, start_day: 20, end_day: 76 };
  const lever = (entry: Record<string, unknown>) => ({ patch: {}, current: {}, direction: "change" as const, rationale: "r", basis: "rule" as const, interventions: [entry], label: "l" });
  const previous = () => ({
    id: "run-7", effectiveParams: params({}), stats: { peak_infections: 1, peak_day: 1, total_infected: 1, total_deaths: 0, n_agents: 10000, sim_days: 366 },
    statsAgents: { peak_infections: 1, peak_day: 1, total_infected: 1, total_deaths: 0, n_agents: 10000, sim_days: 366 }, popScale: 1,
    diagnostics: [{ id: "what_if", severity: "info" as const, title: "Interventions to try", evidence: {}, levers: [lever(distancing), lever(masks)] }],
  }) as unknown as PreviousRun;
  const start = async () => {
    const deps = makeDeps({ previousRun: previous() });
    await run(deps, { disease: "measles", r0: 3 });
    deps.scenario.hasRun = true;
    return deps;
  };

  it("does not record a lever again for an entry that was already there", async () => {
    const deps = await start();
    await run(deps, { interventions: [masks] });
    await run(deps, { interventions: [{ type: "seasonality", scale: 0.2 }] });             // the masks are still there, but this call did not add them
    await run(deps, { interventions: [{ ...distancing, scale: 0.5, end_day: 40 }] });      // the user's own distancing
    expect(deps.options.map((o) => o.interventions)).toEqual([[masks]]);
  });

  it("records every lever whose entries one call added, and each lever once across calls", async () => {
    const both = await start();
    await run(both, { interventions: [distancing, masks] });
    expect(both.options.map((o) => o.interventions)).toEqual([[distancing], [masks]]);
    const twice = await start();
    await run(twice, { interventions: [distancing] });
    await run(twice, { interventions: [masks] });
    expect(twice.options.map((o) => o.interventions)).toEqual([[distancing], [masks]]);
  });
});

describe("configure_simulation on a fitted scenario (review of phase B)", () => {
  const masks = { type: "transmission_reduction", scale: 0.2, start_day: 20, end_day: 110 };
  const stats = { peak_infections: 1, peak_day: 1, total_infected: 4500, total_deaths: 0, n_agents: 10000, sim_days: 366 };
  const fittedRun = (effective: SimParams, fit: { target: string; lever: string; value: number; wanted: number }): PreviousRun => ({
    id: "run-9", effectiveParams: effective, stats: { ...stats, fit: { target: fit.target, wanted: fit.wanted, achieved: fit.wanted, lever: fit.lever, value: fit.value, runs: 4 } },
    statsAgents: stats, popScale: 1, diagnostics: [],
  }) as unknown as PreviousRun;
  const fitted = async (fit: Record<string, unknown>, value: number, extra: Record<string, unknown> = {}) => {
    const first = makeDeps();
    await run(first, { disease: "measles", r0: 3, ...extra, fit });
    const spec = first.scenario.params!.run.fit!;
    const deps = makeDeps({ scenario: first.scenario, previousRun: fittedRun(first.scenario.params!, { target: spec.target, lever: spec.lever, value, wanted: spec.value }) });
    deps.scenario.hasRun = true;
    return deps;
  };

  it("ends the fit and keeps the fitted beta when an intervention is added, so the next run does not fit it away", async () => {
    const deps = await fitted({ target: "attack_rate", value: 0.45 }, 13.56, { network_type: "hybrid" });
    const out = JSON.parse((await run(deps, { interventions: [masks] })).content);
    const p = deps.scenario.params!;
    expect(p.run.fit).toBeNull();
    expect(p.disease.beta).toBe(13.56);
    expect(p.run.calibrate_r0).toBe(false);                                                 // the pilot would move the fitted beta to the formula's R0
    expect(p.interventions).toHaveLength(1);
    expect(out.warnings.join(" ")).toContain("ended the fit");
    expect(out.warnings.join(" ")).toContain("13.56");
    expect(out.changed.map((c: { path: string }) => c.path)).toEqual(expect.arrayContaining(["interventions", "disease.beta", "run.fit.target"]));
  });

  it("keeps a fitted variation and a fitted response the same way, and leaves the calibration on", async () => {
    const cv = await fitted({ target: "attack_rate", value: 0.6, lever: "disease.rel_sus_cv" }, 0.875);
    await run(cv, { interventions: [masks] });
    expect(cv.scenario.params!.run.fit).toBeNull();
    expect(cv.scenario.params!.disease.rel_sus_cv).toBe(0.875);
    expect(cv.scenario.params!.run.calibrate_r0).toBe(true);
    const response = await fitted({ target: "attack_rate", value: 0.7, lever: "behavior_response.scale" }, 0.3, { interventions: [{ type: "behavior_response", scale: 0.2 }] });
    await run(response, { interventions: [masks] });
    expect(response.scenario.params!.run.fit).toBeNull();
    expect(response.scenario.params!.interventions.find((i) => i.type === "behavior_response")?.scale).toBe(0.3);
  });

  it("fits again when the call asks for a fit, and leaves the fit alone before a fitted run or for another change", async () => {
    const again = await fitted({ target: "attack_rate", value: 0.45 }, 13.56);
    await run(again, { interventions: [masks], fit: { target: "attack_rate", value: 0.45 } });
    expect(again.scenario.params!.run.fit).toMatchObject({ target: "attack_rate", value: 0.45 });
    const other = await fitted({ target: "attack_rate", value: 0.45 }, 13.56);
    const before = other.scenario.params!.disease.beta;
    await run(other, { n_agents: 5000 });                                                   // not an intervention: the fit goes on, as in Part 2
    expect(other.scenario.params!.run.fit).not.toBeNull();
    expect(other.scenario.params!.disease.beta).toBe(before);
    const unrun = makeDeps();
    await run(unrun, { disease: "measles", r0: 3, fit: { target: "attack_rate", value: 0.45 } });
    await run(unrun, { interventions: [masks] });                                           // no fitted run yet: the first run fits with the masks in place
    expect(unrun.scenario.params!.run.fit).not.toBeNull();
    const moved = await fitted({ target: "attack_rate", value: 0.45 }, 13.56);
    await run(moved, { fit: { target: "attack_rate", value: 0.3 } });                       // a new target since the fitted run
    await run(moved, { interventions: [masks] });
    expect(moved.scenario.params!.run.fit).toMatchObject({ value: 0.3 });
  });
});

describe("configure_simulation with routine immunity and a campaign on top of it (review of phase B)", () => {
  const campaign = { type: "vaccine", kind: "campaign", coverage: 0.7, efficacy: 0.9, start_day: 20, end_day: 50 };

  it("reads vaccine_coverage as the routine coverage and keeps the campaign", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", r0: 3, vaccine_coverage: 0.85 });
    await run(deps, { interventions: [campaign] });
    expect(deps.scenario.params!.disease.initial_immune_frac).toBe(0.85);
    await run(deps, { vaccine_coverage: 0.9 });
    expect(deps.scenario.params!.disease.initial_immune_frac).toBe(0.9);
    expect(deps.scenario.params!.interventions).toMatchObject([{ type: "vaccine", kind: "campaign", coverage: 0.7, start_day: 20, end_day: 50 }]);
  });

  it("refuses a start day there, naming both", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", r0: 3, vaccine_coverage: 0.85 });
    await run(deps, { interventions: [campaign] });
    const out = await run(deps, { vaccine_coverage: 0.9, vaccine_start_day: 30 });
    expect(out.isError).toBe(true);
    expect(out.content).toContain("routine immunity");
    expect(out.content).toContain("campaign");
    expect(deps.scenario.params!.disease.initial_immune_frac).toBe(0.85);                  // nothing was written
  });
});

describe("configure_simulation sends where each value came from (follow-up spec 8.4)", () => {
  it("carries sources beside the parameters", async () => {
    const deps = makeDeps();
    const out = await run(deps, { disease: "measles", dur_inf_days: 8, n_agents: 5000, advanced: { "disease.rel_sus_cv": 1 } });   // 8 days is the database's typical value
    const payload = out.payload as { sources?: Record<string, string>; params?: unknown };
    expect(payload.params).toBeDefined();
    expect(payload.sources).toMatchObject({ "run.n_agents": "user", "disease.dur_inf.mean_days": "database", "run.sim_dur_years": "default", "disease.rel_sus_cv": "illustrative" });
    const typed = await run(deps, { advanced: { "disease.rel_sus_cv": 0.7 } });
    expect((typed.payload as { sources: Record<string, string> }).sources["disease.rel_sus_cv"]).toBe("user");   // not the offered value: the user's own
    const none = await run(deps, { advanced: { "disease.rel_sus_cv": 0 } });
    expect((none.payload as { sources: Record<string, string> }).sources["disease.rel_sus_cv"]).toBe("default");
  });
});
