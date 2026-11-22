import { describe, expect, it } from "vitest";
import { readClientEvent } from "@/lib/clientEvents";

const SESSION = "44444444-4444-4444-8444-444444444444";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const TURN = "55555555-5555-4555-8555-555555555555";

describe("readClientEvent", () => {
  it("accepts the tutorial's events and refuses anything loose", () => {
    const ok = (e: object) => expect(readClientEvent(JSON.stringify(e))).toMatchObject(e);
    const no = (e: object) => expect(readClientEvent(JSON.stringify(e))).toBeNull();
    ok({ kind: "tutorial_started", replay: false, entry: "first_visit" });
    ok({ kind: "tutorial_started", replay: true, entry: "menu", sessionId: SESSION });
    ok({ kind: "tutorial_step", replay: false, step: 4, how: "skipped" });
    ok({ kind: "tutorial_step", replay: false, step: 0, how: "done" });
    ok({ kind: "tutorial_finished", replay: true });
    ok({ kind: "tutorial_ended", replay: false, step: 0 });
    ok({ kind: "tutorial_offer_declined" });
    no({ kind: "tutorial_step", replay: false, step: 11, how: "done" });
    no({ kind: "tutorial_step", replay: false, step: -1, how: "done" });
    no({ kind: "tutorial_step", replay: false, step: 2.5, how: "done" });
    no({ kind: "tutorial_step", replay: false, step: 2, how: "typed text" });
    no({ kind: "tutorial_step", step: 2, how: "done" });
    no({ kind: "tutorial_started", replay: false, entry: "elsewhere" });
    no({ kind: "tutorial_started", replay: false, entry: "menu", note: "hello" });
  });

  it("accepts each fixed shape", () => {
    expect(readClientEvent(JSON.stringify({ kind: "session_start", viewport: "390x844", language: "en-US", timezone: "America/New_York" }))).toEqual({
      kind: "session_start", viewport: "390x844", language: "en-US", timezone: "America/New_York",
    });
    expect(readClientEvent(JSON.stringify({ kind: "session_ping", sessionId: SESSION }))).toEqual({ kind: "session_ping", sessionId: SESSION });
    expect(readClientEvent(JSON.stringify({ kind: "session_end", sessionId: SESSION }))).toEqual({ kind: "session_end", sessionId: SESSION });
    expect(readClientEvent(JSON.stringify({ kind: "suggestion_used", sessionId: SESSION, conversationId: CONVERSATION, turnId: TURN, stage: "configure" }))).toMatchObject({ kind: "suggestion_used", stage: "configure" });
    expect(readClientEvent(JSON.stringify({ kind: "card_expanded", conversationId: CONVERSATION, turnId: TURN, card: "run" }))).toMatchObject({ card: "run" });
    expect(readClientEvent(JSON.stringify({ kind: "chart_view_changed", conversationId: CONVERSATION, turnId: TURN, view: "incidence" }))).toMatchObject({ view: "incidence" });
    expect(readClientEvent(JSON.stringify({ kind: "chart_view_changed", conversationId: CONVERSATION, turnId: TURN, view: "infected" }))).toMatchObject({ view: "infected" });
    expect(readClientEvent(JSON.stringify({ kind: "feedback_given", conversationId: CONVERSATION, turnId: TURN, rating: "up" }))).toBeNull();   // the thumbs are gone (round-1 UI cleanup)
    expect(readClientEvent(JSON.stringify({ kind: "export", conversationId: CONVERSATION, format: "pdf" }))).toMatchObject({ format: "pdf" });
    expect(readClientEvent(JSON.stringify({ kind: "export", conversationId: CONVERSATION, format: "md" }))).toMatchObject({ format: "md" });
    expect(readClientEvent(JSON.stringify({ kind: "export", conversationId: CONVERSATION, format: "html" }))).toMatchObject({ format: "html" });
    expect(readClientEvent(JSON.stringify({ kind: "scenario_panel_opened", conversationId: CONVERSATION, section: "report" }))).toMatchObject({ section: "report" });
    expect(readClientEvent(JSON.stringify({ kind: "card_expanded", conversationId: CONVERSATION, turnId: TURN, card: "report" }))).toMatchObject({ card: "report" });
    expect(readClientEvent(JSON.stringify({ kind: "conversation_opened", conversationId: CONVERSATION }))).toMatchObject({ kind: "conversation_opened" });
    expect(readClientEvent(JSON.stringify({ kind: "suggestion_used", conversationId: CONVERSATION, stage: "ground", source: "draft" }))).toMatchObject({ source: "draft" });
    expect(readClientEvent(JSON.stringify({ kind: "suggestion_used", conversationId: CONVERSATION, stage: "understand", source: "intro" }))).toMatchObject({ source: "intro" });
    expect(readClientEvent(JSON.stringify({ kind: "suggestion_used", conversationId: CONVERSATION, stage: "interpret", source: "option" }))).toMatchObject({ source: "option" });      // a Try next button
    expect(readClientEvent(JSON.stringify({ kind: "suggestion_used", conversationId: CONVERSATION, stage: "ground", source: "reference" }))).toMatchObject({ source: "reference" });
    expect(readClientEvent(JSON.stringify({ kind: "card_expanded", conversationId: CONVERSATION, turnId: TURN, card: "activity" }))).toMatchObject({ card: "activity" });
    expect(readClientEvent(JSON.stringify({ kind: "card_expanded", conversationId: CONVERSATION, turnId: TURN, card: "recap" }))).toMatchObject({ card: "recap" });
    expect(readClientEvent(JSON.stringify({ kind: "card_expanded", conversationId: CONVERSATION, turnId: TURN, card: "references" }))).toMatchObject({ card: "references" });
    expect(readClientEvent(JSON.stringify({ kind: "scenario_panel_opened", conversationId: CONVERSATION, section: "runs" }))).toMatchObject({ section: "runs" });
    expect(readClientEvent(JSON.stringify({ kind: "scenario_panel_opened", conversationId: CONVERSATION, section: "parameters" }))).toMatchObject({ section: "parameters" });
    expect(readClientEvent(JSON.stringify({ kind: "scenario_panel_opened", conversationId: CONVERSATION }))).toMatchObject({ kind: "scenario_panel_opened" });
  });

  it("refuses unknown kinds, extra fields, free text, bad ids, and oversized bodies", () => {
    expect(readClientEvent(JSON.stringify({ kind: "typed", text: "hello" }))).toBeNull();
    expect(readClientEvent(JSON.stringify({ kind: "session_end", sessionId: SESSION, note: "bye" }))).toBeNull();
    expect(readClientEvent(JSON.stringify({ kind: "session_start", viewport: "huge screen" }))).toBeNull();
    expect(readClientEvent(JSON.stringify({ kind: "card_expanded", conversationId: "abc", turnId: TURN, card: "run" }))).toBeNull();
    expect(readClientEvent(JSON.stringify({ kind: "feedback_given", conversationId: CONVERSATION, turnId: TURN, rating: "meh" }))).toBeNull();
    expect(readClientEvent("not json")).toBeNull();
    expect(readClientEvent("x".repeat(1001))).toBeNull();
    expect(readClientEvent(JSON.stringify({ kind: "suggestion_used", conversationId: CONVERSATION, stage: "ground", source: "typed" }))).toBeNull();
    expect(readClientEvent(JSON.stringify({ kind: "scenario_panel_opened", conversationId: CONVERSATION, section: "notes" }))).toBeNull();
  });
});
