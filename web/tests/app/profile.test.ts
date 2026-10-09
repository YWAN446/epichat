import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("the profile page", () => {
  it("decides from loadParticipant, sends the unconsented to consent and the signed-out to sign in, and renders the questionnaire", () => {
    const page = read("app/profile/page.tsx");
    for (const piece of ["loadParticipant()", 'export const dynamic = "force-dynamic"', 'redirect("/consent")', 'redirect("/sign-in")', "<ProfileSetup", "prefillRole(", "diseaseOptions()"]) {
      expect(page).toContain(piece);
    }
  });

  it("asks the questionnaire, resolves the country to its code, posts to the setup route, and opens the chat", () => {
    const form = read("components/ProfileSetup.tsx");
    for (const piece of ["Tell us about yourself", 'fetch("/api/profile/setup"', 'router.replace("/chat")', "<datalist", "countryIso3For(", '"Could not save. Please try again."', "Pick a country from the list", "required"]) {
      expect(form).toContain(piece);
    }
  });

  it("hands a consenting participant to the profile page, and the consent page sends an unprofiled one there", () => {
    const consentForm = read("components/ConsentForm.tsx");
    expect(consentForm).toContain('"/profile"');
    expect(consentForm).not.toContain('? "/chat"');
    expect(read("app/consent/page.tsx")).toContain('redirect("/profile")');
  });

  it("ships the consent text with the new page and routes", () => {
    const config = read("next.config.ts");
    for (const route of ['"/profile"', '"/api/profile"', '"/api/profile/setup"', '"/api/memories"', '"/api/memories/[id]"']) expect(config).toContain(route);
  });
});

describe("the Profile tab", () => {
  it("is a real tab list beside Details, with the arrow keys moving the selection", () => {
    const tabs = read("components/panel/PanelTabs.tsx");
    for (const piece of ['role="tablist"', 'role="tab"', "aria-selected", 'role="tabpanel"', "aria-controls", '"ArrowRight"', '"ArrowLeft"', ">Details<", ">Profile<"]) expect(tabs).toContain(piece);
  });

  it("keeps both panels mounted, so a half-edited profile and the Details sections survive a tab switch", () => {
    const tabs = read("components/panel/PanelTabs.tsx");
    expect(tabs).toContain('hidden={tab !== "details"}');
    expect(tabs).toContain('hidden={tab !== "profile"}');
    expect(tabs).not.toContain('tab === "details" ? details : profile');
  });

  it("shows the profile, the preferences, and the memory as three sections with the spec's words", () => {
    const panel = read("components/panel/ProfilePanel.tsx");
    for (const piece of [
      'title="Profile"', 'title="Preferences"', 'title="Memory"',
      "Changes reach the assistant from your next conversation.",
      "Remember things about me across conversations",
      "Nothing remembered yet. The assistant adds what you tell it about your role, your situation, and your preferences; you can add your own.",
      "Forget everything", "Memory could not be loaded.", "Retry", "Could not save. Please try again.",
      "loadMemories(", "patchProfile(", "addMemory(", "updateMemory(", "removeMemory(", "forgetAll(", "memoryAddedLine(", "memoryWrites",
      "<datalist", "countryIso3For(", 'role="switch"', "onSectionOpen(",
    ]) {
      expect(panel).toContain(piece);
    }
    expect(panel).not.toContain("window.confirm");
  });

  it("is wired into the chat: the tabs in the right column, the preferred download first, and a lapsed profile sent to the page", () => {
    const chat = read("components/Chat.tsx");
    for (const piece of ["<PanelTabs", "<ProfilePanel", '"profile_required"', 'router.replace("/profile")', 'onSectionOpen("profile")', "memoryWrites={artifacts.memoryWrites}", "preferredFormat={profile.reportFormat}", "initialProfile"]) {
      expect(chat).toContain(piece);
    }
    const details = read("components/panel/DetailsPanel.tsx");
    expect(details).toContain("preferredFormat");
    expect(details).not.toContain(">Details</h2>");
    expect(read("components/panel/ReportSection.tsx")).toContain("orderFormats(");
    expect(read("components/Welcome.tsx")).toContain("Profile tab");
    for (const page of ["app/chat/page.tsx", "app/chat/[id]/page.tsx"]) {
      const source = read(page);
      expect(source).toContain("initialProfile=");
      expect(source).toContain("diseases={diseaseOptions()}");
    }
  });
});

describe("consent and deployment (profile)", () => {
  it("tells participants, in the spec's words, that their answers and the assistant's memory are collected, under a new version", () => {
    const consent = read("content/consent.md");
    expect(consent).toContain("version: 2026-10-10");
    expect(consent.replace(/\s+/g, " ")).toContain("Your answers to the profile questions and what the assistant remembers about you, which you can see and edit.");
  });

  it("documents the migration, the routes, and the verification steps", () => {
    const doc = read("docs/DEPLOY.md");
    for (const phrase of ["0006_profile_memory.sql", "## 6g. Profile verification", "/api/profile", "/api/memories", "profile_completed", "memory_added", "memory_toggled", "version: 2026-10-10", "Tell us about yourself", "seq = 1"]) {
      expect(doc).toContain(phrase);
    }
  });
});
