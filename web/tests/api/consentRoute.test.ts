import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/consent", () => ({ loadConsent: vi.fn(async () => ({ version: "2026-10-07", markdown: "" })) }));

import { POST } from "@/app/api/consent/route";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";
let admin: ReturnType<typeof fakeAdmin>;
let signOut: ReturnType<typeof vi.fn>;

function signedInAs(email: string | null) {
  signOut = vi.fn(async () => ({ error: null }));
  const user = email === null ? null : { id: USER, email, email_confirmed_at: "2026-10-01T12:00:00Z" };
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }), signOut } } as never);
}

function post(body: unknown) {
  return POST(new Request("http://localhost/api/consent", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
}

describe("POST /api/consent", () => {
  beforeEach(() => {
    admin = fakeAdmin();
    vi.mocked(adminClient).mockReturnValue(admin.client);
  });

  it("records agreement with the participant type and the current version, and logs the event", async () => {
    signedInAs("student@emory.edu");
    const response = await post({ decision: "agree", participantType: "graduate_student" });
    expect(response.status).toBe(204);
    const upsert = callOn(admin.recorded, "profiles", "upsert")?.[0] as Record<string, unknown>;
    expect(upsert).toMatchObject({ user_id: USER, email: "student@emory.edu", participant_type: "graduate_student", consent_version: "2026-10-07" });
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "consent_given", meta: { participant_type: "graduate_student", version: "2026-10-07" } });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("on decline logs only the event and signs the user out", async () => {
    signedInAs("student@emory.edu");
    const response = await post({ decision: "decline" });
    expect(response.status).toBe(204);
    expect(callOn(admin.recorded, "profiles", "upsert")).toBeUndefined();
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "consent_declined", meta: { version: "2026-10-07" } });
    expect(signOut).toHaveBeenCalled();
  });

  it("turns away a signed-out request, a disallowed address, and a malformed body", async () => {
    signedInAs(null);
    expect((await post({ decision: "agree", participantType: "other" })).status).toBe(401);
    signedInAs("someone@gmail.com");
    expect((await post({ decision: "agree", participantType: "other" })).status).toBe(403);
    signedInAs("student@emory.edu");
    expect((await post({ decision: "agree" })).status).toBe(400);
    expect((await post({ decision: "agree", participantType: "student" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(admin.recorded).toEqual([]);
  });
});
