"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { endSession, startSession, track } from "@/lib/client/track";

const SessionContext = createContext<string | null>(null);
const PING_MS = 120_000;

/** Opens a visit when the chat mounts, keeps it alive, and closes it when the tab goes away. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    void startSession({
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).then((opened) => {
      if (cancelled || !opened) return;
      id = opened;
      setSessionId(opened);
    });

    const timer = window.setInterval(() => {
      if (id && document.visibilityState === "visible") track({ kind: "session_ping", sessionId: id });
    }, PING_MS);
    const close = () => {
      if (id) endSession(id);
    };
    window.addEventListener("pagehide", close);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("pagehide", close);
      close();
    };
  }, []);

  return <SessionContext.Provider value={sessionId}>{children}</SessionContext.Provider>;
}

export function useSessionId(): string | null {
  return useContext(SessionContext);
}
