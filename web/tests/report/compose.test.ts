import { describe, expect, it } from "vitest";

import { composeReport, runLabels } from "@/lib/report/compose";
import { FIXTURE } from "./fixture";

const NOW = new Date("2026-10-09T15:00:00Z");

describe("composeReport", () => {
  const doc = composeReport(FIXTURE, NOW);
  const section = (id: string) => doc.sections.find((s) => s.id === id)!;

  it("titles the report from the scenario and numbers the version", () => {
    expect(doc.version).toBe(1);
    expect(doc.title).toBe("Measles in Kenya, SIR model, 1 year");
    expect(doc.subtitle).toBe("EpiChat report · version 2 · 9 October 2026");
    expect(doc.generatedAt).toBe(NOW.toISOString());
    expect(doc.sections.map((s) => s.id)).toEqual(["summary", "results", "meaning", "modelled", "decisions", "limitations", "next_steps", "appendix"]);
    expect(composeReport({ ...FIXTURE, narrative: { ...FIXTURE.narrative, title: "My own title" } }, NOW).title).toBe("My own title");
  });

  it("fills the key results from the runs: one table row and one curve per run, a note for a run without a series", () => {
    const results = section("results");
    const table = results.blocks[0];
    expect(table).toMatchObject({ kind: "table", columns: ["Run", "Peak day", "Peak infections", "Attack rate", "Disease deaths"] });
    if (table.kind !== "table") throw new Error("table");
    expect(table.rows.map((r) => r[0])).toEqual(["Run 1", "Run 2, vaccine coverage 90%", "Run 3, no vaccine"]);
    expect(table.rows[0].slice(1)).toEqual(["Day 40", "900", "40.0%", "12"]);
    expect(table.rows[1].slice(1)).toEqual(["Day 55", "300", "12.5%", "3"]);
    const figure = results.blocks[1];
    expect(figure).toMatchObject({ kind: "figure", id: "infected", xLabel: "Day", yLabel: "People infected" });
    if (figure.kind !== "figure") throw new Error("figure");
    expect(figure.lines.map((l) => l.label)).toEqual(["Run 1", "Run 2, vaccine coverage 90%"]);
    expect(figure.lines[0].x.at(-1)).toBe(365);
    expect(results.blocks[2]).toEqual({ kind: "note", text: "Run 3, no vaccine's curve is not available." });
  });

  it("writes the narrative sections as paragraphs and bullets", () => {
    expect(section("summary").blocks).toEqual([{ kind: "paragraph", text: "Measles would spread fast." }, { kind: "paragraph", text: "Vaccination at 90% halves the peak." }]);
    expect(section("meaning").blocks).toEqual([{ kind: "bullets", items: ["Run 2 beats run 1", "Deaths stay low"] }]);
    expect(section("limitations").blocks).toEqual([{ kind: "paragraph", text: "Homogeneous mixing." }]);
  });

  it("describes what was modelled from the configuration and the data sources, in words", () => {
    const modelled = section("modelled");
    const rows = modelled.blocks[0];
    expect(rows).toMatchObject({ kind: "keyValues" });
    if (rows.kind !== "keyValues") throw new Error("kv");
    expect(rows.items).toContainEqual(["Disease", "Measles"]);
    expect(rows.items).toContainEqual(["Country", "Kenya"]);
    expect(rows.items).toContainEqual(["Population", "55,100,586"]);
    expect(rows.items).toContainEqual(["Agents", "10,000"]);
    const sources = modelled.blocks[1];
    expect(sources).toMatchObject({ kind: "table", caption: "Data sources", columns: ["Source", "Field", "Value", "Citation"] });
    if (sources.kind !== "table") throw new Error("table");
    expect(sources.rows[0]).toEqual(["UN World Population Prospects", "Birth rate", "28.3 per 1,000 per year", "https://population.un.org/"]);
  });

  it("lists the decisions, the appendix tables, and the software", () => {
    expect(section("decisions").blocks).toEqual([{ kind: "bullets", items: ["Measles in Kenya, SIR model, one year", "UN demographics applied"] }]);
    const appendix = section("appendix");
    expect(appendix.blocks[0]).toMatchObject({ kind: "table", caption: "Effective parameters", columns: ["Parameter", "Run 1", "Run 2, vaccine coverage 90%", "Run 3, no vaccine"] });
    if (appendix.blocks[0].kind !== "table") throw new Error("table");
    expect(appendix.blocks[0].rows.find((r) => r[0] === "Agents")).toEqual(["Agents", "10,000", "10,000", "10,000"]);
    expect(appendix.blocks[0].rows.map((r) => r[0])).not.toContain("run.n_agents");
    const literature = appendix.blocks.find((b) => b.kind === "table" && b.caption === "Literature parameters");
    expect(literature).toBeDefined();
    if (!literature || literature.kind !== "table") throw new Error("table");
    expect(literature.rows[0]).toEqual(["R₀", "15", "12–18", "ok", "https://pubmed.ncbi.nlm.nih.gov/28757186/"]);
    expect(appendix.blocks.at(-1)).toEqual({ kind: "keyValues", items: [["EpiChat", "web"], ["Starsim", "3.3.2"], ["Report format", "1"]] });
  });

  it("says so when there is no data and no recap, and omits the literature when unknown", () => {
    const bare = composeReport({ ...FIXTURE, scenario: { ...FIXTURE.scenario, dataSources: [] }, recap: [], literature: null, starsimVersion: null }, NOW);
    expect(bare.sections.find((s) => s.id === "modelled")!.blocks[1]).toEqual({ kind: "paragraph", text: "No real data was fetched; every value is a literature value or an assumption." });
    expect(bare.sections.find((s) => s.id === "decisions")!.blocks).toEqual([{ kind: "paragraph", text: "The conversation recorded no decisions." }]);
    const appendix = bare.sections.find((s) => s.id === "appendix")!;
    expect(appendix.blocks.some((b) => b.kind === "table" && b.caption === "Literature parameters")).toBe(false);
    expect(appendix.blocks.at(-1)).toMatchObject({ kind: "keyValues", items: [["EpiChat", "web"], ["Starsim", "unknown"], ["Report format", "1"]] });
  });

  it("labels runs by what changed from the previous one", () => {
    expect(runLabels(FIXTURE.runs)).toEqual(["Run 1", "Run 2, vaccine coverage 90%", "Run 3, no vaccine"]);
    expect(runLabels([FIXTURE.runs[0]])).toEqual(["Run 1"]);
    expect(runLabels([FIXTURE.runs[0], FIXTURE.runs[0]])).toEqual(["Run 1", "Run 2"]);
  });
});

describe("the measured R0 in the report (Part 2, 5.6)", () => {
  it("adds an R0 measured row after the configured R0 when the latest run carries one, and nothing otherwise", () => {
    const runs = FIXTURE.runs.map((r, i) => (i === FIXTURE.runs.length - 1 ? { ...r, stats: { ...r.stats, r0_measured: 2.4 } } : r));
    const doc = composeReport({ ...FIXTURE, runs }, NOW);
    const rows = doc.sections.find((s) => s.id === "modelled")!.blocks[0];
    if (rows.kind !== "keyValues") throw new Error("kv");
    const labels = rows.items.map(([label]) => label);
    expect(labels.indexOf("R₀ measured")).toBe(labels.indexOf("R₀ (approx.)") + 1);
    expect(rows.items).toContainEqual(["R₀ measured", "2.4"]);
    const plain = composeReport(FIXTURE, NOW).sections.find((s) => s.id === "modelled")!.blocks[0];
    if (plain.kind !== "keyValues") throw new Error("kv");
    expect(plain.items.map(([label]) => label)).not.toContain("R₀ measured");
  });
});

describe("the fit in the report (Part 2, 7.7)", () => {
  it("adds a Fitted to row after the R0 rows when the latest run was fitted, and nothing otherwise", () => {
    const fit = { target: "attack_rate", wanted: 0.3, achieved: 0.31, lever: "disease.beta", value: 9.5, runs: 4 };
    const runs = FIXTURE.runs.map((r, i) => (i === FIXTURE.runs.length - 1 ? { ...r, stats: { ...r.stats, r0_measured: 2.4, fit } } : r));
    const rows = composeReport({ ...FIXTURE, runs }, NOW).sections.find((s) => s.id === "modelled")!.blocks[0];
    if (rows.kind !== "keyValues") throw new Error("kv");
    const labels = rows.items.map(([label]) => label);
    expect(labels.indexOf("Fitted to")).toBe(labels.indexOf("R\u2080 measured") + 1);
    expect(rows.items).toContainEqual(["Fitted to", "attack rate 30% (reached 31% in 4 runs)"]);
    const peak = { target: "peak_day", wanted: 60, achieved: 58, lever: "network.network_beta", value: 1.3, runs: 3 };
    const peakRuns = FIXTURE.runs.map((r, i) => (i === 0 ? { ...r, stats: { ...r.stats, fit: peak } } : r));
    const peakRows = composeReport({ ...FIXTURE, runs: peakRuns }, NOW).sections.find((s) => s.id === "modelled")!.blocks[0];
    if (peakRows.kind !== "keyValues") throw new Error("kv");
    expect(peakRows.items.map(([label]) => label)).not.toContain("Fitted to");                    // only the latest run's fit is the report's
    const plain = composeReport(FIXTURE, NOW).sections.find((s) => s.id === "modelled")!.blocks[0];
    if (plain.kind !== "keyValues") throw new Error("kv");
    expect(plain.items.map(([label]) => label)).not.toContain("Fitted to");
  });
});

describe("the measured R0 row after the pilot fix (review I2)", () => {
  const modelled = (runs: typeof FIXTURE.runs) => {
    const rows = composeReport({ ...FIXTURE, runs }, NOW).sections.find((s) => s.id === "modelled")!.blocks[0];
    if (rows.kind !== "keyValues") throw new Error("kv");
    return rows.items;
  };
  const last = FIXTURE.runs.length - 1;

  it("never borrows an earlier run's value when the latest run's was withheld", () => {
    const runs = FIXTURE.runs.map((r, i) => ({ ...r, stats: { ...r.stats, r0_measured: i === 0 ? 5.9 : null } }));
    expect(modelled(runs).map(([label]) => label)).not.toContain("R₀ measured");
  });

  it("shows the pilot's measurement when the latest run was calibrated and its live value was withheld", () => {
    const runs = FIXTURE.runs.map((r, i) => (i === last ? { ...r, stats: { ...r.stats, r0_measured: null, r0_calibration: { target: 12, measured: 11.82, se: 0.55, corrections: 2, reached: true } } } : r));
    expect(modelled(runs)).toContainEqual(["R₀ measured", "11.8"]);
    const both = FIXTURE.runs.map((r, i) => (i === last ? { ...r, stats: { ...r.stats, r0_measured: 2.44, r0_calibration: { target: 2.5, measured: 2.49, se: 0.09, corrections: 1, reached: true } } } : r));
    expect(modelled(both)).toContainEqual(["R₀ measured", "2.4"]);                  // the live value when there is one
  });
});

describe("run labels and the limits on spread (follow-up spec 4 and 5)", () => {
  it("names a run by the variation or the response it gained or lost", () => {
    const base = FIXTURE.runs[0];
    const withCv = { ...base, effectiveParams: { ...base.effectiveParams, disease: { ...base.effectiveParams.disease, rel_sus_cv: 1 } } };
    const response = { type: "behavior_response", coverage: null, start_day: 0, end_day: null, efficacy: 1, kind: "routine", leaky: true, age_min: null, age_max: null, protection_days: null,
      capacity: null, delay_days: 0, rel_trans_treated: 1, symptomatic_only: false, scale: 0.5, shift: 0, layer: "all", half_prevalence: 0.01, memory_days: 7 } as (typeof base.effectiveParams.interventions)[number];
    const withResponse = { ...base, effectiveParams: { ...base.effectiveParams, interventions: [response] } };
    expect(runLabels([base, withCv])).toEqual(["Run 1", "Run 2, variation CV 1"]);
    expect(runLabels([withCv, base])).toEqual(["Run 1", "Run 2, no variation"]);
    expect(runLabels([base, withResponse])).toEqual(["Run 1", "Run 2, behaviour response"]);
    expect(runLabels([withResponse, base])).toEqual(["Run 1", "Run 2, no behaviour response"]);
  });
});

describe("the appendix lists the Parameters section's rows (follow-up spec 8.5)", () => {
  it("shows what differs from the defaults, the variation and the fit among it, and nothing a run's network does not have", () => {
    const base = FIXTURE.runs[0];
    const varied = { ...base, effectiveParams: { ...base.effectiveParams, disease: { ...base.effectiveParams.disease, rel_sus_cv: 1 }, run: { ...base.effectiveParams.run, fit: { target: "attack_rate" as const, value: 0.3, lever: "disease.rel_sus_cv" as const } } } };
    const doc = composeReport({ ...FIXTURE, runs: [base, varied] }, NOW);
    const table = doc.sections.find((s) => s.id === "appendix")!.blocks[0];
    if (table.kind !== "table") throw new Error("table");
    expect(table.caption).toBe("Effective parameters");
    expect(table.columns[0]).toBe("Parameter");
    const row = (label: string) => table.rows.find((r) => r[0] === label);
    expect(row("Variation in susceptibility")).toEqual(["Variation in susceptibility", "none", "CV 1"]);
    expect(row("Fitted to")).toEqual(["Fitted to", "not fitted", "attack rate 30% by moving the variation in susceptibility"]);
    expect(row("Model")).toEqual(["Model", "SIR", "SIR"]);
    for (const absent of ["Household size", "Contact duration", "Contact matrix"]) expect(row(absent)).toBeUndefined();   // the old list printed these on every run
    expect(table.rows.every((r) => r.length === 3 && r.every((cell) => typeof cell === "string"))).toBe(true);
  });
});
