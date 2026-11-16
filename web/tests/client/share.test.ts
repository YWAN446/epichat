import { describe, expect, it, vi } from "vitest";

import { describeShare, requestShare, revokeShare, type ShareState } from "@/lib/client/share";

const SHARE: ShareState = { token: "t".repeat(22), url: "https://epichat-ai.vercel.app/s/tttttttttttttttttttttt", takenAt: "2026-10-09T18:00:00Z", turnCount: 3 };

function answering(status: number, body?: unknown) {
  return vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

describe("describeShare", () => {
  it("says when the snapshot was taken and how many turns it holds", () => {
    expect(describeShare(SHARE)).toBe("Snapshot taken 9 October 2026 · 3 turns");
    expect(describeShare({ ...SHARE, turnCount: 1 })).toBe("Snapshot taken 9 October 2026 · 1 turn");
  });
});

describe("requestShare", () => {
  it("posts the conversation and returns the share state", async () => {
    const send = answering(200, { ...SHARE, created: true });
    const result = await requestShare("c1", send);
    expect(result).toEqual({ ok: true, share: SHARE, created: true });
    expect(send).toHaveBeenCalledWith("/api/shares", expect.objectContaining({ method: "POST", body: JSON.stringify({ conversationId: "c1" }) }));
  });

  it("turns the route's refusals and failures into the dialog's messages", async () => {
    expect(await requestShare("c1", answering(400, { code: "nothing_to_share", message: "Nothing to share yet." }))).toEqual({ ok: false, message: "Nothing to share yet." });
    expect(await requestShare("c1", answering(500, { code: "service_unavailable", message: "x" }))).toEqual({ ok: false, message: "Something went wrong. Please try again." });
    expect(await requestShare("c1", answering(200, { nope: true }))).toEqual({ ok: false, message: "Something went wrong. Please try again." });
    const offline = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await requestShare("c1", offline)).toEqual({ ok: false, message: "Something went wrong. Please try again." });
  });
});

describe("revokeShare", () => {
  it("deletes the share; nothing to revoke still counts as done; a failure carries the message", async () => {
    const send = answering(204);
    expect(await revokeShare("c1", send)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith("/api/shares", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ conversationId: "c1" }) }));
    expect(await revokeShare("c1", answering(404))).toEqual({ ok: true });
    expect(await revokeShare("c1", answering(500, { message: "x" }))).toEqual({ ok: false, message: "Something went wrong. Please try again." });
  });
});
