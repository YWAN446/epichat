/** The questionnaire's and the Profile tab's browser-side helpers (profile spec, sections 3 and 11). */
import names from "@/data/country_names.json";
import type { DiseaseOption } from "@/lib/profile/options";

export const COUNTRY_NAMES = names as Record<string, string>;

/** Every country for the suggestion list, by name. */
export const COUNTRY_OPTIONS: { iso3: string; name: string }[] = Object.entries(COUNTRY_NAMES)
  .map(([iso3, name]) => ({ iso3, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** The ISO3 for a typed name or code (case-insensitive), or null. */
export function countryIso3For(text: string): string | null {
  const typed = text.trim();
  if (typed.length === 0) return null;
  const code = typed.toUpperCase();
  if (Object.hasOwn(COUNTRY_NAMES, code)) return code;
  const wanted = typed.toLowerCase();
  return COUNTRY_OPTIONS.find((country) => country.name.toLowerCase() === wanted)?.iso3 ?? null;
}

/** The name for a stored code; "" for none. */
export function countryLabel(iso3: string | null): string {
  return iso3 ? (COUNTRY_NAMES[iso3] ?? iso3) : "";
}

/** The display name for a stored disease key, else the text as typed; "" for none. */
export function diseaseLabel(value: string | null, diseases: DiseaseOption[]): string {
  if (!value) return "";
  return diseases.find((disease) => disease.key === value)?.name ?? value;
}
