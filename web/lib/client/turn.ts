import type { Block, ChatStreamEvent } from "@/lib/chat/events";
import type { Stage } from "@/lib/enums";
import { THINKING, statusLabel } from "./toolLine";

export type TurnOutcome = { ok: true; turnId: string; conversationId: string; notice: string | null } | { ok: false; message: string };

export type TurnProgress = {
  /** The reply so far, in the shape turn_events stores. */
  blocks: Block[];
  /** What to show while waiting, such as "Running the simulation…". */
  status: string | null;
  stage: Stage | null;
  suggestions: string[];
  /** Set once the turn has ended, one way or the other. */
  result: TurnOutcome | null;
};

export const INTERRUPTED = "The reply was interrupted. Please try again.";

export function startTurn(): TurnProgress {
  return { blocks: [], status: THINKING, stage: null, suggestions: [], result: null };
}

function withBlock(progress: TurnProgress, block: Block, status: string | null): TurnProgress {
  return { ...progress, blocks: [...progress.blocks, block], status };
}

/** Fold one server event into the turn. A text delta extends the open text block; any other block starts a new one. */
export function applyEvent(progress: TurnProgress, event: ChatStreamEvent): TurnProgress {
  switch (event.type) {
    case "text": {
      const last = progress.blocks.at(-1);
      const blocks =
        last?.kind === "text"
          ? [...progress.blocks.slice(0, -1), { kind: "text" as const, text: last.text + event.delta }]
          : [...progress.blocks, { kind: "text" as const, text: event.delta }];
      return { ...progress, blocks, status: null };
    }
    case "tool_use":
      return withBlock(progress, { kind: "tool_use", id: event.id, name: event.name, input: event.input }, statusLabel(event.name));
    case "tool_result":
      return withBlock(progress, { kind: "tool_result", id: event.id, name: event.name, ok: event.ok, payload: event.payload }, THINKING);
    case "web_search":
      return withBlock(progress, { kind: "web_search", query: event.query }, statusLabel("web_search"));
    case "web_fetch":
      return withBlock(progress, { kind: "web_fetch", url: event.url, title: event.title }, statusLabel("web_fetch"));
    case "notice":
      return withBlock(progress, { kind: "notice", message: event.message }, progress.status);
    case "stage":
      return { ...withBlock(progress, { kind: "stage", stage: event.stage }, progress.status), stage: event.stage };
    case "suggestions":
      return { ...withBlock(progress, { kind: "suggestions", items: event.items }, progress.status), suggestions: event.items };
    case "done":
      return { ...progress, status: null, result: { ok: true, turnId: event.turnId, conversationId: event.conversationId, notice: event.notice } };
    case "discard":
    case "error":
      return { ...progress, status: null, result: { ok: false, message: event.message } };
  }
}

/** The conversation's stage: the last stage block anywhere, or the first stage before any turn. */
export function lastStage(turns: { blocks: Block[] }[]): Stage {
  for (let i = turns.length - 1; i >= 0; i--) {
    for (let j = turns[i].blocks.length - 1; j >= 0; j--) {
      const block = turns[i].blocks[j];
      if (block.kind === "stage") return block.stage;
    }
  }
  return "understand";
}

/** The chips to show: the last turn's suggestions, if it made any. */
export function lastSuggestions(turns: { blocks: Block[] }[]): string[] {
  const last = turns.at(-1);
  if (!last) return [];
  const block = last.blocks.find((b): b is Extract<Block, { kind: "suggestions" }> => b.kind === "suggestions");
  return block?.items ?? [];
}
