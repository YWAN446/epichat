import { describe, expect, it } from "vitest";

import { ageRangeShare, ageShares, approxR0, calibrateBeta, contactRows, hybridContacts, isV1Treatment, r0IsApproximate, clampBeta, CONTACT_MATRIX, CONTACT_SPECTRAL_RADIUS, deathProbabilities, DEFAULT_BETA, effectiveDays, exposedDays, getVaccine, maxR0, migrateV1, perContactProb, R0UnreachableError, recalibrateBeta, simDays, spectralRadius3, validateParams, weightedCfr, withR0 } from "@/lib/sim/params";

function must(input: unknown) {
  const r = validateParams(input);
  if (!r.ok) throw new Error(r.error);
  return r.params;
}

describe("SimParams v2 validation", () => {
  it("fills every default like pydantic", () => {
    const p = must({ schema_version: 2 });
    expect(p).toEqual({
      schema_version: 2,
      disease: {
        model: "sir", beta: DEFAULT_BETA, dur_exp: null, dur_inf: { mean_days: 10, dist: "constant", sd_days: null }, dur_immune: null,
        p_death: 0, p_asymp: 0.3, rel_trans_asymp: 0.5, rel_sus_age: { children: 1, adults: 1, elderly: 1 }, p_death_age: { children: null, adults: null, elderly: null },
        rel_trans_exposed: 0, sis_waning: 0, sis_imm_boost: 0, seed: { mode: "fraction", value: 0.01, day: 0 }, initial_immune_frac: 0,
      },
      network: {
        network_type: "random", n_contacts: 4, network_beta: 1, contacts_dist: "constant", contact_duration_days: 0,
        contacts: { children_children: 7, children_adults: 2.5, children_elderly: 0.5, adults_children: 2.5, adults_adults: 9, adults_elderly: 1.5, elderly_children: 0.5, elderly_adults: 1.5, elderly_elderly: 3.5 },
        contacts_source: "polymod_default", household_size: 2, school_contacts: 20, work_contacts: 16, community_contacts: 20,
        layer_beta: { household: 3, school: 0.6, work: 0.6, community: 0.3 }, school_age_min: 6, school_age_max: 22, work_age_min: 22, work_age_max: 65,
      },
      demographics: {
        use_demographics: false, birth_rate: 20, death_rate: 10, age_pct_under18: null, age_pct_18_64: null, age_pct_over65: null,
        country: null, auto_demographics: true, demographics_year: 2022, demographics_source: null, age_source: "default",
      },
      interventions: [],
      run: { n_agents: 10000, sim_dur_years: 1, rand_seed: null, n_replicates: 1, calibrate_r0: true, fit: null },
    });
    expect(must({})).toEqual(must({ schema_version: 2 })); // a v1 row with nothing in it migrates to the same defaults
  });

  it("enforces registry bounds and names the dotted path like pydantic", () => {
    const r = validateParams({ schema_version: 2, run: { n_agents: -5 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^1 validation error for SimParams\nrun\.n_agents\n  /);
    expect(validateParams({ schema_version: 2, disease: { beta: 0.0001 } }).ok).toBe(false);
    expect(validateParams({ schema_version: 2, disease: { dur_inf: { mean_days: 400 } } })).toEqual({ ok: false, error: expect.stringContaining("disease.dur_inf.mean_days must be between 0.5 and 365 days") });
    expect(validateParams({ schema_version: 2, run: { n_replicates: 6 } }).ok).toBe(false);
    expect(validateParams({ schema_version: 2, disease: { model: "sirv" } }).ok).toBe(false);
  });

  it("applies the duration, seed and model validators", () => {
    expect(validateParams({ schema_version: 2, disease: { dur_inf: { mean_days: 10, dist: "gamma" } } })).toEqual({ ok: false, error: expect.stringContaining("sd_days is required when dist is 'gamma'") });
    expect(validateParams({ schema_version: 2, disease: { dur_inf: { mean_days: 10, dist: "gamma", sd_days: 25 } } }).ok).toBe(false);
    expect(validateParams({ schema_version: 2, disease: { seed: { value: 1 } } })).toEqual({ ok: false, error: expect.stringContaining("between 0 and 1") });
    expect(validateParams({ schema_version: 2, disease: { seed: { mode: "count", value: 2.5 } } })).toEqual({ ok: false, error: expect.stringContaining("integer count") });
    expect(validateParams({ schema_version: 2, disease: { seed: { mode: "count", value: 500 } }, run: { n_agents: 100 } })).toEqual({ ok: false, error: expect.stringContaining("disease.seed.value (500) must not exceed run.n_agents (100)") });
    expect(validateParams({ schema_version: 2, disease: { seed: { value: 0.01, day: 400 } }, run: { sim_dur_years: 0.5 } })).toEqual({ ok: false, error: expect.stringContaining("disease.seed.day (400) must be within the simulation (182 days)") });
    expect(validateParams({ schema_version: 2, disease: { model: "seir" } })).toEqual({ ok: false, error: expect.stringContaining("disease.dur_exp is required when disease.model is 'seir', 'seirs', or 'seiar'") });
    expect(validateParams({ schema_version: 2, disease: { model: "sirs" } })).toEqual({ ok: false, error: expect.stringContaining("disease.dur_immune is required") });
    expect(validateParams({ schema_version: 2, disease: { beta: 1000 }, network: { network_beta: 10 } })).toEqual({ ok: false, error: expect.stringContaining("network.network_beta") });
  });

  it("normalizes a day-0 vaccine into initial immunity", () => {
    const p = must({ schema_version: 2, interventions: [{ type: "vaccination", coverage: 0.6, start_day: 0 }, { type: "treatment", capacity: 5 }] });
    expect(p.disease.initial_immune_frac).toBe(0.6);
    expect(p.interventions.map((i) => i.type)).toEqual(["treatment"]);
    expect(must({ schema_version: 2, interventions: [{ type: "vaccine", coverage: 1 }] }).disease.initial_immune_frac).toBe(0.99);
    expect(getVaccine(must({ schema_version: 2, interventions: [{ type: "vaccine", coverage: 0.6, start_day: 30 }] }))).toMatchObject({ coverage: 0.6, start_day: 30 });
    expect(validateParams({ schema_version: 2, disease: { initial_immune_frac: 0.3 }, interventions: [{ type: "vaccine", coverage: 0.6 }] })).toEqual({ ok: false, error: expect.stringContaining("initial_immune_frac") });
  });

  it("keeps the v1 demographics rules", () => {
    expect(validateParams({ schema_version: 2, demographics: { age_pct_under18: 10, age_pct_18_64: 10, age_pct_over65: 10 } })).toEqual({ ok: false, error: expect.stringContaining("age_pct fields must sum to 100 (got 30.0)") });
    expect(must({ schema_version: 2, demographics: { country: " ken " } }).demographics.country).toBe("KEN");
    expect(must({ schema_version: 2, demographics: { country: "Brazil" } }).demographics.country).toBeNull();
    expect(simDays(1)).toBe(365);
    expect(simDays(0.5)).toBe(182);
  });
});

describe("migration from v1", () => {
  it("migrates a flat row to constant durations and a fraction seed", () => {
    const p = must({ disease_type: "seirs", beta: 12.5, dur_inf: 7, dur_exp: 4, dur_immune: 90, init_prev: 0.02, n_agents: 2000, sim_dur_years: 0.5, rand_seed: 9, p_death: 0.1 });
    expect(p.disease).toMatchObject({ model: "seirs", beta: 12.5, dur_inf: { mean_days: 7, dist: "constant", sd_days: null }, p_death: 0.1, seed: { mode: "fraction", value: 0.02, day: 0 } });
    expect(p.run).toEqual({ n_agents: 2000, sim_dur_years: 0.5, rand_seed: 9, n_replicates: 1, calibrate_r0: true, fit: null });
  });

  it("folds a day-0 vaccine into initial immunity and keeps later campaigns", () => {
    const out = migrateV1({ disease_type: "sir", beta: 1, interventions: [{ type: "vaccine", coverage: 0.4, start_day: 0 }], country: "KEN" });
    expect(out).toMatchObject({ schema_version: 2, disease: { initial_immune_frac: 0.4 }, interventions: [], demographics: { country: "KEN" }, network: {}, run: {} });
    expect(must({ beta: 5, interventions: [{ type: "vaccine", coverage: 0.6, start_day: 60 }] }).interventions).toHaveLength(1);
    expect(must({ beta: 5, interventions: [{ type: "vaccination", coverage: 1, start_day: 0 }] }).disease.initial_immune_frac).toBe(0.99);
  });

  it("rejects a v1 row that is not usable", () => {
    expect(validateParams({ beta: "not a number" }).ok).toBe(false);
  });
});

describe("R0 math", () => {
  it("uses the exact per-contact probability and effective days", () => {
    const p = must({ schema_version: 2 });
    expect(effectiveDays(p.disease)).toBe(9);
    expect(approxR0(p)).toBeCloseTo(4 * (1 - Math.exp(-DEFAULT_BETA / 365)) * 9, 12);
    expect(maxR0(p)).toBe(36);
    expect(effectiveDays(must({ schema_version: 2, disease: { dur_inf: { mean_days: 10, dist: "gamma", sd_days: 4 } } }).disease)).toBe(9.5);
    expect(effectiveDays(must({ schema_version: 2, disease: { model: "seir", dur_exp: { mean_days: 5 }, dur_inf: { mean_days: 10, dist: "gamma", sd_days: 4 } } }).disease)).toBe(10.5);
    expect(effectiveDays(must({ schema_version: 2, disease: { dur_inf: { mean_days: 0.5 } } }).disease)).toBe(0);
  });

  it("calibrates, clamps and rounds, and refuses an unreachable R0 naming the levers", () => {
    const p = must({ schema_version: 2 });
    expect(approxR0(withR0(p, 15))).toBeCloseTo(15, 6);
    expect(clampBeta(0.00001)).toBe(0.001);
    expect(clampBeta(12.3456789)).toBe(12.345679);
    const small = must({ schema_version: 2, network: { n_contacts: 2 }, disease: { dur_inf: { mean_days: 3 } } });
    expect(() => calibrateBeta(small, 4)).toThrow(R0UnreachableError);
    expect(() => calibrateBeta(small, 4)).toThrow(expect.objectContaining({ target: 4, maximum: 4, levers: ["network.n_contacts", "disease.dur_inf.mean_days"] }));
    const aged = must({ schema_version: 2, network: { network_type: "age_structured" }, disease: { dur_inf: { mean_days: 1 } } });
    expect(() => calibrateBeta(aged, 1)).toThrow(expect.objectContaining({ maximum: 0, levers: ["network.network_beta", "disease.dur_inf.mean_days"] }));
  });

  it("ignores age shares and n_contacts on the age-structured network", () => {
    const base = must({ schema_version: 2, network: { network_type: "age_structured", n_contacts: 4 } });
    const shares = must({ schema_version: 2, network: { network_type: "age_structured", n_contacts: 40 }, demographics: { age_pct_under18: 38.6, age_pct_18_64: 57.6, age_pct_over65: 3.8 } });
    expect(CONTACT_SPECTRAL_RADIUS).toBeCloseTo(11.0028224279, 9);
    expect(approxR0(base)).toBeCloseTo(CONTACT_SPECTRAL_RADIUS * (1 - Math.exp(-DEFAULT_BETA / 365)) * 9, 9);
    expect(approxR0(shares)).toBeCloseTo(approxR0(base), 12);
    expect(spectralRadius3([[2, 0, 0], [0, 1, 0], [0, 0, 0.5]])).toBeCloseTo(2, 12);
  });

  it("recalibrates after a network switch to hold the R0, and keeps beta when the R0 is unreachable", () => {
    const before = withR0(must({ schema_version: 2 }), 3);
    const switched = must({ ...before, network: { ...before.network, network_type: "age_structured" } });
    expect(approxR0(recalibrateBeta(switched, 3, before))).toBeCloseTo(3, 6);
    const raised = must({ ...before, disease: { ...before.disease, beta: 54.4 } });
    expect(approxR0(recalibrateBeta(raised, 3, before))).toBeCloseTo(4 * (1 - Math.exp(-54.4 / 365)) * 9, 6);
    const stuck = must({ schema_version: 2, network: { n_contacts: 1 }, disease: { dur_inf: { mean_days: 2 } } });
    expect(recalibrateBeta(stuck, 3, before).disease.beta).toBe(stuck.disease.beta);
    const aged = withR0(must({ schema_version: 2, network: { network_type: "age_structured" } }), 3);
    const agedRaised = must({ ...aged, disease: { ...aged.disease, beta: 50 } });
    expect(recalibrateBeta(agedRaised, 3, aged).disease.beta).toBeCloseTo(50, 6); // read on the network it was set on
  });
});

describe("susceptibility and fatality by age, presymptomatic transmissibility", () => {
  const must = (input: unknown) => { const r = validateParams(input); if (!r.ok) throw new Error(r.error); return r.params; };

  it("defaults, validates and exposes the group values", () => {
    const base = must({ schema_version: 2 });
    expect(base.disease.rel_sus_age).toEqual({ children: 1, adults: 1, elderly: 1 });
    expect(base.disease.p_death_age).toEqual({ children: null, adults: null, elderly: null });
    expect(base.disease.rel_trans_exposed).toBe(0);
    const p = must({ schema_version: 2, disease: { model: "seir", dur_exp: { mean_days: 5 }, p_death: 0.01, rel_sus_age: { children: 1.5, elderly: 0.7 }, p_death_age: { elderly: 0.1 }, rel_trans_exposed: 0.5 } });
    expect(p.disease.rel_sus_age).toEqual({ children: 1.5, adults: 1, elderly: 0.7 });
    expect(deathProbabilities(p.disease)).toEqual([0.01, 0.01, 0.1]);
    expect(validateParams({ schema_version: 2, disease: { rel_sus_age: { children: 11 } } }).ok).toBe(false);
    expect(validateParams({ schema_version: 2, disease: { p_death_age: { adults: 1.5 } } }).ok).toBe(false);
    expect(must({ disease_type: "sir", beta: 5 }).disease.rel_sus_age).toEqual({ children: 1, adults: 1, elderly: 1 }); // a v1 row
  });

  it("scales the R0 by the share-weighted susceptibility, the column-scaled matrix, and the exposed days", () => {
    const base = must({ schema_version: 2 });
    const scaled = must({ schema_version: 2, disease: { rel_sus_age: { children: 2, adults: 0.5, elderly: 3 } } });
    expect(ageShares(base)).toEqual([0.3, 0.7, 0]);
    expect(approxR0(scaled)).toBeCloseTo(approxR0(base) * (0.3 * 2 + 0.7 * 0.5), 9);
    const aged = must({ schema_version: 2, network: { network_type: "age_structured" }, disease: { rel_sus_age: { children: 1.5, adults: 1, elderly: 0.7 } } });
    const matrix = CONTACT_MATRIX.map((row) => row.map((v, j) => v * [1.5, 1, 0.7][j]));
    expect(approxR0(aged)).toBeCloseTo(approxR0(must({ schema_version: 2, network: { network_type: "age_structured" } })) * (spectralRadius3(matrix) / CONTACT_SPECTRAL_RADIUS), 9);
    const seir = must({ schema_version: 2, disease: { model: "seir", dur_exp: { mean_days: 5 } } });
    const half = must({ schema_version: 2, disease: { model: "seir", dur_exp: { mean_days: 5 }, rel_trans_exposed: 0.5 } });
    expect(exposedDays(seir.disease)).toBe(4);
    expect(effectiveDays(half.disease)).toBeCloseTo(effectiveDays(seir.disease) + 2, 9);
    expect(weightedCfr(must({ schema_version: 2, disease: { p_death: 0.01, p_death_age: { elderly: 0.2 } }, demographics: { age_pct_under18: 40, age_pct_18_64: 50, age_pct_over65: 10 } }))).toBeCloseTo(0.4 * 0.01 + 0.5 * 0.01 + 0.1 * 0.2, 9);
  });

  it("mirrors the hybrid R0, the configured matrix and the approximate flag", () => {
    const hybrid = must({ schema_version: 2, network: { network_type: "hybrid" } });
    const school = ageRangeShare([0.3, 0.7, 0], 6, 22);
    const work = ageRangeShare([0.3, 0.7, 0], 22, 65);
    expect(school).toBeCloseTo(0.3 * 12 / 18 + 0.7 * 4 / 47, 12);
    expect(hybridContacts(hybrid)).toBeCloseTo(3 * 2 + 0.6 * 20 * school + 0.6 * 16 * work + 0.3 * 20, 9);
    expect(r0IsApproximate(hybrid)).toBe(true);
    expect(r0IsApproximate(must({ schema_version: 2 }))).toBe(false);
    expect(r0IsApproximate(must({ schema_version: 2, network: { contact_duration_days: 7 } }))).toBe(true);
    expect(() => calibrateBeta(hybrid, 1000)).toThrow(/network.household_size/);
    const base = must({ schema_version: 2, network: { network_type: "age_structured" } });
    const doubled = must({ schema_version: 2, network: { network_type: "age_structured", contacts: Object.fromEntries(Object.entries(base.network.contacts).map(([k, v]) => [k, 2 * v])) } });
    expect(approxR0(doubled)).toBeCloseTo(2 * approxR0(base), 9);
    expect(contactRows(base.network.contacts)).toEqual([[7, 2.5, 0.5], [2.5, 9, 1.5], [0.5, 1.5, 3.5]]);
    expect(validateParams({ schema_version: 2, network: { school_age_min: 22, school_age_max: 22 } })).toEqual({ ok: false, error: expect.stringContaining("school_age_min") });
    expect(must({ schema_version: 2 }).network).toMatchObject({ contacts_dist: "constant", contact_duration_days: 0, contacts_source: "polymod_default", household_size: 2, layer_beta: { household: 3, school: 0.6, work: 0.6, community: 0.3 } });
    expect(must({ schema_version: 2 }).demographics.age_source).toBe("default");
    expect(must({ schema_version: 2 }).run.calibrate_r0).toBe(true);
  });

  it("scales the infectious days alone by the asymptomatic factor: the exposed transmit at the fraction whatever their track", () => {
    const p = must({ schema_version: 2, disease: { model: "seiar", dur_exp: { mean_days: 5, dist: "gamma", sd_days: 2 }, dur_inf: { mean_days: 10, dist: "gamma", sd_days: 4 }, p_asymp: 0.8, rel_trans_asymp: 0, rel_trans_exposed: 1 } });
    expect(effectiveDays(p.disease)).toBeCloseTo(10 * 0.2 + 4.5, 9);
    expect(approxR0(p)).toBeCloseTo(p.network.n_contacts * perContactProb(p.disease.beta) * 6.5, 9);
  });
});

describe("interventions and the fit (Part 2, section 7)", () => {
  it("fills the entry defaults, keeps the day-0 fold at full efficacy only and checks the layer and the window", () => {
    const p = must({ schema_version: 2, network: { network_type: "hybrid" }, interventions: [
      { type: "vaccine", coverage: 0.5, start_day: 30 }, { type: "treatment", coverage: 0.8, capacity: 20 },
      { type: "contact_reduction", layer: "school", scale: 0, start_day: 30, end_day: 72 }, { type: "transmission_reduction", scale: 0.3, end_day: 90 },
      { type: "seasonality", scale: 0.2, peak_day: 91 }] });
    expect(p.interventions[0]).toMatchObject({ kind: "routine", end_day: null, efficacy: 1, leaky: true, age_min: null, age_max: null, protection_days: null });
    expect(p.interventions[1]).toMatchObject({ delay_days: 0, rel_trans_treated: 1, symptomatic_only: false, efficacy: 1 });
    expect(p.interventions[2]).toMatchObject({ layer: "school", scale: 0, start_day: 30, end_day: 72 });
    expect(p.interventions[4].shift).toBeCloseTo(91 / 365, 9);
    expect(isV1Treatment(p.interventions[1])).toBe(true);
    expect(must({ schema_version: 2, interventions: [{ type: "vaccine", coverage: 0.4, start_day: 0 }] })).toMatchObject({ disease: { initial_immune_frac: 0.4 }, interventions: [] });
    const leaky = must({ schema_version: 2, interventions: [{ type: "vaccine", coverage: 0.4, start_day: 0, efficacy: 0.6 }] });
    expect(leaky.disease.initial_immune_frac).toBe(0);
    expect(leaky.interventions[0]).toMatchObject({ efficacy: 0.6, start_day: 0 });
    expect(validateParams({ schema_version: 2, interventions: [{ type: "contact_reduction", layer: "school", scale: 0.5 }] })).toEqual({ ok: false, error: expect.stringContaining("layer school needs the hybrid network") });
    expect(validateParams({ schema_version: 2, interventions: [{ type: "transmission_reduction", scale: 0.5, start_day: 40, end_day: 10 }] })).toEqual({ ok: false, error: expect.stringContaining("end_day") });
    expect(must({ schema_version: 2, run: { fit: { target: "attack_rate", value: 0.3 } } }).run.fit).toEqual({ target: "attack_rate", value: 0.3, lever: "disease.beta" });
    expect(validateParams({ schema_version: 2, run: { fit: { target: "attack_rate", value: 1.5 } } })).toEqual({ ok: false, error: expect.stringContaining("fraction") });
    expect(must({ schema_version: 2 }).run.fit).toBeNull();
    expect(must({ schema_version: 2, interventions: [{ type: "school_closure", layer: "school", scale: 0 }], network: { network_type: "hybrid" } }).interventions[0].type).toBe("contact_reduction");
  });
});
