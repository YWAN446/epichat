import { describe, expect, it } from "vitest";
import { supabaseProfileStore } from "@/lib/profiles";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-07T15:00:00Z");

describe("supabaseProfileStore", () => {
  it("reads one profile by user id and maps the columns", async () => {
    const { client, recorded } = fakeAdmin({
      profiles: [{ data: { user_id: USER, email: "a@emory.edu", participant_type: "other", consent_version: "v1", consented_at: "2026-10-02T00:00:00Z" } }],
    });
    const profile = await supabaseProfileStore(client).get(USER);
    expect(profile).toEqual({ userId: USER, email: "a@emory.edu", participantType: "other", consentVersion: "v1", consentedAt: "2026-10-02T00:00:00Z" });
    expect(callOn(recorded, "profiles", "eq")).toEqual(["user_id", USER]);
    expect(callOn(recorded, "profiles", "maybeSingle")).toEqual([]);
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
