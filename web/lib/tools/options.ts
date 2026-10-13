import type { PreviousRun } from "@/lib/db/runs";
import type { SimParams } from "@/lib/sim/params";
import { flattenParams, type PathChange } from "@/lib/sim/paths";
import { near } from "./sources";

export type MatchedLever = { diagnosticId: string; patch: Record<string, unknown>; interventions?: Record<string, unknown>[] };

/** The scenario holds the lever's entry: the same type (and layer, for a contact reduction) with every field the lever gave. */
const sameEntry = (lever: Record<string, unknown>, now: Record<string, unknown>) =>
  now.type === lever.type && (lever.type !== "contact_reduction" || (now.layer ?? "all") === (lever.layer ?? "all")) &&
  Object.keys(lever).every((key) => near(now[key], lever[key]));

/**
 * Spec 11: a lever was taken when every path of its patch now holds the lever's value and at least one of them
 * was applied by this call (a path that already held the value, such as a default, counts); the first matching
 * lever per diagnostic. Follow-up spec 7.5: a lever that carries intervention entries was taken when this call
 * changed the interventions and every entry is in the new scenario; a lever with a patch and entries needs both,
 * and a lever with neither is never taken.
 */
export function matchedLevers(previous: PreviousRun | null, changed: PathChange[], params: SimParams): MatchedLever[] {
  if (!previous || changed.length === 0) return [];
  const applied = new Map(changed.map((c) => [c.path, c.to]));
  const current = flattenParams(params as unknown as Record<string, unknown>);
  const now = params.interventions as unknown as Record<string, unknown>[];
  const out: MatchedLever[] = [];
  for (const diagnostic of previous.diagnostics) {
    const lever = diagnostic.levers.find((l) => {
      const paths = Object.keys(l.patch);
      const entries = l.interventions ?? [];
      if (paths.length === 0 && entries.length === 0) return false;
      const patched = paths.length === 0 || (paths.some((p) => applied.has(p)) && paths.every((p) => near(applied.has(p) ? applied.get(p) : current[p], l.patch[p])));
      // flattenParams leaves the interventions array as one leaf, so any change to an entry is the path "interventions"
      const entered = entries.length === 0 || (applied.has("interventions") && entries.every((entry) => now.some((i) => sameEntry(entry, i))));
      return patched && entered;
    });
    if (lever) out.push({ diagnosticId: diagnostic.id, patch: lever.patch, ...(lever.interventions?.length ? { interventions: lever.interventions } : {}) });
  }
  return out;
}
