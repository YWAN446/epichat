import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE } from "@/lib/profile/schema";
import { supabaseProfileStore } from "@/lib/profiles";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-07T15:00:00Z");
const ROW = { user_id: USER, email: "a@emory.edu", participant_type: "other", consent_version: "v1", consented_at: "2026-10-02T00:00:00Z" };
const COLUMNS = {
  role: "policy_maker", experience: "some", goals: ["deciding"], disease_interest: "measles", country_interest: "KEN", decisions: "campaign timing",
  results_pref: "summary", report_format: "docx", memory_enabled: false, profile_completed_at: "2026-10-09T00:00:00Z",
};

describe("supabaseProfileStore", () => {
  it("reads one profile by user id and maps the columns", async () => {
    const { client, recorded } = fakeAdmin({
      profiles: [{ data: { user_id: USER, email: "a@emory.edu", participant_type: "other", consent_version: "v1", consented_at: "2026-10-02T00:00:00Z" } }],
    });
    const profile = await supabaseProfileStore(client).get(USER);
    expect(profile).toEqual({ userId: USER, email: "a@emory.edu", participantType: "other", consentVersion: "v1", consentedAt: "2026-10-02T00:00:00Z", fields: EMPTY_PROFILE });
    expect(callOn(recorded, "profiles", "eq")).toEqual(["user_id", USER]);
    expect(callOn(recorded, "profiles", "maybeSingle")).toEqual([]);
    expect(String(callOn(recorded, "profiles", "select")?.[0])).toContain("profile_completed_at");
  });

  it("maps the questionnaire's columns to the profile fields", async () => {
    const { client } = fakeAdmin({ profiles: [{ data: { ...ROW, ...COLUMNS } }] });
    expect((await supabaseProfileStore(client).get(USER))?.fields).toEqual({
      role: "policy_maker", experience: "some", goals: ["deciding"], diseaseInterest: "measles", countryInterest: "KEN", decisions: "campaign timing",
      resultsPref: "summary", reportFormat: "docx", memoryEnabled: false, completedAt: "2026-10-09T00:00:00Z",
    });
  });

  it("saves the questionnaire, stamping completion the first time only", async () => {
    const first = fakeAdmin({ profiles: [{ data: ROW }, { data: null }] });
    const input = { role: "student" as const, experience: "none" as const, goals: ["learning" as const], diseaseInterest: "measles", countryInterest: null, decisions: null, reportFormat: "md" as const };
    expect(await supabaseProfileStore(first.client).saveProfile(USER, input, NOW)).toEqual({ first: true });
    const update = first.recorded.filter((r) => r.table === "profiles")[1];
    expect(update.calls.find(([m]) => m === "update")?.[1]).toEqual([
      { role: "student", experience: "none", goals: ["learning"], disease_interest: "measles", country_interest: null, decisions: null, report_format: "md", profile_completed_at: NOW.toISOString(), profile_updated_at: NOW.toISOString() },
    ]);
    expect(update.calls.find(([m]) => m === "eq")?.[1]).toEqual(["user_id", USER]);
    const again = fakeAdmin({ profiles: [{ data: { ...ROW, ...COLUMNS } }, { data: null }] });
    expect(await supabaseProfileStore(again.client).saveProfile(USER, input, NOW)).toEqual({ first: false });
    const payload = again.recorded.filter((r) => r.table === "profiles")[1].calls.find(([m]) => m === "update")?.[1][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("profile_completed_at");
    expect(payload.profile_updated_at).toBe(NOW.toISOString());
    const failing = fakeAdmin({ profiles: [{ data: ROW }, { data: null, error: { message: "down" } }] });
    await expect(supabaseProfileStore(failing.client).saveProfile(USER, input, NOW)).rejects.toThrow(/down/);
  });

  it("patches only the given fields", async () => {
    const { client, recorded } = fakeAdmin();
    await supabaseProfileStore(client).patchProfile(USER, { goals: ["exploring"], memoryEnabled: false, countryInterest: null }, NOW);
    expect(callOn(recorded, "profiles", "update")).toEqual([{ goals: ["exploring"], memory_enabled: false, country_interest: null, profile_updated_at: NOW.toISOString() }]);
    expect(callOn(recorded, "profiles", "eq")).toEqual(["user_id", USER]);
  });

  it("returns null when there is no row and throws when the database errors", async () => {
    expect(await supabaseProfileStore(fakeAdmin().client).get(USER)).toBeNull();
    const failing = fakeAdmin({ profiles: [{ data: null, error: { message: "down" } }] });
    await expect(supabaseProfileStore(failing.client).get(USER)).rejects.toThrow(/down/);
  });

  it("records consent as an upsert on the user id", async () => {
    const { client, recorded } = fakeAdmin();
    await supabaseProfileStore(client).recordConsent(USER, "a@emory.edu", "graduate_student", "2026-10-07", NOW);
    expect(callOn(recorded, "profiles", "upsert")).toEqual([
      {
        user_id: USER,
        email: "a@emory.edu",
        participant_type: "graduate_student",
        consent_version: "2026-10-07",
        consented_at: NOW.toISOString(),
        last_seen_at: NOW.toISOString(),
      },
      { onConflict: "user_id" },
    ]);
  });

  it("touches last_seen_at", async () => {
    const { client, recorded } = fakeAdmin();
    await supabaseProfileStore(client).touch(USER, NOW);
    expect(callOn(recorded, "profiles", "update")).toEqual([{ last_seen_at: NOW.toISOString() }]);
    expect(callOn(recorded, "profiles", "eq")).toEqual(["user_id", USER]);
  });
});
