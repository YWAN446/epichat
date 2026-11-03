/** The WHO/UNICEF estimates of national immunization coverage (WUENIC), from UNICEF's SDMX service: WHO's GHO API, which
 *  carried the same estimates, was retired at the end of 2025. No key; a query with no data answers 404. */
import { ADAPTER_TIMEOUT_MS, resolved, type AdapterOptions, type DataQuery, type ResolvedField } from "./types";

export const UNICEF_BASE_URL = "https://sdmx.data.unicef.org/ws/public/sdmxapi/rest/data/UNICEF,IMMUNISATION,1.0/";

/** UNICEF's code, and the field and description it becomes; the fields are the ones lib/client/format.ts labels. */
export const UNICEF_INDICATOR_MAP: Record<string, [string, string]> = {
  IM_BCG: ["bcg_coverage", "BCG (% of live births)"],
  IM_DTP3: ["dtp3_coverage", "diphtheria, tetanus and pertussis, third dose (% of children)"],
  IM_HEPB3: ["hepb3_coverage", "hepatitis B, third dose (% of children)"],
  IM_HIB3: ["hib3_coverage", "Haemophilus influenzae type b, third dose (% of children)"],
  IM_MCV1: ["mcv1_coverage", "measles-containing vaccine, first dose (% of children)"],
  IM_MCV2: ["mcv2_coverage", "measles-containing vaccine, second dose (% of children)"],
  IM_RCV1: ["rcv1_coverage", "rubella-containing vaccine, first dose (% of children)"],
  IM_ROTAC: ["rotac_coverage", "rotavirus, last dose (% of children)"],
  IM_HPV: ["hpv_coverage", "HPV, last dose (% of girls)"],
  IM_MENGA: ["menga_coverage", "meningococcal A conjugate (% of children)"],
  IM_YFV: ["yfv_coverage", "yellow fever (% of children)"],
  IM_PAB: ["pab_coverage", "newborns protected at birth against tetanus (%)"],
};

/** RFC 4180 rows: quoted fields may hold commas, doubled quotes, and line breaks; a trailing line break adds no row. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** SDMX's answer to a query that matched no observations; every other 404 (a retired dataflow, a moved path) is an outage. */
const NO_DATA = "No data for data query";

/** Per code asked for, in that order, the latest year that has a value. A body without the CSV's columns is not an answer. */
export function mapUnicefRows(rows: string[][], codes: string[], iso3: string): ResolvedField[] {
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  const col = (name: string) => header.indexOf(name);
  const [indicator, period, value] = [col("INDICATOR"), col("TIME_PERIOD"), col("OBS_VALUE")];
  if (indicator < 0 || period < 0 || value < 0) throw new Error("UNICEF data service unavailable (unexpected response)");
  const results: ResolvedField[] = [];
  for (const code of codes) {
    const known = UNICEF_INDICATOR_MAP[code];
    if (!known) continue;
    const usable = body.filter((r) => r[indicator] === code && (r[value] ?? "").trim() !== "" && Number.isFinite(Number(r[value])));
    if (usable.length === 0) continue;
    const best = usable.reduce((a, b) => (b[period] > a[period] ? b : a));
    results.push(resolved(known[0], Number(best[value]), `WHO/UNICEF estimates, ${iso3}, ${best[period]}`, known[1]));
  }
  return results;
}

/** One request for every known code, ten years back. No data is an empty list; a service that does not answer, or answers with
 *  anything but SDMX's no-data message or the CSV, throws, so the tool can say the source is down rather than that the country has
 *  no estimate. */
export async function fetchUnicef(query: DataQuery, opts: AdapterOptions = {}): Promise<ResolvedField[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const iso3 = (query.locationCode ?? "").trim().toUpperCase();
  const codes = (query.indicatorCodes ?? []).filter((c) => Object.hasOwn(UNICEF_INDICATOR_MAP, c));
  if (codes.length === 0 || !iso3) return [];
  const since = (opts.now ?? (() => new Date()))().getUTCFullYear() - 10;
  const url = `${UNICEF_BASE_URL}${iso3}.${codes.join("+")}.?format=csv&labels=id&startPeriod=${since}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(ADAPTER_TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`UNICEF data service unavailable (${error instanceof Error ? error.message : String(error)})`);
  }
  const body = await response.text().catch(() => "");
  if (response.status === 404 && body.includes(NO_DATA)) return [];
  if (!response.ok) throw new Error(`UNICEF data service unavailable (HTTP ${response.status})`);
  return mapUnicefRows(parseCsv(body), codes, iso3);
}
