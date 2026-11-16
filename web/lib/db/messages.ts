import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MessageStore {
  /** The exact message list, in order, as it was sent to and received from the API. */
  list(conversationId: string): Promise<Anthropic.Beta.BetaMessageParam[]>;
}

type Row = { role: "user" | "assistant"; content: Anthropic.Beta.BetaMessageParam["content"] };

export function supabaseMessageStore(admin: SupabaseClient): MessageStore {
  return {
    async list(conversationId) {
      const { data, error } = await admin.from("messages").select("role, content").eq("conversation_id", conversationId).order("seq", { ascending: true });
      if (error) throw new Error(`messages read failed: ${error.message}`);
      return ((data ?? []) as Row[]).map((row) => ({ role: row.role, content: row.content }));
    },
  };
}
