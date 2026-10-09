import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { POST } from "@/app/api/feedback/route";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const TURN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SESSION = "44444444-4444-4444-8444-444444444444";
let admin: ReturnType<typeof fakeAdmin>;

function withDb(conversation: Record<string, unknown> | null, turn: Record<string, unknown> | null) {
  admin = fakeAdmin({ conversations: [{ data: conversation }], turns: [{ data: turn }] });
  vi.mocked(adminClient).mockReturnValue(admin.client);
}

function post(body: unknown) {
  return POST(new Request("http://localhost/api/feedback", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
}

describe("POST /api/feedback", () => {
  beforeEach(() => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({}) });
    withDb({ id: CONVERSATION, title: "T", active_scenario_id: null }, { id: TURN });
  });

  it("inserts one row per press and mirrors it as a step event", async () => {
    const response = await post({ conversationId: CONVERSATION, turnId: TURN, rating: "down", comment: "  Too slow  ", sessionId: SESSION });
    expect(response.status).toBe(204);
    expect(callOn(admin.recorded, "feedback", "insert")).toEqual([{ user_id: USER.id, conversation_id: CONVERSATION, turn_id: TURN, rating: "down", comment: "Too slow" }]);
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "feedback_given", session_id: SESSION, conversation_id: CONVERSATION, turn_id: TURN, meta: { rating: "down", has_comment: true } });
  });

  it("stores an empty comment as null and no session as null", async () => {
    await post({ conversationId: CONVERSATION, turnId: TURN, rating: "up", comment: "   " });
    expect(callOn(admin.recorded, "feedback", "insert")).toEqual([{ user_id: USER.id, conversation_id: CONVERSATION, turn_id: TURN, rating: "up", comment: null }]);
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ session_id: null, meta: { rating: "up", has_comment: false } });
  });

  it("answers 404 when the conversation is not the caller's or the turn is not in it, and writes nothing", async () => {
    withDb(null, { id: TURN });
    expect((await post({ conversationId: CONVERSATION, turnId: TURN, rating: "up" })).status).toBe(404);
    withDb({ id: CONVERSATION, title: "T", active_scenario_id: null }, null);
    expect((await post({ conversationId: CONVERSATION, turnId: TURN, rating: "up" })).status).toBe(404);
    expect(callOn(admin.recorded, "feedback", "insert")).toBeUndefined();
  });

  it("refuses a malformed body and passes the gate's refusal through", async () => {
    for (const body of ["not json", { conversationId: CONVERSATION, turnId: TURN, rating: "meh" }, { conversationId: CONVERSATION, rating: "up" }, { conversationId: CONVERSATION, turnId: TURN, rating: "up", comment: "x".repeat(1001) }, { conversationId: CONVERSATION, turnId: TURN, rating: "up", extra: 1 }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(admin.recorded).toEqual([]);
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await post({ conversationId: CONVERSATION, turnId: TURN, rating: "up" })).status).toBe(401);
  });
});
