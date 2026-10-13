import { describe, expect, it } from "vitest";

import { checkParams } from "@/lib/disease/checkParams";
import { approxR0, calibrateBeta, clampBeta, maxR0, R0UnreachableError, recalibrateBeta, validateParams, weightedCfr } from "@/lib/sim/params";
import parity from "../fixtures/parity.json";

function must(input: unknown) {
  const r = validateParams(input);
  if (!r.ok) throw new Error(r.error);
  return r.params;
}

function calibrateOrNull(p: ReturnType<typeof must>, target: number): number | null {
  try {
    return clampBeta(calibrateBeta(p, target));
  } catch (e) {
    if (e instanceof R0UnreachableError) return null;
    throw e;
  }
}

describe("parity with the Python package", () => {
  it("has enough cases", () => {
    expect(parity.version).toBe(3);
    expect(parity.params.length).toBeGreaterThanOrEqual(200);
    expect(parity.migration.length).toBeGreaterThanOrEqual(12);
    expect(parity.warnings.length).toBeGreaterThanOrEqual(300);
  });

  it("approx_r0, max_r0, calibrate_beta and recalibrate_beta agree within 1e-6", () => {
    for (const c of parity.params) {
      const p = must(c.input);
      expect(approxR0(p)).toBeCloseTo(c.approx_r0, 6);
      expect(maxR0(p)).toBeCloseTo(c.max_r0, 6);
      expect(weightedCfr(p)).toBeCloseTo((c as { weighted_cfr: number }).weighted_cfr, 6);
      for (const k of c.calibrate) {
        const beta = calibrateOrNull(p, k.target_r0);
        if (k.beta === null) expect(beta).toBeNull();
        else expect(beta).toBeCloseTo(k.beta, 6);
      }
      for (const r of c.recalibrate) expect(recalibrateBeta(must(r.after_input), r.r0_before, must(r.before)).disease.beta).toBeCloseTo(r.beta, 6);
    }
  });

  it("migrates every v1 fixture to the same v2 document", () => {
    for (const c of parity.migration) expect(must(c.input), JSON.stringify(c.input)).toEqual(c.expected);
  });

  it("check_params warnings are identical strings", () => {
    for (const w of parity.warnings) {
      expect(checkParams(w.disease, w.r0, w.dur_inf, w.dur_exp, { pDeath: w.p_death, nContacts: w.n_contacts, durImmune: w.dur_immune, pAsymp: w.p_asymp }), JSON.stringify(w)).toEqual(w.warnings);
    }
  });
});
