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
