import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));

import { GET } from "@/app/api/diseases/[key]/references/route";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };

function get(key: string) {
  return GET(new Request(`http://localhost/api/diseases/${key}/references`), { params: Promise.resolve({ key }) });
}

describe("GET /api/diseases/[key]/references", () => {
  beforeEach(() => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({}) });
  });

  it("answers the literature behind every parameter of a known disease, privately cacheable for a day", async () => {
    const response = await get("measles");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=86400");
    const body = (await response.json()) as { display_name: string; parameters: Record<string, { source: string | null; estimates: { title: string; year?: number; doi?: string }[] }> };
    expect(body.display_name).toBe("Measles");
    expect(body.parameters.r0.source).toBe("https://pubmed.ncbi.nlm.nih.gov/28757186/");
    expect(body.parameters.r0.estimates).toHaveLength(11);
    expect(body.parameters.r0.estimates[0]).toMatchObject({ title: "The basic reproduction number (R0) of measles: a systematic review", year: 2017, doi: "10.1016/S1473-3099(17)30307-9" });
    expect(Object.keys(body.parameters)).toContain("fatality_rate");
  });

  it("answers 404 for an unknown or malformed key and passes the gate through", async () => {
    expect((await get("unicorn_pox")).status).toBe(404);
    expect((await get("..%2F..%2Fetc")).status).toBe(404);
    expect((await get("MEASLES")).status).toBe(404);
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await get("measles")).status).toBe(401);
  });
});
