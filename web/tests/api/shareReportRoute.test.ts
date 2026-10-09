import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { GET } from "@/app/s/[token]/report/route";
import { adminClient } from "@/lib/supabase/admin";
import { fakeAdmin } from "../helpers/fakeAdmin";

const TOKEN = "t".repeat(22);
const DOC = { version: 1, title: "Measles in Kenya", subtitle: "EpiChat report · version 1", generatedAt: "2026-10-09T15:00:00Z", language: "en", sections: [{ id: "summary", heading: "Summary", blocks: [{ kind: "paragraph", text: "Fast." }] }] };
const ROW = { id: "sh1", token: TOKEN, conversation_id: "c1", user_id: "u1", title: "Measles in Kenya", snapshot: { version: 1, title: "Measles in Kenya", takenAt: "2026-10-09T18:00:00Z", turns: [], report: DOC }, turn_count: 1, taken_at: "2026-10-09T18:00:00Z", revoked_at: null, view_count: 0 };

function get(token: string) {
  return GET(new Request(`http://localhost/s/${token}/report`), { params: Promise.resolve({ token }) });
}

describe("GET /s/[token]/report", () => {
  beforeEach(() => {
    vi.mocked(adminClient).mockImplementation(() => fakeAdmin({ shares: [{ data: ROW }] }).client);
  });

  it("renders the snapshot's report inline, uncached and unindexed, with no sign-in", async () => {
    const response = await get(TOKEN);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await response.text()).toContain("<h2>Summary</h2>");
  });

  it("answers 404 for a malformed token, an unknown or revoked share, or a share without a report, and 500 on a database failure", async () => {
    expect((await get("nope")).status).toBe(404);
    vi.mocked(adminClient).mockImplementation(() => fakeAdmin({ shares: [{ data: null }] }).client);
    expect((await get(TOKEN)).status).toBe(404);
    vi.mocked(adminClient).mockImplementation(() => fakeAdmin({ shares: [{ data: { ...ROW, snapshot: { ...ROW.snapshot, report: null } } }] }).client);
    expect((await get(TOKEN)).status).toBe(404);
    vi.mocked(adminClient).mockImplementation(() => fakeAdmin({ shares: [{ data: null, error: { message: "down" } }] }).client);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get(TOKEN)).status).toBe(500);
  });
});
