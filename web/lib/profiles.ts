import type { SupabaseClient } from "@supabase/supabase-js";
import type { Experience, ExportFormat, Goal, ParticipantType, ResultsPref, Role } from "./enums";
import { EMPTY_PROFILE, type ProfileFields, type ProfilePatchArgs, type SetupArgs } from "./profile/schema";

export type Profile = {
  userId: string;
  email: string;
  participantType: ParticipantType | null;
  consentVersion: string | null;
  consentedAt: string | null;
  /** The questionnaire and the preferences (profile spec, section 4); defaults until saved. */
  fields: ProfileFields;
};

export interface ProfileStore {
  get(userId: string): Promise<Profile | null>;
  recordConsent(userId: string, email: string, participantType: ParticipantType, version: string, now: Date): Promise<void>;
  touch(userId: string, now: Date): Promise<void>;
  /** Save the questionnaire; `first` when this save completed the profile. */
  saveProfile(userId: string, input: SetupArgs, now: Date): Promise<{ first: boolean }>;
  /** Change only the given fields. */
  patchProfile(userId: string, patch: ProfilePatchArgs, now: Date): Promise<void>;
}

type Row = {
  user_id: string;
  email: string;
  participant_type: ParticipantType | null;
  consent_version: string | null;
  consented_at: string | null;
  role?: Role | null;
  experience?: Experience | null;
  goals?: Goal[] | null;
  disease_interest?: string | null;
  country_interest?: string | null;
  decisions?: string | null;
  results_pref?: ResultsPref | null;
  report_format?: ExportFormat | null;
  memory_enabled?: boolean | null;
  profile_completed_at?: string | null;
};

const COLUMNS =
  "user_id, email, participant_type, consent_version, consented_at, role, experience, goals, disease_interest, country_interest, decisions, results_pref, report_format, memory_enabled, profile_completed_at";

function fieldsFrom(row: Row): ProfileFields {
  return {
    role: row.role ?? null,
    experience: row.experience ?? null,
    goals: row.goals ?? [],
    diseaseInterest: row.disease_interest ?? null,
    countryInterest: row.country_interest ?? null,
    decisions: row.decisions ?? null,
    resultsPref: row.results_pref ?? EMPTY_PROFILE.resultsPref,
    reportFormat: row.report_format ?? EMPTY_PROFILE.reportFormat,
    memoryEnabled: row.memory_enabled ?? EMPTY_PROFILE.memoryEnabled,
    completedAt: row.profile_completed_at ?? null,
  };
}

const COLUMN_OF: Record<keyof ProfilePatchArgs, string> = {
  role: "role",
  experience: "experience",
  goals: "goals",
  diseaseInterest: "disease_interest",
  countryInterest: "country_interest",
  decisions: "decisions",
  resultsPref: "results_pref",
  reportFormat: "report_format",
  memoryEnabled: "memory_enabled",
};

/** The given fields as columns; an undefined field is left alone, a null one is cleared. */
function columnsOf(patch: ProfilePatchArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[COLUMN_OF[key as keyof ProfilePatchArgs]] = value;
  }
  return out;
}

export function supabaseProfileStore(admin: SupabaseClient): ProfileStore {
  const store: ProfileStore = {
    async get(userId) {
      const { data, error } = await admin.from("profiles").select(COLUMNS).eq("user_id", userId).maybeSingle();
      if (error) throw new Error(`profiles read failed: ${error.message}`);
      if (!data) return null;
      const row = data as Row;
      return {
        userId: row.user_id,
        email: row.email,
        participantType: row.participant_type,
        consentVersion: row.consent_version,
        consentedAt: row.consented_at,
        fields: fieldsFrom(row),
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

    async saveProfile(userId, input, now) {
      const existing = await store.get(userId);
      const first = !existing?.fields.completedAt;
      const stamp = now.toISOString();
      const payload = { ...columnsOf(input), ...(first ? { profile_completed_at: stamp } : {}), profile_updated_at: stamp };
      const { error } = await admin.from("profiles").update(payload).eq("user_id", userId);
      if (error) throw new Error(`profiles update failed: ${error.message}`);
      return { first };
    },

    async patchProfile(userId, patch, now) {
      const { error } = await admin.from("profiles").update({ ...columnsOf(patch), profile_updated_at: now.toISOString() }).eq("user_id", userId);
      if (error) throw new Error(`profiles update failed: ${error.message}`);
    },
  };
  return store;
}
