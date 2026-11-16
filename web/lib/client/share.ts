/** The Share dialog's state and its two requests (share spec, section 8). */

export type ShareState = { token: string; url: string; takenAt: string; turnCount: number };

const GENERIC = "Something went wrong. Please try again.";
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "Snapshot taken 9 October 2026 · 3 turns". */
export function describeShare(share: ShareState): string {
  return `Snapshot taken ${DATE.format(new Date(share.takenAt))} · ${share.turnCount} ${share.turnCount === 1 ? "turn" : "turns"}`;
}

function isShare(value: unknown): value is ShareState & { created?: boolean } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.token === "string" && typeof v.url === "string" && typeof v.takenAt === "string" && typeof v.turnCount === "number";
}

/** Create the share, or refresh its snapshot when one is active. */
export async function requestShare(conversationId: string, send: typeof fetch = fetch): Promise<{ ok: true; share: ShareState; created: boolean } | { ok: false; message: string }> {
  try {
    const response = await send("/api/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId }) });
    const body = (await response.json().catch(() => null)) as unknown;
    if (response.status === 400 && body && typeof (body as { code?: unknown }).code === "string" && (body as { code: string }).code === "nothing_to_share") {
      return { ok: false, message: "Nothing to share yet." };
    }
    if (!response.ok || !isShare(body)) return { ok: false, message: GENERIC };
    return { ok: true, share: { token: body.token, url: body.url, takenAt: body.takenAt, turnCount: body.turnCount }, created: body.created === true };
  } catch {
    return { ok: false, message: GENERIC };
  }
}

/** Stop sharing. Nothing to revoke counts as done. */
export async function revokeShare(conversationId: string, send: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await send("/api/shares", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId }) });
    if (response.ok || response.status === 404) return { ok: true };
    return { ok: false, message: GENERIC };
  } catch {
    return { ok: false, message: GENERIC };
  }
}
