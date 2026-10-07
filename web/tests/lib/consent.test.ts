import { describe, expect, it } from "vitest";
import { loadConsent, parseConsent, withContact } from "@/lib/consent";

describe("parseConsent", () => {
  it("reads the version from the front matter and returns the body", () => {
    const parsed = parseConsent("---\nversion: 2026-10-07\n---\n\n# Title\n\nBody.\n");
    expect(parsed).toEqual({ version: "2026-10-07", markdown: "# Title\n\nBody." });
  });

  it("refuses a file without a version, so a bad edit cannot silently re-enroll nobody", () => {
    expect(() => parseConsent("# Title\n\nBody.")).toThrow(/version/);
    expect(() => parseConsent("---\nversion:\n---\nBody")).toThrow(/version/);
  });
});

describe("withContact", () => {
  it("substitutes the contact address, or a plain phrase when there is none", () => {
    expect(withContact("write to {{contact_email}}.", "pi@emory.edu")).toBe("write to pi@emory.edu.");
    expect(withContact("write to {{contact_email}}.", "")).toBe("write to the research team.");
  });
});

describe("the consent file", () => {
  it("has a dated version and names what the spec says is collected", async () => {
    const consent = await loadConsent();
    expect(consent.version).toMatch(/^\d{4}-\d{2}-\d{2}/);
    const text = consent.markdown;
    for (const phrase of ["email address", "conversations", "summarized reasoning", "feedback", "browser", "Anthropic", "{{contact_email}}", "cannot use EpiChat"]) {
      expect(text).toContain(phrase);
    }
  });
});
