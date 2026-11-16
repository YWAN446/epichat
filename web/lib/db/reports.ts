import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportDocument, ReportNarrative } from "@/lib/report/document";

export type ReportInsert = {
  conversationId: string;
  userId: string;
  turnId: string;
  scenarioId: string | null;
  version: number;
  title: string;
  language: string;
  narrative: ReportNarrative;
  document: ReportDocument;
};
export type ReportRow = { id: string; user_id: string; conversation_id: string; version: number; title: string; document: ReportDocument };

export interface ReportStore {
  /** Insert one version and return its id. Throws when the database refuses; the tool turns that into REPORT NOT SAVED. */
  insert(report: ReportInsert): Promise<string>;
  /** How many versions the conversation has. */
  count(conversationId: string): Promise<number>;
  /** One report with its document, for the download route. */
  get(id: string): Promise<ReportRow | null>;
  /** The conversation's latest version, or null (the share's snapshot). */
  latest(conversationId: string): Promise<ReportRow | null>;
}

/** The reports columns for one version. */
export function reportRow(report: ReportInsert): Record<string, unknown> {
  return {
    conversation_id: report.conversationId,
    user_id: report.userId,
    turn_id: report.turnId,
    scenario_id: report.scenarioId,
    version: report.version,
    title: report.title,
    language: report.language,
    narrative: report.narrative,
    document: report.document,
  };
}

export function supabaseReportStore(admin: SupabaseClient): ReportStore {
  return {
    async insert(report) {
      const { data, error } = await admin.from("reports").insert(reportRow(report)).select("id").single();
      if (error || !data) throw new Error(`reports insert failed: ${error?.message ?? "no row"}`);
      return (data as { id: string }).id;
    },
    async count(conversationId) {
      const { count, error } = await admin.from("reports").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
      if (error) throw new Error(`reports count failed: ${error.message}`);
      return count ?? 0;
    },
    async get(id) {
      const { data, error } = await admin.from("reports").select("id, user_id, conversation_id, version, title, document").eq("id", id).maybeSingle();
      if (error) throw new Error(`reports read failed: ${error.message}`);
      return (data as ReportRow | null) ?? null;
    },
    async latest(conversationId) {
      const { data, error } = await admin
        .from("reports")
        .select("id, user_id, conversation_id, version, title, document")
        .eq("conversation_id", conversationId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`reports read failed: ${error.message}`);
      return (data as ReportRow | null) ?? null;
    },
  };
}
