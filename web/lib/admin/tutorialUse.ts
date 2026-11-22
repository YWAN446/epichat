/** How the first-use tutorial is used, for the researcher page. Counts of participants only: the tutorial's events hold fixed words and step numbers. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { TUTORIAL_EVENT_KINDS, TUTORIAL_LAST_STEP, type TutorialHow } from "@/lib/enums";

const PAGE = 1000;

export type TutorialEvent = { userId: string; kind: (typeof TUTORIAL_EVENT_KINDS)[number]; replay: boolean; step: number | null; how: TutorialHow | null };

export type TutorialSummary = {
  /** Participants who started a first run-through. */
  started: number;
  finished: number;
  /** Started and did not finish, however they left: End tutorial, or a closed tab. */
  notFinished: number;
  offerDeclined: number;
  /** Participants who came back to it after their first time. */
  replayedBy: number;
  /** Steps 0 to 10. `leftHere`: reached this step, got no further, and did not finish. */
  steps: { step: number; reached: number; did: number; skipped: number; leftHere: number }[];
};

const isStep = (step: number | null): step is number => step !== null && Number.isInteger(step) && step >= 0 && step <= TUTORIAL_LAST_STEP;

/**
 * Distinct participants on their first run-through; researcher accounts and replays are left out of everything but
 * `replayedBy`. A participant reaches step n by completing step n-1, so someone who closes the tab is counted at the
 * last step they reached.
 */
export function summarizeTutorial(events: TutorialEvent[], excludeUserIds: ReadonlySet<string> = new Set()): TutorialSummary {
  const started = new Set<string>();
  const finished = new Set<string>();
  const declined = new Set<string>();
  const replayed = new Set<string>();
  /** Per participant: the steps completed, and how. */
  const done = new Map<string, Map<number, TutorialHow>>();
  for (const event of events) {
    if (excludeUserIds.has(event.userId)) continue;
    if (event.kind === "tutorial_offer_declined") declined.add(event.userId);
    else if (event.replay) replayed.add(event.userId);
    else if (event.kind === "tutorial_started") started.add(event.userId);
    else if (event.kind === "tutorial_finished") finished.add(event.userId);
    else if (event.kind === "tutorial_step" && isStep(event.step) && event.how) {
      const steps = done.get(event.userId) ?? new Map<number, TutorialHow>();
      // Done wins over skipped when both were logged for a step.
      if (steps.get(event.step) !== "done") steps.set(event.step, event.how);
      done.set(event.userId, steps);
    }
  }

  const steps = Array.from({ length: TUTORIAL_LAST_STEP + 1 }, (_, step) => ({ step, reached: 0, did: 0, skipped: 0, leftHere: 0 }));
  let finishedStarters = 0;
  for (const userId of started) {
    const own = done.get(userId) ?? new Map<number, TutorialHow>();
    const furthest = Math.min(TUTORIAL_LAST_STEP, own.size > 0 ? Math.max(...own.keys()) + 1 : 0);
    for (let step = 0; step <= furthest; step++) steps[step].reached += 1;
    for (const [step, how] of own) steps[step][how === "done" ? "did" : "skipped"] += 1;
    if (finished.has(userId)) finishedStarters += 1;
    else steps[furthest].leftHere += 1;
  }
  return { started: started.size, finished: finishedStarters, notFinished: started.size - finishedStarters, offerDeclined: declined.size, replayedBy: replayed.size, steps };
}

type Row = { user_id: string; kind: TutorialEvent["kind"]; replay: string | null; step: string | null; how: string | null };

/** Every tutorial event, up to a thousand rows at a time until an empty page. */
export async function loadTutorialEvents(admin: SupabaseClient): Promise<TutorialEvent[]> {
  const events: TutorialEvent[] = [];
  // The server may cap a page below what was asked for, so only an empty page ends the read.
  for (let from = 0; ; ) {
    const { data, error } = await admin
      .from("step_events")
      .select("user_id, kind, replay:meta->>replay, step:meta->>step, how:meta->>how")
      .in("kind", [...TUTORIAL_EVENT_KINDS])
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`step_events read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    for (const row of rows) {
      const step = row.step !== null && /^\d+$/.test(row.step) ? Number(row.step) : null;
      events.push({ userId: row.user_id, kind: row.kind, replay: row.replay === "true", step: isStep(step) ? step : null, how: row.how === "done" || row.how === "skipped" ? row.how : null });
    }
    if (rows.length === 0) return events;
    from += rows.length;
  }
}
