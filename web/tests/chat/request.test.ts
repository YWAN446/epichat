import { describe, expect, it } from "vitest";

import { parseChatRequest } from "@/lib/chat/request";

const LIMITS = { maxMessageChars: 20 };
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";

describe("parseChatRequest", () => {
  it("accepts the three fields, trims the text, and defaults the ids to null", () => {
    expect(parseChatRequest(JSON.stringify({ text: " Model measles " }), LIMITS)).toEqual({ ok: true, request: { conversationId: null, sessionId: null, text: "Model measles" } });
    expect(parseChatRequest(JSON.stringify({ conversationId: CONVERSATION, sessionId: SESSION, text: "hi" }), LIMITS)).toEqual({ ok: true, request: { conversationId: CONVERSATION, sessionId: SESSION, text: "hi" } });
    expect(parseChatRequest(JSON.stringify({ sessionId: null, text: "hi" }), LIMITS)).toMatchObject({ ok: true, request: { sessionId: null } });
  });

  it("refuses bodies that are not JSON, not the shape, or carry extra fields", () => {
    for (const raw of ["not json", "[]", JSON.stringify({ text: 5 }), JSON.stringify({ text: "hi", history: [] }), JSON.stringify({ conversationId: "c1", text: "hi" })]) {
      expect(parseChatRequest(raw, LIMITS)).toEqual({ ok: false, problem: { code: "bad_request", message: "The request could not be read. Please reload the page." } });
    }
  });

  it("refuses an empty message and one over the limit, before and after parsing", () => {
    expect(parseChatRequest(JSON.stringify({ text: "   " }), LIMITS)).toEqual({ ok: false, problem: { code: "bad_request", message: "Type a message first." } });
    expect(parseChatRequest(JSON.stringify({ text: "x".repeat(21) }), LIMITS)).toEqual({ ok: false, problem: { code: "message_too_long", message: "That message is too long. Keep it under 20 characters." } });
    expect(parseChatRequest("x".repeat(20 * 6 + 1001), LIMITS)).toMatchObject({ ok: false, problem: { code: "message_too_long" } });
  });
});
