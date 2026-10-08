import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ADAPTER_TIMEOUT_MS, type FetchLike } from "@/lib/data/types";
import { fetchUnWpp, mapUnRows, parseUnCsv, unLocationId } from "@/lib/data/unWpp";
import { assembleWbFields, fetchWbData360 } from "@/lib/data/wbData360";
import { fetchWhoGho, mapWhoRows } from "@/lib/data/whoGho";
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

describe("WHO GHO adapter", () => {
  it("maps the latest non-null row", () => {
    const rows = JSON.parse(fixture("who_gho_coverage.json")).value;
    expect(mapWhoRows("WHS8_110", rows, "KEN")).toEqual({ field: "mcv1_coverage", value: 76, citation: "WHO GHO, KEN, 2022", description: "", alternatives: [] });
    expect(mapWhoRows("WHS8_110", [], "KEN")).toBeNull();
    expect(mapWhoRows("NOPE", rows, "KEN")).toBeNull();
  });

  it("fetches each code and matches the Python fields", async () => {
    for (const c of parity.adapters.who_gho) {
      const { fetchImpl, calls } = fakeFetch((url) => {
        for (const [code, file] of Object.entries(c.files)) if (url.includes(`/${code}?`)) return { status: 200, body: fixture(file) };
        return new Error(`unexpected ${url}`);
      });
      const fields = await fetchWhoGho({ source: "who_gho", indicatorCodes: c.codes, locationCode: c.iso3 }, { fetchImpl });
      expect(fields, JSON.stringify(c.codes)).toEqual(c.fields);
      expect(calls[0].url).toBe(`https://ghoapi.azureedge.net/api/${c.codes[0]}?$filter=SpatialDim%20eq%20'KEN'`);
    }
  });

  it("skips a code whose request fails and keeps the rest", async () => {
    const { fetchImpl } = fakeFetch((url) => (url.includes("/MCV2?") ? new Error("down") : { status: 200, body: fixture("who_gho_coverage.json") }));
    const fields = await fetchWhoGho({ source: "who_gho", indicatorCodes: ["WHS8_110", "MCV2"], locationCode: "KEN" }, { fetchImpl });
    expect(fields.map((f) => f.field)).toEqual(["mcv1_coverage"]);
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
});
