import type { SupabaseClient } from "@supabase/supabase-js";

export type ConversationSummary = { id: string; title: string; updatedAt: string };
export type ConversationRow = { id: string; title: string; activeScenarioId: string | null };

export interface ConversationStore {
  /** Open a conversation for the participant and return its id. */
  create(userId: string, title: string): Promise<string>;
  /** The participant's own, undeleted conversation, or null. */
  get(id: string, userId: string): Promise<ConversationRow | null>;
  /** Hide the conversation from the participant; the study keeps it. False when it is not theirs or already hidden. */
  softDelete(id: string, userId: string, now: Date): Promise<boolean>;
}

const LIMIT = 50;
const TITLE_CHARS = 60;

/** The first 60 characters of the first message, cut at a word, on one line. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= TITLE_CHARS) return line;
  const cut = line.slice(0, TITLE_CHARS);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > TITLE_CHARS / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

export function supabaseConversationStore(admin: SupabaseClient): ConversationStore {
  return {
    async create(userId, title) {
      const { data, error } = await admin.from("conversations").insert({ user_id: userId, title }).select("id").single();
      if (error || !data) throw new Error(`conversations insert failed: ${error?.message ?? "no row"}`);
      return (data as { id: string }).id;
    },

    async get(id, userId) {
      const { data, error } = await admin
        .from("conversations")
        .select("id, title, active_scenario_id")
        .eq("id", id)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(`conversations read failed: ${error.message}`);
      if (!data) return null;
      const row = data as { id: string; title: string; active_scenario_id: string | null };
      return { id: row.id, title: row.title, activeScenarioId: row.active_scenario_id };
    },

    async softDelete(id, userId, now) {
      const { data, error } = await admin
        .from("conversations")
        .update({ deleted_at: now.toISOString() })
        .eq("id", id)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .select("id");
      if (error) throw new Error(`conversations delete failed: ${error.message}`);
      return Array.isArray(data) && data.length > 0;
    },
  };
}

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
