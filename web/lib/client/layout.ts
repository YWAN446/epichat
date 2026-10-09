/**
 * The side columns on wide screens: each can be collapsed and dragged or keyed
 * to a width, and the browser remembers both. Pure helpers first, then a small
 * store for useSyncExternalStore so the server-rendered tree and the first
 * client render agree (the stored layout applies once hydrated).
 */
import { useSyncExternalStore } from "react";

export type Side = "left" | "right";
export type ColumnState = { open: boolean; width: number };
export type Layout = Record<Side, ColumnState>;

/** Pixels. The initial widths are the spec's 16rem and 24rem. */
export const BOUNDS: Record<Side, { min: number; max: number; initial: number }> = {
  left: { min: 192, max: 448, initial: 256 },
  right: { min: 288, max: 640, initial: 384 },
};
export const STEP = 16;
export const LAYOUT_KEY = "epichat.layout";
export const DEFAULT_LAYOUT: Layout = { left: { open: true, width: BOUNDS.left.initial }, right: { open: true, width: BOUNDS.right.initial } };

export function clampWidth(side: Side, width: number): number {
  const { min, max, initial } = BOUNDS[side];
  if (!Number.isFinite(width)) return initial;
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** The width while a handle is dragged: the left column grows to the right, the right column grows to the left. */
export function dragWidth(side: Side, startWidth: number, startX: number, clientX: number): number {
  const delta = clientX - startX;
  return clampWidth(side, side === "left" ? startWidth + delta : startWidth - delta);
}

/** The width after a key on a focused handle; null when the key means nothing here. */
export function nudgeWidth(side: Side, width: number, key: string): number | null {
  const outward = side === "left" ? "ArrowRight" : "ArrowLeft";
  const inward = side === "left" ? "ArrowLeft" : "ArrowRight";
  if (key === outward) return clampWidth(side, width + STEP);
  if (key === inward) return clampWidth(side, width - STEP);
  if (key === "Home") return BOUNDS[side].min;
  if (key === "End") return BOUNDS[side].max;
  return null;
}

function column(side: Side, value: unknown): ColumnState | null {
  if (typeof value !== "object" || value === null) return null;
  const { open, width } = value as Record<string, unknown>;
  if (typeof open !== "boolean" || typeof width !== "number") return null;
  return { open, width: clampWidth(side, width) };
}

/** A stored layout, or the default when there is none or it is malformed. */
export function readLayout(raw: string | null): Layout {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    const left = column("left", parsed?.left);
    const right = column("right", parsed?.right);
    return left && right ? { left, right } : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function writeLayout(layout: Layout): string {
  return JSON.stringify(layout);
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type LayoutStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Layout;
  getServerSnapshot(): Layout;
  set(next: Layout): void;
  toggle(side: Side): void;
  resize(side: Side, width: number): void;
};

/** One snapshot until something changes; every change is written to the storage when it allows. */
export function createLayoutStore(storage: StorageLike | null): LayoutStore {
  let current: Layout | null = null;
  const listeners = new Set<() => void>();
  const load = (): Layout => {
    if (current) return current;
    let raw: string | null = null;
    try {
      raw = storage?.getItem(LAYOUT_KEY) ?? null;
    } catch {
      raw = null;
    }
    current = readLayout(raw);
    return current;
  };
  const set = (next: Layout) => {
    current = next;
    try {
      storage?.setItem(LAYOUT_KEY, writeLayout(next));
    } catch {
      // A per-viewer convenience: the layout still applies for this page.
    }
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: load,
    getServerSnapshot: () => DEFAULT_LAYOUT,
    set,
    toggle(side) {
      const now = load();
      set({ ...now, [side]: { ...now[side], open: !now[side].open } });
    },
    resize(side, width) {
      const now = load();
      set({ ...now, [side]: { ...now[side], width: clampWidth(side, width) } });
    },
  };
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const layoutStore: LayoutStore = createLayoutStore(browserStorage());

/** The remembered layout; the default on the server and during hydration. */
export function useLayout(): Layout {
  return useSyncExternalStore(layoutStore.subscribe, layoutStore.getSnapshot, layoutStore.getServerSnapshot);
}

const WIDE = "(min-width: 80rem)";
const subscribeWide = (notify: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

/** True from Tailwind's xl breakpoint, where the sides are columns rather than overlays; false on the server and until hydrated. */
export function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
}
