/**
 * Fenced blocks the assistant appends for the interface: ```next (suggested
 * replies) and ```recap (decisions so far). Adapted from CampusOtter's
 * nextStep.ts. A stage line is skipped: stages are derived, never declared.
 */
export type FencedLimits = { maxItems: number; maxChars: number };

function completeBlock(tag: string): RegExp {
  return new RegExp("```" + tag + "[ \\t]*\\n([\\s\\S]*?)\\n?```", "g");
}

/** n(?:e(?:x(?:t[\s\S]*)?)?)? for "next": any prefix of the tag, or the tag and anything after it. */
function prefixPattern(tag: string, index = 0): string {
  return index === tag.length - 1 ? tag[index] + "[\\s\\S]*" : tag[index] + "(?:" + prefixPattern(tag, index + 1) + ")?";
}

/**
 * A block that has started and not yet closed, or the first backticks of one,
 * at the end of the text. Anchored to a line start so a backtick closing
 * inline code is never taken for a fence.
 */
function arrivingBlock(tags: string[]): RegExp {
  const inner = tags.map((tag) => prefixPattern(tag)).join("|");
  return new RegExp("(?:^|\\n)[ \\t]*```(?:" + inner + ")?$|(?:^|\\n)[ \\t]*`{1,2}$");
}

/** The lines of the last complete block with the tag, or null when there is none. */
export function parseFenced(text: string, tag: string, limits: FencedLimits): string[] | null {
  const blocks = [...text.matchAll(completeBlock(tag))];
  const last = blocks.at(-1);
  if (!last) return null;
  const items: string[] = [];
  for (const raw of last[1].split("\n")) {
    const line = raw.trim();
    if (!line || /^stage:/i.test(line)) continue;
    if (items.length < limits.maxItems) {
      items.push(line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").slice(0, limits.maxChars).trim());
    }
  }
  return items;
}

/** The text as the reader should see it: no block with any of the tags, whether complete or still arriving. */
export function withoutFenced(text: string, tags: string[]): string {
  let shown = text;
  for (const tag of tags) shown = shown.replace(completeBlock(tag), "");
  const arriving = arrivingBlock(tags).exec(shown);
  if (!arriving) return shown.trim();
  // An odd number of fences before it means another code block is open and these backticks close it.
  const fencesBefore = shown.slice(0, arriving.index).split("```").length - 1;
  return (fencesBefore % 2 === 1 ? shown : shown.slice(0, arriving.index)).trim();
}
