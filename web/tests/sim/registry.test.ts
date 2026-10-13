import { describe, expect, it } from "vitest";

import { PARAM_REGISTRY, REGISTRY_VERSION, applicableSpecs, boundsOf, defaultOf, specFor } from "@/lib/sim/registry";

describe("the exported parameter registry", () => {
  it("loads in registry order with the version", () => {
    expect(REGISTRY_VERSION).toBe(2);
    expect(PARAM_REGISTRY[0].path).toBe("disease.model");
    expect(PARAM_REGISTRY.at(-1)?.path).toBe("run.rand_seed");
    expect(PARAM_REGISTRY.length).toBeGreaterThanOrEqual(40);
  });

  it("looks up specs, bounds and defaults by path", () => {
    expect(specFor("disease.dur_inf.mean_days")).toMatchObject({ label: "Infectious period (mean)", unit: "days", tier: "core", db_field: "infectious_days" });
    expect(specFor("nope")).toBeNull();
    expect(specFor("disease.rel_sus_age.children")).toMatchObject({ unit: "multiplier", tier: "advanced", default: 1 });
    expect(specFor("disease.p_death_age.elderly")?.models).toEqual(["sir", "seir", "sirs", "seirs", "seiar"]);
    expect(boundsOf("disease.beta")).toEqual([0.001, 1000]);
    expect(defaultOf<number>("run.n_agents")).toBe(10000);
    expect(() => boundsOf("disease.model")).toThrow(/no bounds/);
  });

  it("filters by model", () => {
    const sir = applicableSpecs("sir").map((s) => s.path);
    const seiar = applicableSpecs("seiar").map((s) => s.path);
    expect(sir).not.toContain("disease.dur_exp.mean_days");
    expect(seiar).toContain("disease.p_asymp");
    expect(applicableSpecs("sis").map((s) => s.path)).not.toContain("disease.p_death");
  });
});
