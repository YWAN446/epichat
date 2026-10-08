import { describe, expect, it } from "vitest";

import { getTreatment, getVaccine } from "@/lib/sim/params";
import { configureSimulation } from "@/lib/tools/configureSimulation";
import { fetchDemographics } from "@/lib/tools/fetchDemographics";
import { fetchHealthSystem } from "@/lib/tools/fetchHealthSystem";
import { fetchVaccinationCoverage } from "@/lib/tools/fetchVaccinationCoverage";
import { makeDeps, rf } from "./helpers";

async function configured(deps: ReturnType<typeof makeDeps>, input: Record<string, unknown>) {
  await configureSimulation(input as never, deps);
  return deps;
}

describe("fetch_demographics", () => {
  const kenya = [
    rf("age_distribution_pct", { "0-17": 38.6, "18-64": 57.6, "65+": 3.8 }, "UN WPP 2024, Kenya (KEN), 2024"),
    rf("total_population", 213_000_000, "UN WPP 2024"),
    rf("birth_rate", 12.3, "UN WPP 2024"),
    rf("death_rate", 7.1, "UN WPP 2024"),
  ];

  it("applies age structure, population, and vital rates", async () => {
    const deps = await configured(makeDeps({ unWpp: kenya }), { disease: "dengue", n_agents: 50000 });
    const out = JSON.parse((await fetchDemographics({ country_iso3: "ken" }, deps)).content);
    const p = deps.scenario.params!;
    expect(p.age_pct_under18).toBe(38.6);
    expect(p.network_type).toBe("age_structured");
    expect(deps.scenario.totalPopulation).toBe(213_000_000);
    expect(p.birth_rate).toBe(12.3);
    expect(p.use_demographics).toBe(true);
    expect(p.country).toBe("KEN");
    expect(deps.scenario.dataSources).toHaveLength(4);
    expect(out.citations[0]).toContain("UN WPP");
    expect(out.applied.total_population).toBe(213_000_000);
    expect(deps.queries[0]).toEqual({ source: "un_wpp", indicators: [55, 59, 71, 49], locationId: 404 });
  });

  it("falls back to the sim service when the UN call returns nothing", async () => {
    const deps = await configured(makeDeps({ unWpp: [], fallback: { birth_rate: 27.3, death_rate: 7.2, source: "UN WPP 2024 — KEN (2022)" } }), { disease: "dengue" });
    const out = await fetchDemographics({ country_iso3: "KEN" }, deps);
    expect(deps.scenario.params?.birth_rate).toBe(27.3);
    expect(JSON.parse(out.content).citations).toEqual(["UN WPP 2024 — KEN (2022)", "UN WPP 2024 — KEN (2022)"]);
    expect(out.payload).toMatchObject({ kind: "data", source: "sim_fallback", iso3: "KEN" });
  });

  it("falls back when the country is not in the UN table, and reports when both fail", async () => {
    const deps = await configured(makeDeps({ unWpp: kenya, fallback: null }), { disease: "dengue" });
    // Antarctica has no UN WPP population series, so the table has no row for it.
    const out = await fetchDemographics({ country_iso3: "ATA" }, deps);
    expect(deps.queries).toEqual([]);
    expect(out.content).toBe("FETCH ERROR: No demographic data found for ATA in UN WPP, WHO Mortality Database, or World Bank Data360");
    expect(out.isError).toBe(true);
  });

  it("requires configuration first", async () => {
    const out = await fetchDemographics({ country_iso3: "BRA" }, makeDeps({ unWpp: kenya }));
    expect(out.content).toBe("Call configure_simulation first to establish the simulation before fetching data.");
    expect(out.isError).toBe(true);
  });

  it("holds the R0 across the network switch", async () => {
    const deps = makeDeps({ unWpp: [kenya[0], kenya[2], kenya[3]] });
    const configured0 = JSON.parse((await configureSimulation({ disease: "measles", disease_type: "seir", dur_exp: 11, dur_inf: 8, r0: 15, n_agents: 5000 } as never, deps)).content);
    expect(configured0.approx_r0).toBe(15);
    const betaBefore = deps.scenario.params!.beta;
    const out = JSON.parse((await fetchDemographics({ country_iso3: "KEN" }, deps)).content);
    expect(deps.scenario.params!.network_type).toBe("age_structured");
    expect(deps.scenario.params!.beta).not.toBe(betaBefore);
    expect(out.approx_r0).toBe(15);
    expect(out.applied.beta_recalibrated_to_hold_r0).toBe(15);
    expect(out.warnings).toEqual([]);
  });

  it("flags an out-of-range R0 after the fetch even without a switch", async () => {
    const deps = await configured(makeDeps({ unWpp: [kenya[2], kenya[3]] }), { disease: "measles", r0: 15, dur_inf: 30 });
    const out = JSON.parse((await fetchDemographics({ country_iso3: "KEN" }, deps)).content);
    expect(out.warnings.some((w: string) => w.includes("outside the literature range"))).toBe(true);
  });

  it("applies partial fields without switching the network", async () => {
    const deps = await configured(makeDeps({ unWpp: [kenya[2], kenya[3]] }), { disease: "dengue", r0: 3 });
    const beta = deps.scenario.params!.beta;
    const out = JSON.parse((await fetchDemographics({ country_iso3: "KEN" }, deps)).content);
    expect(deps.scenario.params!.network_type).toBe("random");
    expect(deps.scenario.params!.beta).toBe(beta);
    expect(deps.scenario.params!.use_demographics).toBe(true);
    expect(out.applied).toEqual({ birth_rate: 12.3, death_rate: 7.1 });
    expect(deps.scenario.totalPopulation).toBeNull();
  });

  it("reports an adapter failure as a FETCH ERROR", async () => {
    const deps = await configured(makeDeps({ unWpp: new Error("UN is down"), fallback: null }), { disease: "dengue" });
    const out = await fetchDemographics({ country_iso3: "KEN" }, deps);
    expect(out.content).toBe("FETCH ERROR: UN is down");
    expect(out.isError).toBe(true);
  });
});

describe("fetch_health_system", () => {
  const fields = [
    { ...rf("treatment_capacity", 2.52, "WB WDI, KEN, 2021"), description: "hospital beds/1,000", alternatives: [{ ...rf("treatment_capacity", 0.2, "WB WDI, KEN, 2021"), description: "physicians/1,000" }] },
    { ...rf("uhc_coverage", 56, "WB WDI, KEN, 2022"), description: "UHC service coverage index 0–100" },
  ];

  it("applies capacity to an existing treatment", async () => {
    const deps = await configured(makeDeps({ wbData360: fields }), { disease: "measles", n_agents: 100000, treatment_capacity: 10 });
    const out = JSON.parse((await fetchHealthSystem({ country_iso3: "KEN" }, deps)).content);
    expect(getTreatment(deps.scenario.params!)?.capacity).toBe(252);
    expect(out.applied).toEqual({ treatment_capacity: 2.52, uhc_coverage: 56, applied_treatment_capacity: 252 });
    expect(out.citations).toEqual(["WB WDI, KEN, 2021", "WB WDI, KEN, 2022"]);
    expect(deps.queries[0]).toEqual({ source: "wb_data360", indicatorCodes: ["WB_WDI_SH_MED_BEDS_ZS", "WB_WDI_SH_MED_PHYS_ZS", "WB_WDI_SH_MED_NUMW_P3", "WB_WDI_SH_UHC_SRVS_CV_XD"], locationCode: "KEN" });
  });

  it("records only when there is no treatment intervention", async () => {
    const deps = await configured(makeDeps({ wbData360: fields }), { disease: "measles" });
    await fetchHealthSystem({ country_iso3: "KEN" }, deps);
    expect(getTreatment(deps.scenario.params!)).toBeNull();
    expect(deps.scenario.dataSources).toHaveLength(2);
  });

  it("reports empty and failed fetches", async () => {
    const empty = await configured(makeDeps({ wbData360: [] }), { disease: "measles" });
    expect((await fetchHealthSystem({ country_iso3: "KEN" }, empty)).content).toBe("FETCH ERROR: no health-system data returned for KEN");
    const down = await configured(makeDeps({ wbData360: new Error("timeout") }), { disease: "measles" });
    expect((await fetchHealthSystem({ country_iso3: "KEN" }, down)).content).toBe("FETCH ERROR: timeout");
    expect((await fetchHealthSystem({ country_iso3: "KEN" }, makeDeps())).content).toMatch(/^Call configure_simulation first/);
  });
});

describe("fetch_vaccination_coverage", () => {
  it("adds a vaccine intervention once", async () => {
    const deps = await configured(makeDeps({ whoGho: [rf("mcv1_coverage", 88, "WHO GHO, KEN, 2022")] }), { disease: "measles" });
    const first = JSON.parse((await fetchVaccinationCoverage({ country_iso3: "KEN", disease: "measles" }, deps)).content);
    expect(getVaccine(deps.scenario.params!)).toMatchObject({ coverage: 0.88, start_day: 0 });
    expect(first.applied).toEqual({ mcv1_coverage: 88, applied_vaccine_coverage: 0.88 });
    expect(deps.queries[0]).toEqual({ source: "who_gho", indicatorCodes: ["WHS8_110", "MCV2"], locationCode: "KEN" });
    await fetchVaccinationCoverage({ country_iso3: "KEN", disease: "measles" }, deps);
    expect(deps.scenario.params!.interventions.filter((i) => i.type === "vaccine")).toHaveLength(1);
  });

  it("says when no indicator exists and when the adapter fails", async () => {
    const deps = await configured(makeDeps({ whoGho: new Error("boom") }), { disease: "dengue" });
    const none = await fetchVaccinationCoverage({ country_iso3: "BRA", disease: "dengue fever" }, deps);
    expect(none.content).toBe("NO VACCINE INDICATOR: no routine-immunization coverage indicator is available for dengue.");
    expect(none.isError).toBeUndefined();
    const failed = await fetchVaccinationCoverage({ country_iso3: "BRA", disease: "measles" }, deps);
    expect(failed.content).toBe("FETCH ERROR: boom");
    const empty = await configured(makeDeps({ whoGho: [] }), { disease: "measles" });
    expect((await fetchVaccinationCoverage({ country_iso3: "BRA", disease: "measles" }, empty)).content).toBe("FETCH ERROR: no vaccination data returned for BRA");
  });
});
