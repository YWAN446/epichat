import { describe, expect, it } from "vitest";

import { SYSTEM_PROMPT, firstUserMessage, systemBlocks } from "@/lib/chat/prompt";
import { TOOLS } from "@/lib/tools";
import promptFile from "@/data/system_prompt.json";

describe("system prompt", () => {
  it("starts with the Python agent's prompt verbatim and adds the four sections", () => {
    expect(SYSTEM_PROMPT.startsWith((promptFile as { system: string }).system)).toBe(true);
    for (const heading of ["## About EpiChat", "## Decisions recap", "## Suggested replies", "## The interface", "## Report", "## Repairs", "## Limits on spread", "## Interventions", "## Contact networks"]) expect(SYSTEM_PROMPT).toContain(heading);
    for (const phrase of ["disease.rel_sus_cv", "behavior_response", "herd immunity threshold", "off by default", "lever: disease.rel_sus_cv", "behavior_response_min_factor"]) expect(SYSTEM_PROMPT).toContain(phrase);
    expect(SYSTEM_PROMPT.indexOf("## Limits on spread")).toBeLessThan(SYSTEM_PROMPT.indexOf("## Interventions"));
    // review of phase A: a run that ends far below the threshold has not finished; one rule for a known attack rate; R0 is kept by a correction
    for (const phrase of ["in the long run", "has not finished", "use the lever of Limits on spread", "by a closed form", "calibrates beta at every value it tries"]) expect(SYSTEM_PROMPT).toContain(phrase);
    expect(SYSTEM_PROMPT).not.toContain("because it relaxes it cannot take the total far below");
    for (const phrase of ["close on every network", "measured R0", "Covasim", "expectedly null"]) expect(SYSTEM_PROMPT).toContain(phrase);
    for (const phrase of ["stats.r0_calibration.reached", "could not be brought to the R0 you set", "only its seeds transmit", "stats.r0_calibration.measured"]) expect(SYSTEM_PROMPT).toContain(phrase);
    for (const phrase of ["schools closed", "illustrative assumption", "fitted", "remove_interventions", "stats.fit"]) expect(SYSTEM_PROMPT).toContain(phrase);
    expect(SYSTEM_PROMPT.indexOf("## Interventions")).toBeLessThan(SYSTEM_PROMPT.indexOf("## Contact networks"));
    expect(SYSTEM_PROMPT).toContain("Create a report");
    expect(SYSTEM_PROMPT).toContain("Do not paste the report into the conversation");
    expect(SYSTEM_PROMPT.indexOf("## About EpiChat")).toBeLessThan(SYSTEM_PROMPT.indexOf("## Decisions recap"));
    for (const phrase of ["Starsim", "World Population Prospects", "Global Health Observatory", "Data360", "not forecasts", "What is EpiChat"]) expect(SYSTEM_PROMPT).toContain(phrase);
    expect(SYSTEM_PROMPT).toMatch(/\b1[0-9] diseases\b/);
    expect(SYSTEM_PROMPT).toMatch(/\b[1-9]\d{2} cited estimates\b/);
    expect(SYSTEM_PROMPT).not.toContain("## Cards");
    expect(SYSTEM_PROMPT.indexOf("```recap")).toBeLessThan(SYSTEM_PROMPT.indexOf("```next"));
    expect(SYSTEM_PROMPT).toContain("three to eight lines");
    expect(SYSTEM_PROMPT).toContain("panel beside the conversation");
    expect(SYSTEM_PROMPT).toContain("in the Dashboard");
    expect(SYSTEM_PROMPT).not.toContain("Details panel");
  });

  it("tells the assistant how to use the About block and the remember tool, between About EpiChat and the recap", () => {
    expect(SYSTEM_PROMPT.indexOf("## About EpiChat")).toBeLessThan(SYSTEM_PROMPT.indexOf("## The participant"));
    expect(SYSTEM_PROMPT.indexOf("## The participant")).toBeLessThan(SYSTEM_PROMPT.indexOf("## Decisions recap"));
    for (const phrase of ["About this participant", "never use a name", "one in ten", "sensitivity runs", "quotable", "preferred format first", "replaces", "third person"]) {
      expect(SYSTEM_PROMPT).toContain(phrase);
    }
  });

  it("keeps the phrases the Python tests pin", () => {
    for (const phrase of ["under_review", "no_source", "estimates_only", "estimate_range", "estimate_extremes", "illustrative assumption", "not a forecast", "web_search", "web_fetch", "medical advice"]) {
      expect(SYSTEM_PROMPT).toContain(phrase);
    }
    expect(/transmissib|virulen/.test(SYSTEM_PROMPT)).toBe(true);
    for (const tool of TOOLS) expect(SYSTEM_PROMPT).toContain(tool.name);
  });

  it("tells the assistant to use describe_parameters, the advanced patch, and the diagnostics' options", () => {
    expect(SYSTEM_PROMPT.indexOf("## Repairs")).toBeLessThan(SYSTEM_PROMPT.indexOf("## Parameters"));
    expect(SYSTEM_PROMPT.indexOf("## Parameters")).toBeLessThan(SYSTEM_PROMPT.indexOf("## Diagnostics and options"));
    for (const phrase of [
      "call describe_parameters rather than answering from memory",
      "Never say a parameter cannot be changed",
      "advanced patch by path",
      "at most three options",
      "keeps the configuration as it is",
      "what it changes, the suggested value, and its basis",
      "before interpreting the new run",
      "apply the lever's whole patch",
      "under 18, 18 to 64, and 65 and over",
      "no elderly group",
    ]) {
      expect(SYSTEM_PROMPT).toContain(phrase);
    }
  });

  it("is deterministic, dateless, and long enough to cache", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(5000);
    expect(systemBlocks()).toEqual([{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
  });

  it("puts the date on the first line of the first user message, and the About block between the date and the text", () => {
    expect(firstUserMessage("2026-10-08", "Model measles in Kenya")).toBe("Today's date: 2026-10-08.\n\nModel measles in Kenya");
    expect(firstUserMessage("2026-10-08", "Model measles in Kenya", null)).toBe("Today's date: 2026-10-08.\n\nModel measles in Kenya");
    expect(firstUserMessage("2026-10-08", "Hi", "About this participant: x")).toBe("Today's date: 2026-10-08.\n\nAbout this participant: x\n\nHi");
  });
});
