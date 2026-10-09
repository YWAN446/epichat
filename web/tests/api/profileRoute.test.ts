import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { GET, PATCH } from "@/app/api/profile/route";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";
import { callOn, fakeAdmin, type Outcome } from "../helpers/fakeAdmin";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const ROW = {
  user_id: USER.id, email: USER.email, participant_type: "graduate_student", consent_version: "2026-10-10", consented_at: "2026-10-10T00:00:00Z",
  role: "policy_maker", experience: "some", goals: ["deciding"], disease_interest: "measles", country_interest: "KEN", decisions: "campaign timing",
  results_pref: "summary", report_format: "pdf", memory_enabled: true, profile_completed_at: "2026-10-10T00:05:00Z",
};
const FIELDS = {
  role: "policy_maker", experience: "some", goals: ["deciding"], diseaseInterest: "measles", countryInterest: "KEN", decisions: "campaign timing",
  resultsPref: "summary", reportFormat: "pdf", memoryEnabled: true, completedAt: "2026-10-10T00:05:00Z",
};

function setup(over: Partial<Record<string, Outcome[]>> = {}) {
  const admin = fakeAdmin({ profiles: [{ data: ROW }, { data: ROW }], step_events: [{ data: null }], ...over });
  vi.mocked(adminClient).mockReturnValue(admin.client);
  return admin;
}
const patch = (body: unknown) => PATCH(new Request("http://localhost/api/profile", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }));
const events = (admin: ReturnType<typeof fakeAdmin>) => (callOn(admin.recorded, "step_events", "insert")?.[0] as { kind: string; meta: Record<string, unknown> }[]).map((e) => [e.kind, e.meta]);

beforeEach(() => {
  vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({}) });
});

describe("GET /api/profile", () => {
  it("answers the participant's fields", async () => {
    setup();
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profile: FIELDS });
  });

  it("answers 500 on a database failure and passes the gate's refusal through", async () => {
    setup({ profiles: [{ data: null, error: { message: "down" } }] });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await GET()).status).toBe(500);
    logged.mockRestore();
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: Response.json({ code: "profile_required" }, { status: 403 }) });
    expect((await GET()).status).toBe(403);
    expect((await patch({ role: "student" })).status).toBe(403);
  });
});

describe("PATCH /api/profile", () => {
  it("updates the given fields, normalizes the disease, logs profile_updated with the field names, and answers the re-read profile", async () => {
    const admin = setup({ profiles: [{ data: null }, { data: { ...ROW, goals: ["exploring"] } }] });
    const response = await patch({ goals: ["exploring"], diseaseInterest: "Measles" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profile: { ...FIELDS, goals: ["exploring"] } });
    const update = admin.recorded.filter((r) => r.table === "profiles")[0].calls.find(([m]) => m === "update")?.[1][0] as Record<string, unknown>;
    expect(update).toMatchObject({ goals: ["exploring"], disease_interest: "measles" });
    expect(update).not.toHaveProperty("profile_completed_at");
    expect(events(admin)).toEqual([["profile_updated", { fields: "goals,diseaseInterest" }]]);
  });

  it("logs memory_toggled for the switch alone, and both kinds when the switch comes with other fields", async () => {
    const alone = setup({ profiles: [{ data: null }, { data: { ...ROW, memory_enabled: false } }] });
    const response = await patch({ memoryEnabled: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profile: { ...FIELDS, memoryEnabled: false } });
    expect(events(alone)).toEqual([["memory_toggled", { enabled: false }]]);
    const both = setup({ profiles: [{ data: null }, { data: ROW }] });
    await patch({ memoryEnabled: true, role: "student" });
    expect(events(both)).toEqual([["profile_updated", { fields: "role" }], ["memory_toggled", { enabled: true }]]);
  });

  it("refuses an empty patch, an emptied goals list, an unknown field, and bad JSON, naming the field", async () => {
    setup();
    const empty = await patch({});
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ code: "bad_request", field: "body" });
    expect(await (await patch({ goals: [] })).json()).toEqual({ code: "bad_request", field: "goals" });
    expect((await patch({ extra: 1 })).status).toBe(400);
    expect(await (await patch("{nope")).json()).toEqual({ code: "bad_request", field: "body" });
  });
});
