import type { SupabaseClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SuggestionUseTable } from "@/components/admin/SuggestionUseTable";
import { WEEKS_SHOWN, loadUseEvents, researcherUserIds, sinceFor, weekStartUtc, weeklySuggestionUse, type UseEvent, type WeekRow } from "@/lib/admin/suggestionUse";

const NOW = new Date("2026-11-21T15:00:00Z"); // a Saturday; its week starts Monday 2026-11-16
const ev = (userId: string, at: string, kind: UseEvent["kind"], source: string | null = null): UseEvent => ({ userId, at, kind, source });

describe("the weekly suggested-reply counts (round-1 UI cleanup)", () => {
  it("starts weeks on Monday, UTC", () => {
    expect(weekStartUtc(new Date("2026-11-22T23:59:59Z"))).toBe("2026-11-16"); // Sunday
    expect(weekStartUtc(new Date("2026-11-23T00:00:00Z"))).toBe("2026-11-23"); // Monday
    expect(sinceFor(NOW).toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("gives twelve weeks, newest first, with empty weeks as zeros", () => {
    const rows = weeklySuggestionUse([], NOW);
    expect(WEEKS_SHOWN).toBe(12);
    expect(rows).toHaveLength(12);
    expect(rows[0].weekStart).toBe("2026-11-16");
    expect(rows[11].weekStart).toBe("2026-08-31");
    expect(rows[0]).toMatchObject({ turns: 0, fromButton: 0, usersWithButton: 0, activeUsers: 0 });
  });

  it("counts turns, presses by kind, and the participants behind them", () => {
    const rows = weeklySuggestionUse(
      [
        ev("a", "2026-11-17T10:00:00Z", "turn"),
        ev("a", "2026-11-17T10:00:00Z", "suggestion_used", "model"),
        ev("a", "2026-11-18T10:00:00Z", "turn"),
        ev("b", "2026-11-18T11:00:00Z", "turn"),
        ev("b", "2026-11-19T11:00:00Z", "turn"),
        ev("b", "2026-11-19T11:00:00Z", "suggestion_used", "intro"),
        ev("c", "2026-11-19T12:00:00Z", "turn"),
        ev("c", "2026-11-19T12:00:00Z", "suggestion_used", null),
        ev("c", "2026-11-19T12:05:00Z", "suggestion_used", "something else"),
        ev("a", "2026-11-10T10:00:00Z", "turn"),
      ],
      NOW,
    );
    expect(rows[0]).toMatchObject({ turns: 5, fromButton: 4, usersWithButton: 3, activeUsers: 3 });
    expect(rows[0].bySource).toEqual({ model: 1, draft: 0, intro: 1, option: 0, reference: 0, other: 2 });
    expect(rows[1]).toMatchObject({ weekStart: "2026-11-09", turns: 1, fromButton: 0, usersWithButton: 0, activeUsers: 1 });
  });

  it("leaves researcher accounts out and ignores events outside the twelve weeks", () => {
    const rows = weeklySuggestionUse([ev("r", "2026-11-17T10:00:00Z", "turn"), ev("a", "2026-08-30T23:00:00Z", "turn"), ev("a", "2026-11-24T00:00:00Z", "turn"), ev("a", "2026-11-17T10:00:00Z", "turn")], NOW, new Set(["r"]));
    expect(rows.reduce((n, row) => n + row.turns, 0)).toBe(1);
  });
});

/** A chainable stand-in for the admin client: every builder call returns itself, and range() answers the page it names. */
function fakeAdmin(pages: unknown[][], calls: { range: [number, number][]; select?: string } = { range: [] }): SupabaseClient {
  const builder: Record<string, unknown> = {};
  for (const method of ["in", "gte", "order"]) builder[method] = () => builder;
  builder.select = (columns: string) => {
    calls.select = columns;
    return builder;
  };
  builder.range = async (from: number, to: number) => {
    calls.range.push([from, to]);
    return { data: pages[from / 1000] ?? [], error: null };
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

describe("reading the events", () => {
  const row = (i: number) => ({ user_id: `u${i % 7}`, at: "2026-11-17T10:00:00Z", kind: i % 3 === 0 ? "suggestion_used" : "turn", source: i % 3 === 0 ? "model" : null });

  it("reads every page, not only the first thousand rows", async () => {
    const calls = { range: [] as [number, number][], select: "" };
    const events = await loadUseEvents(fakeAdmin([Array.from({ length: 1000 }, (_, i) => row(i)), Array.from({ length: 3 }, (_, i) => row(1000 + i))], calls), new Date("2026-08-31T00:00:00Z"));
    expect(events).toHaveLength(1003);
    expect(calls.range).toEqual([[0, 999], [1000, 1999], [1003, 2002]]);
    expect(events[0]).toEqual({ userId: "u0", at: "2026-11-17T10:00:00Z", kind: "suggestion_used", source: "model" });
  });

  it("keeps reading when the server caps a page below a thousand rows, and stops on an empty page (final review 3)", async () => {
    const half = (start: number) => Array.from({ length: 500 }, (_, i) => row(start + i));
    const capped = { from: () => capped, select: () => capped, in: () => capped, gte: () => capped, order: () => capped, range: async (from: number) => ({ data: from === 0 ? half(0) : from === 500 ? half(500) : from === 1000 ? [row(1)] : [], error: null }) } as unknown as SupabaseClient;
    expect(await loadUseEvents(capped, new Date("2026-08-31T00:00:00Z"))).toHaveLength(1001);
    const users = [[{ id: "a", email: "a@example.org" }], [{ id: "r", email: "lead@example.org" }], []];
    const admin = { auth: { admin: { listUsers: async ({ page }: { page: number }) => ({ data: { users: users[page - 1] ?? [] }, error: null }) } } } as unknown as SupabaseClient;
    expect(await researcherUserIds(admin, ["lead@example.org"])).toEqual(new Set(["r"]));
  });

  it("asks only for ids, times, kinds and the button's kind: no typed text", async () => {
    const calls = { range: [] as [number, number][], select: "" };
    await loadUseEvents(fakeAdmin([[]], calls), new Date());
    expect(calls.select).toBe("user_id, at, kind, source:meta->>source");
  });

  it("finds the researcher accounts by email, whatever the letter case, across pages", async () => {
    const pages = [Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, email: `p${i}@example.org` })), [{ id: "r1", email: "Lead@Example.org" }, { id: "x", email: null }]];
    const admin = { auth: { admin: { listUsers: async ({ page }: { page: number }) => ({ data: { users: pages[page - 1] ?? [] }, error: null }) } } } as unknown as SupabaseClient;
    expect(await researcherUserIds(admin, ["lead@example.org"])).toEqual(new Set(["r1"]));
    expect(await researcherUserIds(admin, [])).toEqual(new Set());
  });
});

describe("the table", () => {
  const week = (over: Partial<WeekRow>): WeekRow => ({ weekStart: "2026-11-16", turns: 20, fromButton: 6, bySource: { model: 3, draft: 1, intro: 2, option: 0, reference: 0, other: 0 }, usersWithButton: 2, activeUsers: 5, ...over });
  const html = (rows: WeekRow[]) => renderToStaticMarkup(createElement(SuggestionUseTable, { rows }));

  it("shows one row per week with the counts and the participants as 2 of 5", () => {
    const out = html([week({}), week({ weekStart: "2026-11-09", turns: 0, fromButton: 0, usersWithButton: 0, activeUsers: 0 })]);
    for (const piece of ["Week of", "Turns", "From a button", "Assistant&#x27;s suggestion", "Example draft", "Introduction question", "Intervention option", "Reference", "Participants using one", "2026-11-16", ">20<", ">6<", "2 of 5", "0 of 0"]) expect(out).toContain(piece);
    expect(out.match(/<tr/g)).toHaveLength(3);
    expect(out).not.toContain(">Other<");
  });

  it("shows the Other column only when some press has no known kind", () => {
    expect(html([week({ bySource: { model: 3, draft: 1, intro: 1, option: 0, reference: 0, other: 1 } })])).toContain(">Other<");
  });
});
