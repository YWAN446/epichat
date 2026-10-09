import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({ default: class FakeAnthropic {} }));
vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/chat/handleChat", () => ({ handleChat: vi.fn() }));

import { POST } from "@/app/api/chat/route";
import { handleChat, type ChatDeps } from "@/lib/chat/handleChat";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const SETTINGS = loadSettings({ UNLIMITED_EMAILS: "student@emory.edu" });

function post(body = "{}") {
  return POST(new Request("http://localhost/api/chat", { method: "POST", body }));
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.mocked(requireParticipant).mockReset();
    vi.mocked(handleChat).mockReset();
  });

  it("answers the gate's refusal as it is", async () => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: Response.json({ code: "consent_required", message: "x" }, { status: 403 }) });
    const response = await post();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "consent_required" });
    expect(handleChat).not.toHaveBeenCalled();
  });

  it("streams the handler's events as server-sent events, passing the caller, the raw body, and an abort signal", async () => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: SETTINGS });
    vi.mocked(handleChat).mockImplementation(async (_deps, _user, _body, emit) => {
      emit({ type: "text", delta: "Hi" });
      emit({ type: "done", turnId: "t1", conversationId: "c1", notice: null });
    });
    const response = await post('{"text":"hello"}');
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(await response.text()).toBe('data: {"type":"text","delta":"Hi"}\n\ndata: {"type":"done","turnId":"t1","conversationId":"c1","notice":null}\n\n');

    const [deps, user, body, , signal] = vi.mocked(handleChat).mock.calls[0] as [ChatDeps, { id: string }, string, unknown, AbortSignal];
    expect(user).toEqual({ id: USER.id });
    expect(body).toBe('{"text":"hello"}');
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(deps.settings).toBe(SETTINGS);
    expect(deps.newId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(deps.now()).toBeInstanceOf(Date);
    for (const key of ["usage", "conversations", "messages", "scenarios", "turns", "runs", "sim", "adapters", "client"] as const) expect(deps[key]).toBeTruthy();
  });

  it("closes the stream even when the handler throws", async () => {
    vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: SETTINGS });
    vi.mocked(handleChat).mockRejectedValue(new Error("unexpected"));
    const response = await post();
    await expect(response.text()).rejects.toThrow(/unexpected/);
  });
});
