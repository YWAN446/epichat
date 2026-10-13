import { describe, expect, it } from "vitest";

import type { Block } from "@/lib/chat/events";
import { TRY_NEXT_MAX, latestRunKey, tryNextKey, tryNextLabels } from "@/lib/client/tryNext";
import { SUGGESTION_SOURCES } from "@/lib/enums";
import type { RunPayload } from "@/lib/tools/types";

const lever = (label?: string | null) => ({ patch: {}, current: {}, direction: "change" as const, rationale: "r", basis: "rule" as const, interventions: [{ type: "behavior_response" }], ...(label === undefined ? {} : { label }) });
const payload = (diagnostics: unknown): RunPayload => ({ kind: "run", diagnostics } as unknown as RunPayload);
const run = (ok = true): Block => ({ kind: "tool_result", id: "t", name: "run_simulation", ok, payload: payload([]) } as unknown as Block);
const text: Block = { kind: "text", text: "hello" };

describe("the run card's Try next buttons (follow-up spec 7.4)", () => {
  it("takes at most three labels from what_if", () => {
    const whatIf = { id: "what_if", severity: "info", title: "Interventions to try", evidence: {}, levers: [lever("A and rerun"), lever("B and rerun"), lever(null), lever(""), lever(), lever("A and rerun"), lever("C and rerun"), lever("D and rerun")] };
    const other = { id: "well_mixed", severity: "info", title: "t", evidence: {}, levers: [lever("Not this one")] };
    expect(tryNextLabels(payload([other, whatIf]))).toEqual(["A and rerun", "B and rerun", "C and rerun"]);
    expect(TRY_NEXT_MAX).toBe(3);
    expect(tryNextLabels(payload([other]))).toEqual([]);
    expect(tryNextLabels(payload(undefined))).toEqual([]);                                   // a payload stored before diagnostics existed
    expect(tryNextLabels(payload([{ ...whatIf, levers: [lever("x".repeat(81)), lever("  Short and rerun  ")] }]))).toEqual(["Short and rerun"]);
  });

  it("names the last successful run of the last turn only", () => {
    expect(latestRunKey([{ id: "a", blocks: [run()] }, { id: "b", blocks: [text, run(), text, run(), text] }])).toBe("b:3");
    expect(latestRunKey([{ id: "a", blocks: [run()] }, { id: "b", blocks: [text] }])).toBeNull();     // the conversation has moved on
    expect(latestRunKey([{ id: "a", blocks: [run(false)] }])).toBeNull();                              // a failed run has nothing to offer
    expect(latestRunKey([{ id: "a", blocks: [run(), run(false)] }])).toBe("a:0");
    expect(latestRunKey([])).toBeNull();
  });

  it("offers nothing on a run with a warning: a baseline that is broken is fixed first (review of phase B)", () => {
    const whatIf = { id: "what_if", severity: "info", title: "Interventions to try", evidence: {}, levers: [lever("A and rerun")] };
    const unfinished = { id: "unfinished", severity: "warning", title: "The run ended before the epidemic did", evidence: {}, levers: [] };
    expect(tryNextLabels(payload([unfinished, whatIf]))).toEqual([]);
    expect(tryNextLabels(payload([whatIf, { ...unfinished, severity: "info" }]))).toEqual(["A and rerun"]);
  });

  it("gives no key while a reply streams", () => {
    const turns = [{ id: "a", blocks: [run()] }];
    expect(tryNextKey(turns, false)).toBe("a:0");
    expect(tryNextKey(turns, true)).toBeNull();
    expect(tryNextKey([], false)).toBeNull();
  });

  it("has a source for the buttons and one for a chosen reference", () => {
    expect(SUGGESTION_SOURCES).toEqual(["model", "draft", "intro", "option", "reference"]);
  });
});
