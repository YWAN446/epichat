import { describe, expect, it } from "vitest";

import { EMPTY_PROFILE, ProfilePatch, SetupInput, diseaseKeyOrText, isCountry, prefillRole } from "@/lib/profile/schema";

describe("the questionnaire", () => {
  it("requires a role, an experience level, and at least one goal; the rest is optional", () => {
    expect(SetupInput.safeParse({ role: "policy_maker", experience: "some", goals: ["deciding", "communicating"] }).success).toBe(true);
    expect(SetupInput.safeParse({ role: "policy_maker", experience: "some", goals: [] }).success).toBe(false);
    expect(SetupInput.safeParse({ experience: "some", goals: ["learning"] }).success).toBe(false);
    expect(SetupInput.safeParse({ role: "wizard", experience: "some", goals: ["learning"] }).success).toBe(false);
    const full = SetupInput.safeParse({
      role: "student", experience: "none", goals: ["learning"], diseaseInterest: "Measles", countryInterest: "KEN", decisions: "none yet", resultsPref: "charts", reportFormat: "docx",
    });
    expect(full.success).toBe(true);
    expect(full.success && full.data).toMatchObject({ diseaseInterest: "Measles", countryInterest: "KEN", decisions: "none yet", resultsPref: "charts", reportFormat: "docx" });
  });

  it("limits the free text, blanks an empty line, and refuses an unknown country while keeping unknown disease text", () => {
    expect(SetupInput.safeParse({ role: "student", experience: "none", goals: ["learning"], decisions: "x".repeat(201) }).success).toBe(false);
    expect(SetupInput.safeParse({ role: "student", experience: "none", goals: ["learning"], diseaseInterest: "x".repeat(61) }).success).toBe(false);
    expect(SetupInput.safeParse({ role: "student", experience: "none", goals: ["learning"], countryInterest: "XXX" }).success).toBe(false);
    const blank = SetupInput.safeParse({ role: "student", experience: "none", goals: ["learning"], decisions: "   ", diseaseInterest: "" });
    expect(blank.success && blank.data).toMatchObject({ decisions: null, diseaseInterest: null });
    expect(isCountry("KEN")).toBe(true);
    expect(isCountry("ken")).toBe(false);
    expect(diseaseKeyOrText("Measles")).toBe("measles");
    expect(diseaseKeyOrText("measles")).toBe("measles");
    expect(diseaseKeyOrText("  Unicorn pox ")).toBe("Unicorn pox");
  });

  it("patches any field alone and pre-fills the role from the study category", () => {
    expect(ProfilePatch.safeParse({ memoryEnabled: false }).success).toBe(true);
    expect(ProfilePatch.safeParse({ goals: ["exploring"] }).success).toBe(true);
    expect(ProfilePatch.safeParse({ goals: [] }).success).toBe(false);
    expect(ProfilePatch.safeParse({ resultsPref: "loud" }).success).toBe(false);
    expect(ProfilePatch.safeParse({ countryInterest: null }).success).toBe(true);
    expect(ProfilePatch.safeParse({ extra: 1 }).success).toBe(false);
    expect(prefillRole("graduate_student")).toBe("student");
    expect(prefillRole("public_health_practitioner")).toBe("public_health_practitioner");
    expect(prefillRole("faculty_or_researcher")).toBeNull();
    expect(prefillRole(null)).toBeNull();
    expect(EMPTY_PROFILE).toEqual({
      role: null, experience: null, goals: [], diseaseInterest: null, countryInterest: null, decisions: null, resultsPref: "all", reportFormat: "pdf", memoryEnabled: true, completedAt: null,
    });
  });
});
