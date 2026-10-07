import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("protected pages", () => {
  for (const page of ["app/chat/page.tsx", "app/admin/page.tsx", "app/consent/page.tsx"]) {
    it(`${page} decides from loadParticipant and is never static`, () => {
      const source = readFileSync(page, "utf8");
      expect(source).toContain("loadParticipant()");
      expect(source).toContain('export const dynamic = "force-dynamic"');
    });
  }

  it("the chat and admin pages redirect anyone who is not an enrolled participant", () => {
    for (const page of ["app/chat/page.tsx", "app/admin/page.tsx"]) {
      expect(readFileSync(page, "utf8")).toContain("redirectFor(participant.status)");
    }
  });

  it("the admin page is for researchers only", () => {
    const source = readFileSync("app/admin/page.tsx", "utf8");
    expect(source).toContain("isResearcher(");
    expect(source).toContain("notFound()");
  });

  it("the home page sends a signed-in user to the chat and everyone else to sign in", () => {
    const source = readFileSync("app/page.tsx", "utf8");
    expect(source).toContain('redirect(user ? "/chat" : "/sign-in")');
  });

  it("the chat shell opens a session and explains that the assistant is not connected yet", () => {
    expect(readFileSync("app/chat/page.tsx", "utf8")).toContain("<SessionProvider>");
    expect(readFileSync("components/ChatShell.tsx", "utf8")).toContain("disabled");
  });
});
