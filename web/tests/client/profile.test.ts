import { describe, expect, it } from "vitest";

import { COUNTRY_OPTIONS, countryIso3For, countryLabel, diseaseLabel } from "@/lib/client/profile";

describe("the country suggestion input", () => {
  it("resolves a typed name or code to the ISO3, whatever the case, and nothing else", () => {
    expect(countryIso3For("Kenya")).toBe("KEN");
    expect(countryIso3For("kenya")).toBe("KEN");
    expect(countryIso3For("KEN")).toBe("KEN");
    expect(countryIso3For("ken")).toBe("KEN");
    expect(countryIso3For("  Kenya ")).toBe("KEN");
    expect(countryIso3For("Narnia")).toBeNull();
    expect(countryIso3For("")).toBeNull();
  });

  it("shows the name for a code and lists the countries by name", () => {
    expect(countryLabel("KEN")).toBe("Kenya");
    expect(countryLabel(null)).toBe("");
    expect(COUNTRY_OPTIONS.length).toBeGreaterThan(150);
    const names = COUNTRY_OPTIONS.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(COUNTRY_OPTIONS.find((c) => c.iso3 === "KEN")).toEqual({ iso3: "KEN", name: "Kenya" });
  });

  it("shows a stored disease key by its name and unknown text as typed", () => {
    const diseases = [{ key: "measles", name: "Measles" }];
    expect(diseaseLabel("measles", diseases)).toBe("Measles");
    expect(diseaseLabel("Unicorn pox", diseases)).toBe("Unicorn pox");
    expect(diseaseLabel(null, diseases)).toBe("");
  });
});
