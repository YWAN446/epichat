import { describe, expect, it } from "vitest";
import { easternDay, easternMonthStart } from "@/lib/time";

describe("Eastern time days", () => {
  it("rolls the day over at midnight Eastern, not UTC", () => {
    // 03:30 UTC on Oct 6 is 23:30 Eastern on Oct 5 (EDT).
    const late = new Date("2026-10-06T03:30:00Z");
    expect(easternDay(late)).toBe("2026-10-05");
    expect(easternMonthStart(late)).toBe("2026-10-01");
    // 04:30 UTC on Nov 1 is 00:30 Eastern on Nov 1 (EDT ends later that day).
    expect(easternDay(new Date("2026-11-01T04:30:00Z"))).toBe("2026-11-01");
    expect(easternMonthStart(new Date("2026-11-01T04:30:00Z"))).toBe("2026-11-01");
  });
});
