import { describe, expect, it } from "vitest";
import { isAllowedEmail, normalizeEmail } from "@/lib/auth";

describe("isAllowedEmail", () => {
  const domains = ["emory.edu", "example.org"];

  it("accepts an allowed domain whatever the case or surrounding spaces", () => {
    expect(isAllowedEmail(" Student@Emory.EDU ", domains)).toBe(true);
    expect(isAllowedEmail("a@example.org", domains)).toBe(true);
  });

  it("rejects other domains, subdomains, lookalikes, and empty values", () => {
    expect(isAllowedEmail("a@gmail.com", domains)).toBe(false);
    expect(isAllowedEmail("a@mail.emory.edu", domains)).toBe(false);
    expect(isAllowedEmail("a@emory.edu.evil.com", domains)).toBe(false);
    expect(isAllowedEmail("emory.edu", domains)).toBe(false);
    expect(isAllowedEmail("", domains)).toBe(false);
    expect(isAllowedEmail(null, domains)).toBe(false);
    expect(isAllowedEmail(undefined, domains)).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail(" Student@Emory.EDU ")).toBe("student@emory.edu");
  });
});
