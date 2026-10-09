import { describe, expect, it } from "vitest";

import { compact, linePath, nearestIndex, niceTicks, seriesFor, thinPoints } from "@/lib/client/chart";

describe("chart math", () => {
  it("maps each view to the lines the series has", () => {
    const series = { day: [0, 1, 2], n_susceptible: [9, 8, 7], n_infected: [1, 2, 3], n_recovered: [0, 0, 0], new_infections: [1, 1, 1], cum_infections: [1, 2, 3], cum_deaths: [0, 0, 1] };
    expect(seriesFor("infected", series).map((l) => l.key)).toEqual(["n_infected"]);
    expect(seriesFor("compartments", series).map((l) => l.key)).toEqual(["n_susceptible", "n_infected", "n_recovered"]);
    expect(seriesFor("compartments", { ...series, n_exposed: [0, 1, 0] }).map((l) => l.key)).toEqual(["n_susceptible", "n_exposed", "n_infected", "n_recovered"]);
    expect(seriesFor("incidence", series)[0]).toMatchObject({ key: "new_infections", label: "New infections per day", values: [1, 1, 1] });
    expect(seriesFor("cumulative", series)[0].key).toBe("cum_infections");
    expect(seriesFor("deaths", series)[0]).toMatchObject({ key: "cum_deaths", label: "Cumulative disease deaths" });
    expect(seriesFor("deaths", { day: [0] })).toEqual([]);
  });

  it("thins long series evenly and always keeps the last point", () => {
    const days = Array.from({ length: 1000 }, (_, i) => i);
    const values = days.map((d) => d * 2);
    const points = thinPoints(days, values, 100);
    expect(points.length).toBeLessThanOrEqual(101);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 999, y: 1998 });
    expect(thinPoints([0, 1, 2], [5, 6, 7], 100)).toEqual([{ x: 0, y: 5 }, { x: 1, y: 6 }, { x: 2, y: 7 }]);
  });

  it("picks round ticks, compacts numbers, and never divides by zero", () => {
    expect(niceTicks(950, 4)).toEqual([0, 250, 500, 750, 1000]);
    expect(niceTicks(365, 5)).toEqual([0, 100, 200, 300, 400]);
    expect(niceTicks(0, 4)).toEqual([0, 1]);
    expect(compact(999)).toBe("999");
    expect(compact(1234)).toBe("1.2k");
    expect(compact(20000)).toBe("20k");
    expect(compact(3_400_000)).toBe("3.4M");
    expect(linePath([{ x: 0, y: 0 }, { x: 10, y: 5 }], 100, 50, 10, 10)).toBe("M0 50 L100 25");
    expect(linePath([{ x: 0, y: 0 }], 100, 50, 0, 0)).toBe("M0 50");
    expect(linePath([], 100, 50, 10, 10)).toBe("");
  });

  it("finds the nearest day", () => {
    expect(nearestIndex([0, 4, 8, 12], 5)).toBe(1);
    expect(nearestIndex([0, 4, 8, 12], 7)).toBe(2);
    expect(nearestIndex([0, 4, 8, 12], 99)).toBe(3);
    expect(nearestIndex([], 3)).toBe(0);
  });
});
