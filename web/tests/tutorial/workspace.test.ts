import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import { TutorialWorkspace } from "@/components/tutorial/TutorialWorkspace";
import { EMPTY_PROFILE } from "@/lib/profile/schema";
import { INITIAL, advance } from "@/lib/tutorial/machine";
import { loadRecording } from "@/lib/tutorial/recording";
import { KEY, clearProgress, loadProgress, saveProgress } from "@/lib/tutorial/session";

const read = (file: string) => readFileSync(file, "utf8");
const FILES = [
  "components/tutorial/TutorialWorkspace.tsx", "components/tutorial/Spotlight.tsx", "components/tutorial/StepCard.tsx", "components/tutorial/ProfileSummary.tsx",
  "app/tutorial/page.tsx", "app/tutorial/report/route.ts", "lib/tutorial/machine.ts", "lib/tutorial/steps.ts", "lib/tutorial/session.ts", "lib/tutorial/recording.ts", "lib/tutorial/spotlight.ts",
];

describe("the practice page", () => {
  it("cannot reach the assistant, the simulation, or anything that saves", () => {
    for (const file of FILES) {
      for (const route of ["/api/chat", "/api/feedback", "/api/shares", "/api/profile", "/api/runs", "/api/reports", "/api/conversations", "/api/memories"]) expect(read(file)).not.toContain(route);
    }
    const workspace = read("components/tutorial/TutorialWorkspace.tsx");
    expect(workspace).not.toMatch(/\bfetch\(/);
    for (const gone of ["<ShareDialog", "<AccountMenu", "<ConversationList", "<ProfilePanel"]) expect(workspace).not.toContain(gone);
  });

  it("opens on the start card over the normal start page, with typing off", () => {
    const html = renderToStaticMarkup(createElement(TutorialWorkspace, { recording: loadRecording()!, profile: EMPTY_PROFILE, diseases: [], replay: false, entry: "first_visit", contactEmail: "" }));
    for (const piece of [
      "A 3-minute practice run.", "Nothing here is sent or saved.", ">Start<", "Skip the tutorial",
      "Which infectious disease scenario would you like to explore today?", "Practice run", 'aria-label="Dashboard"', "This conversation",
      'placeholder="Typing is off in the practice run."', 'data-tutorial="example"',
    ]) expect(html).toContain(piece);
    for (const gone of [">Share<", "Sign out", 'aria-expanded="true" aria-controls="panel-'] ) expect(html).not.toContain(gone);
  });

  it("keeps its card out of sight until it knows where it goes (final review: no flash at the corner)", () => {
    const html = renderToStaticMarkup(createElement(TutorialWorkspace, { recording: loadRecording()!, profile: EMPTY_PROFILE, diseases: [], replay: false, entry: "first_visit", contactEmail: "" }));
    expect(html).toMatch(/role="dialog"[^>]*visibility:hidden/);
  });

  it("is built from the workspace's own components and the machine", () => {
    const source = read("components/tutorial/TutorialWorkspace.tsx");
    for (const piece of [
      "<WorkspaceShell", "<ChatHeader", "<Welcome", "<Turn", "<Suggestions", "<StageStrip", "<RecapBar", "<Composer", "<PanelTabs", "<DetailsPanel", "<ProfileSummary", "<PracticeReport", "<Spotlight",
      "practice=", "advance(", "skip(", "completedStep(", "currentPart(", "saveProgress(", "loadProgress(", "clearProgress(",
      'kind: "tutorial_started"', 'kind: "tutorial_step"', 'kind: "tutorial_finished"', 'kind: "tutorial_ended"', "prefers-reduced-motion", "Typing is off in the practice run.", 'useColumn("right")', 'router.push("/chat?from=tutorial")', "saveProgress(INITIAL, isReplay.current)", "The assistant is answering…",
    ]) expect(source).toContain(piece);
  });
});

describe("the tutorial's progress in the browser tab", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    return store;
  }

  it("round-trips the state and whether this is a replay, and clears", () => {
    const store = stubStorage();
    const state = advance(advance(INITIAL, { type: "start" }, false), { type: "example" }, false);
    saveProgress(state, true);
    expect(store.has(KEY)).toBe(true);
    expect(loadProgress()).toEqual({ state, replay: true });
    clearProgress();
    expect(loadProgress()).toBeNull();
  });

  it("gives nothing for a stored value that is not a state", () => {
    for (const value of ["", "not json", "{}", JSON.stringify({ state: { step: 99 }, replay: false }), JSON.stringify({ state: INITIAL, replay: "yes" })]) {
      stubStorage({ [KEY]: value });
      expect(loadProgress()).toBeNull();
    }
  });

  it("survives a browser whose storage throws, or has none", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
    expect(loadProgress()).toBeNull();
    expect(() => saveProgress(INITIAL, false)).not.toThrow();
    expect(() => clearProgress()).not.toThrow();
    vi.stubGlobal("sessionStorage", undefined);
    expect(loadProgress()).toBeNull();
    expect(() => saveProgress(INITIAL, false)).not.toThrow();
  });
});
