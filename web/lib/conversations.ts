import type { SupabaseClient } from "@supabase/supabase-js";

export type ConversationSummary = { id: string; title: string; updatedAt: string };

const LIMIT = 50;

/** The participant's conversations, newest first. A list that cannot be read is shown as empty. */
export async function listConversations(admin: SupabaseClient, userId: string): Promise<ConversationSummary[]> {
  const { data, error } = await admin
    .from("conversations")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(LIMIT);
  if (error || !data) return [];
  return (data as { id: string; title: string; updated_at: string }[]).map((row) => ({
    id: row.id,
    title: row.title || "New conversation",
    updatedAt: row.updated_at,
  }));
}
