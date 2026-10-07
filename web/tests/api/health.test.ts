import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { GET } from "@/app/api/health/route";
import { adminClient } from "@/lib/supabase/admin";
import { fakeAdmin } from "../helpers/fakeAdmin";

function get(headers: Record<string, string> = {}) {
  return GET(new Request("http://localhost/api/health", { headers }));
}

describe("GET /api/health", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => vi.mocked(adminClient).mockReset());
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("with the cron secret set, admits only the bearer Vercel sends and then reports the participant count", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { client, recorded } = fakeAdmin({ profiles: [{ count: 12, error: null }] });
    vi.mocked(adminClient).mockReturnValue(client);
    expect((await get()).status).toBe(401);
    expect((await get({ authorization: "Bearer wrong" })).status).toBe(401);
    expect(recorded).toEqual([]);
    const response = await get({ authorization: "Bearer s3cret" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, participants: 12 });
    expect(recorded[0].calls[0]).toEqual(["select", ["user_id", { count: "exact", head: true }]]);
  });

  it("without a cron secret, still pings the database but tells nobody the count", async () => {
    delete process.env.CRON_SECRET;
    const { client } = fakeAdmin({ profiles: [{ count: 12, error: null }] });
    vi.mocked(adminClient).mockReturnValue(client);
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns 500 when the database cannot be reached", async () => {
    delete process.env.CRON_SECRET;
    const { client } = fakeAdmin({ profiles: [{ count: null, error: { message: "paused" } }] });
    vi.mocked(adminClient).mockReturnValue(client);
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
  });
});
