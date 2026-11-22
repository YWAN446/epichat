import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Welcome } from "@/components/Welcome";
import { tutorialEntry } from "@/lib/tutorial/entry";

const read = (file: string) => readFileSync(file, "utf8");
const welcome = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Welcome, { disabled: false, contactEmail: "", error: null, onPick: () => {}, ...props } as unknown as Parameters<typeof Welcome>[0], "COMPOSER"));

describe("the ways into the tutorial", () => {
  it("sends a new participant in, offers it to one with conversations, and leaves the rest alone", () => {
    expect(tutorialEntry(null, 0)).toBe("redirect");
    expect(tutorialEntry(null, 3)).toBe("offer");
    expect(tutorialEntry("2026-11-22T10:00:00Z", 0)).toBe("none");
    expect(tutorialEntry("2026-11-22T10:00:00Z", 3)).toBe("none");
  });

  it("shows the offer card on the start page only when asked to", () => {
    const withOffer = welcome({ offer: { onTake: () => {}, onDecline: () => {} } });
    for (const piece of ["New: a 3-minute practice run that shows what the Dashboard does.", ">Take the tutorial<", ">Not now<"]) expect(withOffer).toContain(piece);
    expect(withOffer.indexOf("Take the tutorial")).toBeLessThan(withOffer.indexOf("Which infectious disease scenario"));
    expect(welcome({})).not.toContain("Take the tutorial");
  });

  it("wires the first arrival, the offer and the menu item", () => {
    const page = read("app/chat/page.tsx");
    for (const piece of ["tutorialEntry(", 'redirect("/tutorial?entry=first_visit")', "tutorialOffer="]) expect(page).toContain(piece);
    expect(read("app/chat/[id]/page.tsx")).toContain("tutorialOffer={false}");
    const chat = read("components/Chat.tsx");
    for (const piece of ['router.push("/tutorial?entry=offer")', 'kind: "tutorial_offer_declined"', "offer={"]) expect(chat).toContain(piece);
    const menu = read("components/AccountMenu.tsx");
    expect(menu).toContain('href="/tutorial?entry=menu"');
    expect(menu).toMatch(/>Tutorial<\/Link>/);
    expect(menu.indexOf(">Tutorial<")).toBeLessThan(menu.indexOf(">Contact support<"));
    expect(menu.indexOf(">Profile<")).toBeLessThan(menu.indexOf(">Tutorial<"));
  });
});
