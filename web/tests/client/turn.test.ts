import { describe, expect, it } from "vitest";

import type { ChatStreamEvent } from "@/lib/chat/events";
import { INTERRUPTED, applyEvent, lastRecap, lastStage, lastSuggestions, startTurn, type TurnProgress } from "@/lib/client/turn";

function play(events: ChatStreamEvent[]): TurnProgress {
  return events.reduce((progress, event) => applyEvent(progress, event), startTurn());
}

const CONFIG = { kind: "config" as const, applied: {}, approx_r0: 12, config: { disease: "measles", disease_type: "sir", country: null, n_agents: 10000, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] }, warnings: [], new_scenario: false };

describe("applyEvent", () => {
  it("starts with a status and no result", () => {
    expect(startTurn()).toEqual({ blocks: [], status: "Thinking…", stage: null, suggestions: [], recap: [], result: null });
    expect(INTERRUPTED).toBe("The reply was interrupted. Please try again.");
  });

  it("extends the open text block and starts a new one after any other block", () => {
    const progress = play([
      { type: "text", delta: "Let me " }, { type: "text", delta: "configure it." },
      { type: "tool_use", id: "tu_1", name: "configure_simulation", input: {} },
      { type: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: CONFIG },
      { type: "text", delta: "Done." },
    ]);
    expect(progress.blocks).toEqual([
      { kind: "text", text: "Let me configure it." },
      { kind: "tool_use", id: "tu_1", name: "configure_simulation", input: {} },
      { kind: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: CONFIG },
      { kind: "text", text: "Done." },
    ]);
    expect(progress.status).toBeNull();
  });

  it("shows what is happening: the tool's status, thinking after a result, the web statuses", () => {
    expect(play([{ type: "text", delta: "x" }]).status).toBeNull();
    expect(play([{ type: "tool_use", id: "tu_1", name: "run_simulation", input: {} }]).status).toBe("Running the simulation — this usually takes 1–2 minutes…");
    expect(play([{ type: "tool_use", id: "tu_1", name: "run_simulation", input: {} }, { type: "tool_result", id: "tu_1", name: "run_simulation", ok: false, payload: { kind: "tool_error", message: "x" } }]).status).toBe("Thinking…");
    expect(play([{ type: "web_search", query: "measles Kenya" }]).status).toBe("Searching the web…");
    expect(play([{ type: "web_fetch", url: "https://www.who.int", title: "WHO" }]).status).toBe("Reading the page…");
    expect(play([{ type: "tool_use", id: "tu_1", name: "something_new", input: {} }]).status).toBe("Running something_new…");
  });

  it("keeps the stage, the suggestions, and notices as blocks too", () => {
    const progress = play([
      { type: "stage", stage: "configure" }, { type: "notice", message: "WEB ERROR: unavailable" }, { type: "suggestions", items: ["Run it", "Fetch data"] },
    ]);
    expect(progress.stage).toBe("configure");
    expect(progress.suggestions).toEqual(["Run it", "Fetch data"]);
    expect(progress.blocks.map((b) => b.kind)).toEqual(["stage", "notice", "suggestions"]);
  });

  it("ends with the ids on done, or the message on discard and error", () => {
    const done = play([{ type: "text", delta: "Hi" }, { type: "done", turnId: "t1", conversationId: "c1", notice: "cut" }]);
    expect(done.result).toEqual({ ok: true, turnId: "t1", conversationId: "c1", notice: "cut" });
    expect(done.status).toBeNull();
    expect(play([{ type: "discard", message: "Dropped." }]).result).toEqual({ ok: false, message: "Dropped." });
    expect(play([{ type: "error", code: "daily_turns", message: "Limit." }]).result).toEqual({ ok: false, message: "Limit." });
  });

  it("keeps the recap items and lastRecap finds the newest turn that has one", () => {
    const progress = play([{ type: "text", delta: "Done." }, { type: "recap", items: ["A", "B"] }]);
    expect(progress.recap).toEqual(["A", "B"]);
    expect(progress.blocks.at(-1)).toEqual({ kind: "recap", items: ["A", "B"] });
    const turns = [
      { blocks: [{ kind: "recap" as const, items: ["old"] }] },
      { blocks: [{ kind: "text" as const, text: "no recap this time" }] },
    ];
    expect(lastRecap(turns)).toEqual(["old"]);
    expect(lastRecap([])).toEqual([]);
  });
});

describe("conversation state from blocks", () => {
  const turns = [
    { blocks: [{ kind: "stage" as const, stage: "configure" as const }, { kind: "suggestions" as const, items: ["Fetch data"] }] },
    { blocks: [{ kind: "text" as const, text: "Hi" }, { kind: "suggestions" as const, items: ["Run it"] }] },
  ];

  it("takes the last stage anywhere and the last turn's suggestions", () => {
    expect(lastStage(turns)).toBe("configure");
    expect(lastStage([])).toBe("understand");
    expect(lastSuggestions(turns)).toEqual(["Run it"]);
    expect(lastSuggestions([turns[0], { blocks: [{ kind: "text", text: "no chips" }] }])).toEqual([]);
    expect(lastSuggestions([])).toEqual([]);
  });
});
