/**
 * The display model of a turn, live and stored (agent-core spec, section 8).
 * The browser folds stream events into Blocks; the server stores the same
 * Blocks as turn_events rows, plus the thinking summaries only the researcher
 * sees. Text is stored in segments: one event per run of prose between other
 * blocks, each stored after withoutHidden, so the stored order is the shown order.
 */
import { withoutHidden } from "@/lib/chat/next";
import type { Stage } from "@/lib/enums";
import type { CardPayload } from "@/lib/tools/types";

export type Block =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; id: string; name: string; ok: boolean; payload: CardPayload }
  | { kind: "web_search"; query: string }
  | { kind: "web_fetch"; url: string; title: string }
  | { kind: "notice"; message: string }
  | { kind: "stage"; stage: Stage }
  | { kind: "suggestions"; items: string[] }
  | { kind: "recap"; items: string[] };

export type ThinkingBlock = { kind: "thinking"; summary: string };
export type SinkBlock = Block | ThinkingBlock;

/** A turn_events row: a block with its position and time. */
export type StoredEvent = SinkBlock & { seq: number; at: string };

/** What runTurn reports as the model's content arrives, in content order. */
export type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; summary: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; payload: CardPayload }
  | { type: "web_search"; query: string }
  | { type: "web_fetch"; url: string; title: string }
  | { type: "notice"; message: string };

/** What the browser receives (spec 3.1). Thinking is never streamed. */
export type ChatStreamEvent =
  | Exclude<TurnEvent, { type: "thinking" }>
  | { type: "stage"; stage: Stage }
  | { type: "suggestions"; items: string[] }
  | { type: "recap"; items: string[] }
  | { type: "done"; turnId: string; conversationId: string; notice: string | null }
  | { type: "discard"; message: string }
  | { type: "error"; code: string; message: string };

export type EventSink = {
  /** A text delta: forwarded at once, stored whole when its segment ends. */
  text(delta: string): void;
  /** Any other block: stored in order, then forwarded (thinking is stored only; a run payload is forwarded with its series and stored without). */
  block(block: SinkBlock): void;
  /** The text segment still open: where the model's ```next block ends up. */
  lastText(): string;
  /** Close the open segment and return every stored event in order. Call once. */
  finish(): StoredEvent[];
};

/** The block a runTurn event stores. Text deltas have no block of their own; they go through `text`. */
export function blockOf(event: Exclude<TurnEvent, { type: "text" }>): SinkBlock {
  switch (event.type) {
    case "thinking":
      return { kind: "thinking", summary: event.summary };
    case "tool_use":
      return { kind: "tool_use", id: event.id, name: event.name, input: event.input };
    case "tool_result":
      return { kind: "tool_result", id: event.id, name: event.name, ok: event.ok, payload: event.payload };
    case "web_search":
      return { kind: "web_search", query: event.query };
    case "web_fetch":
      return { kind: "web_fetch", url: event.url, title: event.title };
    case "notice":
      return { kind: "notice", message: event.message };
  }
}

/** The stream event for a block, or null for one that is never streamed. */
function streamEventOf(block: SinkBlock): ChatStreamEvent | null {
  if (block.kind === "thinking") return null;
  const { kind, ...rest } = block;
  return { type: kind, ...rest } as ChatStreamEvent;
}

/** The run series lives in the runs row; the event store keeps the card's numbers only. */
function storedForm(block: SinkBlock): SinkBlock {
  if (block.kind !== "tool_result" || block.payload.kind !== "run") return block;
  const payload = { ...block.payload };
  delete payload.series;
  return { ...block, payload };
}

export function createEventSink(emit: (event: ChatStreamEvent) => void, now: () => Date): EventSink {
  const stored: StoredEvent[] = [];
  let buffer = "";
  let segmentStartedAt: string | null = null;

  const send = (event: ChatStreamEvent) => {
    try {
      emit(event);
    } catch {
      // The receiver is gone. The turn still has to finish and be stored.
    }
  };
  const store = (block: SinkBlock, at: string) => {
    stored.push({ ...block, seq: stored.length + 1, at });
  };
  const closeText = () => {
    const text = withoutHidden(buffer);
    if (text) store({ kind: "text", text }, segmentStartedAt ?? now().toISOString());
    buffer = "";
    segmentStartedAt = null;
  };

  return {
    text(delta) {
      if (!delta) return;
      segmentStartedAt ??= now().toISOString();
      buffer += delta;
      send({ type: "text", delta });
    },
    block(block) {
      closeText();
      store(storedForm(block), now().toISOString());
      const event = streamEventOf(block);
      if (event) send(event);
    },
    lastText() {
      return buffer;
    },
    finish() {
      closeText();
      return stored;
    },
  };
}
