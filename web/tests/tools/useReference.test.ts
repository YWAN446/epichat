import { describe, expect, it } from "vitest";

import refs from "@/data/disease_refs.json";
import { estimateAt } from "@/lib/disease/refs";
import { approxR0 } from "@/lib/sim/params";
import { configureSimulation } from "@/lib/tools/configureSimulation";
import { fetchDemographics } from "@/lib/tools/fetchDemographics";
import { makeDeps, rf } from "./helpers";

const run = (deps: ReturnType<typeof makeDeps>, input: Record<string, unknown>) => configureSimulation(input as never, deps);
type Estimate = { value?: number; range?: [number, number]; special_value?: string; title: string; year?: number; url?: string; doi?: string };
const ALL = (refs as unknown as { diseases: Record<string, { parameters: Record<string, { estimates: Estimate[] }> }> }).diseases;
const estimates = (disease: string, parameter: string) => ALL[disease].parameters[parameter].estimates;
const applied = (out: { content: string }) => (JSON.parse(out.content) as { applied: { use_reference: Record<string, unknown> } }).applied.use_reference;
const chosen = (deps: ReturnType<typeof makeDeps>) => deps.scenario.dataSources.filter((f) => f.field.startsWith("ref:"));

describe("configure_simulation applies a chosen reference (follow-up spec 9.3)", () => {
  it("reads the estimate the list numbers, sets R0 through beta, and records the choice", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles" });
    const second = estimates("measles", "r0")[1];
    const out = await run(deps, { use_reference: { parameter: "r0", index: 2 } });
    expect(out.isError, out.content).toBeFalsy();
    expect(approxR0(deps.scenario.params!)).toBeCloseTo(second.value!, 1);
    expect(applied(out)).toMatchObject({ parameter: "r0", index: 2, value: second.value, title: second.title });
    const source = deps.scenario.dataSources.find((f) => f.field === "ref:r0")!;
    expect(source).toMatchObject({ value: second.value, description: "Chosen from the literature table" });
    expect(source.citation).toContain(second.title);
    if (second.year) expect(source.citation).toContain(String(second.year));
    expect(estimateAt("measles", "r0", 2)).toEqual(second);
    expect(estimateAt("measles", "r0", 0)).toBeNull();
    expect(estimateAt("measles", "r0", 1.5)).toBeNull();
    expect(estimateAt("not_a_disease", "r0", 1)).toBeNull();
  });

  it("converts units: percent to a fraction, a duration to days, contacts to a whole number", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", model: "seir", dur_exp_days: 10 });
    const fatality = estimates("measles", "fatality_rate")[0];
    await run(deps, { use_reference: { parameter: "fatality_rate", index: 1 } });
    expect(deps.scenario.params!.disease.p_death).toBeCloseTo(fatality.value! / 100, 9);
    const incubation = estimates("measles", "incubation_days")[0];
    await run(deps, { use_reference: { parameter: "incubation_days", index: 1 } });
    expect(deps.scenario.params!.disease.dur_exp!.mean_days).toBe(incubation.value);
    const infectious = estimates("measles", "infectious_days")[0];
    await run(deps, { use_reference: { parameter: "infectious_days", index: 1 } });
    expect(deps.scenario.params!.disease.dur_inf.mean_days).toBe(infectious.value);
    const contacts = estimates("measles", "average_contacts_daily")[0];
    await run(deps, { use_reference: { parameter: "average_contacts_daily", index: 1 } });
    expect(deps.scenario.params!.network.n_contacts).toBe(Math.round(contacts.value!));
    expect(chosen(deps).map((f) => f.field).sort()).toEqual(["ref:average_contacts_daily", "ref:fatality_rate", "ref:incubation_days", "ref:infectious_days"]);
    expect(deps.scenario.dataSources.find((f) => f.field === "ref:fatality_rate")!.value).toBeCloseTo(fatality.value! / 100, 9);   // in the unit it was applied in
  });

  it("reads an asymptomatic share in the unit its disease uses, and an immunity duration in days", async () => {
    const covid = makeDeps();
    await run(covid, { disease: "covid19", model: "seiar", dur_exp_days: 5 });
    const share = estimates("covid19", "asymptomatic_fraction")[2];
    expect(share.value).toBe(44.1);                                                          // a percentage in this disease's entry
    await run(covid, { use_reference: { parameter: "asymptomatic_fraction", index: 3 } });
    expect(covid.scenario.params!.disease.p_asymp).toBeCloseTo(0.441, 9);
    const hepatitis = makeDeps();
    await run(hepatitis, { disease: "hepatitis_a", model: "sirs", dur_immune_days: 200 });
    const immunity = estimates("hepatitis_a", "immunity_duration")[1];
    expect(immunity.value).toBe(7300);
    const out = await run(hepatitis, { use_reference: { parameter: "immunity_duration", index: 2 } });
    expect(out.isError, out.content).toBeFalsy();
    expect(hepatitis.scenario.params!.disease.dur_immune!.mean_days).toBe(7300);
  });

  it("replaces an earlier choice for the same parameter", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles" });
    await run(deps, { use_reference: { parameter: "r0", index: 1 } });
    await run(deps, { use_reference: { parameter: "r0", index: 2 } });
    expect(chosen(deps)).toHaveLength(1);
    expect(chosen(deps)[0].value).toBe(estimates("measles", "r0")[1].value);
  });

  it("refuses what it cannot apply, saying what to do, and writes nothing", async () => {
    const deps = makeDeps();
    const none = await run(deps, { use_reference: { parameter: "r0", index: 1 } });
    expect(none.isError).toBe(true);                                                         // no disease yet
    expect(none.content).toContain("needs a disease");
    await run(deps, { disease: "measles" });
    const before = structuredClone(deps.scenario.params);
    const cases: [Record<string, unknown>, string][] = [
      [{ parameter: "r0", index: 99 }, "has 11 estimates"],
      [{ parameter: "r0", index: 0 }, "index must be 1 to 11"],
      [{ parameter: "incubation_days", index: 1 }, "the sir model has no latent period; switch to seir first"],
      [{ parameter: "asymptomatic_fraction", index: 1 }, "no estimate"],
      [{ parameter: "not_a_parameter", index: 1 }, "use_reference"],
    ];
    for (const [use_reference, message] of cases) {
      const out = await run(deps, { use_reference });
      expect(out.isError, JSON.stringify(use_reference)).toBe(true);
      expect(out.content, JSON.stringify(use_reference)).toContain(message);
    }
    expect(deps.scenario.params).toEqual(before);
    expect(chosen(deps)).toEqual([]);
    const both = await run(deps, { r0: 12, use_reference: { parameter: "r0", index: 1 } });
    expect(both.isError).toBe(true);
    expect(both.content).toContain("r0 and use_reference");
    const hybrid = makeDeps();
    await run(hybrid, { disease: "measles", network_type: "hybrid" });
    const contacts = await run(hybrid, { use_reference: { parameter: "average_contacts_daily", index: 1 } });
    expect(contacts.isError).toBe(true);
    expect(contacts.content).toContain("random network");
  });

  it("refuses a value the registry or the contacts cannot take, naming it, and writes nothing", async () => {
    expect(estimates("measles", "average_contacts_daily")[4].value).toBe(350);
    expect(estimates("measles", "r0")[7].value).toBe(103.5);
    const deps = makeDeps();
    await run(deps, { disease: "measles" });
    const before = structuredClone(deps.scenario.params);
    const contacts = await run(deps, { use_reference: { parameter: "average_contacts_daily", index: 5 } });
    expect(contacts.isError).toBe(true);
    expect(contacts.content).toContain("network.n_contacts");
    const r0 = await run(deps, { use_reference: { parameter: "r0", index: 8 } });
    expect(r0.isError).toBe(true);
    expect(r0.content).toContain("not reachable");
    expect(deps.scenario.params).toEqual(before);
    expect(chosen(deps)).toEqual([]);
  });

  it("refuses an estimate without a single value", async () => {
    expect(estimates("hepatitis_a", "immunity_duration")[0].value).toBeUndefined();
    const deps = makeDeps();
    await run(deps, { disease: "hepatitis_a", model: "sirs", dur_immune_days: 200 });
    const out = await run(deps, { use_reference: { parameter: "immunity_duration", index: 1 } });
    expect(out.isError).toBe(true);
    expect(out.content).toContain("has no single value");
    expect(out.content).toContain("lifelong");
    expect(chosen(deps)).toEqual([]);
  });
});

describe("a chosen reference is the value's source while the value stands (follow-up spec 9.4)", () => {
  type Tagged = { sources: Record<string, string>; references?: Record<string, string> };

  it("tags the path, names the reference, and loses the tag when the value changes", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles" });
    const first = estimates("measles", "infectious_days")[0];
    const out = (await run(deps, { use_reference: { parameter: "infectious_days", index: 1 } })).payload as Tagged;
    expect(out.sources["disease.dur_inf.mean_days"]).toBe("reference");
    expect(out.references).toEqual({ "disease.dur_inf.mean_days": `${first.title}${first.year ? ` (${first.year})` : ""}` });
    const r0 = (await run(deps, { use_reference: { parameter: "r0", index: 2 } })).payload as Tagged;
    expect(r0.sources["disease.beta"]).toBe("reference");                                    // beta, by the R0 it implies
    expect(Object.keys(r0.references!).sort()).toEqual(["disease.beta", "disease.dur_inf.mean_days"]);
    const again = (await run(deps, { r0: 9 })).payload as Tagged;
    expect(again.sources["disease.beta"]).toBe("user");
    expect(again.references).toEqual({ "disease.dur_inf.mean_days": out.references!["disease.dur_inf.mean_days"] });   // the other choice still stands
    const changed = (await run(deps, { dur_inf_days: 5 })).payload as Tagged;
    expect(changed.sources["disease.dur_inf.mean_days"]).toBe("user");
    expect(changed.references).toBeUndefined();
    // an R0 from a reference stands only while the scenario still has that R0: a longer infectious period at the same beta is another R0
    await run(deps, { use_reference: { parameter: "r0", index: 2 } });
    const longer = (await run(deps, { dur_inf_days: 12 })).payload as Tagged;
    expect(longer.sources["disease.beta"]).not.toBe("reference");
  });

  it("keeps the fetched data's tags beside it", async () => {
    const deps = makeDeps({ unWpp: [rf("birth_rate", 28.1), rf("death_rate", 7.9), rf("total_population", 55_000_000)] });
    await run(deps, { disease: "measles", country_iso3: "KEN" });
    await fetchDemographics({ country_iso3: "KEN" } as never, deps);
    const out = (await run(deps, { use_reference: { parameter: "fatality_rate", index: 1 } })).payload as Tagged;
    expect(out.sources).toMatchObject({ "demographics.birth_rate": "fetch", "disease.p_death": "reference" });
  });
});
