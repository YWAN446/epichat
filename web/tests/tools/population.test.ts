import { describe, expect, it } from "vitest";
import { populationView } from "@/lib/tools/population";
import { emptyScenario } from "@/lib/tools/types";

describe("populationView (round-1 spec 1)", () => {
  const kenya = () => ({ ...emptyScenario(), countryIso3: "KEN", totalPopulation: 55_100_000, dataSources: [{ field: "total_population", value: 55_100_000, citation: "UN WPP 2024", description: "", alternatives: [] }] });

  it("shows an area set by the user", () => {
    const s = { ...kenya(), area: { name: "Example County", population: 2_000_000, countryIso3: "KEN", source: { kind: "user" as const } } };
    expect(populationView(s)).toEqual({ value: 2_000_000, place: "Example County, Kenya", origin: "you set it", url: null, national: false });
  });

  it("shows an area found on the web with its source", () => {
    const s = { ...kenya(), area: { name: "Example County", population: 2_000_000, countryIso3: "KEN", source: { kind: "web" as const, title: "Census 2019", url: "https://example.org" } } };
    expect(populationView(s)).toMatchObject({ origin: "Census 2019", url: "https://example.org", national: false });
  });

  it("falls back to the country's total, then to none", () => {
    expect(populationView(kenya())).toEqual({ value: 55_100_000, place: "Kenya", origin: "UN World Population Prospects", url: null, national: true });
    expect(populationView(emptyScenario())).toBeNull();
  });
});
