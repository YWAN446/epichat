import { describe, expect, it } from "vitest";

import { isToken, newToken } from "@/lib/share/token";

describe("share tokens", () => {
  it("are 22 base64url characters, distinct, and recognised", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => newToken()));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(isToken(token)).toBe(true);
    }
    expect(isToken("")).toBe(false);
    expect(isToken("abc")).toBe(false);
    expect(isToken(`${"a".repeat(22)}b`)).toBe(false);
    expect(isToken("../../etc/passwd!!!!!!")).toBe(false);
  });
});
