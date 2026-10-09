/**
 * The memories table (profile spec, section 5): what the assistant or the
 * participant keeps across conversations. Rows are deactivated, never deleted.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryKind } from "@/lib/enums";
import type { Memory } from "@/lib/profile/about";

export type { Memory };
export type MemorySource = Memory["source"];

/** Active memories per participant; the assistant's oldest give way first, the participant's own never. */
export const MEMORY_CAP = 30;

type Row = { id: string; kind: MemoryKind; text: string; source: MemorySource; created_at: string };
const COLUMNS = "id, kind, text, source, created_at";

export interface MemoryStore {
  /** The participant's active memories, newest first. */
  list(userId: string): Promise<Memory[]>;
  /** Insert one; returns its id. Throws when the database refuses. */
  add(userId: string, kind: MemoryKind, text: string, source: MemorySource, conversationId: string | null): Promise<string>;
  /** Change the text or the kind of the participant's own active memory; false when there is no such row. */
  update(userId: string, id: string, patch: { kind?: MemoryKind; text?: string }, now: Date): Promise<boolean>;
  /** Deactivate one; false when there is no such active row. */
  deactivate(userId: string, id: string, now: Date): Promise<boolean>;
  /** Deactivate every active memory; the count. */
  deactivateAll(userId: string, now: Date): Promise<number>;
  countActive(userId: string): Promise<number>;
  /** Deactivate the oldest active memory the assistant added; false when there is none. */
  evictOldestAgent(userId: string, now: Date): Promise<boolean>;
}

function memoryFrom(row: Row): Memory {
  return { id: row.id, kind: row.kind, text: row.text, source: row.source, createdAt: row.created_at };
}

export function supabaseMemoryStore(admin: SupabaseClient): MemoryStore {
  const changed = (data: unknown) => (Array.isArray(data) ? data.length : 0);
  return {
    async list(userId) {
      const { data, error } = await admin.from("memories").select(COLUMNS).eq("user_id", userId).eq("active", true).order("created_at", { ascending: false });
      if (error) throw new Error(`memories read failed: ${error.message}`);
      return ((data as Row[] | null) ?? []).map(memoryFrom);
    },
    async add(userId, kind, text, source, conversationId) {
      const { data, error } = await admin.from("memories").insert({ user_id: userId, kind, text, source, source_conversation_id: conversationId }).select("id").single();
      if (error || !data) throw new Error(`memories insert failed: ${error?.message ?? "no row"}`);
      return (data as { id: string }).id;
    },
    async update(userId, id, patch, now) {
      const fields: Record<string, unknown> = { updated_at: now.toISOString() };
      if (patch.kind !== undefined) fields.kind = patch.kind;
      if (patch.text !== undefined) fields.text = patch.text;
      const { data, error } = await admin.from("memories").update(fields).eq("user_id", userId).eq("id", id).eq("active", true).select("id");
      if (error) throw new Error(`memories update failed: ${error.message}`);
      return changed(data) > 0;
    },
    async deactivate(userId, id, now) {
      const { data, error } = await admin.from("memories").update({ active: false, updated_at: now.toISOString() }).eq("user_id", userId).eq("id", id).eq("active", true).select("id");
      if (error) throw new Error(`memories deactivate failed: ${error.message}`);
      return changed(data) > 0;
    },
    async deactivateAll(userId, now) {
      const { data, error } = await admin.from("memories").update({ active: false, updated_at: now.toISOString() }).eq("user_id", userId).eq("active", true).select("id");
      if (error) throw new Error(`memories deactivate failed: ${error.message}`);
      return changed(data);
    },
    async countActive(userId) {
      const { count, error } = await admin.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("active", true);
      if (error) throw new Error(`memories count failed: ${error.message}`);
      return count ?? 0;
    },
    async evictOldestAgent(userId, now) {
      const { data, error } = await admin.from("memories").select("id").eq("user_id", userId).eq("active", true).eq("source", "agent").order("created_at", { ascending: true }).limit(1);
      if (error) throw new Error(`memories read failed: ${error.message}`);
      const oldest = ((data as { id: string }[] | null) ?? [])[0];
      if (!oldest) return false;
      const result = await admin.from("memories").update({ active: false, updated_at: now.toISOString() }).eq("id", oldest.id).select("id");
      if (result.error) throw new Error(`memories evict failed: ${result.error.message}`);
      return changed(result.data) > 0;
    },
  };
}
