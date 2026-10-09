import { z } from "zod";
import type { Settings } from "@/lib/config";

// Only the three fields the spec names. Anything else is refused, so no stray
// text can ride in on the request. sessionId may be missing: a visit that
// could not be opened (tracking is best-effort) must not stop a participant
// from chatting.
const ChatRequest = z.strictObject({
  conversationId: z.uuid().optional(),
  sessionId: z.uuid().nullable().optional(),
  text: z.string(),
});

export type ChatRequestData = { conversationId: string | null; sessionId: string | null; text: string };
export type RequestProblem = { code: "bad_request" | "message_too_long"; message: string };
export type ParseResult = { ok: true; request: ChatRequestData } | { ok: false; problem: RequestProblem };

const UNREADABLE = "The request could not be read. Please reload the page.";
const EMPTY = "Type a message first.";

function problem(code: RequestProblem["code"], message: string): ParseResult {
  return { ok: false, problem: { code, message } };
}

export function tooLong(maxMessageChars: number): string {
  return `That message is too long. Keep it under ${maxMessageChars} characters.`;
}

/** Read one chat request. The raw body is bounded before parsing: JSON escapes can inflate a message sixfold. */
export function parseChatRequest(raw: string, limits: Pick<Settings, "maxMessageChars">): ParseResult {
  if (raw.length > limits.maxMessageChars * 6 + 1000) return problem("message_too_long", tooLong(limits.maxMessageChars));
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return problem("bad_request", UNREADABLE);
  }
  const parsed = ChatRequest.safeParse(json);
  if (!parsed.success) return problem("bad_request", UNREADABLE);
  const text = parsed.data.text.trim();
  if (text === "") return problem("bad_request", EMPTY);
  if (text.length > limits.maxMessageChars) return problem("message_too_long", tooLong(limits.maxMessageChars));
  return { ok: true, request: { conversationId: parsed.data.conversationId ?? null, sessionId: parsed.data.sessionId ?? null, text } };
}
