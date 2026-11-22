import { describe, expect, it } from "vitest";

import { INITIAL, advance, completedStep, currentPart, restore, skip, type TutorialState } from "@/lib/tutorial/machine";
import { DASHBOARD_TARGETS, OPEN_DASHBOARD_TEXT, STEPS, type TutorialAction } from "@/lib/tutorial/steps";

/** The completing action of every part, in order: 0 start, 1 example, 2 Scenario, 3 reply (data), 4 Data, 5 reply (run), 6 Runs, 7 Incidence, 8 option, 9 Parameters, 10 reply (report), 11 Report, 12 Profile, 13 finish. */
const WALK: TutorialAction[] = STEPS.flatMap((step) => step.parts.map((part) => part.completes));
const run = (actions: TutorialAction[], narrow = false): TutorialState => actions.reduce((state, action) => advance(state, action, narrow), INITIAL);

describe("the tutorial's steps", () => {
  it("are numbered 0 to 10 with the spec's targets, seven of them in the Dashboard", () => {
    expect(STEPS.map((s) => s.number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(STEPS.map((s) => s.parts.map((p) => p.target))).toEqual([
      ["centre"], ["example"], ["panel-scenario"], ["reply", "panel-data"], ["reply", "panel-runs"], ["view-incidence"], ["option"], ["panel-parameters"], ["reply", "panel-report", "practice-report"], ["tab-profile"], ["centre"],
    ]);
    expect(STEPS.flatMap((s) => s.parts).filter((p) => DASHBOARD_TARGETS.has(p.target))).toHaveLength(8);
    expect(STEPS[8].parts[2]).toMatchObject({ target: "practice-report", completes: { type: "next" } });
    expect(STEPS[2].parts[0].text).toContain("This is the Dashboard. The conversation is where you ask; the Dashboard keeps the record");
    expect(STEPS[0].parts[0].text).toContain("Nothing here is sent or saved.");
    expect(STEPS.flatMap((s) => s.parts).map((p) => p.press).filter(Boolean)).toEqual(["example", "dataReply", "runReply", "option", "reportReply"]);
  });
});

describe("the tutorial's state machine", () => {
  it("starts with nothing shown and every section closed", () => {
    expect(INITIAL).toEqual({ step: 0, part: 0, turnsShown: 0, open: { scenario: false, data: false, parameters: false, runs: false, report: false, activity: false }, view: "infected", tab: "details", sheetOpen: false, finished: false });
  });

  it("walks from start to finish when every step is done", () => {
    const end = run(WALK);
    expect(end.finished).toBe(true);
    expect(end.step).toBe(10);
    expect(end.open).toEqual({ scenario: true, data: true, runs: true, parameters: true, report: true, activity: false });
    expect(end.view).toBe("incidence");
    expect(end.tab).toBe("profile");
    expect(end.turnsShown).toBe(5);
  });

  it("reaches the same end when every step is skipped", () => {
    let state = INITIAL;
    for (let i = 0; i < 40 && !state.finished; i++) state = skip(state, false);
    expect(state).toEqual(run(WALK));
  });

  it("reaches the end on a narrow screen too, by doing or by skipping", () => {
    let state = INITIAL;
    for (let i = 0; i < 60 && !state.finished; i++) state = skip(state, true);
    expect(state.finished).toBe(true);
    expect({ ...state, sheetOpen: false }).toEqual({ ...run(WALK), sheetOpen: false });
  });

  it("shows more of the recording only as steps complete, never less", () => {
    const shown = WALK.map((_, i) => run(WALK.slice(0, i + 1)).turnsShown);
    expect(shown).toEqual([0, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5, 5, 5]);
  });

  it("ignores a press that is not the current step's action", () => {
    const atData = run(WALK.slice(0, 4)); // step 3, second part: open Data
    expect(atData).toMatchObject({ step: 3, part: 1 });
    const strays: TutorialAction[] = [{ type: "reply" }, { type: "example" }, { type: "section", section: "runs", open: true }, { type: "section", section: "data", open: false }, { type: "view", view: "deaths" }, { type: "start" }, { type: "dashboard" }, { type: "next" }, { type: "finish" }];
    for (const stray of strays) expect(advance(atData, stray, false)).toBe(atData);
    const done = advance(atData, { type: "section", section: "data", open: true }, false);
    expect(done.step).toBe(4);
    expect(advance(done, { type: "section", section: "data", open: true }, false)).toBe(done); // a double press
    const end = run(WALK);
    expect(advance(end, { type: "finish" }, false)).toBe(end);
  });

  it("on a narrow screen asks for the Dashboard button first, and closes the sheet for the conversation", () => {
    const atScenario = run(WALK.slice(0, 2), true);
    expect(currentPart(atScenario, true)).toMatchObject({ target: "dashboard-button", text: OPEN_DASHBOARD_TEXT });
    expect(currentPart(atScenario, false).target).toBe("panel-scenario"); // the window was widened: no extra part
    expect(advance(atScenario, { type: "section", section: "scenario", open: true }, true)).toBe(atScenario); // the section is behind the sheet
    const opened = advance(atScenario, { type: "dashboard" }, true);
    expect(opened.sheetOpen).toBe(true);
    expect(opened.step).toBe(2);
    expect(currentPart(opened, true).target).toBe("panel-scenario");
    const atReply = advance(opened, { type: "section", section: "scenario", open: true }, true);
    expect(atReply.sheetOpen).toBe(false); // step 3 starts with a reply, in the conversation
    expect(currentPart(atReply, true).target).toBe("reply");
    const atData = advance(atReply, { type: "reply" }, true);
    expect(currentPart(atData, true).target).toBe("dashboard-button"); // Data is behind the button again
    const inData = advance(atData, { type: "dashboard" }, true);
    const afterData = advance(inData, { type: "section", section: "data", open: true }, true);
    expect(afterData.sheetOpen).toBe(false); // step 4 starts with a reply
    expect(currentPart(afterData, true).target).toBe("reply");
  });

  it("when the window narrows in the middle of a Dashboard step, asks for the Dashboard button", () => {
    const wide = run(WALK.slice(0, 4)); // at Data, on a wide screen
    expect(currentPart(wide, false).target).toBe("panel-data");
    expect(currentPart(wide, true).target).toBe("dashboard-button");
  });

  it("names the step that was just completed, once per step", () => {
    const before = run(WALK.slice(0, 5)); // step 4, part 0
    const mid = advance(before, WALK[5], false);
    expect(completedStep(before, mid)).toBeNull(); // only the first part
    expect(completedStep(mid, advance(mid, WALK[6], false))).toBe(4);
    expect(completedStep(INITIAL, advance(INITIAL, { type: "start" }, false))).toBe(0);
    const last = run(WALK.slice(0, 14));
    expect(completedStep(last, advance(last, { type: "finish" }, false))).toBe(10);
    expect(completedStep(before, before)).toBeNull();
  });

  it("restores a saved state and refuses anything else", () => {
    const state = run(WALK.slice(0, 5));
    expect(restore(JSON.parse(JSON.stringify(state)))).toEqual(state);
    const bad: unknown[] = [null, "x", {}, { ...state, step: 11 }, { ...state, step: 2, part: 5 }, { ...state, open: { scenario: "yes" } }, { ...state, view: "everything" }, { ...state, turnsShown: -1 }, { ...state, turnsShown: 99 }, { ...state, tab: "elsewhere" }];
    for (const value of bad) expect(restore(value)).toBeNull();
  });
});
