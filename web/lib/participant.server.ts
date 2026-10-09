import { loadConsent, type ConsentText } from "./consent";
import { loadSettings, settingsFor, type Settings } from "./config";
import { apiRefusal, participantStatus, redirectFor, type ParticipantStatus } from "./participant";

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

export type Gate = { ok: true; user: { id: string; email: string }; settings: Settings } | { ok: false; response: Response };

/** The three gates every agent-core route applies, in order, answering JSON. The settings are the caller's own. */
export async function requireParticipant(): Promise<Gate> {
  const participant = await loadParticipant();
  const refusal = apiRefusal(participant.status) ?? (participant.user ? null : apiRefusal("sign_in"));
  if (refusal || !participant.user) {
    const { status, code, message } = refusal ?? apiRefusal("sign_in")!;
    return { ok: false, response: Response.json({ code, message }, { status }) };
  }
  return { ok: true, user: participant.user, settings: settingsFor(participant.settings, participant.user.email) };
}
