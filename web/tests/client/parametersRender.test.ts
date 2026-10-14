import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ParametersSection } from "@/components/panel/ParametersSection";
import { params } from "../tools/helpers";

const render = (props: Parameters<typeof ParametersSection>[0]) => renderToStaticMarkup(createElement(ParametersSection, props));

describe("the Parameters section as it renders (follow-up spec 8)", () => {
  it("groups the rows, tags them and keeps the rest behind Show all", () => {
    const p = params({ schema_version: 2, disease: { rel_sus_cv: 1 }, network: { network_type: "hybrid" }, interventions: [{ type: "seasonality", scale: 0.3 }] });
    const html = render({ params: p, sources: { "disease.rel_sus_cv": "illustrative", "run.n_agents": "default", "network.network_type": "user" }, configured: true });
    for (const heading of ["Disease", "Contact network", "Demographics", "Interventions", "Run"]) expect(html).toContain(`>${heading}</h4>`);
    expect(html.indexOf(">Disease</h4>")).toBeLessThan(html.indexOf(">Contact network</h4>"));
    expect(html.indexOf(">Interventions</h4>")).toBeLessThan(html.indexOf(">Run</h4>"));
    expect(html).toContain("Variation in susceptibility");
    for (const tag of ["assumption", "default", "you"]) expect(html).toContain(`>${tag}</span>`);
    expect(html).toMatch(/Show all \(\d+\)/);
    expect(html).toContain("Seasonality: amplitude 0.3, shift 0");
    expect(html).toContain("<table");                                                      // the layers, a table inside Show all
    expect(html).toContain("Workplace");
    expect(html).not.toContain("Contacts per day</dt>");                                   // not a parameter of the hybrid network
  });

  it("keeps a row at its default behind Show all and shows it when it changes", () => {
    const hidden = render({ params: params({}), sources: null, configured: true });
    const shown = render({ params: params({ schema_version: 2, disease: { initial_immune_frac: 0.4 } }), sources: null, configured: true });
    const before = (html: string, label: string) => html.indexOf(`${label}</dt>`) < html.indexOf("<details");
    expect(hidden).toContain("Initially immune</dt>");
    expect(before(hidden, "Initially immune")).toBe(false);
    expect(before(shown, "Initially immune")).toBe(true);
  });

  it("renders without tags for a payload stored before them, and says so when nothing is set up", () => {
    const html = render({ params: params({}), sources: null, configured: true });
    expect(html).not.toContain(">default</span>");
    expect(html).toContain("R₀ (approx.)");
    expect(html).toContain("No interventions.");
    expect(render({ params: null, sources: null, configured: false })).toContain("Parameters appear here once a scenario is set up.");
    expect(render({ params: null, sources: null, configured: true })).toContain("were not recorded");
  });
});
