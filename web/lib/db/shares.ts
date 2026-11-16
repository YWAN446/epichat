import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShareSnapshot } from "@/lib/share/snapshot";

export type ShareRow = {
  id: string;
  token: string;
  conversation_id: string;
  user_id: string;
  title: string;
  snapshot: ShareSnapshot;
  turn_count: number;
  taken_at: string;
  revoked_at: string | null;
  view_count: number;
};
export type ShareInsert = { conversationId: string; userId: string; title: string; snapshot: ShareSnapshot; turnCount: number; token: string };
export type ShareUpdate = { title: string; snapshot: ShareSnapshot; turnCount: number };

const COLUMNS = "id, token, conversation_id, user_id, title, snapshot, turn_count, taken_at, revoked_at, view_count";

export interface ShareStore {
  /** The conversation's active share, or null. */
  active(conversationId: string, userId: string): Promise<ShareRow | null>;
  /** Insert a new share with its token; returns the row. Throws when the database refuses. */
  create(share: ShareInsert): Promise<ShareRow>;
  /** Replace the active share's snapshot, title, turn count, and taken_at; the token stays. */
  update(id: string, share: ShareUpdate, now: Date): Promise<void>;
  /** Set revoked_at on the conversation's active share; false when there was none. */
  revoke(conversationId: string, userId: string, now: Date): Promise<boolean>;
  /** The public read: the active share by token, or null. */
  byToken(token: string): Promise<ShareRow | null>;
  /** Count an open (record_share_view); the share id, or null when revoked or unknown. */
  view(token: string): Promise<string | null>;
}

export function shareRow(share: ShareInsert): Record<string, unknown> {
  return { conversation_id: share.conversationId, user_id: share.userId, title: share.title, snapshot: share.snapshot, turn_count: share.turnCount, token: share.token };
}

export function supabaseShareStore(admin: SupabaseClient): ShareStore {
  return {
    async active(conversationId, userId) {
      const { data, error } = await admin.from("shares").select(COLUMNS).eq("conversation_id", conversationId).eq("user_id", userId).is("revoked_at", null).maybeSingle();
      if (error) throw new Error(`shares read failed: ${error.message}`);
      return (data as ShareRow | null) ?? null;
    },
    async create(share) {
      const { data, error } = await admin.from("shares").insert(shareRow(share)).select(COLUMNS).single();
      if (error || !data) throw new Error(`shares insert failed: ${error?.message ?? "no row"}`);
      return data as ShareRow;
    },
    async update(id, share, now) {
      const { error } = await admin.from("shares").update({ title: share.title, snapshot: share.snapshot, turn_count: share.turnCount, taken_at: now.toISOString() }).eq("id", id);
      if (error) throw new Error(`shares update failed: ${error.message}`);
    },
    async revoke(conversationId, userId, now) {
      const { data, error } = await admin
        .from("shares")
        .update({ revoked_at: now.toISOString() })
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .is("revoked_at", null)
        .select("id");
      if (error) throw new Error(`shares revoke failed: ${error.message}`);
      return Array.isArray(data) && data.length > 0;
    },
    async byToken(token) {
      const { data, error } = await admin.from("shares").select(COLUMNS).eq("token", token).is("revoked_at", null).maybeSingle();
      if (error) throw new Error(`shares read failed: ${error.message}`);
      return (data as ShareRow | null) ?? null;
    },
    async view(token) {
      const { data, error } = await admin.rpc("record_share_view", { p_token: token });
      if (error) throw new Error(`record_share_view failed: ${error.message}`);
      return typeof data === "string" ? data : null;
    },
  };
}
