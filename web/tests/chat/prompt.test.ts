import { describe, expect, it } from "vitest";

import { SYSTEM_PROMPT, firstUserMessage, systemBlocks } from "@/lib/chat/prompt";
import { TOOLS } from "@/lib/tools";
import promptFile from "@/data/system_prompt.json";

describe("system prompt", () => {
  it("starts with the Python agent's prompt verbatim and adds the four sections", () => {
    expect(SYSTEM_PROMPT.startsWith((promptFile as { system: string }).system)).toBe(true);
    for (const heading of ["## Decisions recap", "## Suggested replies", "## The interface", "## Repairs"]) expect(SYSTEM_PROMPT).toContain(heading);
    expect(SYSTEM_PROMPT).not.toContain("## Cards");
    expect(SYSTEM_PROMPT.indexOf("```recap")).toBeLessThan(SYSTEM_PROMPT.indexOf("```next"));
    expect(SYSTEM_PROMPT).toContain("three to eight lines");
    expect(SYSTEM_PROMPT).toContain("panel beside the conversation");
  });

  it("keeps the phrases the Python tests pin", () => {
    for (const phrase of ["under_review", "no_source", "estimates_only", "estimate_range", "estimate_extremes", "illustrative assumption", "not a forecast", "web_search", "web_fetch", "medical advice"]) {
      expect(SYSTEM_PROMPT).toContain(phrase);
    }
    expect(/transmissib|virulen/.test(SYSTEM_PROMPT)).toBe(true);
    for (const tool of TOOLS) expect(SYSTEM_PROMPT).toContain(tool.name);
  });

  it("is deterministic, dateless, and long enough to cache", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(5000);
    expect(systemBlocks()).toEqual([{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
  });

  it("puts the date on the first line of the first user message", () => {
    expect(firstUserMessage("2026-10-08", "Model measles in Kenya")).toBe("Today's date: 2026-10-08.\n\nModel measles in Kenya");
  });
});
