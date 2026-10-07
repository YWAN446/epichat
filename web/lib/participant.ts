import { isAllowedEmail } from "./auth";
import type { Settings } from "./config";

export type ParticipantStatus = "sign_in" | "forbidden" | "consent" | "ok";

export type AuthUserLike = { id: string; email?: string | null; email_confirmed_at?: string | null } | null;
export type ConsentLike = { consent_version: string | null; consented_at: string | null } | null;

/**
 * Where a visitor stands. The pages redirect on anything but "ok", and the
 * API routes refuse. Consent to an older text counts as no consent.
 */
export function participantStatus(
  user: AuthUserLike,
  profile: ConsentLike,
  settings: Pick<Settings, "allowedEmailDomains">,
  currentVersion: string,
): ParticipantStatus {
  if (!user) return "sign_in";
  if (!user.email_confirmed_at || !isAllowedEmail(user.email, settings.allowedEmailDomains)) return "forbidden";
  if (!profile || !profile.consented_at || profile.consent_version !== currentVersion) return "consent";
  return "ok";
}

/**
 * Where to send a visitor who is not an enrolled participant, or null when
 * they may stay. An ineligible account (unconfirmed, or a domain that is no
 * longer allowed) is told why on the sign-in page and signed out there;
 * otherwise it would bounce between the home page and the chat forever.
 */
export function redirectFor(status: ParticipantStatus): string | null {
  if (status === "sign_in") return "/sign-in";
  if (status === "forbidden") return "/sign-in?forbidden=1";
  if (status === "consent") return "/consent";
  return null;
}
