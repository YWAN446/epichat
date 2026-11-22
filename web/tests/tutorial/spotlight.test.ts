import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StepCard } from "@/components/tutorial/StepCard";
import { CARD_GAP, CARD_WIDTH, HOLE_PAD, TARGET_WAIT_MS, cardPosition, dimPanels, scrollToCentre, selectorFor } from "@/lib/tutorial/spotlight";

const VIEW = { width: 1280, height: 720 };
const inside = (rect: { top: number; left: number; width: number; height: number }, view = VIEW) => rect.left >= 0 && rect.top >= 0 && rect.left + rect.width <= view.width && rect.top + rect.height <= view.height;

describe("the spotlight's geometry", () => {
  it("dims everything but the padded target", () => {
    const panels = dimPanels({ top: 100, left: 900, width: 200, height: 40 }, VIEW);
    expect(panels).toHaveLength(4);
    const area = panels.reduce((sum, p) => sum + p.width * p.height, 0);
    expect(area).toBe(1280 * 720 - (200 + 2 * HOLE_PAD) * (40 + 2 * HOLE_PAD));
    for (const p of panels) expect(p.width >= 0 && p.height >= 0 && inside(p)).toBe(true);
  });

  it("clips the hole at the viewport's edge, and dims the whole screen for a target that is off it", () => {
    for (const p of dimPanels({ top: -4, left: 1270, width: 40, height: 40 }, VIEW)) expect(p.width >= 0 && p.height >= 0 && inside(p)).toBe(true);
    const off = dimPanels({ top: 2000, left: 100, width: 40, height: 40 }, VIEW);
    expect(off.reduce((sum, p) => sum + p.width * p.height, 0)).toBe(1280 * 720);
  });

  it("keeps the card on screen: below the target, else above, else beside", () => {
    const card = { width: CARD_WIDTH, height: 180 };
    expect(cardPosition({ top: 100, left: 400, width: 200, height: 40 }, card, VIEW).top).toBe(100 + 40 + HOLE_PAD + CARD_GAP);
    expect(cardPosition({ top: 660, left: 400, width: 200, height: 40 }, card, VIEW).top).toBe(660 - HOLE_PAD - CARD_GAP - 180);
    const tall = cardPosition({ top: 60, left: 900, width: 380, height: 640 }, card, VIEW); // a whole Dashboard section: the card goes beside it
    expect(tall.left + CARD_WIDTH).toBeLessThanOrEqual(900 - HOLE_PAD);
    for (const target of [{ top: 0, left: 0, width: 1280, height: 720 }, { top: 300, left: 1270, width: 10, height: 10 }, { top: 700, left: -50, width: 30, height: 30 }, { top: 2000, left: 100, width: 40, height: 40 }]) {
      expect(inside({ ...cardPosition(target, card, VIEW), ...card })).toBe(true);
    }
    const phone = { width: 360, height: 640 };
    expect(inside({ ...cardPosition({ top: 100, left: 100, width: 50, height: 30 }, card, phone), ...card }, phone)).toBe(true);
  });

  it("does not cover its own target when there is room", () => {
    const card = { width: CARD_WIDTH, height: 180 };
    const target = { top: 300, left: 500, width: 200, height: 40 };
    const at = cardPosition(target, card, VIEW);
    const overlaps = at.left < target.left + target.width && at.left + card.width > target.left && at.top < target.top + target.height && at.top + card.height > target.top;
    expect(overlaps).toBe(false);
  });

  it("brings a hidden target to the middle of its own scrolling column, and never scrolls the page (preview check)", () => {
    const column = { top: 60, left: 900, width: 380, height: 640 };
    expect(scrollToCentre({ top: 900, left: 910, width: 360, height: 40 }, column)).toBe(900 + 20 - (60 + 320));
    expect(scrollToCentre({ top: -200, left: 910, width: 360, height: 40 }, column)).toBe(-200 + 20 - 380);
    expect(scrollToCentre({ top: 100, left: 910, width: 360, height: 40 }, column)).toBe(0); // already in view: stay put
    expect(scrollToCentre({ top: 680, left: 910, width: 360, height: 40 }, column)).not.toBe(0); // cut off at the bottom edge
    expect(readFileSync("components/tutorial/Spotlight.tsx", "utf8")).not.toContain("scrollIntoView");
  });

  it("finds targets by attribute, and the Profile tab by its id", () => {
    expect(selectorFor("panel-data")).toBe('[data-tutorial="panel-data"]');
    expect(selectorFor("reply")).toBe('[data-tutorial="reply"]');
    expect(selectorFor("dashboard-button")).toBe('[data-tutorial="dashboard-button"]');
    expect(selectorFor("tab-profile")).toBe("#tab-profile");
    expect(selectorFor("practice-report")).toBe('[data-tutorial="practice-report"]');
    expect(TARGET_WAIT_MS).toBe(2000);
  });
});

describe("the step card", () => {
  it("names the step and always offers a way out", () => {
    const html = renderToStaticMarkup(createElement(StepCard, { step: 5, text: "Switch the chart.", onSkip: () => {}, onEnd: () => {} }));
    for (const piece of ['role="dialog"', 'aria-label="Tutorial"', 'aria-live="polite"', "Step 5 of 10", "Switch the chart.", "Skip step", "End tutorial"]) expect(html).toContain(piece);
  });

  it("has no step count or Skip step on the first and last cards, and shows their main button", () => {
    const first = renderToStaticMarkup(createElement(StepCard, { step: 0, text: "A 3-minute practice run.", onEnd: () => {}, endLabel: "Skip the tutorial", primary: { label: "Start", onPress: () => {} } }));
    expect(first).not.toContain("Step 0 of 10");
    expect(first).not.toContain("Skip step");
    for (const piece of [">Start<", "Skip the tutorial"]) expect(first).toContain(piece);
    const stuck = renderToStaticMarkup(createElement(StepCard, { step: 3, text: "Open Data.", onSkip: () => {}, onEnd: () => {}, primary: { label: "Next", onPress: () => {} } }));
    for (const piece of [">Next<", "Skip step", "End tutorial", "Step 3 of 10"]) expect(stuck).toContain(piece);
  });
});
