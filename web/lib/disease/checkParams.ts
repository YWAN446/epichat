/**
 * epichat/disease_db.py check_params, with the range text pre-rendered by
 * Python (so "12–18" and "1.0–103.0" come out as the file says) and the
 * value formatting done by the Python-parity helpers.
 */
import { f1, g4 } from "@/lib/sim/pyformat";
import { lookup, type FlatParam } from "./db";

const DAYS_PER_UNIT: Record<string, number> = { days: 1, weeks: 7, months: 30.44, years: 365.25 };

type Range = { lo: number; hi: number; text: string; data: FlatParam };

function rangeOf(flat: Record<string, FlatParam | null>, param: string): Range | null {
  const data = flat[param];
  if (!data || data.min === null || data.max === null || data.range_text === null) return null;
  return { lo: data.min, hi: data.max, text: data.range_text, data };
}

export function checkParams(
  disease: string,
  r0: number,
  durInf: number,
  durExp: number | null,
  opts: { pDeath?: number | null; nContacts?: number | null; durImmune?: number | null; pAsymp?: number | null } = {},
): string[] {
  const entry = lookup(disease);
  if (!entry) return [];
  const out: string[] = [];
  const outside = (r: Range, v: number) => !(r.lo <= v && v <= r.hi);

  let r = rangeOf(entry.flat, "r0");
  if (r && outside(r, r0)) out.push(`R₀ ≈ ${f1(r0)} is outside the literature range for ${disease} (${r.text}). Source: ${r.data.source}`);

  r = rangeOf(entry.flat, "infectious_days");
  if (r && outside(r, durInf)) out.push(`Infectious period ${g4(durInf)} days is outside the literature range for ${disease} (${r.text} days). Source: ${r.data.source}`);

  if (durExp !== null && durExp !== undefined) {
    r = rangeOf(entry.flat, "incubation_days");
    if (r && outside(r, durExp)) out.push(`Incubation period ${g4(durExp)} days is outside the literature range for ${disease} (${r.text} days). Source: ${r.data.source}`);
  }

  const { pDeath, nContacts, durImmune, pAsymp } = opts;
  if (pDeath !== null && pDeath !== undefined) {
    r = rangeOf(entry.flat, "fatality_rate");
    if (r) {
      const percent = r.data.unit === "percentage";
      const value = percent ? pDeath * 100 : pDeath;
      if (outside(r, value)) {
        const u = percent ? "%" : "";
        out.push(`Fatality rate ${g4(value)}${u} is outside the literature range for ${disease} (${r.text}${u}). Source: ${r.data.source}`);
      }
    }
  }

  if (nContacts !== null && nContacts !== undefined) {
    r = rangeOf(entry.flat, "average_contacts_daily");
    if (r && outside(r, nContacts)) out.push(`Daily contacts ${g4(nContacts)} is outside the literature range for ${disease} (${r.text}). Source: ${r.data.source}`);
  }

  if (durImmune !== null && durImmune !== undefined) {
    r = rangeOf(entry.flat, "immunity_duration");
    if (r) {
      const factor = DAYS_PER_UNIT[r.data.unit ?? "days"] ?? 1;
      const lo = r.lo * factor;
      const hi = r.hi * factor;
      if (!(lo <= durImmune && durImmune <= hi)) {
        out.push(`Immunity duration ${g4(durImmune)} days is outside the literature range for ${disease} (${g4(lo)}–${g4(hi)} days). Source: ${r.data.source}`);
      }
    }
  }

  if (pAsymp !== null && pAsymp !== undefined) {
    r = rangeOf(entry.flat, "asymptomatic_fraction");
    if (r) {
      const value = r.data.unit === "percentage" ? pAsymp * 100 : pAsymp;
      if (outside(r, value)) out.push(`Asymptomatic fraction ${g4(pAsymp)} is outside the literature range for ${disease} (${r.text} ${r.data.unit ?? ""}). Source: ${r.data.source}`);
    }
  }
  return out;
}
