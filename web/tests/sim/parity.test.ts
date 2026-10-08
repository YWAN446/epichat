import { describe, expect, it } from "vitest";

import { checkParams } from "@/lib/disease/checkParams";
import { approxR0, calibrateBeta, clampBeta, recalibrateBeta, validateParams } from "@/lib/sim/params";
import parity from "../fixtures/parity.json";

function must(input: unknown) {
  const r = validateParams(input);
  if (!r.ok) throw new Error(r.error);
  return r.params;
}

describe("parity with the Python package", () => {
  it("has enough cases", () => {
    expect(parity.params.length).toBeGreaterThanOrEqual(200);
    expect(parity.warnings.length).toBeGreaterThanOrEqual(300);
  });

  it("approx_r0, calibrate_beta, and recalibrate_beta agree within 1e-6", () => {
    for (const c of parity.params) {
      const p = must(c.input);
      expect(approxR0(p)).toBeCloseTo(c.approx_r0, 6);
      for (const k of c.calibrate) expect(clampBeta(calibrateBeta(p, k.target_r0))).toBeCloseTo(k.beta, 6);
      for (const r of c.recalibrate) {
        const after = must(r.after_input);
        expect(recalibrateBeta(after, r.r0_before, must(r.before)).beta).toBeCloseTo(r.beta, 6);
      }
    }
  });

  it("check_params warnings are identical strings", () => {
    for (const w of parity.warnings) {
      expect(checkParams(w.disease, w.r0, w.dur_inf, w.dur_exp, { pDeath: w.p_death, nContacts: w.n_contacts, durImmune: w.dur_immune, pAsymp: w.p_asymp }), JSON.stringify(w)).toEqual(w.warnings);
    }
  });
});
