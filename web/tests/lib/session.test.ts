import { describe, expect, it } from "vitest";
import { PROTECTED_PREFIXES, needsSignIn } from "@/lib/supabase/session";

describe("which pages need a signed-in user", () => {
  it("protects the chat, consent, admin, and profile pages and nothing else", () => {
    expect(PROTECTED_PREFIXES).toEqual(["/chat", "/consent", "/admin", "/profile"]);
    expect(needsSignIn("/profile")).toBe(true);
    expect(needsSignIn("/chat")).toBe(true);
    expect(needsSignIn("/chat/abc")).toBe(true);
    expect(needsSignIn("/consent")).toBe(true);
    expect(needsSignIn("/admin")).toBe(true);
    expect(needsSignIn("/sign-in")).toBe(false);
    expect(needsSignIn("/")).toBe(false);
    expect(needsSignIn("/chatter")).toBe(false);
  });
});
