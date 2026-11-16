import { describe, expect, it } from "vitest";
import { supabaseSessionStore } from "@/lib/sessions";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";
const SESSION = "44444444-4444-4444-8444-444444444444";
const info = { userAgent: "UA", viewport: "390x844", language: "en-US", timezone: "America/New_York" };

describe("supabaseSessionStore", () => {
  it("starts a session with the device facts and returns its id", async () => {
    const { client, recorded } = fakeAdmin({ sessions: [{ data: { id: SESSION } }] });
    expect(await supabaseSessionStore(client).start(USER, info)).toBe(SESSION);
    expect(callOn(recorded, "sessions", "insert")).toEqual([{ user_id: USER, user_agent: "UA", viewport: "390x844", language: "en-US", timezone: "America/New_York" }]);
    expect(callOn(recorded, "sessions", "select")).toEqual(["id"]);
    expect(callOn(recorded, "sessions", "single")).toEqual([]);
  });

  it("pings and ends only the caller's own session", async () => {
    const { client, recorded } = fakeAdmin();
    const store = supabaseSessionStore(client);
    await store.ping(SESSION, USER);
    await store.end(SESSION, USER);
    const [ping, end] = recorded;
    expect(ping.calls[0][0]).toBe("update");
    expect(Object.keys(ping.calls[0][1][0] as object)).toEqual(["last_active_at"]);
    expect(ping.calls.filter(([m]) => m === "eq").map(([, a]) => a)).toEqual([["id", SESSION], ["user_id", USER]]);
    expect(Object.keys(end.calls[0][1][0] as object).sort()).toEqual(["ended_at", "last_active_at"]);
    expect(end.calls.filter(([m]) => m === "eq").map(([, a]) => a)).toEqual([["id", SESSION], ["user_id", USER]]);
  });

  it("throws when the database refuses", async () => {
    const { client } = fakeAdmin({ sessions: [{ data: null, error: { message: "down" } }] });
    await expect(supabaseSessionStore(client).start(USER, info)).rejects.toThrow(/down/);
  });
});
