import { describe, expect, it, vi } from "vitest";

import { MEMORY_KINDS } from "@/lib/enums";
import { TOOLS, executeTool } from "@/lib/tools";
import { makeDeps } from "./helpers";

describe("tool registry", () => {
  it("declares the nine tools in the agent's order with streaming on and no extra properties", () => {
    expect(TOOLS.map((t) => t.name)).toEqual(["configure_simulation", "lookup_disease", "fetch_demographics", "fetch_health_system", "fetch_vaccination_coverage", "run_simulation", "write_report", "remember", "describe_parameters"]);
    expect((TOOLS[6].input_schema as { required: string[] }).required).toEqual(["summary", "meaning", "limitations", "next_steps"]);
    const remember = TOOLS[7].input_schema as { required: string[]; properties: { kind: { enum: string[] }; replaces: { type: string[] } } };
    expect(remember.required).toEqual(["kind", "text"]);
    expect(remember.properties.kind.enum).toEqual([...MEMORY_KINDS]);
    expect(remember.properties.replaces.type).toEqual(["string", "null"]);
    const describe = TOOLS[8].input_schema as { required: string[]; properties: { module: { enum: unknown[] }; tier: { enum: unknown[] } } };
    expect(describe.required).toEqual([]);
    expect(describe.properties.module.enum).toEqual(["disease", "network", "demographics", "interventions", "run", null]);
    expect(describe.properties.tier.enum).toEqual(["core", "advanced", "expert", null]);
    for (const tool of TOOLS) {
      expect(tool.eager_input_streaming).toBe(true);
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect(tool.description?.length).toBeGreaterThan(80);
    }
    const configure = TOOLS[0].input_schema as { properties: Record<string, { description: string }>; required?: string[] };
    expect(Object.keys(configure.properties)).toHaveLength(25);
    expect(Object.keys(configure.properties)).toEqual(["disease", "country_iso3", "model", "disease_type", "n_agents", "sim_dur_years", "r0", "dur_inf_days", "dur_exp_days", "dur_immune_days", "p_death", "p_asymp", "seed_fraction", "seed_count", "vaccine_coverage", "vaccine_start_day", "treatment_capacity", "seasonality_scale", "network_type", "household_size", "interventions", "remove_interventions", "fit", "advanced", "start_new_scenario"]);
    const advanced = configure.properties.advanced as unknown as { type: string[]; additionalProperties: boolean };
    expect(advanced.type).toEqual(["object", "null"]);
    expect(advanced.additionalProperties).toBe(true);
    expect(TOOLS[0].description).toContain("describe_parameters");
    expect(configure.properties.vaccine_start_day.description).toBe("Day the vaccination campaign begins. 0 (the\ndefault) means pre-existing immunity at the start rather than\na campaign. Requires vaccine_coverage.");
    expect(configure.required ?? []).toEqual([]);
    expect((TOOLS[1].input_schema as { required: string[] }).required).toEqual(["disease_name"]);
    expect((TOOLS[4].input_schema as { required: string[] }).required).toEqual(["country_iso3", "disease"]);
  });

  it("refuses unknown tools and invalid input, and gates fetches on configuration", async () => {
    const deps = makeDeps();
    expect(await executeTool("nope", {}, deps)).toMatchObject({ isError: true, content: 'Unknown tool "nope".' });
    const invalid = await executeTool("lookup_disease", { disease_name: 5 }, deps);
    expect(invalid.isError).toBe(true);
    expect(JSON.parse(invalid.content).INVALID_INPUT[0]).toMatch(/^disease_name: /);
    const extra = await executeTool("lookup_disease", { disease_name: "measles", extra: 1 }, deps);
    expect(extra.isError).toBe(true);
    const broken = makeDeps({ unWpp: new Error("kaboom"), scenario: { ...deps.scenario, params: null } });
    const thrown = await executeTool("fetch_demographics", { country_iso3: "KEN" }, broken);
    expect(thrown.content).toMatch(/^Call configure_simulation first/);
  });

  it("reports a thrown tool error as data and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deps = makeDeps({ simulate: new Error("simulate exploded") });
      await executeTool("configure_simulation", { disease: "measles" }, deps);
      const out = await executeTool("run_simulation", {}, deps);
      expect(out).toMatchObject({
        content: "This tool failed. Tell the user this part is temporarily unavailable.",
        isError: true,
        payload: { kind: "tool_error", message: "simulate exploded" },
      });
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
  });

  it("treats null fields as not passed", async () => {
    const deps = makeDeps();
    const out = await executeTool("configure_simulation", { disease: "measles", n_agents: null, r0: null, vaccine_coverage: null }, deps);
    expect(out.isError).toBeUndefined();
    expect(JSON.parse(out.content).applied).toEqual({ disease: "measles" });
    expect(deps.scenario.params?.run.n_agents).toBe(10000);
  });

  it("stamps the payload with the tool's duration", async () => {
    const deps = makeDeps();
    let t = 1000;
    const out = await executeTool("lookup_disease", { disease_name: "measles" }, deps, () => (t += 25));
    expect(out.payload?.duration_ms).toBe(25);
  });
});
