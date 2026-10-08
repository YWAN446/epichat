import { describe, expect, it } from "vitest";

import { lookupDisease } from "@/lib/tools/lookupDisease";
import { makeDeps } from "./helpers";

describe("lookup_disease", () => {
  it("returns the measles entry with every parameter's status", async () => {
    const out = await lookupDisease({ disease_name: "measles" }, makeDeps());
    const body = JSON.parse(out.content);
    expect(body.canonical_name).toBe("measles");
    expect(body.display_name).toBe("Measles");
    expect(body.parameters.r0).toMatchObject({ status: "ok", min: 12, max: 18, typical: 15 });
    expect(body.parameters.r0.source).toContain("http");
    expect(Object.keys(body.parameters)).toEqual(["r0", "incubation_days", "infectious_days", "fatality_rate", "average_contacts_daily", "immunity_duration", "asymptomatic_fraction"]);
    expect(out.payload).toMatchObject({ kind: "disease", canonical_name: "measles" });
  });

  it("resolves an alias and omits parameters a disease lacks", async () => {
    expect(JSON.parse((await lookupDisease({ disease_name: "german measles" }, makeDeps())).content).canonical_name).toBe("rubella");
    const dengue = JSON.parse((await lookupDisease({ disease_name: "Dengue fever" }, makeDeps())).content);
    expect(Object.keys(dengue.parameters)).toEqual(["r0", "incubation_days", "infectious_days"]);
  });

  it("lists the known diseases for an unknown name", async () => {
    const out = await lookupDisease({ disease_name: "unicorn fever" }, makeDeps());
    expect(out.content).toBe("UNKNOWN DISEASE: 'unicorn fever'. Known diseases: measles, covid19, mumps, rubella, varicella, pertussis, influenza, meningococcal, hepatitis_a, ebola, dengue, rsv, cholera, polio, tuberculosis, mpox");
    expect(out.isError).toBeUndefined();
    expect(out.payload).toBeUndefined();
  });
});
