import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sign-in by emailed code only", () => {
  const form = readFileSync("components/SignInForm.tsx", "utf8");
  const page = readFileSync("app/sign-in/page.tsx", "utf8");

  it("asks for the eight-digit code and offers no sign-in link", () => {
    expect(form).toContain("eight-digit code");
    expect(form).toContain('type: "email"');
    expect(form).not.toMatch(/emailRedirectTo|magic link|six-digit/i);
  });

  it("has no page for a sign-in link to land on", () => {
    expect(existsSync("app/auth/confirm/route.ts")).toBe(false);
  });

  it("checks the domain in the form and goes to the chat after sign-in", () => {
    expect(form).toContain("isAllowedEmail(");
    expect(form).toContain('router.replace("/chat")');
  });

  it("tells a visitor who declined consent how to reach the team, and points to the study description", () => {
    expect(page).toContain("declined");
    expect(page).toContain("settings.contactEmail");
    expect(page).toContain("usability study");
  });
});
