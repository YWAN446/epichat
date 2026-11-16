/** epichat/adapters/who_gho.py */
import { ADAPTER_TIMEOUT_MS, firstMax, resolved, type AdapterOptions, type DataQuery, type ResolvedField } from "./types";

export const WHO_BASE_URL = "https://ghoapi.azureedge.net/api/";

export const WHO_INDICATOR_MAP: Record<string, string> = {
  WHS3_40: "bcg_coverage",
  WHS3_41: "dtp3_coverage",
  WHS3_43: "polio_coverage",
  WHS3_45: "hepb3_coverage",
  WHS3_46: "hib3_coverage",
  WHS8_110: "mcv1_coverage",
  MCV2: "mcv2_coverage",
  PCV3: "pcv3_coverage",
  ROTAC: "rotac_coverage",
  SDGHPV: "hpv_coverage",
  MENGA: "menga_coverage",
  WHS3_48: "yfv_coverage",
  PAB: "pab_coverage",
  WHS3_62: "measles_cases",
  WHS3_56: "pertussis_cases",
  WHS3_59: "poliomyelitis_cases",
  WHS3_55: "diphtheria_cases",
  WHS3_51: "rubella_cases",
  WHS3_54: "mumps_cases",
  WHS3_57: "tetanus_cases",
  WHS3_58: "neonatal_tetanus_cases",
  WHS3_60: "yellow_fever_cases",
  WHS3_61: "japanese_encephalitis_cases",
  WHS3_63: "congenital_rubella_cases",
  WHS9_86: "total_population",
};

type Row = { NumericValue?: number | null; TimeDimensionValue?: string | number | null };

export function mapWhoRows(code: string, rows: unknown[], iso3: string): ResolvedField | null {
  const field = WHO_INDICATOR_MAP[code];
  if (!field) return null;
  const usable = (rows as Row[]).filter((r) => r.NumericValue !== null && r.NumericValue !== undefined);
  if (usable.length === 0) return null;
  const best = firstMax(usable, (r) => Number.parseInt(String(r.TimeDimensionValue ?? "0"), 10) || 0);
  const year = best.TimeDimensionValue ?? "unknown";
  return resolved(field, best.NumericValue, `WHO GHO, ${iso3}, ${year}`);
}

export async function fetchWhoGho(query: DataQuery, opts: AdapterOptions = {}): Promise<ResolvedField[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const iso3 = query.locationCode ?? "";
  const results: ResolvedField[] = [];
  for (const code of query.indicatorCodes ?? []) {
    if (!WHO_INDICATOR_MAP[code]) continue;
    const url = `${WHO_BASE_URL}${code}?$filter=${encodeURIComponent(`SpatialDim eq '${iso3}'`)}`;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(ADAPTER_TIMEOUT_MS) });
      if (!response.ok) continue;
      const data = (await response.json()) as { value?: unknown[] };
      const field = mapWhoRows(code, data.value ?? [], iso3);
      if (field) results.push(field);
    } catch {
      continue;
    }
  }
  return results;
}
