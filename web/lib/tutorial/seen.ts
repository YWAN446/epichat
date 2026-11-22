/** Whether a participant has started the tutorial before, read from the event log. Server only. */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * True when the participant has a `tutorial_started` event already: this run-through is then a replay. A declined
 * offer is not a start, so someone who said "Not now" and comes back from the menu is on their first run-through.
 * A read that fails counts as a first time: the tutorial must open either way.
 */
export async function tutorialStartedBefore(admin: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { count, error } = await admin.from("step_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "tutorial_started");
    return !error && (count ?? 0) > 0;
  } catch {
    return false;
  }
}
