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
    expect(appendix.blocks[0].rows.find((r) => r[0] === "n_agents")).toEqual(["n_agents", "10,000", "10,000", "10,000"]);
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
