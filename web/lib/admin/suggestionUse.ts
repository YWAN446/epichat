/** How often participants send a turn from a button, week by week, for the researcher page. Counts only: no typed text is read. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUGGESTION_SOURCES } from "@/lib/enums";

export const WEEKS_SHOWN = 12;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const PAGE = 1000;

type Source = (typeof SUGGESTION_SOURCES)[number] | "other";

/** One logged turn or button press. `source` is the button's kind as logged; null when none was recorded. */
export type UseEvent = { userId: string; at: string; kind: "turn" | "suggestion_used"; source: string | null };

export type WeekRow = {
  /** The week's Monday, UTC, as YYYY-MM-DD. */
  weekStart: string;
  turns: number;
  fromButton: number;
  bySource: Record<Source, number>;
  usersWithButton: number;
  /** Distinct participants with a turn or a press that week. */
  activeUsers: number;
};

export const SOURCE_LABELS: Record<Source, string> = {
  model: "Assistant's suggestion",
  draft: "Example draft",
  intro: "Introduction question",
  option: "Intervention option",
  reference: "Reference",
  other: "Other",
};
export const SOURCE_ORDER: Source[] = [...SUGGESTION_SOURCES, "other"];

function mondayMs(at: Date): number {
  const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  return day - ((at.getUTCDay() + 6) % 7) * DAY_MS;
}

/** The Monday, UTC, of the week a moment falls in. */
export function weekStartUtc(at: Date): string {
  return new Date(mondayMs(at)).toISOString().slice(0, 10);
}

/** The start of the oldest week shown. */
export function sinceFor(now: Date): Date {
  return new Date(mondayMs(now) - (WEEKS_SHOWN - 1) * WEEK_MS);
}

const isSource = (value: string | null): value is (typeof SUGGESTION_SOURCES)[number] => (SUGGESTION_SOURCES as readonly string[]).includes(value ?? "");

/** The last twelve weeks, newest first, a week with nothing in it included as zeros. */
export function weeklySuggestionUse(events: UseEvent[], now: Date, excludeUserIds: ReadonlySet<string> = new Set()): WeekRow[] {
  const newest = mondayMs(now);
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => ({
    weekStart: new Date(newest - i * WEEK_MS).toISOString().slice(0, 10),
    turns: 0,
    fromButton: 0,
    bySource: { model: 0, draft: 0, intro: 0, option: 0, reference: 0, other: 0 } as Record<Source, number>,
    pressed: new Set<string>(),
    active: new Set<string>(),
  }));
  for (const event of events) {
    if (excludeUserIds.has(event.userId)) continue;
    const at = new Date(event.at);
    if (Number.isNaN(at.getTime())) continue;
    const index = Math.round((newest - mondayMs(at)) / WEEK_MS);
    const week = weeks[index];
    if (index < 0 || !week) continue;
    week.active.add(event.userId);
    if (event.kind === "turn") week.turns += 1;
    else {
      week.fromButton += 1;
      week.bySource[isSource(event.source) ? event.source : "other"] += 1;
      week.pressed.add(event.userId);
    }
  }
  return weeks.map(({ pressed, active, ...row }) => ({ ...row, usersWithButton: pressed.size, activeUsers: active.size }));
}

type EventRow = { user_id: string; at: string; kind: "turn" | "suggestion_used"; source: string | null };

/** Every turn and button press since a moment, up to a thousand rows at a time until an empty page. */
export async function loadUseEvents(admin: SupabaseClient, since: Date): Promise<UseEvent[]> {
  const events: UseEvent[] = [];
  // The server may cap a page below what was asked for, so only an empty page ends the read.
  for (let from = 0; ; ) {
    const { data, error } = await admin
      .from("step_events")
      .select("user_id, at, kind, source:meta->>source")
      .in("kind", ["turn", "suggestion_used"])
      .gte("at", since.toISOString())
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`step_events read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as EventRow[];
    for (const row of rows) events.push({ userId: row.user_id, at: row.at, kind: row.kind, source: row.source });
    if (rows.length === 0) return events;
    from += rows.length;
  }
}

/** The user ids behind the researcher emails, so their test sessions stay out of the counts. */
export async function researcherUserIds(admin: SupabaseClient, emails: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  if (emails.length === 0) return ids;
  const wanted = new Set(emails.map((email) => email.trim().toLowerCase()));
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw new Error(`user list failed: ${error.message}`);
    for (const user of data.users) if (user.email && wanted.has(user.email.trim().toLowerCase())) ids.add(user.id);
    if (data.users.length === 0) return ids;
  }
}
