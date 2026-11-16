import { describe, expect, it } from "vitest";

import { countryDemographics, sharesFor } from "@/lib/data/countryDemographics";

describe("the bundled country demographics", () => {
  it("carries Kenya's shares, household size and contact matrix", () => {
    const ken = countryDemographics("ken")!;
    const shares = sharesFor(ken, 2024)!;
    expect(shares[0]).toBeGreaterThan(40);
    expect(shares[2]).toBeLessThan(5);
    expect(Math.abs(shares[0] + shares[1] + shares[2] - 100)).toBeLessThan(0.31);
    expect(sharesFor(ken, 2028)).toEqual(sharesFor(ken, 2030));
    expect(ken.household_size).toBeGreaterThan(3);
    expect(ken.contacts).toHaveLength(9);
    expect(countryDemographics("XXX")).toBeNull();
  });
});
