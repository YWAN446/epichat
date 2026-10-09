import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("the header", () => {
  it("keeps the conversations toggle, the brand, Share, and a Dashboard toggle; New, the email, and Sign out have left it", () => {
    const header = read("components/ChatHeader.tsx");
    for (const piece of ['aria-label="Conversations"', 'aria-label="Dashboard"', ">Dashboard<", ">Share<", "aria-expanded", "unseen"]) expect(header).toContain(piece);
    for (const piece of [">New<", "onNew", "Sign out", "signOut", "{email}", 'aria-label="Details"']) expect(header).not.toContain(piece);
    expect(header).not.toContain("xl:hidden");
  });

  it("names the right column Dashboard everywhere the shell labels it", () => {
    const shell = read("components/WorkspaceShell.tsx");
    expect(shell).toContain('aria-label="Dashboard"');
    expect(shell).not.toContain('aria-label="Details"');
    expect(shell).toContain("Resize the dashboard column");
  });
});

describe("the account menu", () => {
  it("sits at the bottom of the left column as the email behind an avatar, opening a real menu", () => {
    const menu = read("components/AccountMenu.tsx");
    for (const piece of ['aria-haspopup="menu"', "aria-expanded", 'role="menu"', 'role="menuitem"', "initialOf(", "{email}", '"Escape"', '"ArrowDown"', '"ArrowUp"', '"Home"', '"End"']) {
      expect(menu).toContain(piece);
    }
  });

  it("closes on Escape without closing the drawer around it, and hands focus back to its toggle", () => {
    const menu = read("components/AccountMenu.tsx");
    // Escape: the innermost popup only. The shell's own Escape listener sits on window; the menu's on document stops the key there.
    const escape = /if \(event\.key === "Escape"\) \{[\s\S]*?\n    \}/.exec(menu)?.[0] ?? "";
    expect(escape).toContain("event.stopPropagation()");
    // The toggle keeps a ref, and closing by key or by a button item returns focus to it; a navigation link does not.
    expect(menu).toContain("toggle.current?.focus()");
    expect(menu).toContain("ref={toggle}");
  });

  it("offers Profile, Contact support, Consent form, Homepage, and Sign out, each going where it says", () => {
    const menu = read("components/AccountMenu.tsx");
    for (const piece of [">Profile<", ">Contact support<", ">Consent form<", ">Homepage<", ">Sign out<", "onProfile", "mailto:${contactEmail}", 'href="/consent"', "href={websiteUrl}", 'target="_blank"', 'rel="noreferrer"', "auth.signOut()", 'router.replace("/sign-in")']) {
      expect(menu).toContain(piece);
    }
    // No address configured, no dead mailto.
    expect(menu).toContain("contactEmail &&");
  });

  it("is wired under the conversation list, and Profile opens the Dashboard's Profile tab, showing the column when it is collapsed", () => {
    const chat = read("components/Chat.tsx");
    for (const piece of ["<AccountMenu", "onProfile={openProfile}", "function openProfile(", 'setTab("profile")', "websiteUrl", "onDashboard={onDashboard}", "dashboardOpen={panelVisible}"]) expect(chat).toContain(piece);
    const open = /function openProfile\(\) \{[\s\S]*?\n  \}/.exec(chat)?.[0] ?? "";
    for (const piece of ['layoutStore.toggle("right")', "setSheet(true)", "panelOpened()", 'onSectionOpen("profile")']) expect(open).toContain(piece);
    for (const page of ["app/chat/page.tsx", "app/chat/[id]/page.tsx"]) expect(read(page)).toContain("websiteUrl={participant.settings.websiteUrl}");
  });

  it("shows a consented participant the consent text read-only, with the date they agreed and a way back", () => {
    const page = read("app/consent/page.tsx");
    for (const piece of ['participant.status === "ok"', "You agreed to this text on", "consentedAt", 'href="/chat"', "Back to the chat", "<ConsentForm", 'redirect("/profile")', "<ConsentText"]) expect(page).toContain(piece);
    expect(page).not.toContain('redirect("/chat")');
    const text = read("components/ConsentText.tsx");
    for (const piece of ["<ReactMarkdown", "remarkGfm", "prose-epichat"]) expect(text).toContain(piece);
    const form = read("components/ConsentForm.tsx");
    expect(form).toContain("<ConsentText");
  });

  it("writes the avatar's letter from the email", async () => {
    const { initialOf } = await import("@/lib/client/account");
    expect(initialOf("yuke@emory.edu")).toBe("Y");
    expect(initialOf("  ")).toBe("?");
    expect(initialOf("")).toBe("?");
  });
});
