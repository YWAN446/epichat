import { describe, expect, it } from "vitest";
import { loadSettings } from "@/lib/config";
import { participantStatus } from "@/lib/participant";

const settings = loadSettings({});
const user = { id: "u1", email: "student@emory.edu", email_confirmed_at: "2026-10-01T00:00:00Z" };
const enrolled = { consent_version: "2026-10-07", consented_at: "2026-10-02T00:00:00Z" };

describe("participantStatus", () => {
  it("sends a signed-out visitor to sign in", () => {
    expect(participantStatus(null, null, settings, "2026-10-07")).toBe("sign_in");
  });

  it("forbids an unconfirmed address or a domain that is not allowed", () => {
    expect(participantStatus({ ...user, email_confirmed_at: null }, enrolled, settings, "2026-10-07")).toBe("forbidden");
    expect(participantStatus({ ...user, email: "a@gmail.com" }, enrolled, settings, "2026-10-07")).toBe("forbidden");
  });

  it("asks for consent when there is no profile, no consent, or consent to an older text", () => {
    expect(participantStatus(user, null, settings, "2026-10-07")).toBe("consent");
    expect(participantStatus(user, { consent_version: null, consented_at: null }, settings, "2026-10-07")).toBe("consent");
    expect(participantStatus(user, { ...enrolled, consent_version: "2026-09-01" }, settings, "2026-10-07")).toBe("consent");
  });

  it("admits a confirmed, allowed, currently consented user", () => {
    expect(participantStatus(user, enrolled, settings, "2026-10-07")).toBe("ok");
  });
});
