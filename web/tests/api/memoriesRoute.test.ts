import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { DELETE as DELETE_ONE, PATCH as PATCH_ONE } from "@/app/api/memories/[id]/route";
import { DELETE, GET, POST } from "@/app/api/memories/route";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";
import { callOn, fakeAdmin, type Outcome } from "../helpers/fakeAdmin";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const MEMORY_ID = "22222222-2222-4222-8222-222222222222";
const ROW = { id: MEMORY_ID, kind: "preference", text: "Prefers tables", source: "participant", created_at: "2026-10-09T10:00:00Z" };
const MEMORY = { id: MEMORY_ID, kind: "preference", text: "Prefers tables", source: "participant", createdAt: "2026-10-09T10:00:00Z" };

function setup(over: Partial<Record<string, Outcome[]>> = {}) {
  const admin = fakeAdmin({ memories: [{ data: [ROW] }], step_events: [{ data: null }], ...over });
  vi.mocked(adminClient).mockReturnValue(admin.client);
  return admin;
}
const json = (body: unknown) => (typeof body === "string" ? body : JSON.stringify(body));
const post = (body: unknown) => POST(new Request("http://localhost/api/memories", { method: "POST", body: json(body) }));
type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
const one = (handler: Handler, method: string, id: string, body?: unknown) =>
  handler(new Request(`http://localhost/api/memories/${id}`, { method, ...(body === undefined ? {} : { body: json(body) }) }), { params: Promise.resolve({ id }) });
const events = (admin: ReturnType<typeof fakeAdmin>) => (callOn(admin.recorded, "step_events", "insert")?.[0] as { kind: string; meta: Record<string, unknown> }[]).map((e) => [e.kind, e.meta]);

beforeEach(() => {
  vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({}) });
});

describe("GET /api/memories", () => {
  it("lists the participant's active memories", async () => {
    setup();
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ memories: [MEMORY] });
  });

  it("answers 500 on a database failure and passes the gate's refusal through on every handler", async () => {
    setup({ memories: [{ data: null, error: { message: "down" } }] });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await GET()).status).toBe(500);
    logged.mockRestore();
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: Response.json({ code: "profile_required" }, { status: 403 }) });
    expect((await GET()).status).toBe(403);
    expect((await post({ kind: "role", text: "A modeler" })).status).toBe(403);
    expect((await DELETE()).status).toBe(403);
    expect((await one(PATCH_ONE, "PATCH", MEMORY_ID, { text: "Prefers charts" })).status).toBe(403);
    expect((await one(DELETE_ONE, "DELETE", MEMORY_ID)).status).toBe(403);
  });
});

describe("POST /api/memories", () => {
  it("adds a participant memory under the cap, logs memory_added, and answers it", async () => {
    const admin = setup({ memories: [{ data: null, count: 3 }, { data: { id: MEMORY_ID } }] });
    const response = await post({ kind: "preference", text: "  Prefers tables " });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { memory: Record<string, unknown> };
    expect(body.memory).toMatchObject({ id: MEMORY_ID, kind: "preference", text: "Prefers tables", source: "participant" });
    expect(typeof body.memory.createdAt).toBe("string");
    const inserted = admin.recorded.filter((r) => r.table === "memories")[1].calls.find(([m]) => m === "insert")?.[1][0];
    expect(inserted).toEqual({ user_id: USER.id, kind: "preference", text: "Prefers tables", source: "participant", source_conversation_id: null });
    expect(events(admin)).toEqual([["memory_added", { memory_id: MEMORY_ID, kind: "preference", source: "participant", replaced: false }]]);
  });

  it("answers 409 memory_full at the cap without inserting, and 400 for short text, a bad kind, or bad JSON", async () => {
    const admin = setup({ memories: [{ data: null, count: 30 }] });
    const full = await post({ kind: "preference", text: "Prefers tables" });
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ code: "memory_full", message: "Your memory list is full (30). Remove one to add another." });
    expect(admin.recorded.filter((r) => r.table === "memories")).toHaveLength(1);
    setup();
    expect((await post({ kind: "preference", text: "ab" })).status).toBe(400);
    expect((await post({ kind: "wish", text: "Prefers tables" })).status).toBe(400);
    expect((await post("{nope")).status).toBe(400);
  });
});

describe("DELETE /api/memories", () => {
  it("forgets everything, answering the count and logging memory_removed for all", async () => {
    const admin = setup({ memories: [{ data: [{ id: "m1" }, { id: "m2" }] }] });
    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 2 });
    expect(events(admin)).toEqual([["memory_removed", { all: true, count: 2 }]]);
  });
});

describe("PATCH and DELETE /api/memories/[id]", () => {
  it("edits a memory and logs memory_updated with the changed fields", async () => {
    const admin = setup({ memories: [{ data: [{ id: MEMORY_ID }] }] });
    const response = await one(PATCH_ONE, "PATCH", MEMORY_ID, { text: "Prefers charts", kind: "preference" });
    expect(response.status).toBe(204);
    expect(callOn(admin.recorded, "memories", "update")).toEqual([expect.objectContaining({ text: "Prefers charts", kind: "preference" })]);
    expect(admin.recorded[0].calls.filter(([m]) => m === "eq").map(([, a]) => a)).toEqual([["user_id", USER.id], ["id", MEMORY_ID], ["active", true]]);
    expect(events(admin)).toEqual([["memory_updated", { memory_id: MEMORY_ID, fields: "kind,text" }]]);
  });

  it("answers 404 for a memory that is not the participant's, and 400 for a bad id or an empty patch", async () => {
    const miss = setup({ memories: [{ data: [] }] });
    const response = await one(PATCH_ONE, "PATCH", MEMORY_ID, { text: "Prefers charts" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "not_found", message: "That memory is no longer there." });
    expect(callOn(miss.recorded, "step_events", "insert")).toBeUndefined();
    setup();
    expect((await one(PATCH_ONE, "PATCH", "nope", { text: "Prefers charts" })).status).toBe(400);
    expect((await one(PATCH_ONE, "PATCH", MEMORY_ID, {})).status).toBe(400);
    expect((await one(DELETE_ONE, "DELETE", "nope")).status).toBe(400);
  });

  it("deactivates one memory with memory_removed, and answers 404 when there is none", async () => {
    const admin = setup({ memories: [{ data: [{ id: MEMORY_ID }] }] });
    expect((await one(DELETE_ONE, "DELETE", MEMORY_ID)).status).toBe(204);
    expect(callOn(admin.recorded, "memories", "update")).toEqual([expect.objectContaining({ active: false })]);
    expect(events(admin)).toEqual([["memory_removed", { memory_id: MEMORY_ID }]]);
    setup({ memories: [{ data: [] }] });
    expect((await one(DELETE_ONE, "DELETE", MEMORY_ID)).status).toBe(404);
  });
});
