"use client";

import { useEffect, useRef, useState } from "react";
import { CARD_WIDTH, TARGET_WAIT_MS, cardPosition, dimPanels, scrollToCentre, selectorFor, type Rect } from "@/lib/tutorial/spotlight";
import type { Target } from "@/lib/tutorial/steps";
import { StepCard, type StepCardProps } from "./StepCard";

type Props = {
  target: Target;
  card: StepCardProps;
  /** Offered on the card when the target cannot be found, so nobody is stuck. */
  onMissing: () => void;
};

type Measured = { rect: Rect | null; missing: boolean; viewport: { width: number; height: number }; card: { width: number; height: number } };

const DIM = "fixed z-40 bg-ink/45";
/** How often the target is measured: it moves when a section opens, a turn appears, or the window changes. */
const MEASURE_MS = 200;
const RESCROLL_MS = 1000;
const START: Measured = { rect: null, missing: false, viewport: { width: 0, height: 0 }, card: { width: CARD_WIDTH, height: 200 } };

const sameRect = (a: Rect | null, b: Rect | null) => a === b || (a !== null && b !== null && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);
const same = (a: Measured, b: Measured) =>
  sameRect(a.rect, b.rect) && a.missing === b.missing && a.viewport.width === b.viewport.width && a.viewport.height === b.viewport.height && a.card.width === b.card.width && a.card.height === b.card.height;

/** The nearest ancestor that scrolls up and down: the conversation column or the Dashboard. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const overflow = window.getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * The tutorial's dimming: everything but the target is covered by four panels that swallow presses; the target shows
 * through the hole and stays pressable. A "centre" card dims the whole screen. The target is scrolled into view, and
 * after two seconds without one the card offers Next. Mount it with a key per card, so each card starts its own search.
 */
export function Spotlight({ target, card, onMissing }: Props) {
  const [measured, setMeasured] = useState<Measured>(START);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const started = Date.now();
    let scrolledAt = 0;
    const measure = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const cardBox = cardRef.current;
      const size = cardBox ? { width: cardBox.offsetWidth, height: cardBox.offsetHeight } : START.card;
      let rect: Rect | null = null;
      let missing = false;
      if (target !== "centre") {
        const element = document.querySelector<HTMLElement>(selectorFor(target));
        const box = element?.getBoundingClientRect();
        if (!element || !box || (box.width === 0 && box.height === 0)) missing = Date.now() - started >= TARGET_WAIT_MS;
        else {
          // Brought back into view whenever it leaves it (an answer can push it away), at most once a second.
          // Only its own column is scrolled; the page itself must stay where it is.
          const column = scrollParent(element);
          if (column && Date.now() - scrolledAt > RESCROLL_MS) {
            const frame = column.getBoundingClientRect();
            const delta = scrollToCentre({ top: box.top, left: box.left, width: box.width, height: box.height }, { top: frame.top, left: frame.left, width: frame.width, height: frame.height });
            if (delta !== 0) {
              scrolledAt = Date.now();
              column.scrollTop += delta;
            }
          }
          if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
          rect = { top: box.top, left: box.left, width: box.width, height: box.height };
        }
      }
      const next: Measured = { rect, missing, viewport, card: size };
      setMeasured((old) => (same(old, next) ? old : next));
    };
    const first = window.requestAnimationFrame(measure);
    const timer = window.setInterval(measure, MEASURE_MS);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    // A new card takes the focus, so a keyboard or screen-reader user hears it.
    cardRef.current?.focus({ preventScroll: true });
    return () => {
      window.cancelAnimationFrame(first);
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [target]);

  const { rect, missing, viewport, card: size } = measured;
  const whole: Rect = { top: 0, left: 0, width: viewport.width, height: viewport.height };
  const panels = rect === null ? [whole] : dimPanels(rect, viewport);
  const at = rect === null ? { top: Math.max(0, (viewport.height - size.height) / 2), left: Math.max(0, (viewport.width - size.width) / 2) } : cardPosition(rect, size, viewport);
  const shown: StepCardProps = missing && !card.primary ? { ...card, primary: { label: "Next", onPress: onMissing } } : card;

  return (
    <>
      {panels.map((panel, index) => (
        <div key={index} aria-hidden="true" className={DIM} style={{ top: panel.top, left: panel.left, width: panel.width, height: panel.height }} />
      ))}
      {/* Out of sight until the first measurement, so the card never flashes at the corner. */}
      <StepCard {...shown} cardRef={cardRef} style={{ top: at.top, left: at.left, visibility: viewport.width === 0 ? "hidden" : "visible" }} />
    </>
  );
}
