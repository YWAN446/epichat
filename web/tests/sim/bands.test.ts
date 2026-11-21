import { describe, expect, it } from "vitest";
import { mergeBands } from "@/lib/sim/bands";

describe("mergeBands (round-1 spec 5)", () => {
  it("adds suffixed keys, and skips a band whose length differs from day", () => {
    const series = { day: [0, 1, 2], n_infectious: [1, 5, 2] };
    const out = mergeBands(series, { n_infectious: { p10: [1, 3, 1], p90: [1, 8, 4] }, cum_deaths: { p10: [0], p90: [0] } });
    expect(out).toEqual({ day: [0, 1, 2], n_infectious: [1, 5, 2], n_infectious_p10: [1, 3, 1], n_infectious_p90: [1, 8, 4] });
    expect(series).toEqual({ day: [0, 1, 2], n_infectious: [1, 5, 2] });       // a new object
    expect(mergeBands(series, undefined)).toEqual(series);
  });
});
