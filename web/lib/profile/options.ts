import { knownDiseases, lookup } from "@/lib/disease/db";

export type DiseaseOption = { key: string; name: string };

/** The database's diseases for the two suggestion lists, by display name. Server only (the database is large). */
export function diseaseOptions(): DiseaseOption[] {
  return knownDiseases()
    .map((key) => ({ key, name: lookup(key)?.display_name ?? key }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
