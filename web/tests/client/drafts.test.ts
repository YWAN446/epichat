import { describe, expect, it } from "vitest";

import { DRAFTS, STAGE_HINTS, STAGE_LABELS, chipsFor, type ChipSource } from "@/lib/client/drafts";
import { STAGES } from "@/lib/enums";

describe("stage drafts", () => {
  it("labels and hints every stage, with three drafts everywhere except while running", () => {
    expect(STAGES.map((s) => STAGE_LABELS[s])).toEqual(["Understand", "Configure", "Ground in data", "Run", "Interpret", "Report"]);
    for (const stage of STAGES) expect(STAGE_HINTS[stage].length).toBeGreaterThan(20);
    expect(DRAFTS.run).toEqual([]);
    for (const stage of STAGES.filter((s) => s !== "run")) {
      expect(DRAFTS[stage]).toHaveLength(3);
      for (const draft of DRAFTS[stage]) expect(draft.length).toBeLessThanOrEqual(80);
    }
    expect(DRAFTS.understand[0]).toBe("Model a measles outbreak in Kenya");
    expect(DRAFTS.interpret).toContain("Create a report");
    expect(DRAFTS.report).toContain("Start a new scenario");
    expect(STAGE_HINTS.report).toBe("The report is ready. Download it from the Details panel, or ask for changes.");
    expect(STAGE_HINTS.run).toBe("The simulation is running. This usually takes one to two minutes.");
  });

  it("prefers the model's suggestions and falls back to the stage's drafts", () => {
    expect(chipsFor("configure", ["Fetch the data"])).toEqual({ items: ["Fetch the data"], source: "model" });
    expect(chipsFor("configure", [])).toEqual({ items: DRAFTS.configure, source: "draft" });
    expect(chipsFor("run", [])).toEqual({ items: [], source: "draft" });
    const intro: ChipSource = "intro";
    expect(intro).toBe("intro");
  });
});
