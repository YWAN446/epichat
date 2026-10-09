import { z } from "zod";
import { MEMORY_KINDS, type MemoryKind } from "@/lib/enums";
import type { MemoryPayload, ToolDeps, ToolOutcome } from "./types";

const line = z.string().trim().min(3).max(200);

/** `replaces` is the earlier memory's text as the About block shows it; the block carries no ids. */
export const RememberInput = z.strictObject({
  kind: z.enum(MEMORY_KINDS),
  text: line,
  replaces: line.nullish().transform((value) => value ?? undefined),
});
export type RememberArgs = { kind: MemoryKind; text: string; replaces?: string };

export const MEMORY_OFF = "MEMORY OFF: this participant switched memory off.";
export const MEMORY_LIMIT = "MEMORY LIMIT: three per turn.";
export const MEMORY_FULL = "MEMORY FULL: ask the participant to tidy their memory list.";
export const MEMORY_NOT_FOUND = "MEMORY NOT FOUND: no such memory to replace.";
/** Remember calls per turn. */
export const PER_TURN = 3;

/** Profile spec, section 9: never an error outcome; the refusals are plain text for the model. */
export async function remember(input: RememberArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const memory = deps.memory;
  if (!memory.enabled) return { content: MEMORY_OFF };
  if (memory.added >= PER_TURN) return { content: MEMORY_LIMIT };
  const result = await memory.add(input.kind, input.text, input.replaces);
  if (result === "full") return { content: MEMORY_FULL };
  if (result === "not_found") return { content: MEMORY_NOT_FOUND };
  memory.added += 1;
  const payload: MemoryPayload = { kind: "memory", memory_id: result.id, memory_kind: input.kind, text: input.text, replaced: input.replaces !== undefined };
  return { content: `Remembered: ${input.text}`, payload };
}
