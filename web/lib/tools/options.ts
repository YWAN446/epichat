import type { PreviousRun } from "@/lib/db/runs";
import type { PathChange } from "@/lib/sim/paths";
import { near } from "./sources";

export type MatchedLever = { diagnosticId: string; patch: Record<string, unknown> };

/** Spec 11: a lever was taken when every path of its patch was applied with its value; the first matching lever per diagnostic. */
export function matchedLevers(previous: PreviousRun | null, changed: PathChange[]): MatchedLever[] {
  if (!previous || changed.length === 0) return [];
  const applied = new Map(changed.map((c) => [c.path, c.to]));
  const out: MatchedLever[] = [];
  for (const diagnostic of previous.diagnostics) {
    const lever = diagnostic.levers.find((l) => {
      const paths = Object.keys(l.patch);
      return paths.length > 0 && paths.every((p) => applied.has(p) && near(applied.get(p), l.patch[p]));
    });
    if (lever) out.push({ diagnosticId: diagnostic.id, patch: lever.patch });
  }
  return out;
}
