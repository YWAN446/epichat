import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { GET } from "@/app/api/health/route";
import { adminClient } from "@/lib/supabase/admin";
import { fakeAdmin } from "../helpers/fakeAdmin";

describe("GET /api/health", () => {
  beforeEach(() => vi.mocked(adminClient).mockReset());

  it("touches the database and reports the participant count", async () => {
    const { client, recorded } = fakeAdmin({ profiles: [{ count: 12, error: null }] });
    vi.mocked(adminClient).mockReturnValue(client);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, participants: 12 });
    expect(recorded[0].calls[0]).toEqual(["select", ["user_id", { count: "exact", head: true }]]);
  });

  it("returns 500 when the database cannot be reached", async () => {
    const { client } = fakeAdmin({ profiles: [{ count: null, error: { message: "paused" } }] });
    vi.mocked(adminClient).mockReturnValue(client);
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
  });
});
