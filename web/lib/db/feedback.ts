import type { SupabaseClient } from "@supabase/supabase-js";

export type FeedbackInsert = { userId: string; conversationId: string; turnId: string; rating: "up" | "down"; comment: string | null };

export interface FeedbackStore {
  /** True when the turn is in the conversation. The route has already checked the conversation is the caller's. */
  turnBelongs(turnId: string, conversationId: string): Promise<boolean>;
  /** One row per press. */
  insert(row: FeedbackInsert): Promise<void>;
}

export function supabaseFeedbackStore(admin: SupabaseClient): FeedbackStore {
  return {
    async turnBelongs(turnId, conversationId) {
      const { data, error } = await admin.from("turns").select("id").eq("id", turnId).eq("conversation_id", conversationId).maybeSingle();
      if (error) throw new Error(`turns read failed: ${error.message}`);
      return data !== null;
    },
    async insert(row) {
      const { error } = await admin.from("feedback").insert({
        user_id: row.userId,
        conversation_id: row.conversationId,
        turn_id: row.turnId,
        rating: row.rating,
        comment: row.comment,
      });
      if (error) throw new Error(`feedback insert failed: ${error.message}`);
    },
  };
}
