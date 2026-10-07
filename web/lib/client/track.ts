import type { ClientEvent } from "@/lib/clientEvents";

const ROUTE = "/api/event";

/** Report an interaction. Fire and forget: tracking must not get in a participant's way. */
export function track(event: ClientEvent, send: typeof fetch = fetch): void {
  try {
    void send(ROUTE, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) }).catch(() => {});
  } catch {
    // No network, or no fetch. Nothing to do.
  }
}

/** Open a visit. Returns the session id, or null when it could not be opened. */
export async function startSession(
  info: { viewport?: string; language?: string; timezone?: string },
  send: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await send(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "session_start", ...info }) });
    if (!response.ok) return null;
    const body = (await response.json()) as { sessionId?: string };
    return body.sessionId ?? null;
  } catch {
    return null;
  }
}

/** Close a visit on unload. sendBeacon survives the page going away; fetch may not. */
export function endSession(sessionId: string, beacon: Navigator["sendBeacon"] | undefined = globalThis.navigator?.sendBeacon?.bind(globalThis.navigator)): void {
  const body = JSON.stringify({ kind: "session_end", sessionId });
  if (beacon) {
    try {
      beacon(ROUTE, body);
      return;
    } catch {
      // Fall through to fetch.
    }
  }
  track({ kind: "session_end", sessionId });
}
