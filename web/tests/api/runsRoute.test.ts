import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { GET } from "@/app/api/runs/[id]/route";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const RUN = "66666666-6666-4666-8666-666666666666";
const SERIES = { day: [0, 1], n_infected: [1, 2] };
let admin: ReturnType<typeof fakeAdmin>;

function get(id: string) {
  return GET(new Request(`http://localhost/api/runs/${id}`), { params: Promise.resolve({ id }) });
}

describe("GET /api/runs/[id]", () => {
  beforeEach(() => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({}) });
    admin = fakeAdmin({ runs: [{ data: { user_id: USER.id, series: SERIES } }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
  });

  it("answers the caller's run series, privately cacheable", async () => {
    const response = await get(RUN);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ series: SERIES });
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(callOn(admin.recorded, "runs", "select")).toEqual(["user_id, series"]);
    expect(callOn(admin.recorded, "runs", "eq")).toEqual(["id", RUN]);
  });

  it("answers 404 for a malformed id, a missing run, another participant's run, or one without a series; 500 on a database error; passes the gate through", async () => {
    expect((await get("nope")).status).toBe(404);
    admin = fakeAdmin({ runs: [{ data: null }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
    expect((await get(RUN)).status).toBe(404);
    admin = fakeAdmin({ runs: [{ data: { user_id: "22222222-2222-2222-2222-222222222222", series: SERIES } }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
    expect((await get(RUN)).status).toBe(404);
    admin = fakeAdmin({ runs: [{ data: { user_id: USER.id, series: null } }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
    expect((await get(RUN)).status).toBe(404);
    admin = fakeAdmin({ runs: [{ data: null, error: { message: "down" } }] });
    vi.mocked(adminClient).mockReturnValue(admin.client);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get(RUN)).status).toBe(500);
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await get(RUN)).status).toBe(401);
  });
});
