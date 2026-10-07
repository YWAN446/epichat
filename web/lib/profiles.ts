import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParticipantType } from "./enums";

export type Profile = {
  userId: string;
  email: string;
  participantType: ParticipantType | null;
  consentVersion: string | null;
  consentedAt: string | null;
};

export interface ProfileStore {
  get(userId: string): Promise<Profile | null>;
  recordConsent(userId: string, email: string, participantType: ParticipantType, version: string, now: Date): Promise<void>;
  touch(userId: string, now: Date): Promise<void>;
}

type Row = {
  user_id: string;
  email: string;
  participant_type: ParticipantType | null;
  consent_version: string | null;
  consented_at: string | null;
};

export function supabaseProfileStore(admin: SupabaseClient): ProfileStore {
  return {
    async get(userId) {
      const { data, error } = await admin
        .from("profiles")
        .select("user_id, email, participant_type, consent_version, consented_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`profiles read failed: ${error.message}`);
      if (!data) return null;
      const row = data as Row;
      return {
        userId: row.user_id,
        email: row.email,
        participantType: row.participant_type,
        consentVersion: row.consent_version,
        consentedAt: row.consented_at,
      };
    },

    async recordConsent(userId, email, participantType, version, now) {
      const { error } = await admin.from("profiles").upsert(
        {
          user_id: userId,
          email,
          participant_type: participantType,
          consent_version: version,
          consented_at: now.toISOString(),
          last_seen_at: now.toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(`profiles upsert failed: ${error.message}`);
    },

    async touch(userId, now) {
      const { error } = await admin.from("profiles").update({ last_seen_at: now.toISOString() }).eq("user_id", userId);
      if (error) throw new Error(`profiles touch failed: ${error.message}`);
    },
  };
}
