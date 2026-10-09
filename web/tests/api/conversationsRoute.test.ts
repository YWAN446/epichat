import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { DELETE } from "@/app/api/conversations/[id]/route";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
let admin: ReturnType<typeof fakeAdmin>;

function del(id: string) {
  return DELETE(new Request(`http://localhost/api/conversations/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
}

describe("DELETE /api/conversations/[id]", () => {
  beforeEach(() => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({}) });
    admin = fakeAdmin({ conversations: [{ data: [{ id: CONVERSATION }] }], shares: [{ data: [{ id: "sh1" }] }], step_events: [{ data: null }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
  });

  it("hides the caller's conversation and answers 204", async () => {
    expect((await del(CONVERSATION)).status).toBe(204);
    expect(callOn(admin.recorded, "conversations", "update")?.[0]).toMatchObject({ deleted_at: expect.any(String) });
    expect(callOn(admin.recorded, "conversations", "eq")).toEqual(["id", CONVERSATION]);
    expect(callOn(admin.recorded, "shares", "update")).toEqual([{ revoked_at: expect.any(String) }]);
    const event = (callOn(admin.recorded, "step_events", "insert")?.[0] as { kind: string }[])[0];
    expect(event).toMatchObject({ kind: "share_revoked", conversation_id: CONVERSATION });
  });

  it("still hides the conversation when revoking its share fails", async () => {
    admin = fakeAdmin({ conversations: [{ data: [{ id: CONVERSATION }] }], shares: [{ data: null, error: { message: "down" } }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await del(CONVERSATION)).status).toBe(204);
  });

  it("answers 404 for someone else's, an already hidden, or a malformed id, and passes the gate's refusal through", async () => {
    admin = fakeAdmin({ conversations: [{ data: [] }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
    expect((await del(CONVERSATION)).status).toBe(404);
    expect((await del("not-a-uuid")).status).toBe(404);
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await del(CONVERSATION)).status).toBe(403);
  });
});
