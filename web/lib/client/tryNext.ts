import type { Block } from "@/lib/chat/events";
import type { RunPayload } from "@/lib/tools/types";

/** Follow-up spec 7.4: the latest run shows up to three of what_if's ready replies as buttons. */
export const TRY_NEXT_MAX = 3;
const LABEL_MAX = 80;

/** What the conversation hands a turn: which run block gets the buttons (null: none) and what a press does. */
export type TryNext = { key: string | null; onPick: (label: string) => void };

/** The labels of the run's what_if levers, in the service's order: non-empty, at most 80 characters, no duplicates, three at most. */
export function tryNextLabels(payload: RunPayload): string[] {
  const whatIf = (payload.diagnostics ?? []).find((d) => d.id === "what_if");
  const labels: string[] = [];
  for (const lever of whatIf?.levers ?? []) {
    const label = typeof lever.label === "string" ? lever.label.trim() : "";
    if (label && label.length <= LABEL_MAX && !labels.includes(label)) labels.push(label);
  }
  return labels.slice(0, TRY_NEXT_MAX);
}

/** "<turn id>:<block index>" of the last successful run of the last turn; null when the last turn ran nothing (the conversation has moved on). */
export function latestRunKey(turns: { id: string; blocks: Block[] }[]): string | null {
  const last = turns.at(-1);
  if (!last) return null;
  for (let index = last.blocks.length - 1; index >= 0; index--) {
    const block = last.blocks[index];
    if (block.kind === "tool_result" && block.ok && block.payload.kind === "run") return `${last.id}:${index}`;
  }
  return null;
}
