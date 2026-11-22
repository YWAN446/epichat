/** Where the tutorial's dimming and its card go, given where the target is. Pure geometry; the component measures. */
import type { Target } from "./steps";

export type Rect = { top: number; left: number; width: number; height: number };
type Size = { width: number; height: number };

/** Room left clear around the target. */
export const HOLE_PAD = 6;
export const CARD_WIDTH = 320;
/** Between the hole and the card. */
export const CARD_GAP = 12;
/** Kept between the card and the viewport's edge when it has to be pushed back on screen. */
const EDGE = 8;
/** How long a missing target is waited for before the card offers Next. */
export const TARGET_WAIT_MS = 2000;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** The four dim panels around a target: the viewport, minus the padded target clipped to it. A target off the screen leaves no hole. */
export function dimPanels(target: Rect, viewport: Size): Rect[] {
  const { width: W, height: H } = viewport;
  let x0 = clamp(target.left - HOLE_PAD, 0, W);
  let x1 = clamp(target.left + target.width + HOLE_PAD, 0, W);
  let y0 = clamp(target.top - HOLE_PAD, 0, H);
  let y1 = clamp(target.top + target.height + HOLE_PAD, 0, H);
  if (x1 <= x0 || y1 <= y0) {
    x0 = x1 = 0;
    y0 = y1 = H;
  }
  return [
    { top: 0, left: 0, width: W, height: y0 },
    { top: y1, left: 0, width: W, height: H - y1 },
    { top: y0, left: 0, width: x0, height: y1 - y0 },
    { top: y0, left: x1, width: W - x1, height: y1 - y0 },
  ];
}

/** Where the card goes: below the target when it fits, else above, else to its left, else to its right; failing all, the middle. Always fully on screen. */
export function cardPosition(target: Rect, card: Size, viewport: Size): { top: number; left: number } {
  const { width: W, height: H } = viewport;
  const maxLeft = Math.max(0, W - card.width - EDGE);
  const maxTop = Math.max(0, H - card.height - EDGE);
  const left = clamp(target.left, Math.min(EDGE, maxLeft), maxLeft);
  const top = clamp(target.top, Math.min(EDGE, maxTop), maxTop);
  const bottom = target.top + target.height + HOLE_PAD;
  const right = target.left + target.width + HOLE_PAD;
  const candidates = [
    { top: bottom + CARD_GAP, left },
    { top: target.top - HOLE_PAD - CARD_GAP - card.height, left },
    { top, left: target.left - HOLE_PAD - CARD_GAP - card.width },
    { top, left: right + CARD_GAP },
  ];
  const fits = (at: { top: number; left: number }) => at.top >= 0 && at.left >= 0 && at.top + card.height <= H && at.left + card.width <= W;
  return candidates.find(fits) ?? { top: Math.max(0, (H - card.height) / 2), left: Math.max(0, (W - card.width) / 2) };
}

/** How the page finds a target: the `data-tutorial` mark the components carry, or the Profile tab's own id. */
export function selectorFor(target: Exclude<Target, "centre">): string {
  return target === "tab-profile" ? "#tab-profile" : `[data-tutorial="${target}"]`;
}

/**
 * How far a scrolling column must move so a target that is not fully inside it sits at its middle; 0 when the target
 * is already fully in view. The column is scrolled itself: asking the browser to scroll the target into view would
 * also move the page.
 */
export function scrollToCentre(target: Rect, column: Rect): number {
  const inView = target.top >= column.top && target.top + target.height <= column.top + column.height;
  if (inView) return 0;
  return Math.round(target.top + target.height / 2 - (column.top + column.height / 2));
}
