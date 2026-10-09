import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/consent", () => ({ loadConsent: vi.fn(async () => ({ version: "2026-10-07", markdown: "" })) }));

import { POST } from "@/app/api/event/route";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";
const SESSION = "44444444-4444-4444-8444-444444444444";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const enrolled = { user_id: USER, email: "student@emory.edu", participant_type: "other", consent_version: "2026-10-07", consented_at: "2026-10-02T00:00:00Z", profile_completed_at: "2026-10-02T00:05:00Z" };

let admin: ReturnType<typeof fakeAdmin>;

function signedInAs(email: string | null) {
  const user = email === null ? null : { id: USER, email, email_confirmed_at: "2026-10-01T12:00:00Z" };
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }) } } as never);
}

function withDb(profile: Record<string, unknown> | null, sessionRow = { id: SESSION }) {
  // Every request reads the profile once; a test may post several times.
  admin = fakeAdmin({ profiles: Array.from({ length: 8 }, () => ({ data: profile })), sessions: [{ data: sessionRow }] });
  vi.mocked(adminClient).mockReturnValue(admin.client);
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request("http://localhost/api/event", { method: "POST", headers: { "user-agent": "TestBrowser/1", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

describe("POST /api/event", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    signedInAs("student@emory.edu");
    withDb(enrolled);
  });

  it("opens a session with the device facts and returns its id", async () => {
    const response = await post({ kind: "session_start", viewport: "390x844", language: "en-US", timezone: "America/New_York" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId: SESSION });
    expect(callOn(admin.recorded, "sessions", "insert")).toEqual([{ user_id: USER, user_agent: "TestBrowser/1", viewport: "390x844", language: "en-US", timezone: "America/New_York" }]);
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "session_start", session_id: SESSION });
  });

  it("pings without logging, and ends a session from a text/plain beacon body", async () => {
    expect((await post({ kind: "session_ping", sessionId: SESSION })).status).toBe(204);
    expect(callOn(admin.recorded, "step_events", "insert")).toBeUndefined();
    const response = await post(JSON.stringify({ kind: "session_end", sessionId: SESSION }), { "content-type": "text/plain;charset=UTF-8" });
    expect(response.status).toBe(204);
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "session_end", session_id: SESSION });
  });

  it("logs an interaction with its conversation and stage", async () => {
    const response = await post({ kind: "suggestion_used", sessionId: SESSION, conversationId: CONVERSATION, stage: "configure" });
    expect(response.status).toBe(204);
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "suggestion_used", session_id: SESSION, conversation_id: CONVERSATION, stage: "configure", meta: {} });
  });

  it("keeps the chip source and the panel section in meta", async () => {
    await post({ kind: "suggestion_used", sessionId: SESSION, conversationId: CONVERSATION, stage: "ground", source: "draft" });
    let events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "suggestion_used", meta: { source: "draft" } });
    admin.recorded.length = 0;
    await post({ kind: "scenario_panel_opened", sessionId: SESSION, conversationId: CONVERSATION, section: "runs" });
    events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "scenario_panel_opened", meta: { section: "runs" } });
  });

  it("turns away a signed-out request, a disallowed address, and a user without current consent", async () => {
    signedInAs(null);
    expect((await post({ kind: "session_ping", sessionId: SESSION })).status).toBe(401);
    signedInAs("someone@gmail.com");
    expect((await post({ kind: "session_ping", sessionId: SESSION })).status).toBe(403);
    signedInAs("student@emory.edu");
    withDb({ ...enrolled, consent_version: "2026-01-01" });
    expect((await post({ kind: "session_ping", sessionId: SESSION })).status).toBe(403);
    withDb(null);
    expect((await post({ kind: "session_ping", sessionId: SESSION })).status).toBe(403);
  });

  it("refuses an action it does not know and stores nothing", async () => {
    expect((await post({ kind: "typed", text: "my question" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(callOn(admin.recorded, "step_events", "insert")).toBeUndefined();
    expect(callOn(admin.recorded, "sessions", "insert")).toBeUndefined();
  });
});
