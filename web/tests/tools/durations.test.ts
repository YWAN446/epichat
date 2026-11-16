import { describe, expect, it } from "vitest";

import { durationFor, illustrativeSd } from "@/lib/tools/durations";

describe("duration defaults for new scenarios (spec 7.3)", () => {
  it("takes a quarter of the database range when the disease is known and the range is real", () => {
    expect(illustrativeSd("dur_exp", 12, "measles")).toBe(3.5); // incubation 7–21 days
    expect(illustrativeSd("dur_inf", 8, "measles")).toBe(2.4); // infectious 8–8: min == max, so 0.3 × mean
    expect(illustrativeSd("dur_inf", 10, null)).toBe(3);
    expect(illustrativeSd("dur_immune", 400, "ebola")).toBe(120); // no upper bound in the database
  });

  it("caps the sd at the mean so the gamma stays valid", () => {
    expect(illustrativeSd("dur_inf", 20, "tuberculosis")).toBe(20); // 14–365 days would give 87.75
  });

  it("creates gamma, keeps an existing distribution, recomputes a non-constant sd", () => {
    expect(durationFor(undefined, 8, "dur_inf", "measles")).toEqual({ mean_days: 8, dist: "gamma", sd_days: 2.4 });
    expect(durationFor({ mean_days: 10, dist: "constant", sd_days: null }, 8, "dur_inf", "measles")).toEqual({ mean_days: 8, dist: "constant", sd_days: null });
    expect(durationFor({ mean_days: 10, dist: "lognormal", sd_days: 1 }, 20, "dur_inf", null)).toEqual({ mean_days: 20, dist: "lognormal", sd_days: 6 });
  });
});
