import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block, StoredEvent } from "@/lib/chat/events";
import type { Stage, StepEventKind } from "@/lib/enums";
import type { ScenarioJson } from "./scenarios";

export const TURN_STOPS = ["end_turn", "max_tokens", "refusal", "tool_limit", "empty", "paused", "error", "aborted"] as const;
export type StoredStop = (typeof TURN_STOPS)[number];

/** One entry of turns.api_calls: one model call. */
export type ApiCall = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  stop_reason: string | null;
  latency_ms: number;
  /** The model that answered: the fallback when the refusal fallback rerouted the call. */
  served_by: string;
};

export type TurnJson = {
  id: string;
  session_id: string | null;
  user_text: string;
  started_at: string;
  first_token_at: string | null;
  finished_at: string;
  stop: StoredStop;
  refusal_category: string | null;
  model: string;
  effort: string;
  api_calls: ApiCall[];
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  stage_before: Stage;
  stage_after: Stage;
};

export type StepEventJson = {
  kind: StepEventKind;
  session_id: string | null;
  stage: Stage | null;
  tool: string | null;
  meta: Record<string, string | number | boolean | null>;
};

/** finish_turn's argument (migration 0002). */
export type FinishTurnPayload = {
  user_id: string;
  conversation_id: string;
  title: string | null;
  turn: TurnJson;
  events: StoredEvent[];
  /** The user message and the appended messages when the turn finished; null when it was dropped or failed. */
  messages: Anthropic.Beta.BetaMessageParam[] | null;
  scenario: ScenarioJson;
  step_events: StepEventJson[];
};

export type ReplayTurn = { id: string; seq: number; userText: string; stop: "end_turn" | "max_tokens"; blocks: Block[] };

export interface TurnStore {
  /** Write the whole turn in one transaction; returns the scenario id. Throws when the database refuses. */
  finishTurn(payload: FinishTurnPayload): Promise<string | null>;
  /** Every turn's typed text, in order: the Python agent's context_text. */
  userTexts(conversationId: string): Promise<string[]>;
  /** The finished turns with their display blocks (thinking left out), for /chat/[id]. */
  listForReplay(conversationId: string): Promise<ReplayTurn[]>;
  /** The recap block of the latest finished turn, or [] (the report's Decisions section). */
  lastRecap(conversationId: string): Promise<string[]>;
}

type ReplayRow = {
  id: string;
  seq: number;
  user_text: string;
  stop: "end_turn" | "max_tokens";
  turn_events: { seq: number; kind: string; payload: Record<string, unknown> }[] | null;
};

export function supabaseTurnStore(admin: SupabaseClient): TurnStore {
  return {
    async finishTurn(payload) {
      const { data, error } = await admin.rpc("finish_turn", { p: payload });
      if (error) throw new Error(`finish_turn failed: ${error.message}`);
      return typeof data === "string" ? data : null;
    },

    async userTexts(conversationId) {
      const { data, error } = await admin.from("turns").select("user_text").eq("conversation_id", conversationId).order("seq", { ascending: true });
      if (error) throw new Error(`turns read failed: ${error.message}`);
      return ((data ?? []) as { user_text: string }[]).map((row) => row.user_text);
    },

    async listForReplay(conversationId) {
      const { data, error } = await admin
        .from("turns")
        .select("id, seq, user_text, stop, turn_events(seq, kind, payload)")
        .eq("conversation_id", conversationId)
        .in("stop", ["end_turn", "max_tokens"])
        .order("seq", { ascending: true });
      if (error) throw new Error(`turns read failed: ${error.message}`);
      return ((data ?? []) as ReplayRow[]).map((row) => ({
        id: row.id,
        seq: row.seq,
        userText: row.user_text,
        stop: row.stop,
        blocks: [...(row.turn_events ?? [])]
          .sort((a, b) => a.seq - b.seq)
          .filter((event) => event.kind !== "thinking")
          .map((event) => ({ kind: event.kind, ...event.payload }) as Block),
      }));
    },

    async lastRecap(conversationId) {
      const { data, error } = await admin
        .from("turns")
        .select("id, turn_events(kind, payload)")
        .eq("conversation_id", conversationId)
        .in("stop", ["end_turn", "max_tokens"])
        .order("seq", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`turns read failed: ${error.message}`);
      const events = ((data as { turn_events?: { kind: string; payload: Record<string, unknown> }[] } | null)?.turn_events ?? []);
      const recap = events.find((event) => event.kind === "recap")?.payload.items;
      return Array.isArray(recap) ? recap.filter((item): item is string => typeof item === "string") : [];
    },
  };
}
