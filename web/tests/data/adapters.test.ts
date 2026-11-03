import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ADAPTER_TIMEOUT_MS, type FetchLike } from "@/lib/data/types";
import { fetchUnWpp, mapUnRows, parseUnCsv, unLocationId } from "@/lib/data/unWpp";
import { assembleWbFields, fetchWbData360 } from "@/lib/data/wbData360";
import { UNICEF_INDICATOR_MAP, fetchUnicef, mapUnicefRows, parseCsv } from "@/lib/data/unicef";
import parity from "../fixtures/parity.json";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/adapters/${name}`, import.meta.url), "utf8");

type Call = { url: string; init?: RequestInit };
function fakeFetch(answer: (url: string) => { status: number; body: string } | Error): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const a = answer(url);
    if (a instanceof Error) throw a;
    return new Response(a.body, { status: a.status });
  };
  return { fetchImpl, calls };
}

describe("UN WPP adapter", () => {
  it("knows the location table", () => {
    expect(unLocationId("KEN")).toBe(404);
    expect(unLocationId("ken")).toBe(404);
    expect(unLocationId("XXX")).toBeNull();
  });

  it("parses CRLF and the sep line", () => {
    const rows = parseUnCsv(fixture("un_wpp_combined.csv"));
    expect(rows).toHaveLength(6);
    expect(rows[0].IndicatorId).toBe("55");
    expect(rows[0].Value).toBe("10.648");
    expect(parseUnCsv("sep =|\r\nA|B\r\n1\r\n")).toEqual([{ A: "1", B: "" }]);
  });

  it("maps rows exactly as the Python adapter", () => {
    for (const c of parity.adapters.un_wpp) {
      expect(mapUnRows(parseUnCsv(fixture(c.file)), c.location_id), c.file).toEqual(c.fields);
    }
  });

  it("fetches with the bearer, the current year, and a timeout; returns nothing on failure", async () => {
    const good = fakeFetch(() => ({ status: 200, body: fixture("un_wpp_birth_death.csv") }));
    const fields = await fetchUnWpp({ source: "un_wpp", indicators: [55, 59, 71, 49], locationId: 840 }, { apiKey: "tok", fetchImpl: good.fetchImpl, now: () => new Date("2026-10-08T00:00:00Z") });
    expect(fields.map((f) => f.field)).toEqual(["birth_rate", "death_rate"]);
    expect(good.calls[0].url).toBe("https://population.un.org/dataportalapi/api/v1/data/indicators/55,59,71,49/locations/840/start/2020/end/2026/?format=csv");
    expect((good.calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(good.calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    const noKey = fakeFetch(() => ({ status: 200, body: fixture("un_wpp_birth_death.csv") }));
    await fetchUnWpp({ source: "un_wpp", indicators: [55], locationId: 840 }, { fetchImpl: noKey.fetchImpl });
    expect((noKey.calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined();
    const bad = fakeFetch(() => ({ status: 500, body: "boom" }));
    expect(await fetchUnWpp({ source: "un_wpp", indicators: [55], locationId: 840 }, { fetchImpl: bad.fetchImpl })).toEqual([]);
    const down = fakeFetch(() => new Error("ECONNRESET"));
    expect(await fetchUnWpp({ source: "un_wpp", indicators: [55], locationId: 840 }, { fetchImpl: down.fetchImpl })).toEqual([]);
    expect(ADAPTER_TIMEOUT_MS).toBe(15_000);
  });
});

describe("UNICEF adapter (the WHO/UNICEF estimates)", () => {
  const now = () => new Date("2026-11-03T12:00:00Z");

  it("parses quoted fields, doubled quotes and CRLF", () => {
    expect(parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\r\n2,,\n')).toEqual([["a", "b", "c"], ["1", "x, y", 'say "hi"'], ["2", "", ""]]);
  });

  it("maps the latest year with a value, per code in the order asked", () => {
    const rows = parseCsv(fixture("../unicef/ken_mcv1_mcv2.csv"));
    expect(mapUnicefRows(rows, ["IM_MCV2", "IM_MCV1"], "KEN")).toEqual([
      { field: "mcv2_coverage", value: 81, citation: "WHO/UNICEF estimates, KEN, 2025", description: "measles-containing vaccine, second dose (% of children)", alternatives: [] },
      { field: "mcv1_coverage", value: 80, citation: "WHO/UNICEF estimates, KEN, 2025", description: "measles-containing vaccine, first dose (% of children)", alternatives: [] },
    ]);
    const blank = parseCsv("REF_AREA,INDICATOR,TIME_PERIOD,OBS_VALUE\nKEN,IM_BCG,2024,90\nKEN,IM_BCG,2025,\n");
    expect(mapUnicefRows(blank, ["IM_BCG", "IM_DTP3"], "KEN").map((f) => [f.value, f.citation])).toEqual([[90, "WHO/UNICEF estimates, KEN, 2024"]]);
    expect(mapUnicefRows([], ["IM_BCG"], "KEN")).toEqual([]);
  });

  it("asks once for every code, ten years back, and gives up after the timeout", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: fixture("../unicef/ken_mcv1_mcv2.csv") }));
    const fields = await fetchUnicef({ source: "unicef", indicatorCodes: ["IM_MCV1", "NOPE", "IM_MCV2"], locationCode: "ken" }, { fetchImpl, now });
    expect(fields.map((f) => [f.field, f.value])).toEqual([["mcv1_coverage", 80], ["mcv2_coverage", 81]]);
    expect(calls.map((c) => c.url)).toEqual(["https://sdmx.data.unicef.org/ws/public/sdmxapi/rest/data/UNICEF,IMMUNISATION,1.0/KEN.IM_MCV1+IM_MCV2.?format=csv&labels=id&startPeriod=2016"]);
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(UNICEF_INDICATOR_MAP.IM_RCV1[0]).toBe("rcv1_coverage");
  });

  it("reads a 404 as no data and asks for nothing without a known code", async () => {
    const missing = fakeFetch(() => ({ status: 404, body: fixture("../unicef/no_results.xml") }));
    expect(await fetchUnicef({ source: "unicef", indicatorCodes: ["IM_MENGA"], locationCode: "USA" }, { fetchImpl: missing.fetchImpl, now })).toEqual([]);
    const none = fakeFetch(() => new Error("must not be called"));
    expect(await fetchUnicef({ source: "unicef", indicatorCodes: ["WHS8_110"], locationCode: "KEN" }, { fetchImpl: none.fetchImpl, now })).toEqual([]);
    expect(none.calls).toEqual([]);
  });

  it("says the service is down rather than that there is no data", async () => {
    const down = fakeFetch(() => ({ status: 500, body: "<html><body>Server Error 500</body></html>" }));
    await expect(fetchUnicef({ source: "unicef", indicatorCodes: ["IM_MCV1"], locationCode: "KEN" }, { fetchImpl: down.fetchImpl, now })).rejects.toThrow("UNICEF data service unavailable (HTTP 500)");
    const offline = fakeFetch(() => new Error("fetch failed"));
    await expect(fetchUnicef({ source: "unicef", indicatorCodes: ["IM_MCV1"], locationCode: "KEN" }, { fetchImpl: offline.fetchImpl, now })).rejects.toThrow("UNICEF data service unavailable (fetch failed)");
  });

  it("reads only SDMX's own no-data answer as no data: a moved or renamed dataset is the service being unavailable", async () => {
    const ask = (answer: { status: number; body: string }) =>
      fetchUnicef({ source: "unicef", indicatorCodes: ["IM_MCV1"], locationCode: "KEN" }, { fetchImpl: fakeFetch(() => answer).fetchImpl, now });
    await expect(ask({ status: 404, body: fixture("../unicef/no_dataflow.xml") })).rejects.toThrow("UNICEF data service unavailable (HTTP 404)");   // a retired dataflow version
    await expect(ask({ status: 404, body: "<html><body>Not Found</body></html>" })).rejects.toThrow("UNICEF data service unavailable (HTTP 404)");   // a moved path
    await expect(ask({ status: 200, body: "<html><body>Down for maintenance</body></html>" })).rejects.toThrow("UNICEF data service unavailable (unexpected response)");
    expect(await ask({ status: 200, body: "REF_AREA,INDICATOR,TIME_PERIOD,OBS_VALUE\n" })).toEqual([]);   // the columns, and no rows
  });
});

describe("World Bank Data360 adapter", () => {
  it("groups capacity candidates like the Python adapter", async () => {
    for (const c of parity.adapters.wb_data360) {
      const { fetchImpl, calls } = fakeFetch((url) => {
        for (const [code, file] of Object.entries(c.files)) if (url.includes(`INDICATOR=${code}&`)) return { status: 200, body: fixture(file) };
        return new Error(`unexpected ${url}`);
      });
      const fields = await fetchWbData360({ source: "wb_data360", indicatorCodes: c.codes, locationCode: c.iso3 }, { fetchImpl });
      expect(fields, JSON.stringify(c.files)).toEqual(c.fields);
      expect(calls[0].url).toBe("https://data360api.worldbank.org/data360/data?DATABASE_ID=WB_WDI&INDICATOR=WB_WDI_SH_MED_BEDS_ZS&REF_AREA=KEN&timePeriodFrom=2020&timePeriodTo=2025");
      expect((calls[0].init?.headers as Record<string, string>)["User-Agent"]).toBe("EpiChat/1.0");
    }
  });

  it("assembles raw values in request order and picks the latest period", () => {
    const raw = new Map([["WB_WDI_SH_UHC_SRVS_CV_XD", { value: 56, year: "2022" }], ["WB_WDI_SH_MED_PHYS_ZS", { value: 0.2, year: "2021" }]]);
    expect(assembleWbFields(raw, "KEN").map((f) => [f.field, f.description])).toEqual([["uhc_coverage", "UHC service coverage index 0–100"], ["treatment_capacity", "physicians/1,000"]]);
  });

  it("reads the World Bank's Pol3 from its health database and names the database", async () => {
    const body = JSON.stringify({ value: [{ OBS_VALUE: "91", TIME_PERIOD: "2021" }, { OBS_VALUE: "87", TIME_PERIOD: "2022" }, { OBS_VALUE: null, TIME_PERIOD: "2023" }] });
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body }));
    const fields = await fetchWbData360({ source: "wb_data360", indicatorCodes: ["WB_HNP_SH_IMM_POL3"], locationCode: "KEN", databaseId: "WB_HNP", startYear: 2015 }, { fetchImpl });
    expect(fields).toEqual([{ field: "polio_coverage", value: 87, citation: "WB HNP, KEN, 2022", description: "Pol3 immunization (% of one-year-old children)", alternatives: [] }]);
    expect(calls[0].url).toBe("https://data360api.worldbank.org/data360/data?DATABASE_ID=WB_HNP&INDICATOR=WB_HNP_SH_IMM_POL3&REF_AREA=KEN&timePeriodFrom=2015&timePeriodTo=2025");
  });
});
