import type { SupabaseClient } from "@supabase/supabase-js";
import type { Stage, StepEventKind } from "./enums";

/** A countable thing that happened. `meta` holds fixed words and numbers, never typed text. */
export type StepEvent = {
  kind: StepEventKind;
  sessionId?: string | null;
  conversationId?: string | null;
  turnId?: string | null;
  stage?: Stage | null;
  tool?: string | null;
  meta?: Record<string, string | number | boolean | null>;
};

export interface StepEventSink {
  /** Never throws: tracking must not get in a participant's way. */
  log(userId: string, events: StepEvent[]): Promise<void>;
}

export function supabaseStepEventSink(admin: SupabaseClient): StepEventSink {
  return {
    async log(userId, events) {
      if (events.length === 0) return;
      const rows = events.map((event) => ({
        user_id: userId,
        session_id: event.sessionId ?? null,
        conversation_id: event.conversationId ?? null,
        turn_id: event.turnId ?? null,
        kind: event.kind,
        stage: event.stage ?? null,
        tool: event.tool ?? null,
        meta: event.meta ?? {},
      }));
      const { error } = await admin.from("step_events").insert(rows);
      if (error) console.error(`step_events insert failed: ${error.message}`);
    },
  };
}
