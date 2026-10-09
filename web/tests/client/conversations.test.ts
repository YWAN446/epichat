import { describe, expect, it } from "vitest";

import { dayLabel, groupByDay, groupsFor, summaryFor } from "@/lib/client/conversations";

const NOW = new Date(2026, 9, 8, 12, 0, 0);
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).toISOString();

describe("sidebar grouping", () => {
  it("labels today, yesterday, and earlier days, with the year only when it differs", () => {
    expect(dayLabel(at(2026, 9, 8, 1), NOW)).toBe("Today");
    expect(dayLabel(at(2026, 9, 7, 23), NOW)).toBe("Yesterday");
    expect(dayLabel(at(2026, 8, 30), NOW)).toBe("Sep 30");
    expect(dayLabel(at(2025, 11, 25), NOW)).toBe("Dec 25, 2025");
  });

  it("groups consecutive conversations by day, keeping their order", () => {
    const items = [
      { id: "a", title: "A", updatedAt: at(2026, 9, 8, 11) },
      { id: "b", title: "B", updatedAt: at(2026, 9, 8, 8) },
      { id: "c", title: "C", updatedAt: at(2026, 9, 7) },
      { id: "d", title: "D", updatedAt: at(2026, 8, 30) },
    ];
    expect(groupByDay(items, NOW).map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([["Today", ["a", "b"]], ["Yesterday", ["c"]], ["Sep 30", ["d"]]]);
    expect(groupByDay([], NOW)).toEqual([]);
  });

  it("builds the row for a conversation the first turn just opened", () => {
    expect(summaryFor("x", "Model a measles outbreak in Kenya", NOW)).toEqual({ id: "x", title: "Model a measles outbreak in Kenya", updatedAt: NOW.toISOString() });
  });
  it("renders one unlabeled group until the browser's clock is known", () => {
    const items = [
      { id: "a", title: "A", updatedAt: at(2026, 9, 8, 11) },
      { id: "c", title: "C", updatedAt: at(2026, 9, 7) },
    ];
    expect(groupsFor(items, null)).toEqual([{ label: null, items }]);
    expect(groupsFor(items, NOW)).toEqual(groupByDay(items, NOW));
    expect(groupsFor([], null)).toEqual([]);
  });
});
