import { describe, expect, it, vi } from "vitest";

import { BOUNDS, DEFAULT_LAYOUT, LAYOUT_KEY, STEP, clampWidth, createLayoutStore, dragWidth, nudgeWidth, readLayout, writeLayout } from "@/lib/client/layout";

function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void items.set(key, value)),
    items,
  };
}

describe("column widths", () => {
  it("keeps each side within its bounds and falls back to the initial width for nonsense", () => {
    expect(clampWidth("left", 300)).toBe(300);
    expect(clampWidth("left", 10)).toBe(BOUNDS.left.min);
    expect(clampWidth("left", 5000)).toBe(BOUNDS.left.max);
    expect(clampWidth("right", Number.NaN)).toBe(BOUNDS.right.initial);
    expect(DEFAULT_LAYOUT).toEqual({ left: { open: true, width: BOUNDS.left.initial }, right: { open: true, width: BOUNDS.right.initial } });
  });

  it("widens the left column when its handle moves right, and the right column when its handle moves left", () => {
    expect(dragWidth("left", 256, 100, 140)).toBe(296);
    expect(dragWidth("left", 256, 100, 60)).toBe(216);
    expect(dragWidth("right", 384, 900, 860)).toBe(424);
    expect(dragWidth("right", 384, 900, 940)).toBe(344);
    expect(dragWidth("left", 256, 100, 100000)).toBe(BOUNDS.left.max);
  });

  it("nudges by one step with the arrow keys, jumps with Home and End, and ignores other keys", () => {
    expect(nudgeWidth("left", 256, "ArrowRight")).toBe(256 + STEP);
    expect(nudgeWidth("left", 256, "ArrowLeft")).toBe(256 - STEP);
    expect(nudgeWidth("right", 384, "ArrowLeft")).toBe(384 + STEP);
    expect(nudgeWidth("right", 384, "ArrowRight")).toBe(384 - STEP);
    expect(nudgeWidth("left", 256, "Home")).toBe(BOUNDS.left.min);
    expect(nudgeWidth("left", 256, "End")).toBe(BOUNDS.left.max);
    expect(nudgeWidth("left", 256, "Enter")).toBeNull();
  });
});

describe("remembering the layout", () => {
  it("reads a stored layout, clamping widths and refusing malformed values", () => {
    expect(readLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(readLayout("not json")).toEqual(DEFAULT_LAYOUT);
    expect(readLayout(JSON.stringify({ left: { open: false, width: 10 }, right: { open: true, width: 500 } }))).toEqual({ left: { open: false, width: BOUNDS.left.min }, right: { open: true, width: 500 } });
    expect(readLayout(JSON.stringify({ left: { open: "yes", width: "wide" } }))).toEqual(DEFAULT_LAYOUT);
    expect(readLayout(writeLayout(DEFAULT_LAYOUT))).toEqual(DEFAULT_LAYOUT);
  });

  it("serves one snapshot until something changes, writes every change, and survives a broken storage", () => {
    const storage = fakeStorage({ [LAYOUT_KEY]: JSON.stringify({ left: { open: false, width: 200 }, right: { open: true, width: 400 } }) });
    const store = createLayoutStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);
    const first = store.getSnapshot();
    expect(first).toEqual({ left: { open: false, width: 200 }, right: { open: true, width: 400 } });
    expect(store.getSnapshot()).toBe(first);
    expect(store.getServerSnapshot()).toBe(DEFAULT_LAYOUT);
    store.toggle("left");
    expect(store.getSnapshot().left.open).toBe(true);
    store.resize("right", 10000);
    expect(store.getSnapshot().right.width).toBe(BOUNDS.right.max);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(JSON.parse(storage.items.get(LAYOUT_KEY) ?? "")).toEqual(store.getSnapshot());

    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const fallback = createLayoutStore(broken);
    expect(fallback.getSnapshot()).toEqual(DEFAULT_LAYOUT);
    expect(() => fallback.toggle("right")).not.toThrow();
    expect(fallback.getSnapshot().right.open).toBe(false);
    expect(createLayoutStore(null).getSnapshot()).toEqual(DEFAULT_LAYOUT);
  });
});
