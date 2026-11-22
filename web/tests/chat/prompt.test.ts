import { describe, expect, it } from "vitest";

import { SYSTEM_PROMPT, firstUserMessage, systemBlocks } from "@/lib/chat/prompt";
import { TOOLS } from "@/lib/tools";
import promptFile from "@/data/system_prompt.json";

describe("system prompt", () => {
  it("calls the right-hand panel the Dashboard and names its tabs (round-1 UI cleanup)", () => {
    expect(SYSTEM_PROMPT).toContain("shown in the Dashboard beside the conversation");
    expect(SYSTEM_PROMPT).toContain('"This conversation" tab');
    expect(SYSTEM_PROMPT).toContain("point to the Dashboard's chart views");
    expect(SYSTEM_PROMPT).toContain('Call it the Dashboard when you point the participant to it; the profile lives in its "Profile" tab.');
    expect(SYSTEM_PROMPT).not.toMatch(/in a panel|the panel's/);
  });

  it("starts with the Python agent's prompt verbatim and adds the four sections", () => {
    expect(SYSTEM_PROMPT.startsWith((promptFile as { system: string }).system)).toBe(true);
    for (const heading of ["## About EpiChat", "## Decisions recap", "## Suggested replies", "## The interface", "## Report", "## Repairs", "## Limits on spread", "## Interventions", "## Contact networks"]) expect(SYSTEM_PROMPT).toContain(heading);
    for (const phrase of ["disease.rel_sus_cv", "behavior_response", "herd immunity threshold", "off by default", "lever: disease.rel_sus_cv", "behavior_response_min_factor"]) expect(SYSTEM_PROMPT).toContain(phrase);
    expect(SYSTEM_PROMPT.indexOf("## Limits on spread")).toBeLessThan(SYSTEM_PROMPT.indexOf("## Interventions"));
    // review of phase A: a run that ends far below the threshold has not finished; one rule for a known attack rate
    for (const phrase of ["in the long run", "has not finished", "use the lever of Limits on spread"]) expect(SYSTEM_PROMPT).toContain(phrase);
    expect(SYSTEM_PROMPT).not.toContain("because it relaxes it cannot take the total far below");
    for (const phrase of ["close on every network", "Covasim"]) expect(SYSTEM_PROMPT).toContain(phrase);
    // Starsim 4: the run reports its solver and Starsim's own R0; no pilot, no measured R0
    for (const phrase of ["stats.solver", "stats.r0_model", "has no replicates", "exact for an ODE run"]) expect(SYSTEM_PROMPT).toContain(phrase);
    for (const phrase of ["pilot", "measured R0", "r0_calibration", "r0_measured", "calibrate_r0", "0 to 60"]) expect(SYSTEM_PROMPT).not.toContain(phrase);
    // the seed default of 2026-10-14: 0.05% of the agents, seed_count below 10,000 agents
    for (const phrase of ["0.05% of the agents", "pass seed_count (at least 5)"]) expect(SYSTEM_PROMPT).toContain(phrase);
    expect(SYSTEM_PROMPT).not.toContain("expected at a high R0 with the default seeding");
    for (const phrase of ["schools closed", "illustrative assumption", "fitted", "remove_interventions", "stats.fit"]) expect(SYSTEM_PROMPT).toContain(phrase);
    expect(SYSTEM_PROMPT.indexOf("## Interventions")).toBeLessThan(SYSTEM_PROMPT.indexOf("## Contact networks"));
    expect(SYSTEM_PROMPT).toContain("Create a report");
    expect(SYSTEM_PROMPT).toContain("Do not paste the report into the conversation");
    expect(SYSTEM_PROMPT.indexOf("## About EpiChat")).toBeLessThan(SYSTEM_PROMPT.indexOf("## Decisions recap"));
    for (const phrase of ["Starsim", "World Population Prospects", "WHO/UNICEF estimates", "Data360", "not forecasts", "What is EpiChat"]) expect(SYSTEM_PROMPT).toContain(phrase);
    expect(SYSTEM_PROMPT).toMatch(/\b1[0-9] diseases\b/);
    expect(SYSTEM_PROMPT).toMatch(/\b[1-9]\d{2} cited estimates\b/);
    expect(SYSTEM_PROMPT).not.toContain("## Cards");
    expect(SYSTEM_PROMPT.indexOf("```recap")).toBeLessThan(SYSTEM_PROMPT.indexOf("```next"));
    expect(SYSTEM_PROMPT).toContain("three to eight lines");
    expect(SYSTEM_PROMPT).toContain("Dashboard beside the conversation");
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

  it("asks which mode to run, recommending agents, with the rule's reasons", () => {
    for (const phrase of ["Run as agents (recommended)", "Run as a compartmental model", "new_reasons", "Rerun as agents", "required", "stats.solver", "never say \"ODE\""]) {
      expect(SYSTEM_PROMPT).toContain(phrase);
    }
    expect(SYSTEM_PROMPT).not.toContain("agent-based");
    expect(SYSTEM_PROMPT).not.toContain("unless something in it needs agents");
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
    expect(SYSTEM_PROMPT.indexOf("## Parameters")).toBeLessThan(SYSTEM_PROMPT.indexOf("## After a run"));
    // follow-up spec 7.3 and 12: the order of offers after a run, levers that carry entries and labels, well_mixed on every network
    for (const phrase of ["what_if", "by the lever's label", "through the interventions field as they are", "A warning diagnostic fired", "Offer no intervention then",
      "only the depletion of susceptibles limits the epidemic", "contact and transmission reductions", "never tell the user to press"]) expect(SYSTEM_PROMPT).toContain(phrase);
    expect(SYSTEM_PROMPT).not.toContain("## Diagnostics and options");
    // review of phase C: the listing is by network now, and the prompt says so
    expect(SYSTEM_PROMPT).toContain("every parameter of the current model and contact network");
    expect(SYSTEM_PROMPT).toContain("change network.network_type first");
    // follow-up spec 9.2 and 9.3: a chosen reference goes through the tool, which reads the value itself
    for (const phrase of ['reference N for <parameter>', "use_reference {disease", "as a check", "what the estimate measured", "a chosen literature reference", "R0 moved"]) expect(SYSTEM_PROMPT).toContain(phrase);
    // review of phase B: a slot for the other info levers, the fitted baseline, and only the dated entries start on the anchor day
    for (const phrase of ["give one of those replies to its first lever", "ends the fit and keeps the fitted value", "the dated ones start the day 1%"]) expect(SYSTEM_PROMPT).toContain(phrase);
    expect(SYSTEM_PROMPT).not.toContain("offers the hybrid network as that structure");
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
      "follow the world's population",
    ]) {
      expect(SYSTEM_PROMPT).toContain(phrase);
    }
  });

  it("is deterministic, dateless, and long enough to cache", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(5000);
    expect(systemBlocks()).toEqual([{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral", ttl: "1h" } }]);   // round-1 spec 9
  });

  it("puts the date on the first line of the first user message, and the About block between the date and the text", () => {
    expect(firstUserMessage("2026-10-08", "Model measles in Kenya")).toBe("Today's date: 2026-10-08.\n\nModel measles in Kenya");
    expect(firstUserMessage("2026-10-08", "Model measles in Kenya", null)).toBe("Today's date: 2026-10-08.\n\nModel measles in Kenya");
    expect(firstUserMessage("2026-10-08", "Hi", "About this participant: x")).toBe("Today's date: 2026-10-08.\n\nAbout this participant: x\n\nHi");
  });
});

describe("the round-1 rules (spec 2026-11-21)", () => {
  it("prompt carries the round-1 rules", () => {
    for (const phrase of [
      "EpiChat cannot run code, notebooks or other models",
      "an area within it (a county, state or city) with its own population",
      "set it with configure_simulation's area",
      "find its population with web_search",
      "Never promise an area figure without setting it",
      "stats.delivered",
      "only from run_size",
      "Initial cases, treatment capacity and a peak-size target are in people",
      "Mention a band only when band_shown is true",
      "Name runs by the Runs section's numbers, never letters",
      "500,000 agent-years",
      "Example County, Kenya: population 2 million (user's figure)",
    ]) expect(SYSTEM_PROMPT).toContain(phrase);
    expect(SYSTEM_PROMPT).not.toContain("Population 2 million (user's choice)");
  });
});
