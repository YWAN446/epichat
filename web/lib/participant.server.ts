import { loadConsent, type ConsentText } from "./consent";
import { loadSettings, type Settings } from "./config";
import { participantStatus, redirectFor, type ParticipantStatus } from "./participant";

export { redirectFor };
import { supabaseProfileStore, type Profile } from "./profiles";
import { adminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";

export type Participant = {
  status: ParticipantStatus;
  user: { id: string; email: string } | null;
  profile: Profile | null;
  settings: Settings;
  consent: ConsentText;
};

/** Everything a page needs to decide whether to render or redirect. Server only. */
export async function loadParticipant(): Promise<Participant> {
  const settings = loadSettings();
  const consent = await loadConsent();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // A profile that cannot be read is treated as missing: the user is asked to consent again.
  const profile = user ? await supabaseProfileStore(adminClient()).get(user.id).catch(() => null) : null;
  const status = participantStatus(
    user,
    profile ? { consent_version: profile.consentVersion, consented_at: profile.consentedAt } : null,
    settings,
    consent.version,
  );
  return { status, user: user ? { id: user.id, email: user.email ?? "" } : null, profile, settings, consent };
}
