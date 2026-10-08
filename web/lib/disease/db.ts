/**
 * The curated disease database as Python exports it (scripts/export_web_data.py):
 * summaries and warning range text are computed there, so this module only
 * resolves names. Mirrors epichat/disease_db.py lookup and detect_disease.
 */
import raw from "@/data/disease_db.json";

export const PARAMETERS = [
  "r0",
  "incubation_days",
  "infectious_days",
  "fatality_rate",
  "average_contacts_daily",
  "immunity_duration",
  "asymptomatic_fraction",
] as const;
export type ParameterName = (typeof PARAMETERS)[number];

export type ParameterSummary = {
  status: "ok" | "under_review" | "estimates_only" | "no_source";
  n_estimates: number;
  unit?: string;
  min?: number;
  max?: number;
  typical?: number;
  source?: string;
  estimate_range?: [number, number];
  estimate_extremes?: { value: number; population?: string; source_type?: string; title?: string }[];
  notes?: string;
  special_value?: string;
  review_note?: string;
};

export type FlatParam = {
  min: number | null;
  max: number | null;
  typical: number | null;
  source: string;
  unit: string | null;
  note: string | null;
  range_text: string | null;
};

export type DiseaseEntry = {
  key: string;
  display_name: string;
  aliases: string[];
  summaries: Record<string, ParameterSummary | null>;
  flat: Record<string, FlatParam | null>;
};

type DbFile = { diseases: Record<string, Omit<DiseaseEntry, "key">> };
const DB = raw as unknown as DbFile;
const ENTRIES: DiseaseEntry[] = Object.entries(DB.diseases).map(([key, entry]) => ({ key, ...entry }));

/** Every disease key, in the database's file order. */
export function knownDiseases(): string[] {
  return ENTRIES.map((e) => e.key);
}

/** Exact match on a key or an alias, case-insensitive and trimmed. */
export function lookup(name: string): DiseaseEntry | null {
  const wanted = name.toLowerCase().trim();
  for (const entry of ENTRIES) {
    if (entry.key === wanted) return entry;
    if (entry.aliases.some((alias) => alias.toLowerCase() === wanted)) return entry;
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Longest term first, so "german measles" wins over "measles"; the sort is stable, so file order breaks ties.
const TERMS: { pattern: RegExp; key: string }[] = ENTRIES.flatMap((entry) => [
  { term: entry.key, key: entry.key },
  ...entry.aliases.map((alias) => ({ term: alias.toLowerCase(), key: entry.key })),
])
  .sort((a, b) => b.term.length - a.term.length)
  .map(({ term, key }) => ({ pattern: new RegExp(`\\b${escapeRegExp(term)}\\b`), key }));

/** The first disease whose name or alias appears in the text as a whole word. */
export function detectDisease(text: string): string | null {
  const lower = text.toLowerCase();
  for (const { pattern, key } of TERMS) if (pattern.test(lower)) return key;
  return null;
}
