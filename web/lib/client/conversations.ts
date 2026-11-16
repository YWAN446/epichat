/** The sidebar's day groups and the row for a conversation the page just opened. */
import { titleFrom, type ConversationSummary } from "@/lib/db/conversations";

export type DayGroup = { label: string; items: ConversationSummary[] };
/** A day group, or the single unlabeled group shown before the browser's clock is known. */
export type SidebarGroup = { label: string | null; items: ConversationSummary[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** "Today", "Yesterday", "Sep 30", or "Dec 25, 2025" in the browser's local time. */
export function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  if (dayKey(date) === dayKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  const year = date.getFullYear() === now.getFullYear() ? "" : `, ${date.getFullYear()}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${year}`;
}

/** Consecutive conversations with the same day label, in the order given (newest first). */
export function groupByDay(items: ConversationSummary[], now: Date): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const label = dayLabel(item.updatedAt, now);
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/**
 * The groups the sidebar renders. The server and the browser may sit in
 * different time zones, so the day labels are computed only once the browser's
 * clock is known (`now` set from an effect); until then, one unlabeled group
 * keeps the server-rendered and client-rendered trees identical.
 */
export function groupsFor(items: ConversationSummary[], now: Date | null): SidebarGroup[] {
  if (now) return groupByDay(items, now);
  return items.length === 0 ? [] : [{ label: null, items }];
}

/** The sidebar row for a conversation whose first turn just finished; the server's title rule, applied here. */
export function summaryFor(id: string, text: string, now: Date): ConversationSummary {
  return { id, title: titleFrom(text), updatedAt: now.toISOString() };
}
