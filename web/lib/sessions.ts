import type { SupabaseClient } from "@supabase/supabase-js";

export type SessionInfo = {
  userAgent: string | null;
  viewport: string | null;
  language: string | null;
  timezone: string | null;
};

export interface SessionStore {
  /** Open a visit and return its id. */
  start(userId: string, info: SessionInfo): Promise<string>;
  ping(id: string, userId: string): Promise<void>;
  end(id: string, userId: string): Promise<void>;
}

export function supabaseSessionStore(admin: SupabaseClient): SessionStore {
  return {
    async start(userId, info) {
      const { data, error } = await admin
        .from("sessions")
        .insert({ user_id: userId, user_agent: info.userAgent, viewport: info.viewport, language: info.language, timezone: info.timezone })
        .select("id")
        .single();
      if (error || !data) throw new Error(`sessions insert failed: ${error?.message ?? "no row"}`);
      return (data as { id: string }).id;
    },
    async ping(id, userId) {
      const { error } = await admin.from("sessions").update({ last_active_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
      if (error) throw new Error(`sessions ping failed: ${error.message}`);
    },
    async end(id, userId) {
      const now = new Date().toISOString();
      const { error } = await admin.from("sessions").update({ last_active_at: now, ended_at: now }).eq("id", id).eq("user_id", userId);
      if (error) throw new Error(`sessions end failed: ${error.message}`);
    },
  };
}
