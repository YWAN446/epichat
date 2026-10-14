import { describe, expect, it } from "vitest";

import { interventionLines } from "@/lib/client/format";
import { coveredPaths, defaultRows, parameterGroups, parameterTable, sourceTags, type ParameterRow } from "@/lib/client/parameters";
import { approxR0, validateParams, type SimParams } from "@/lib/sim/params";
import { getPath, setPath } from "@/lib/sim/paths";
import { PARAM_REGISTRY, appliesOn, appliesTo, specFor } from "@/lib/sim/registry";
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
    expect(parameterGroups(p)[0].rows[0]).toMatchObject({ label: "R₀ (approx.)", value: approxR0(p).toFixed(1), shown: true });
    expect(defaultRows(p)).toEqual([                                                         // the flat list of a run has no derived R₀: that is the formula on the run's own beta
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
    expect(plain).toMatchObject({ "Variation in susceptibility": "none", "Fatality by age": "same for every age", "Random seed": "1 (not set)", "Calibrate beta by measurement": "yes", "Age structure": "Starsim's default ages", "Contact duration": "a fresh contact every day", "Network transmission multiplier": "×1" });
  });

  it("shows the contact matrix as a grid on the age-structured network and the layers as a table on the hybrid one", () => {
    const aged = parameterGroups(params({ schema_version: 2, network: { network_type: "age_structured" } }))[1];
    const matrix = aged.rows.find((r) => r.label === "Contact matrix")!;
    expect(matrix.value).toBe("POLYMOD default (European)");
    expect(matrix.paths).toHaveLength(10);
    expect(matrix.grid).toEqual({ columns: ["from / to", "children", "adults", "elderly"], rows: [["children", "7", "2.5", "0.5"], ["adults", "2.5", "9", "1.5"], ["elderly", "0.5", "1.5", "3.5"]] });
    expect(matrix.shown).toBe(true);                                                         // the only description of the contacts on this network, default or not
    expect(matrix.detail).toBe("POLYMOD default (European): children 7 / 2.5 / 0.5, adults 2.5 / 9 / 1.5, elderly 0.5 / 1.5 / 3.5 a day with children / adults / elderly");
    expect(aged.rows.map((r) => r.label)).not.toContain("Contacts per day");
    const hybrid = parameterGroups(params({ schema_version: 2, network: { network_type: "hybrid", household_size: 4.9, school_contacts: 30 } }))[1];
    expect(hybrid.rows.find((r) => r.label === "Household size")).toMatchObject({ value: "4.9 people", shown: true });
    const layers = hybrid.rows.find((r) => r.label === "Layers")!;
    expect(layers.shown).toBe(true);                                                         // the school contacts were changed
    expect(layers.value).toBe("school 30, work 16, community 20 contacts a day");
    expect(layers.detail).toBe("household ×3; school 30 a day ×0.6; workplace 16 a day ×0.6; community 20 a day ×0.3");
    expect(defaultRows(params({ schema_version: 2, network: { network_type: "hybrid", layer_beta: { household: 1.5 } } }))).toContainEqual(["Layers", "household ×1.5; school 20 a day ×0.6; workplace 16 a day ×0.6; community 20 a day ×0.3"]);
    expect(layers.grid).toEqual({ columns: ["Layer", "Contacts per day", "Transmissibility"], rows: [["Household", "the household", "×3"], ["School", "30", "×0.6"], ["Workplace", "16", "×0.6"], ["Community", "20", "×0.3"]] });
    expect(hybrid.rows.find((r) => r.label === "School and working ages")).toMatchObject({ value: "school 6 to 22, work 22 to 65", shown: false });
    expect(hybrid.rows.map((r) => r.label)).not.toContain("Contact matrix");
    expect(hybrid.rows.map((r) => r.label)).not.toContain("Contacts per day");
  });
});

describe("where each value came from (follow-up spec 8.4)", () => {
  const p = params({ schema_version: 2, disease: { dur_inf: { mean_days: 8, dist: "gamma", sd_days: 2.4 }, rel_sus_cv: 1 } });
  const rows = (sources?: Record<string, string> | null) => Object.fromEntries(parameterGroups(p, sources).flatMap((g) => g.rows).map((r) => [r.label, r.sources]));

  it("tags a row with every source its values have, in plain words; a path that was not sent is a default", () => {
    const tagged = rows({ "disease.dur_inf.mean_days": "database", "disease.dur_inf.dist": "illustrative", "disease.dur_inf.sd_days": "illustrative", "disease.beta": "user",
      "disease.rel_sus_cv": "illustrative", "demographics.birth_rate": "fetch", "demographics.use_demographics": "fetch", "demographics.death_rate": "fetch" });
    expect(tagged["Infectious period"]).toEqual(["database", "assumption"]);                // the database's mean with an assumed spread: both are said
    expect(tagged["Transmission rate (β)"]).toEqual(["set in chat"]);
    expect(tagged["Variation in susceptibility"]).toEqual(["assumption"]);
    expect(tagged["Agents"]).toEqual(["default"]);
    expect(tagged["Initial infections"]).toEqual(["default"]);
    expect(tagged["Births and deaths"]).toEqual(["fetched"]);
    expect(tagged["R₀ (approx.)"]).toEqual([]);                                             // derived: no source of its own
  });

  it("says what the run set, and names a value set in the conversation beside the database's", () => {
    expect(rows({ "disease.beta": "run" })["Transmission rate (β)"]).toEqual(["set by the run"]);
    expect(rows({ "disease.dur_inf.mean_days": "database", "disease.dur_inf.sd_days": "user" })["Infectious period"]).toEqual(["database", "set in chat"]);
    expect(rows({ "disease.dur_inf.sd_days": "illustrative" })["Infectious period"]).toEqual(["assumption"]);   // beside defaults, only what is not one
  });

  it("renders payloads stored before the sources, and ignores paths and sources it does not know", () => {
    expect(Object.values(rows(null)).every((tags) => tags.length === 0)).toBe(true);
    expect(Object.values(rows(undefined)).every((tags) => tags.length === 0)).toBe(true);
    expect(rows({ "disease.gone": "user", "disease.beta": "weird" })["Transmission rate (β)"]).toEqual([]);
    expect(rows({ "disease.beta": "toString" })["Transmission rate (β)"]).toEqual([]);        // not a word of ours, though every object has one
    expect(sourceTags(["a", "b"], { b: "reference" })).toEqual(["reference"]);
    expect(sourceTags([], { a: "user" })).toEqual([]);
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
    expect(labels).not.toContain("R₀ (approx.)");                                            // the formula on a run's own beta is not the R0 the report states
    expect(labels.indexOf("Variation in susceptibility")).toBeLessThan(labels.indexOf("Contact network"));
    expect(labels.indexOf("Household size")).toBeLessThan(labels.indexOf("Agents"));
    for (const absent of ["Contact matrix", "Layers", "Fitted to", "Random seed", "Contact duration"]) expect(labels).not.toContain(absent);   // default or not on these networks
    expect(new Set(labels).size).toBe(labels.length);
    expect(parameterTable([])).toEqual([]);
    expect(labels).not.toContain("Interventions");                                           // neither run has any
    const closed = params({ schema_version: 2, network: { network_type: "hybrid" }, interventions: [{ type: "contact_reduction", layer: "school", scale: 1, start_day: 20, end_day: 62 }] });
    const withClosure = parameterTable([second, closed]);
    expect(interventionLines(closed)).toHaveLength(1);
    expect(interventionLines(closed)[0]).toContain("School contacts reduced by 100%");
    expect(withClosure.find((r) => r.label === "Interventions")?.values).toEqual(["none", interventionLines(closed).join("; ")]);
    const order = withClosure.map((r) => r.label);
    expect(order.indexOf("Interventions")).toBeGreaterThan(order.indexOf("Births and deaths"));
    expect(order.indexOf("Interventions")).toBeLessThan(order.indexOf("Agents"));
  });
});

describe("a covered parameter is a displayed parameter (review of phase C)", () => {
  // A scenario per network with every bundle switched on, so each path has something to show.
  const base = (network: string): SimParams => params({
    schema_version: 2,
    disease: { model: "seiar", dur_exp: { mean_days: 5, dist: "gamma", sd_days: 2 }, dur_inf: { mean_days: 8, dist: "gamma", sd_days: 2.4 }, p_death: 0.01, p_death_age: { children: 0.001, adults: 0.01, elderly: 0.1 }, seed: { mode: "count", value: 20, day: 3 } },
    network: { network_type: network },
    demographics: { use_demographics: true, age_pct_under18: 40, age_pct_18_64: 50, age_pct_over65: 10, country: "KEN", demographics_source: "UN WPP" },
    run: { rand_seed: 4, fit: { target: "attack_rate", value: 0.3, lever: "disease.beta" } },
  });
  const OTHER: Record<string, unknown> = {
    "disease.model": null,                                                                   // changes which rows exist; its own row is checked below
    "disease.dur_exp.dist": "lognormal", "disease.dur_inf.dist": "lognormal",
    "disease.seed.mode": null,                                                               // a count of 20 is no fraction: the two move together, below
    "network.network_type": null, "network.contacts_dist": "poisson", "network.contacts_source": "user",
    "demographics.country": "BRA", "demographics.demographics_source": "another source", "demographics.age_source": "shares",
    "demographics.age_pct_under18": null, "demographics.age_pct_18_64": null, "demographics.age_pct_over65": null,   // the three move together, below
    "run.fit.target": "peak_infections", "run.fit.lever": "network.network_beta", "run.fit.value": 0.4, "run.n_agents": 20000,
    "network.school_age_max": 20, "network.work_age_min": 25, "network.school_age_min": 5, "network.work_age_max": 60,
  };
  const shown = (row: ParameterRow | undefined) => JSON.stringify([row?.value, row?.detail, row?.grid]);
  /** Another valid number for the path: the next whole number for an integer, else half the value, or a value toward the upper bound when half would leave the bounds. */
  const another = (path: string, current: number): number => {
    const spec = specFor(path)!;
    if (spec.kind === "integer") return current + 1;
    const [low, high] = spec.bounds ?? [-Infinity, Infinity];
    const half = current === 0 ? Math.min(0.25, high) : current * 0.5;
    return half >= low && half !== current ? half : (current + Math.min(high, current * 2 + 1)) / 2;
  };

  it("changes the row's text, detail or grid when any path it covers changes", () => {
    const unmoved: string[] = [];
    for (const network of ["random", "age_structured", "hybrid"]) {
      const before = base(network);
      for (const group of parameterGroups(before)) {
        for (const row of group.rows) {
          for (const path of row.paths) {
            if (OTHER[path] === null) continue;
            const current = getPath(before as unknown as Record<string, unknown>, path);
            const next = path in OTHER ? OTHER[path] : typeof current === "boolean" ? !current : typeof current === "number" ? another(path, current) : undefined;
            expect(next, `no perturbation for ${path}`).not.toBeUndefined();
            const body = structuredClone(before) as unknown as Record<string, unknown>;
            setPath(body, path, next);
            const validated = validateParams(body);
            expect(validated.ok, `${path} = ${JSON.stringify(next)}: ${validated.ok ? "" : validated.error}`).toBe(true);
            if (!validated.ok) continue;
            const after = parameterGroups(validated.params).flatMap((g) => g.rows).find((r) => r.label === row.label);
            if (shown(after) === shown(row)) unmoved.push(`${network}: ${path} in "${row.label}"`);
          }
        }
      }
    }
    expect(unmoved).toEqual([]);
  });

  it("shows the model, the network and a changed age structure", () => {
    const rows = (p: SimParams) => Object.fromEntries(parameterGroups(p).flatMap((g) => g.rows).map((r) => [r.label, r.value]));
    expect(rows(base("random"))["Model"]).toBe("SEIAR");
    expect(rows(base("hybrid"))["Contact network"]).not.toBe(rows(base("random"))["Contact network"]);
    const older = structuredClone(base("random"));
    older.demographics = { ...older.demographics, age_pct_under18: 20, age_pct_18_64: 60, age_pct_over65: 20 };
    expect(rows(older)["Age structure"]).not.toBe(rows(base("random"))["Age structure"]);
    const share = structuredClone(base("random"));
    share.disease.seed = { mode: "fraction", value: 0.05, day: 3 };
    expect(rows(share)["Initial infections"]).toBe("5% on day 3");
    expect(rows(base("random"))["Initial infections"]).toBe("20 agents on day 3");
  });
});
