import { describe, expect, it } from "vitest";
import { isResearcher, loadSettings, settingsFor } from "@/lib/config";

describe("loadSettings", () => {
  it("uses the spec's defaults when nothing is set", () => {
    expect(loadSettings({})).toEqual({
      model: "claude-opus-5-5",
      effort: "medium",
      thinkingDisplay: "summarized",
      maxOutputTokens: 16000,
      maxToolRounds: 8,
      maxPauseContinuations: 5,
      monthlyBudgetUsd: 50,
      dailyTurnsPerUser: 40,
      maxMessageChars: 6000,
      allowedEmailDomains: ["emory.edu"],
      researcherEmails: [],
      unlimitedEmails: [],
      refusalFallback: true,
      contactEmail: "",
      websiteUrl: "https://ywan446.github.io/epichat/",
      simInternalUrl: "",
      simSharedSecret: "",
      unApiKey: "",
      evalBearerToken: "",
      cronSecret: "",
    });
  });

  it("reads overrides and normalizes the lists", () => {
    const settings = loadSettings({
      CHAT_MODEL: "claude-sonnet-5-5",
      CHAT_EFFORT: "high",
      MONTHLY_BUDGET_USD: "10",
      ALLOWED_EMAIL_DOMAINS: " Emory.edu , example.org ,",
      RESEARCHER_EMAILS: " Yuke.Wang@emory.edu ",
      REFUSAL_FALLBACK: "0",
      CONTACT_EMAIL: "help@example.org",
    });
    expect(settings.model).toBe("claude-sonnet-5-5");
    expect(settings.effort).toBe("high");
    expect(settings.monthlyBudgetUsd).toBe(10);
    expect(settings.allowedEmailDomains).toEqual(["emory.edu", "example.org"]);
    expect(settings.researcherEmails).toEqual(["yuke.wang@emory.edu"]);
    expect(settings.refusalFallback).toBe(false);
    expect(settings.contactEmail).toBe("help@example.org");
  });

  it("treats an empty string as unset", () => {
    expect(loadSettings({ MONTHLY_BUDGET_USD: "" }).monthlyBudgetUsd).toBe(50);
  });

  it("rejects an unknown model or effort and a non-numeric or negative number", () => {
    expect(() => loadSettings({ CHAT_MODEL: "gpt-4" })).toThrow(/CHAT_MODEL/);
    expect(() => loadSettings({ CHAT_EFFORT: "extreme" })).toThrow(/CHAT_EFFORT/);
    expect(() => loadSettings({ MONTHLY_BUDGET_USD: "lots" })).toThrow(/MONTHLY_BUDGET_USD/);
    expect(() => loadSettings({ DAILY_TURNS_PER_USER: "-1" })).toThrow(/DAILY_TURNS_PER_USER/);
  });
});

describe("settingsFor and isResearcher", () => {
  const settings = loadSettings({
    UNLIMITED_EMAILS: "tester@emory.edu",
    RESEARCHER_EMAILS: "pi@emory.edu",
  });

  it("lifts the daily cap for the named test addresses only, never the budget", () => {
    expect(settingsFor(settings, "Tester@EMORY.edu").dailyTurnsPerUser).toBeGreaterThan(100000);
    expect(settingsFor(settings, "student@emory.edu").dailyTurnsPerUser).toBe(40);
    expect(settingsFor(settings, undefined).dailyTurnsPerUser).toBe(40);
    expect(settingsFor(settings, "tester@emory.edu").monthlyBudgetUsd).toBe(50);
  });

  it("recognizes a researcher by email, ignoring case", () => {
    expect(isResearcher(settings, "PI@emory.edu")).toBe(true);
    expect(isResearcher(settings, "student@emory.edu")).toBe(false);
    expect(isResearcher(settings, null)).toBe(false);
  });
});

describe("UN_API_KEY", () => {
  it("defaults to empty and reads the variable", () => {
    expect(loadSettings({}).unApiKey).toBe("");
    expect(loadSettings({ UN_API_KEY: "tok" }).unApiKey).toBe("tok");
  });
});
