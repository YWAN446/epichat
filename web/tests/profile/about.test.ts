import { describe, expect, it } from "vitest";

import { aboutBlock, withoutKindSuffix, type Memory } from "@/lib/profile/about";
import { EMPTY_PROFILE, type ProfileFields } from "@/lib/profile/schema";

const PROFILE: ProfileFields = {
  ...EMPTY_PROFILE,
  role: "policy_maker", experience: "some", goals: ["deciding", "communicating"], diseaseInterest: "measles", countryInterest: "KEN",
  decisions: "vaccination campaigns", resultsPref: "summary", reportFormat: "pdf", completedAt: "2026-10-09T10:00:00Z",
};
const MEMORIES: Memory[] = [
  { id: "m2", kind: "preference", text: "Asked for results as tables last time", source: "participant", createdAt: "2026-10-09T10:00:00Z" },
  { id: "m1", kind: "situation", text: "Works at a county health office", source: "agent", createdAt: "2026-10-08T10:00:00Z" },
];

describe("aboutBlock", () => {
  it("writes the profile and the memory in the spec's lines, oldest memory first", () => {
    expect(aboutBlock(PROFILE, MEMORIES)).toBe(
      [
        "About this participant (from their profile and your memory; pitch the detail and the framing by it; do not repeat it back; do not ask for what it already says):",
        "- Role: policy maker · Experience with epidemic models: some · Wants: making decisions, communicating to others",
        "- Interest: measles in Kenya · Decisions they can influence: vaccination campaigns",
        "- Prefers: plain-language summary · Report format: PDF",
        "- Remembered: Works at a county health office (situation) · Asked for results as tables last time (preference)",
      ].join("\n"),
    );
  });

  it("leaves out empty lines, writes a disease without a country, a country without a disease, and unknown disease text as typed", () => {
    const text = aboutBlock({ ...PROFILE, diseaseInterest: null, countryInterest: null, decisions: null }, []);
    expect(text).not.toContain("- Interest");
    expect(text).not.toContain("- Remembered");
    expect(text).toContain("- Prefers: plain-language summary · Report format: PDF");
    expect(aboutBlock({ ...PROFILE, countryInterest: null }, [])).toContain("- Interest: measles · Decisions");
    expect(aboutBlock({ ...PROFILE, diseaseInterest: null }, [])).toContain("- Interest: Kenya · Decisions");
    expect(aboutBlock({ ...PROFILE, diseaseInterest: "Unicorn pox" }, [])).toContain("- Interest: Unicorn pox in Kenya");
    expect(aboutBlock({ ...PROFILE, experience: "a_lot", goals: ["learning"], resultsPref: "all", reportFormat: "docx" }, [])).toContain(
      "- Role: policy maker · Experience with epidemic models: a lot · Wants: learning\n- Interest: measles in Kenya · Decisions they can influence: vaccination campaigns\n- Prefers: all of them · Report format: Word",
    );
  });

  it("is null for an incomplete profile and has no Remembered line with memory off", () => {
    expect(aboutBlock(EMPTY_PROFILE, MEMORIES)).toBeNull();
    expect(aboutBlock({ ...PROFILE, completedAt: null }, MEMORIES)).toBeNull();
    expect(aboutBlock({ ...PROFILE, memoryEnabled: false }, MEMORIES)).not.toContain("Remembered");
  });

  it("strips the (kind) suffix the Remembered line appends, and nothing else", () => {
    expect(withoutKindSuffix("Works at a county health office (situation)")).toBe("Works at a county health office");
    expect(withoutKindSuffix("Prefers tables")).toBe("Prefers tables");
    expect(withoutKindSuffix("Likes (parentheses) (other)")).toBe("Likes (parentheses)");
    expect(withoutKindSuffix("Not a kind (wizard)")).toBe("Not a kind (wizard)");
    expect(withoutKindSuffix("  Prefers tables (preference)  ")).toBe("Prefers tables");
  });

  it("lists thirty memories on one line", () => {
    const many: Memory[] = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, kind: "other", text: `Fact ${i}`, source: "agent", createdAt: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T00:00:${String(i).padStart(2, "0")}Z` }));
    const line = aboutBlock(PROFILE, many)?.split("\n").at(-1) ?? "";
    expect(line.startsWith("- Remembered: ")).toBe(true);
    expect(line.match(/\(other\)/g)).toHaveLength(30);
  });
});
