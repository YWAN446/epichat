/** epichat/adapters/wb_data360.py */
import { ADAPTER_TIMEOUT_MS, firstMax, resolved, type AdapterOptions, type DataQuery, type ResolvedField } from "./types";

export const WB_BASE_URL = "https://data360api.worldbank.org";

export const WB_INDICATOR_MAP: Record<string, [string, string]> = {
  WB_WDI_SH_MED_BEDS_ZS: ["treatment_capacity", "hospital beds/1,000"],
  WB_WDI_SH_MED_PHYS_ZS: ["treatment_capacity", "physicians/1,000"],
  WB_WDI_SH_MED_NUMW_P3: ["treatment_capacity", "nurses/1,000"],
  WB_WDI_SH_UHC_SRVS_CV_XD: ["uhc_coverage", "UHC service coverage index 0–100"],
  WB_WDI_SH_TBS_INCD: ["tb_incidence", "per 100,000/yr"],
  WB_WDI_SH_DYN_AIDS_ZS: ["hiv_prevalence", "% of population ages 15–49"],
  WB_WDI_SH_HIV_INCD_TL_P3: ["hiv_prevalence", "per 1,000 uninfected/yr"],
  WB_WDI_SH_MLR_INCD_P3: ["malaria_incidence", "per 1,000 population at risk/yr"],
  WB_WDI_SH_STA_DIAB_ZS: ["diabetes_prevalence", "% of adults ages 20–79"],
  WB_WDI_SH_HEP_HBVS_ZS: ["hepb_prevalence", "% of population"],
  WB_WDI_SP_DYN_CBRT_IN: ["birth_rate", "crude birth rate/1,000/yr"],
  WB_WDI_SP_DYN_CDRT_IN: ["death_rate", "crude death rate/1,000/yr"],
  WB_WDI_SP_POP_TOTL: ["total_population", "total population"],
  WB_WDI_SP_POP_0014_TO_ZS: ["age_distribution_pct", "population ages 0–14 (%)"],
  WB_WDI_SP_POP_65UP_TO_ZS: ["age_distribution_pct", "population ages 65+ (%)"],
};

const CANDIDATE_GROUPS: Record<string, { primary: string; alternatives: string[] }> = {
  treatment_capacity: { primary: "WB_WDI_SH_MED_BEDS_ZS", alternatives: ["WB_WDI_SH_MED_PHYS_ZS", "WB_WDI_SH_MED_NUMW_P3"] },
  hiv_prevalence: { primary: "WB_WDI_SH_DYN_AIDS_ZS", alternatives: ["WB_WDI_SH_HIV_INCD_TL_P3"] },
};

type Raw = { value: number; year: string };

export function assembleWbFields(raw: Map<string, Raw>, iso3: string): ResolvedField[] {
  if (raw.size === 0) return [];
  const results: ResolvedField[] = [];
  const consumed = new Set<string>();
  for (const [field, group] of Object.entries(CANDIDATE_GROUPS)) {
    const primary = raw.get(group.primary);
    if (!primary) continue;
    consumed.add(group.primary);
    const alternatives: ResolvedField[] = [];
    for (const code of group.alternatives) {
      const alt = raw.get(code);
      if (!alt) continue;
      alternatives.push(resolved(field, alt.value, `WB WDI, ${iso3}, ${alt.year}`, WB_INDICATOR_MAP[code][1]));
      consumed.add(code);
    }
    results.push(resolved(field, primary.value, `WB WDI, ${iso3}, ${primary.year}`, WB_INDICATOR_MAP[group.primary][1], alternatives));
  }
  for (const [code, { value, year }] of raw) {
    if (consumed.has(code)) continue;
    const [field, description] = WB_INDICATOR_MAP[code];
    results.push(resolved(field, value, `WB WDI, ${iso3}, ${year}`, description));
  }
  return results;
}

type Obs = { OBS_VALUE?: string | number | null; TIME_PERIOD?: string | null };

export async function fetchWbData360(query: DataQuery, opts: AdapterOptions = {}): Promise<ResolvedField[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const iso3 = query.locationCode ?? "";
  const codes = (query.indicatorCodes ?? []).filter((c) => Object.hasOwn(WB_INDICATOR_MAP, c));
  const fetched = await Promise.all(
    codes.map(async (code): Promise<[string, Raw | null]> => {
      const url = `${WB_BASE_URL}/data360/data?DATABASE_ID=${query.databaseId ?? "WB_WDI"}&INDICATOR=${code}&REF_AREA=${iso3}&timePeriodFrom=${query.startYear ?? 2020}&timePeriodTo=${query.endYear ?? 2025}`;
      try {
        const response = await fetchImpl(url, { headers: { "User-Agent": "EpiChat/1.0" }, signal: AbortSignal.timeout(ADAPTER_TIMEOUT_MS) });
        if (!response.ok) return [code, null];
        const data = (await response.json()) as { value?: Obs[] };
        const rows = (data.value ?? []).filter((r) => r.OBS_VALUE !== null && r.OBS_VALUE !== undefined && r.OBS_VALUE !== "null");
        if (rows.length === 0) return [code, null];
        const best = firstMax(rows, (r) => r.TIME_PERIOD ?? "");
        return [code, { value: Number.parseFloat(String(best.OBS_VALUE)), year: best.TIME_PERIOD ?? "unknown" }];
      } catch {
        return [code, null];
      }
    }),
  );
  const raw = new Map<string, Raw>();
  for (const [code, value] of fetched) if (value) raw.set(code, value);
  return assembleWbFields(raw, iso3);
}
