import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/sim/client", () => ({ createSimClient: vi.fn() }));

import { GET, slugOf } from "@/app/api/reports/[id]/route";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";
import { createSimClient } from "@/lib/sim/client";
import { adminClient } from "@/lib/supabase/admin";
import { fakeAdmin } from "../helpers/fakeAdmin";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const REPORT = "77777777-7777-4777-8777-777777777777";
const DOC = {
  version: 1,
  title: "Measles in Kenya, SIR model",
  subtitle: "EpiChat report · version 2",
  generatedAt: "2026-10-09T15:00:00Z",
  language: "en",
  sections: [{ id: "summary", heading: "Summary", blocks: [{ kind: "paragraph", text: "Fast." }] }],
};
const ROW = { id: REPORT, user_id: USER.id, conversation_id: "c1", version: 2, title: DOC.title, document: DOC };
const PDF = new Uint8Array([37, 80, 68, 70]);

function get(id: string, query = "") {
  return GET(new Request(`http://localhost/api/reports/${id}${query}`), { params: Promise.resolve({ id }) });
}

describe("GET /api/reports/[id]", () => {
  beforeEach(() => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({ SIM_INTERNAL_URL: "http://sim", SIM_SHARED_SECRET: "s" }) });
    // A fresh fake per request: each outcome queue serves one read.
    vi.mocked(adminClient).mockImplementation(() => fakeAdmin({ reports: [{ data: ROW }] }).client);
    vi.mocked(createSimClient).mockReturnValue({ export: vi.fn(async () => ({ ok: true, bytes: PDF, contentType: "application/pdf" })) } as never);
  });

  it("renders Markdown as an attachment and HTML inline, both privately cacheable", async () => {
    const md = await get(REPORT, "?format=md");
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(md.headers.get("content-disposition")).toBe('attachment; filename="measles-in-kenya-sir-model-v2.md"');
    expect(md.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(await md.text()).toContain("# Measles in Kenya, SIR model");
    const html = await get(REPORT, "?format=html");
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(html.headers.get("content-disposition")).toBe("inline");
    expect(await html.text()).toContain("<h2>Summary</h2>");
    expect((await get(REPORT, "?format=html&download=1")).headers.get("content-disposition")).toBe('attachment; filename="measles-in-kenya-sir-model-v2.html"');
  });

  it("streams Word and PDF from the sim service, and answers 503 when it cannot", async () => {
    const pdf = await get(REPORT, "?format=pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toBe('attachment; filename="measles-in-kenya-sir-model-v2.pdf"');
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(PDF);
    expect(vi.mocked(createSimClient).mock.results[0].value.export).toHaveBeenCalledWith("pdf", DOC);
    vi.mocked(createSimClient).mockReturnValue({ export: vi.fn(async () => ({ ok: false, status: 0, kind: "unavailable", detail: "down" })) } as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = await get(REPORT, "?format=docx");
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ code: "export_unavailable", message: "Word and PDF exports are temporarily unavailable. Markdown and HTML still work." });
  });

  it("answers 400 for an unknown format, 404 for a bad id, a missing row, or another participant's report, and passes the gate through", async () => {
    expect((await get(REPORT, "?format=txt")).status).toBe(400);
    expect((await get(REPORT)).status).toBe(400);
    expect((await get("nope", "?format=md")).status).toBe(404);
    vi.mocked(adminClient).mockReturnValue(fakeAdmin({ reports: [{ data: null }] }).client);
    expect((await get(REPORT, "?format=md")).status).toBe(404);
    vi.mocked(adminClient).mockReturnValue(fakeAdmin({ reports: [{ data: { ...ROW, user_id: "22222222-2222-2222-2222-222222222222" } }] }).client);
    expect((await get(REPORT, "?format=md")).status).toBe(404);
    vi.mocked(adminClient).mockReturnValue(fakeAdmin({ reports: [{ data: null, error: { message: "down" } }] }).client);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get(REPORT, "?format=md")).status).toBe(500);
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await get(REPORT, "?format=md")).status).toBe(401);
  });

  it("slugs titles for file names", () => {
    expect(slugOf("Measles in Kenya, SIR model, 1 year")).toBe("measles-in-kenya-sir-model-1-year");
    expect(slugOf("   ")).toBe("report");
    expect(slugOf("x".repeat(100))).toHaveLength(60);
  });
});
