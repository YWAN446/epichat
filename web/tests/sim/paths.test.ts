import { describe, expect, it } from "vitest";

import { diffParams, flattenParams, getPath, setPath } from "@/lib/sim/paths";

describe("dotted paths", () => {
  it("flattens, reads and writes nested objects", () => {
    const d: Record<string, unknown> = { a: { b: 1, c: { d: [1, 2] } }, e: null };
    expect(flattenParams(d)).toEqual({ "a.b": 1, "a.c.d": [1, 2], e: null });
    expect(getPath(d, "a.c.d")).toEqual([1, 2]);
    expect(getPath(d, "a.x")).toBeUndefined();
    setPath(d, "a.c.f", 3);
    setPath(d, "g.h", 4);
    expect((d.a as { c: { f: number } }).c.f).toBe(3);
    expect(d.g).toEqual({ h: 4 });
  });

  it("diffs like the Python service", () => {
    expect(diffParams({ a: { b: 1 }, x: 2 }, { a: { b: 5 }, x: 2, y: [1] })).toEqual([
      { field: "a.b", from: 1, to: 5 },
      { field: "y", from: null, to: [1] },
    ]);
  });
});

describe("changedPaths", () => {
  it("names each changed leaf by path", async () => {
    const { changedPaths } = await import("@/lib/sim/paths");
    expect(changedPaths({ a: { b: 1, c: "x" }, d: [1] }, { a: { b: 2, c: "x" }, d: [1, 2] })).toEqual([
      { path: "a.b", from: 1, to: 2 },
      { path: "d", from: [1], to: [1, 2] },
    ]);
    expect(changedPaths({ a: { b: 1 } }, { a: { b: 1 } })).toEqual([]);
  });
});
