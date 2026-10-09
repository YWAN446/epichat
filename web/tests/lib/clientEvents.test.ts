import { describe, expect, it } from "vitest";
import { readClientEvent } from "@/lib/clientEvents";

const SESSION = "44444444-4444-4444-8444-444444444444";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const TURN = "55555555-5555-4555-8555-555555555555";

describe("readClientEvent", () => {
  it("accepts each fixed shape", () => {
    expect(readClientEvent(JSON.stringify({ kind: "session_start", viewport: "390x844", language: "en-US", timezone: "America/New_York" }))).toEqual({
      kind: "session_start", viewport: "390x844", language: "en-US", timezone: "America/New_York",
    });
    expect(readClientEvent(JSON.stringify({ kind: "session_ping", sessionId: SESSION }))).toEqual({ kind: "session_ping", sessionId: SESSION });
    expect(readClientEvent(JSON.stringify({ kind: "session_end", sessionId: SESSION }))).toEqual({ kind: "session_end", sessionId: SESSION });
    expect(readClientEvent(JSON.stringify({ kind: "suggestion_used", sessionId: SESSION, conversationId: CONVERSATION, turnId: TURN, stage: "configure" }))).toMatchObject({ kind: "suggestion_used", stage: "configure" });
    expect(readClientEvent(JSON.stringify({ kind: "card_expanded", conversationId: CONVERSATION, turnId: TURN, card: "run" }))).toMatchObject({ card: "run" });
    expect(readClientEvent(JSON.stringify({ kind: "chart_view_changed", conversationId: CONVERSATION, turnId: TURN, view: "incidence" }))).toMatchObject({ view: "incidence" });
    expect(readClientEvent(JSON.stringify({ kind: "feedback_given", conversationId: CONVERSATION, turnId: TURN, rating: "up" }))).toMatchObject({ rating: "up" });
    expect(readClientEvent(JSON.stringify({ kind: "export", conversationId: CONVERSATION, format: "pdf" }))).toMatchObject({ format: "pdf" });
    expect(readClientEvent(JSON.stringify({ kind: "conversation_opened", conversationId: CONVERSATION }))).toMatchObject({ kind: "conversation_opened" });
    expect(readClientEvent(JSON.stringify({ kind: "suggestion_used", conversationId: CONVERSATION, stage: "ground", source: "draft" }))).toMatchObject({ source: "draft" });
    expect(readClientEvent(JSON.stringify({ kind: "card_expanded", conversationId: CONVERSATION, turnId: TURN, card: "activity" }))).toMatchObject({ card: "activity" });
    expect(readClientEvent(JSON.stringify({ kind: "card_expanded", conversationId: CONVERSATION, turnId: TURN, card: "recap" }))).toMatchObject({ card: "recap" });
    expect(readClientEvent(JSON.stringify({ kind: "scenario_panel_opened", conversationId: CONVERSATION, section: "runs" }))).toMatchObject({ section: "runs" });
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
