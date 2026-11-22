import type { SupabaseClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TutorialTable } from "@/components/admin/TutorialTable";
import { loadTutorialEvents, summarizeTutorial, type TutorialEvent } from "@/lib/admin/tutorialUse";

const e = (userId: string, kind: TutorialEvent["kind"], step: number | null = null, how: TutorialEvent["how"] = null, replay = false): TutorialEvent => ({ userId, kind, replay, step, how });
/** Started, and did every step up to and including `last`. */
const through = (userId: string, last: number) => [e(userId, "tutorial_started"), ...Array.from({ length: last + 1 }, (_, n) => e(userId, "tutorial_step", n, "done"))];

describe("the tutorial's counts for researchers", () => {
  it("counts participants, not events, on their first run-through", () => {
    const s = summarizeTutorial(
      [
        ...through("a", 10), e("a", "tutorial_finished"),
        ...through("b", 3), e("b", "tutorial_step", 3, "done"), // a repeated event
        e("c", "tutorial_started"), e("c", "tutorial_step", 0, "skipped"), e("c", "tutorial_ended", 1),
        e("d", "tutorial_offer_declined"),
        e("a", "tutorial_started", null, null, true), e("a", "tutorial_step", 0, "done", true), // a replay
        ...through("r", 10), e("r", "tutorial_finished"), // a researcher
      ],
      new Set(["r"]),
    );
    expect(s).toMatchObject({ started: 3, finished: 1, notFinished: 2, offerDeclined: 1, replayedBy: 1 });
    expect(s.steps.map((row) => row.step)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.steps[0]).toEqual({ step: 0, reached: 3, did: 2, skipped: 1, leftHere: 0 });
    expect(s.steps[1]).toEqual({ step: 1, reached: 3, did: 2, skipped: 0, leftHere: 1 }); // c left at step 1
    expect(s.steps[4]).toEqual({ step: 4, reached: 2, did: 1, skipped: 0, leftHere: 1 }); // b did 0..3, reached 4, left there
    expect(s.steps[10]).toEqual({ step: 10, reached: 1, did: 1, skipped: 0, leftHere: 0 });
    expect(s.steps.reduce((n, row) => n + row.leftHere, 0)).toBe(s.notFinished);
  });

  it("counts a step once when it was both skipped and done, as done", () => {
    const s = summarizeTutorial([e("a", "tutorial_started"), e("a", "tutorial_step", 0, "skipped"), e("a", "tutorial_step", 0, "done")]);
    expect(s.steps[0]).toMatchObject({ did: 1, skipped: 0 });
  });

  it("is all zeros with no events, and ignores steps outside 0 to 10", () => {
    const s = summarizeTutorial([e("a", "tutorial_step", 42, "done"), e("a", "tutorial_step", null, "done")]);
    expect(s).toMatchObject({ started: 0, finished: 0, notFinished: 0, offerDeclined: 0, replayedBy: 0 });
    expect(s.steps).toHaveLength(11);
    expect(s.steps.every((row) => row.reached === 0 && row.did === 0 && row.skipped === 0 && row.leftHere === 0)).toBe(true);
  });

  it("reads every page and turns the stored words into values", async () => {
    const row = (i: number) => ({ user_id: `u${i % 5}`, kind: "tutorial_step", replay: "false", step: "4", how: "done" });
    const pages: Record<number, unknown[]> = {
      0: Array.from({ length: 1000 }, (_, i) => row(i)),
      1000: [{ user_id: "x", kind: "tutorial_started", replay: "true", step: null, how: null }, { user_id: "y", kind: "tutorial_step", replay: "false", step: "x", how: "typed" }],
    };
    const calls = { select: "", kinds: [] as unknown[] };
    const builder: Record<string, unknown> = {};
    builder.select = (columns: string) => ((calls.select = columns), builder);
    builder.in = (_column: string, kinds: unknown[]) => ((calls.kinds = kinds), builder);
    builder.order = () => builder;
    builder.range = async (from: number) => ({ data: pages[from] ?? [], error: null });
    const events = await loadTutorialEvents({ from: () => builder } as unknown as SupabaseClient);
    expect(events).toHaveLength(1002);
    expect(events[0]).toEqual({ userId: "u0", kind: "tutorial_step", replay: false, step: 4, how: "done" });
    expect(events[1000]).toEqual({ userId: "x", kind: "tutorial_started", replay: true, step: null, how: null });
    expect(events[1001]).toEqual({ userId: "y", kind: "tutorial_step", replay: false, step: null, how: null });
    expect(calls.select).toBe("user_id, kind, replay:meta->>replay, step:meta->>step, how:meta->>how");
    expect(calls.kinds).toEqual(["tutorial_started", "tutorial_step", "tutorial_finished", "tutorial_ended", "tutorial_offer_declined"]);
  });

  it("shows the totals and one row per step", () => {
    const summary = summarizeTutorial([...through("a", 10), e("a", "tutorial_finished"), ...through("b", 3), e("d", "tutorial_offer_declined")]);
    const html = renderToStaticMarkup(createElement(TutorialTable, { summary }));
    for (const piece of ["Started", "Finished", "Did not finish", "Offer declined", "Replayed by", "Step", "Reached", "Did it", "Skipped", "Left here"]) expect(html).toContain(piece);
    expect(html.match(/<tr/g)).toHaveLength(12);
    expect(html).not.toMatch(/email|user_text/);
  });
});
