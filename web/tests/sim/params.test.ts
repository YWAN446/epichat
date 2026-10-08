import { describe, expect, it } from "vitest";

import {
  DEFAULT_BETA, approxR0, calibrateBeta, clampBeta, getVaccine, recalibrateBeta, spectralRadius3, validateParams,
} from "@/lib/sim/params";

function must(input: unknown) {
  const r = validateParams(input);
  if (!r.ok) throw new Error(r.error);
  return r.params;
}

describe("SimParams validation", () => {
  it("fills every default like pydantic", () => {
    const p = must({ beta: DEFAULT_BETA });
    expect(p).toMatchObject({
      disease_type: "sir", n_agents: 10000, n_contacts: 4, network_type: "random", network_beta: 1, beta: 22.8125,
      init_prev: 0.01, dur_inf: 10, dur_exp: null, dur_immune: null, p_death: 0, p_asymp: 0.3, rel_trans_asymp: 0.5,
      sim_dur_years: 1, interventions: [], rand_seed: null, use_demographics: false, birth_rate: 20, death_rate: 10,
      age_pct_under18: null, age_pct_18_64: null, age_pct_over65: null, country: null, auto_demographics: true,
      demographics_year: 2022, demographics_source: null,
    });
  });

  it("requires beta and enforces the bounds", () => {
    expect(validateParams({})).toEqual({ ok: false, error: expect.stringContaining("beta") });
    expect(validateParams({ beta: 1, n_agents: -5 }).ok).toBe(false);
    expect(validateParams({ beta: 1, n_agents: 5 }).ok).toBe(false);
    expect(validateParams({ beta: 1, n_agents: 1_000_001 }).ok).toBe(false);
    expect(validateParams({ beta: 0 }).ok).toBe(false);
    expect(validateParams({ beta: 1, init_prev: 1 }).ok).toBe(false);
    expect(validateParams({ beta: 1, sim_dur_years: 21 }).ok).toBe(false);
    expect(validateParams({ beta: 1, disease_type: "sirv" }).ok).toBe(false);
  });

  it("names the field in the error text like pydantic", () => {
    const r = validateParams({ beta: 1, n_agents: -5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^1 validation error for SimParams\nn_agents\n  /);
  });

  it("applies the two model validators with pydantic's messages", () => {
    const ages = validateParams({ beta: 1, age_pct_under18: 50, age_pct_18_64: 50, age_pct_over65: 10 });
    expect(ages.ok).toBe(false);
    if (!ages.ok) expect(ages.error).toContain("age_pct fields must sum to 100 (got 110.0)");
    const seir = validateParams({ beta: 1, disease_type: "seir" });
    expect(seir.ok).toBe(false);
    if (!seir.ok) expect(seir.error).toContain("dur_exp is required when disease_type is 'seir', 'seirs', or 'seiar'");
    const sirs = validateParams({ beta: 1, disease_type: "sirs" });
    if (!sirs.ok) expect(sirs.error).toContain("dur_immune is required when disease_type is 'sirs' or 'seirs'");
    expect(validateParams({ beta: 1, age_pct_under18: 30, age_pct_18_64: 60.5, age_pct_over65: 10 }).ok).toBe(true);
  });

  it("normalizes the country code and intervention aliases, and coerces capacity", () => {
    expect(must({ beta: 1, country: " bra " }).country).toBe("BRA");
    expect(must({ beta: 1, country: "Brazil" }).country).toBeNull();
    const p = must({ beta: 1, interventions: [{ type: "vaccination", coverage: 0.5 }, { type: "treat", capacity: 20.4 }, { type: "seasonal" }] });
    expect(p.interventions.map((i) => i.type)).toEqual(["vaccine", "treatment", "seasonality"]);
    expect(p.interventions[1].capacity).toBe(20);
    expect(p.interventions[0]).toEqual({ type: "vaccine", coverage: 0.5, start_day: 0, capacity: null, scale: 0.2, shift: 0 });
    expect(getVaccine(p)?.coverage).toBe(0.5);
  });
});

describe("R0 math", () => {
  it("matches the Python reference values", () => {
    expect(approxR0(must({ beta: DEFAULT_BETA }))).toBeCloseTo(2.5, 12);
    expect(approxR0(must({ beta: DEFAULT_BETA, network_type: "age_structured", age_pct_under18: 38.6, age_pct_18_64: 57.6, age_pct_over65: 3.8 }))).toBeCloseTo(3.54004728034979, 9);
    expect(approxR0(must({ beta: DEFAULT_BETA, network_type: "age_structured" }))).toBeCloseTo(6.8767640174459785, 9);
    expect(approxR0(must({ beta: DEFAULT_BETA, disease_type: "seiar", dur_exp: 3, p_asymp: 0.4, rel_trans_asymp: 0.5 }))).toBeCloseTo(2.0, 12);
  });

  it("calibrates beta to a target R0 and clamps and rounds like the agent", () => {
    const m = must({ beta: 1, dur_inf: 8 });
    expect(clampBeta(calibrateBeta(m, 15))).toBe(171.09375);
    expect(clampBeta(1e9)).toBe(1000);
    expect(clampBeta(1e-9)).toBe(0.001);
    expect(clampBeta(0.47222222222)).toBe(0.472222);
  });

  it("recalibrates after a network switch to hold the R0, and recovers a changed beta's intent", () => {
    const before = must({ beta: 171.09375, disease_type: "seir", dur_exp: 11, dur_inf: 8 });
    expect(approxR0(before)).toBeCloseTo(15, 9);
    const after = must({ ...before, network_type: "age_structured", age_pct_under18: 38.6, age_pct_18_64: 57.6, age_pct_over65: 3.8, use_demographics: true, birth_rate: 27.3, death_rate: 7.2, country: "KEN" });
    const rec = recalibrateBeta(after, approxR0(before), before);
    expect(rec.beta).toBe(120.827306);
    expect(approxR0(rec)).toBeCloseTo(15, 2);
    const changed = must({ ...before, beta: 2 });
    const rec2 = recalibrateBeta(changed, approxR0(before), before);
    expect(rec2.beta).toBe(2);
    expect(approxR0(rec2)).toBeCloseTo(0.1753, 4);
  });

  it("finds the dominant eigenvalue of the contact matrix to machine precision", () => {
    expect(spectralRadius3([[7, 2.5, 0.5], [2.5, 9, 1.5], [0.5, 1.5, 3.5]])).toBeCloseTo(6.8767640174459785 / (DEFAULT_BETA * 10 / 365), 10);
    expect(spectralRadius3([[2, 0, 0], [0, 1, 0], [0, 0, 1]])).toBeCloseTo(2, 12);
  });
});
