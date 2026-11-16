import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { DELETE, POST } from "@/app/api/shares/route";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";
import { callOn, fakeAdmin, type Outcome } from "../helpers/fakeAdmin";
import { params } from "../tools/helpers";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const TOKEN = "t".repeat(22);
const STATS = { peak_infections: 9, peak_day: 3, total_infected: 40, total_deaths: 0, n_agents: 100, sim_days: 30 };
const RUN = { kind: "run", run_id: "run-1", stats: STATS, stats_agents: STATS, attack_rate_pct: 40, pop_scale: 1, population: 100, effective_params: params({}), warnings: [], repairs: [], data_sources: [], duration_ms: 1000, cold_start: false };
const REPLAY_ROW = {
  id: "t1", seq: 1, user_text: "Model measles in Kenya", stop: "end_turn",
  turn_events: [{ seq: 1, kind: "text", payload: { text: "Sure." } }, { seq: 2, kind: "tool_result", payload: { id: "tu", name: "run_simulation", ok: true, payload: RUN } }],
};
const CONV_ROW = { id: CONVERSATION, title: "Measles in Kenya", active_scenario_id: null };
const SHARE_ROW = { id: "sh1", token: TOKEN, conversation_id: CONVERSATION, user_id: USER.id, title: "Measles in Kenya", snapshot: {}, turn_count: 1, taken_at: "2026-10-09T18:00:00Z", revoked_at: null, view_count: 0 };

function setup(over: Partial<Record<string, Outcome[]>> = {}) {
  const admin = fakeAdmin({
    conversations: [{ data: CONV_ROW }],
    turns: [{ data: [REPLAY_ROW] }],
    runs: [{ data: [{ id: "run-1", series: { day: [0, 1], n_infected: [1, 2] } }] }],
    reports: [{ data: null }],
    shares: [{ data: null }, { data: SHARE_ROW }],
    step_events: [{ data: null }],
    ...over,
  });
  vi.mocked(adminClient).mockReturnValue(admin.client);
  return admin;
}

const post = (body: unknown) => POST(new Request("http://localhost/api/shares", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const del = (body: unknown) => DELETE(new Request("http://localhost/api/shares", { method: "DELETE", body: JSON.stringify(body) }));

describe("POST /api/shares", () => {
  beforeEach(() => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({}) });
  });

  it("creates the first share: a snapshot with the series embedded, a token, the link, and a share_created event", async () => {
    const admin = setup();
    const response = await post({ conversationId: CONVERSATION });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string; url: string; takenAt: string; turnCount: number; created: boolean };
    expect(body).toMatchObject({ token: TOKEN, url: `http://localhost/s/${TOKEN}`, turnCount: 1, created: true });
    expect(body.takenAt).toMatch(/^\d{4}-/);
    // The first shares builder is the active-share read; the insert is the second.
    const inserted = admin.recorded.filter((r) => r.table === "shares")[1].calls.find(([m]) => m === "insert")?.[1][0] as { token: string; snapshot: { turns: { blocks: { payload?: { series?: unknown } }[] }[] }; turn_count: number };
    expect(inserted.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(inserted.turn_count).toBe(1);
    expect(inserted.snapshot.turns[0].blocks[1].payload?.series).toEqual({ day: [0, 1], n_infected: [1, 2] });
    expect(callOn(admin.recorded, "runs", "in")).toEqual(["id", ["run-1"]]);
    const event = (callOn(admin.recorded, "step_events", "insert")?.[0] as { kind: string; meta: Record<string, unknown> }[])[0];
    expect(event).toMatchObject({ kind: "share_created", conversation_id: CONVERSATION, meta: { share_id: "sh1", turn_count: 1, has_report: false } });
  });

  it("refreshes the snapshot under the same token when a share is active, with a share_updated event", async () => {
    const admin = setup({ shares: [{ data: SHARE_ROW }, { data: null }], reports: [{ data: { id: "r1", version: 1, document: { version: 1, title: "R", subtitle: "", generatedAt: "", language: "en", sections: [] } } }] });
    const response = await post({ conversationId: CONVERSATION });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ token: TOKEN, created: false, turnCount: 1 });
    expect(admin.recorded.filter((r) => r.table === "shares")[1].calls.find(([m]) => m === "update")?.[1]).toEqual([expect.objectContaining({ turn_count: 1, title: "Measles in Kenya" })]);
    const event = (callOn(admin.recorded, "step_events", "insert")?.[0] as { kind: string; meta: Record<string, unknown> }[])[0];
    expect(event).toMatchObject({ kind: "share_updated", meta: { share_id: "sh1", has_report: true } });
  });

  it("answers 400 with nothing to share, 404 for another participant's conversation, 400 for a bad body, 500 on a database failure, and passes the gate through", async () => {
    setup({ turns: [{ data: [] }] });
    const empty = await post({ conversationId: CONVERSATION });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ code: "nothing_to_share", message: "Nothing to share yet." });
    setup({ conversations: [{ data: null }] });
    expect((await post({ conversationId: CONVERSATION })).status).toBe(404);
    setup();
    expect((await post({ conversationId: "nope" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    setup({ shares: [{ data: null }, { data: null, error: { message: "down" } }] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post({ conversationId: CONVERSATION })).status).toBe(500);
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await post({ conversationId: CONVERSATION })).status).toBe(401);
  });
});

describe("DELETE /api/shares", () => {
  beforeEach(() => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({}) });
  });

  it("revokes the active share with a share_revoked event, and answers 404 when there is none", async () => {
    const admin = setup({ shares: [{ data: [{ id: "sh1" }] }] });
    expect((await del({ conversationId: CONVERSATION })).status).toBe(204);
    expect(callOn(admin.recorded, "shares", "update")).toEqual([{ revoked_at: expect.any(String) }]);
    const event = (callOn(admin.recorded, "step_events", "insert")?.[0] as { kind: string }[])[0];
    expect(event).toMatchObject({ kind: "share_revoked", conversation_id: CONVERSATION });
    setup({ shares: [{ data: [] }] });
    expect((await del({ conversationId: CONVERSATION })).status).toBe(404);
    expect((await del({})).status).toBe(400);
  });
});
