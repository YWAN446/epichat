import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataSection } from "@/components/panel/DataSection";
import { ScenarioSection } from "@/components/panel/ScenarioSection";
import type { ConfigPayload } from "@/lib/tools/types";

const CONFIG: ConfigPayload = {
  kind: "config", applied: {}, approx_r0: 12, warnings: [], new_scenario: false,
  config: { disease: "measles", disease_type: "sir", country: "KEN", n_agents: 10000, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] },
};
const AREA = { value: 2_000_000, place: "Example County, Kenya", origin: "you set it", url: null, national: false };

describe("the panel shows the population (round-1 spec 1)", () => {
  it("Scenario section has a Population row after Country", () => {
    const html = renderToStaticMarkup(createElement(ScenarioSection, { config: CONFIG, disease: null, population: AREA }));
    expect(html).toContain("2,000,000, Example County, Kenya (you set it)");
    expect(html.indexOf("Country")).toBeLessThan(html.indexOf("Population"));
    expect(renderToStaticMarkup(createElement(ScenarioSection, { config: CONFIG, disease: null, population: null }))).not.toContain("Population");
  });

  it("Data section says what stays national for an area", () => {
    const html = renderToStaticMarkup(createElement(DataSection, { data: [], disease: null, population: AREA, countryIso3: "KEN" }));
    expect(html).toContain("Ages, contact patterns and vaccination coverage are Kenya&#x27;s national figures.");
  });
});
