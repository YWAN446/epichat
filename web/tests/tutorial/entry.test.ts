import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Welcome } from "@/components/Welcome";
import { tutorialEntry } from "@/lib/tutorial/entry";
import { tutorialStartedBefore } from "@/lib/tutorial/seen";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const read = (file: string) => readFileSync(file, "utf8");
const welcome = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Welcome, { disabled: false, contactEmail: "", error: null, onPick: () => {}, ...props } as unknown as Parameters<typeof Welcome>[0], "COMPOSER"));

describe("the ways into the tutorial", () => {
  it("sends a new participant in, offers it to one with conversations, and leaves the rest alone", () => {
    expect(tutorialEntry(null, 0)).toBe("redirect");
    expect(tutorialEntry(null, 3)).toBe("offer");
    expect(tutorialEntry("2026-11-22T10:00:00Z", 0)).toBe("none");
    expect(tutorialEntry("2026-11-22T10:00:00Z", 3)).toBe("none");
  });

  it("never sends a newcomer in when they have just left it, or when the recording cannot be played (final review 1, 2)", () => {
    expect(tutorialEntry(null, 0, { fromTutorial: true })).toBe("none");
    expect(tutorialEntry(null, 0, { playable: false })).toBe("none");
    expect(tutorialEntry(null, 0, { fromTutorial: false, playable: true })).toBe("redirect");
    expect(tutorialEntry(null, 3, { fromTutorial: true })).toBe("none");
    expect(tutorialEntry(null, 3, { playable: false })).toBe("none");
    const page = read("app/chat/page.tsx");
    for (const piece of ["searchParams", 'from === "tutorial"', "loadRecording()"]) expect(page).toContain(piece);
    const tutorial = read("app/tutorial/page.tsx");
    for (const piece of ["markTutorialSeen(", "tutorialStartedBefore("]) expect(tutorial).toContain(piece);
    expect(tutorial.indexOf("markTutorialSeen(")).toBeLessThan(tutorial.indexOf("<TutorialWorkspace"));
    expect(read("components/tutorial/TutorialWorkspace.tsx")).toContain('router.push("/chat?from=tutorial")');
  });

  it("knows a replay by an earlier start, not by a declined offer (final review 3)", async () => {
    const counted = (count: number | null, error: { message: string } | null = null) => fakeAdmin({ step_events: [{ count, error }] });
    const yes = counted(2);
    expect(await tutorialStartedBefore(yes.client, "u1")).toBe(true);
    expect(callOn(yes.recorded, "step_events", "eq")).toEqual(["user_id", "u1"]);
    expect(yes.recorded[0].calls.filter(([m]) => m === "eq").map(([, args]) => args)).toContainEqual(["kind", "tutorial_started"]);
    expect(await tutorialStartedBefore(counted(0).client, "u1")).toBe(false);
    expect(await tutorialStartedBefore(counted(null, { message: "down" }).client, "u1")).toBe(false);
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
