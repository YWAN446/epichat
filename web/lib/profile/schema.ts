/**
 * The participant profile (profile spec, section 4): the fields as the app
 * holds them, the questionnaire's zod schema, the partial-update schema, and
 * the two normalizers the page and the routes share.
 */
import { z } from "zod";
import names from "@/data/country_names.json";
import { knownDiseases, lookup } from "@/lib/disease/db";
import { EXPERIENCES, EXPORT_FORMATS, GOALS, RESULTS_PREFS, ROLES, type Experience, type ExportFormat, type Goal, type ParticipantType, type ResultsPref, type Role } from "@/lib/enums";

export type ProfileFields = {
  role: Role | null;
  experience: Experience | null;
  goals: Goal[];
  /** A disease key from the database, or the text as typed. */
  diseaseInterest: string | null;
  /** ISO3. */
  countryInterest: string | null;
  decisions: string | null;
  resultsPref: ResultsPref;
  reportFormat: ExportFormat;
  memoryEnabled: boolean;
  /** Null until the questionnaire is saved. */
  completedAt: string | null;
};

export const EMPTY_PROFILE: ProfileFields = {
  role: null,
  experience: null,
  goals: [],
  diseaseInterest: null,
  countryInterest: null,
  decisions: null,
  resultsPref: "all",
  reportFormat: "pdf",
  memoryEnabled: true,
  completedAt: null,
};

const COUNTRIES = names as Record<string, string>;

/** True for an ISO3 code in country_names.json (upper case only). */
export function isCountry(iso3: string): boolean {
  return Object.hasOwn(COUNTRIES, iso3);
}

/** The database's key when the text names a disease (key, alias, or display name, case-insensitive), else the text as typed. */
export function diseaseKeyOrText(text: string): string {
  const trimmed = text.trim();
  const direct = lookup(trimmed);
  if (direct) return direct.key;
  const wanted = trimmed.toLowerCase();
  const byName = knownDiseases().find((key) => lookup(key)?.display_name.toLowerCase() === wanted);
  return byName ?? trimmed;
}

const country = z.string().refine(isCountry, "Not a country in the list");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length === 0 ? null : s))
    .nullable()
    .optional();

const OPTIONAL = {
  diseaseInterest: optionalText(60),
  countryInterest: country.nullable().optional(),
  decisions: optionalText(200),
  resultsPref: z.enum(RESULTS_PREFS).optional(),
  reportFormat: z.enum(EXPORT_FORMATS).optional(),
};

/** The questionnaire: role, experience, and at least one goal are required. */
export const SetupInput = z.strictObject({
  role: z.enum(ROLES),
  experience: z.enum(EXPERIENCES),
  goals: z.array(z.enum(GOALS)).min(1),
  ...OPTIONAL,
});
export type SetupArgs = z.infer<typeof SetupInput>;

/** A partial update from the Profile tab; a goals list can never be emptied. */
export const ProfilePatch = z.strictObject({
  role: z.enum(ROLES).optional(),
  experience: z.enum(EXPERIENCES).optional(),
  goals: z.array(z.enum(GOALS)).min(1).optional(),
  ...OPTIONAL,
  memoryEnabled: z.boolean().optional(),
});
export type ProfilePatchArgs = z.infer<typeof ProfilePatch>;

/** The role the study's enrolment category implies, when the mapping is plain. */
export function prefillRole(type: ParticipantType | null): Role | null {
  if (type === "graduate_student") return "student";
  if (type === "public_health_practitioner") return "public_health_practitioner";
  return null;
}
