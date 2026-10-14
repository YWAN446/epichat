import { describe, expect, it } from "vitest";

import { coveredPaths, defaultRows, parameterGroups, parameterTable, sourceTag } from "@/lib/client/parameters";
import { approxR0 } from "@/lib/sim/params";
import { PARAM_REGISTRY, appliesOn, appliesTo } from "@/lib/sim/registry";
import { params } from "../tools/helpers";

const MODELS = ["sir", "seir", "sirs", "seirs", "seiar", "sis"] as const;
const NETWORKS = ["random", "age_structured", "hybrid"] as const;
const scenario = (model: string, network: string) => params({
  schema_version: 2,
  disease: { model, ...(["seir", "seirs", "seiar"].includes(model) ? { dur_exp: { mean_days: 5 } } : {}), ...(["sirs", "seirs"].includes(model) ? { dur_immune: { mean_days: 180 } } : {}) },
  network: { network_type: network },
});

describe("the Parameters section's rows come from the registry (follow-up spec 8.3)", () => {
  it("covers every parameter that applies to a scenario exactly once, on every model and network", () => {
    for (const model of MODELS) {
      for (const network of NETWORKS) {
        const expected = PARAM_REGISTRY.filter((s) => s.module !== "interventions" && appliesTo(s, model) && appliesOn(s, network)).map((s) => s.path).sort();
        const covered = coveredPaths(scenario(model, network));
        expect([...covered].sort(), `${model} on ${network}`).toEqual(expected);
        expect(new Set(covered).size, `${model} on ${network}: a path covered twice`).toBe(covered.length);
      }
    }
  });

  it("has five groups in the registry's module order, the interventions as lines", () => {
    const groups = parameterGroups(params({ interventions: [{ type: "seasonality", scale: 0.3 }] }));
    expect(groups.map((g) => [g.id, g.title])).toEqual([["disease", "Disease"], ["network", "Contact network"], ["demographics", "Demographics"], ["interventions", "Interventions"], ["run", "Run"]]);
    expect(groups[3].rows).toEqual([]);
    expect(groups[3].lines).toEqual(["Seasonality: amplitude 0.3, shift 0"]);
    expect(groups[0].rows[0]).toMatchObject({ label: "R₀ (approx.)", paths: [], shown: true });
    expect(groups.filter((g) => g.id !== "interventions").every((g) => g.lines === undefined)).toBe(true);
  });

  it("shows the core rows and the rows that differ from the default, and keeps the rest for Show all", () => {
    const p = params({ disease_type: "seir", beta: 171.09375, n_contacts: 4, init_prev: 0.01, dur_inf: 8, dur_exp: 11, p_death: 0.001, n_agents: 10000, sim_dur_years: 1 });
    expect(defaultRows(p)).toEqual([
      ["R₀ (approx.)", approxR0(p).toFixed(1)],
      ["Model", "SEIR"],
      ["Transmission rate (β)", "171.1"],
      ["Infectious period", "8 days"],
      ["Exposed period", "11 days"],
      ["Death probability", "0.1%"],
      ["Initial infections", "1%"],
      ["Contact network", "random"],
      ["Contacts per day", "4"],
      ["Births and deaths", "not modelled"],
      ["Country", "not set"],
      ["Agents", "10,000"],
      ["Duration", "1 year"],
    ]);
    const disease = parameterGroups(p)[0];
    const hidden = disease.rows.filter((r) => !r.shown).map((r) => r.label);
    expect(hidden).toEqual(expect.arrayContaining(["Variation in susceptibility", "Susceptibility by age", "Fatality by age", "Presymptomatic transmission", "Initially immune"]));
    expect(parameterGroups(params({})).flatMap((g) => g.rows).find((r) => r.label === "Transmission rate (β)")?.shown).toBe(false);   // the default beta is not core
  });

  it("writes a bundle of parameters as one row", () => {
    const v2 = params({ schema_version: 2, disease: { dur_inf: { mean_days: 8, dist: "gamma", sd_days: 2.4 }, seed: { mode: "count", value: 20, day: 5 }, initial_immune_frac: 0.4, rel_sus_cv: 1 }, run: { n_replicates: 3, rand_seed: 42 } });
    const rows = parameterGroups(v2).flatMap((g) => g.rows);
    const row = (label: string) => rows.find((r) => r.label === label)!;
    expect(row("Infectious period")).toMatchObject({ value: "8 days, gamma (sd 2.4)", paths: ["disease.dur_inf.mean_days", "disease.dur_inf.dist", "disease.dur_inf.sd_days"], shown: true });
    expect(row("Initial infections")).toMatchObject({ value: "20 agents on day 5", paths: ["disease.seed.value", "disease.seed.mode", "disease.seed.day"] });
    expect(row("Initially immune")).toMatchObject({ value: "40%", shown: true });
    expect(row("Variation in susceptibility")).toMatchObject({ value: "CV 1", shown: true });
    expect(row("Replicates")).toMatchObject({ value: "3", shown: true });
    expect(row("Random seed")).toMatchObject({ value: "42", shown: true });
    expect(row("Fitted to")).toMatchObject({ value: "not fitted", shown: false, paths: ["run.fit.target", "run.fit.value", "run.fit.lever"] });
    const fitted = params({ schema_version: 2, run: { fit: { target: "attack_rate", value: 0.3 } } });
    expect(defaultRows(fitted)).toContainEqual(["Fitted to", "attack rate 30% by moving the transmission rate"]);
    const plain = Object.fromEntries(parameterGroups(params({})).flatMap((g) => g.rows).map((r) => [r.label, r.value]));
    expect(plain).toMatchObject({ "Variation in susceptibility": "none", "Fatality by age": "same for every age", "Random seed": "a new one each run", "Calibrate beta by measurement": "yes", "Age structure": "Starsim's default ages", "Contact duration": "a fresh contact every day", "Network transmission multiplier": "×1" });
  });

  it("shows the contact matrix as a grid on the age-structured network and the layers as a table on the hybrid one", () => {
    const aged = parameterGroups(params({ schema_version: 2, network: { network_type: "age_structured" } }))[1];
    const matrix = aged.rows.find((r) => r.label === "Contact matrix")!;
    expect(matrix.value).toBe("POLYMOD default (European)");
    expect(matrix.paths).toHaveLength(10);
    expect(matrix.grid).toEqual({ columns: ["", "children", "adults", "elderly"], rows: [["children", "7", "2.5", "0.5"], ["adults", "2.5", "9", "1.5"], ["elderly", "0.5", "1.5", "3.5"]] });
    expect(matrix.shown).toBe(false);                                                        // the bundled default, kept for Show all
    expect(aged.rows.map((r) => r.label)).not.toContain("Contacts per day");
    const hybrid = parameterGroups(params({ schema_version: 2, network: { network_type: "hybrid", household_size: 4.9, school_contacts: 30 } }))[1];
    expect(hybrid.rows.find((r) => r.label === "Household size")).toMatchObject({ value: "4.9 people", shown: true });
    const layers = hybrid.rows.find((r) => r.label === "Layers")!;
    expect(layers.shown).toBe(true);                                                         // the school contacts were changed
    expect(layers.value).toBe("school 30, work 16, community 20 contacts a day");
    expect(layers.grid).toEqual({ columns: ["Layer", "Contacts per day", "Transmissibility"], rows: [["Household", "the household", "×3"], ["School", "30", "×0.6"], ["Workplace", "16", "×0.6"], ["Community", "20", "×0.3"]] });
    expect(hybrid.rows.find((r) => r.label === "School and working ages")).toMatchObject({ value: "school 6 to 22, work 22 to 65", shown: false });
    expect(hybrid.rows.map((r) => r.label)).not.toContain("Contact matrix");
    expect(hybrid.rows.map((r) => r.label)).not.toContain("Contacts per day");
  });
});

describe("where each value came from (follow-up spec 8.4)", () => {
  const p = params({ schema_version: 2, disease: { dur_inf: { mean_days: 8, dist: "gamma", sd_days: 2.4 }, rel_sus_cv: 1 } });
  const rows = (sources?: Record<string, string> | null) => Object.fromEntries(parameterGroups(p, sources).flatMap((g) => g.rows).map((r) => [r.label, r.source]));

  it("tags a row by its paths' sources, in the user's words", () => {
    const tagged = rows({ "disease.dur_inf.mean_days": "database", "disease.dur_inf.dist": "illustrative", "disease.dur_inf.sd_days": "illustrative", "disease.beta": "user",
      "disease.rel_sus_cv": "illustrative", "run.n_agents": "default", "demographics.birth_rate": "fetch", "demographics.use_demographics": "fetch", "demographics.death_rate": "fetch",
      "disease.seed.value": "default", "disease.seed.mode": "default", "disease.seed.day": "default" });
    expect(tagged["Infectious period"]).toBe("database");                                  // the mean's source leads; the spread is an assumption beside it
    expect(tagged["Transmission rate (β)"]).toBe("you");
    expect(tagged["Variation in susceptibility"]).toBe("assumption");
    expect(tagged["Agents"]).toBe("default");
    expect(tagged["Initial infections"]).toBe("default");
    expect(tagged["Births and deaths"]).toBe("fetched");
    expect(tagged["R₀ (approx.)"]).toBeNull();                                             // derived: no source of its own
    expect(tagged["Duration"]).toBeNull();                                                 // no source was sent for it
  });

  it("is you as soon as the user set one of a row's values, and an assumption beside a default", () => {
    expect(rows({ "disease.dur_inf.mean_days": "database", "disease.dur_inf.sd_days": "user" })["Infectious period"]).toBe("you");
    expect(rows({ "disease.dur_inf.mean_days": "default", "disease.dur_inf.sd_days": "illustrative" })["Infectious period"]).toBe("assumption");
  });

  it("renders payloads stored before the sources, and ignores paths and sources it does not know", () => {
    expect(Object.values(rows(null)).every((tag) => tag === null)).toBe(true);
    expect(Object.values(rows(undefined)).every((tag) => tag === null)).toBe(true);
    expect(rows({ "disease.gone": "user", "disease.beta": "weird" })["Transmission rate (β)"]).toBeNull();
    expect(sourceTag(["a", "b"], { a: "default", b: "reference" })).toBe("reference");
  });
});

describe("the same rows in the report (follow-up spec 8.5)", () => {
  it("unites the runs' rows in group order, with each run's own value and a gap where a row does not apply", () => {
    const first = params({ schema_version: 2, disease: { rel_sus_cv: 1 } });
    const second = params({ schema_version: 2, network: { network_type: "hybrid", household_size: 4.9 } });
    const table = parameterTable([first, second]);
    const row = (label: string) => table.find((r) => r.label === label)?.values;
    expect(row("Variation in susceptibility")).toEqual(["CV 1", "none"]);                    // shown for one run: the other run's own value beside it
    expect(row("Contacts per day")).toEqual(["4", null]);                                    // not a parameter of the hybrid network
    expect(row("Household size")).toEqual([null, "4.9 people"]);
    expect(row("Contact network")).toEqual(["random", "hybrid (households, schools, workplaces, community)"]);
    expect(row("Agents")).toEqual(["10,000", "10,000"]);
    const labels = table.map((r) => r.label);
    expect(labels[0]).toBe("R₀ (approx.)");
    expect(labels.indexOf("Variation in susceptibility")).toBeLessThan(labels.indexOf("Contact network"));
    expect(labels.indexOf("Household size")).toBeLessThan(labels.indexOf("Agents"));
    for (const absent of ["Contact matrix", "Layers", "Fitted to", "Random seed", "Contact duration"]) expect(labels).not.toContain(absent);   // default or not on these networks
    expect(new Set(labels).size).toBe(labels.length);
    expect(parameterTable([])).toEqual([]);
  });
});
