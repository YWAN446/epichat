/**
 * The ```next block the assistant ends each reply with: one to three
 * suggested replies. Adapted from CampusOtter's nextStep.ts without the
 * stage line (stages are derived from tool events, never declared).
 */
const MAX_SUGGESTIONS = 3;
const MAX_CHARS = 80;
const COMPLETE_BLOCK = /```next[ \t]*\n([\s\S]*?)\n?```/g;
// A block that has started and not yet closed, or the first backticks of one.
// Anchored to a line start so a backtick closing inline code is never taken for a fence.
const ARRIVING_BLOCK = /(?:^|\n)[ \t]*```(?:n(?:e(?:x(?:t[\s\S]*)?)?)?)?$|(?:^|\n)[ \t]*`{1,2}$/;

export function parseNext(text: string): string[] | null {
  const blocks = [...text.matchAll(COMPLETE_BLOCK)];
  const last = blocks.at(-1);
  if (!last) return null;
  const items: string[] = [];
  for (const raw of last[1].split("\n")) {
    const line = raw.trim();
    if (!line || /^stage:/i.test(line)) continue;
    if (items.length < MAX_SUGGESTIONS) items.push(line.replace(/^[-*]\s+/, "").slice(0, MAX_CHARS).trim());
  }
  return items;
}

/** The reply as the user should read it: no block, whether complete or still arriving. */
export function withoutNext(text: string): string {
  const shown = text.replace(COMPLETE_BLOCK, "");
  const arriving = ARRIVING_BLOCK.exec(shown);
  if (!arriving) return shown.trim();
  // An odd number of fences before it means another code block is open and these backticks close it.
  const fencesBefore = shown.slice(0, arriving.index).split("```").length - 1;
  return (fencesBefore % 2 === 1 ? shown : shown.slice(0, arriving.index)).trim();
}
