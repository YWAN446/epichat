/**
 * The two hidden blocks a reply ends with: ```recap (decisions so far, 8 lines
 * of 120 characters) then ```next (one to three suggested replies of 80).
 */
import { parseFenced, withoutFenced } from "./fenced";

export const HIDDEN_TAGS = ["next", "recap"];

export function parseNext(text: string): string[] | null {
  return parseFenced(text, "next", { maxItems: 3, maxChars: 80 });
}

export function parseRecap(text: string): string[] | null {
  return parseFenced(text, "recap", { maxItems: 8, maxChars: 120 });
}

/** The reply without its next block only (kept for callers that handle one tag). */
export function withoutNext(text: string): string {
  return withoutFenced(text, ["next"]);
}

/** The reply as the reader should see it: no recap, no next, complete or arriving. */
export function withoutHidden(text: string): string {
  return withoutFenced(text, HIDDEN_TAGS);
}
