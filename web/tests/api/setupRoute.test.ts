import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { POST } from "@/app/api/profile/setup/route";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";
import { callOn, fakeAdmin, type Outcome } from "../helpers/fakeAdmin";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const ROW = { user_id: USER.id, email: USER.email, participant_type: "graduate_student", consent_version: "2026-10-10", consented_at: "2026-10-10T00:00:00Z", profile_completed_at: null };
const BODY = { role: "policy_maker", experience: "some", goals: ["deciding"], diseaseInterest: "Measles", countryInterest: "KEN", decisions: "campaign timing" };

function setup(over: Partial<Record<string, Outcome[]>> = {}) {
  const admin = fakeAdmin({ profiles: [{ data: ROW }, { data: null }], step_events: [{ data: null }], ...over });
  vi.mocked(adminClient).mockReturnValue(admin.client);
  return admin;
}
const post = (body: unknown) => POST(new Request("http://localhost/api/profile/setup", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("POST /api/profile/setup", () => {
  beforeEach(() => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({}) });
  });

  it("saves the questionnaire, normalizes the disease to its key, stamps completion, and logs profile_completed", async () => {
    const admin = setup();
    const response = await post(BODY);
    expect(response.status).toBe(204);
    expect(vi.mocked(requireParticipant)).toHaveBeenCalledWith({ allowIncompleteProfile: true });
    const update = admin.recorded.filter((r) => r.table === "profiles")[1].calls.find(([m]) => m === "update")?.[1][0] as Record<string, unknown>;
    expect(update).toMatchObject({ role: "policy_maker", experience: "some", goals: ["deciding"], disease_interest: "measles", country_interest: "KEN", decisions: "campaign timing" });
    expect(typeof update.profile_completed_at).toBe("string");
    const event = (callOn(admin.recorded, "step_events", "insert")?.[0] as { kind: string; meta: Record<string, unknown> }[])[0];
    expect(event).toMatchObject({ kind: "profile_completed", meta: { role: "policy_maker", experience: "some", goals: "deciding", has_disease: true, has_country: true, has_decisions: true } });
  });

  it("logs profile_updated instead when the profile was already complete, and keeps unknown disease text as typed", async () => {
    const admin = setup({ profiles: [{ data: { ...ROW, profile_completed_at: "2026-10-09T00:00:00Z" } }, { data: null }] });
    expect((await post({ ...BODY, diseaseInterest: "Unicorn pox", countryInterest: null, decisions: "" })).status).toBe(204);
    const update = admin.recorded.filter((r) => r.table === "profiles")[1].calls.find(([m]) => m === "update")?.[1][0] as Record<string, unknown>;
    expect(update).toMatchObject({ disease_interest: "Unicorn pox", country_interest: null, decisions: null });
    expect(update).not.toHaveProperty("profile_completed_at");
    const event = (callOn(admin.recorded, "step_events", "insert")?.[0] as { kind: string; meta: Record<string, unknown> }[])[0];
    expect(event).toMatchObject({ kind: "profile_updated", meta: { has_country: false, has_decisions: false } });
  });

  it("names the missing or bad field in a 400, answers 500 on a database failure, and passes the gate's refusal through", async () => {
    setup();
    const missing = await post({ role: "student", experience: "none", goals: [] });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ code: "bad_request", field: "goals" });
    const country = await post({ ...BODY, countryInterest: "XXX" });
    expect(await country.json()).toEqual({ code: "bad_request", field: "countryInterest" });
    const bad = await post("{not json");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ code: "bad_request", field: "body" });
    setup({ profiles: [{ data: ROW }, { data: null, error: { message: "down" } }] });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post(BODY)).status).toBe(500);
    logged.mockRestore();
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: Response.json({ code: "consent_required" }, { status: 403 }) });
    expect((await post(BODY)).status).toBe(403);
  });
});
