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
