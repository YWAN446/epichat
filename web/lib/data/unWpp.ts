/**
 * epichat/adapters/un_wpp.py. The location table is static (exported by
 * scripts/export_un_locations.py) instead of downloaded at start-up.
 */
import locations from "@/data/un_locations.json";
import { pyRound } from "@/lib/sim/pyformat";
import { ADAPTER_TIMEOUT_MS, firstMax, resolved, type AdapterOptions, type DataQuery, type ResolvedField } from "./types";

export const UN_BASE_URL = "https://population.un.org/dataportalapi/api/v1";
const VARIANT_MEDIAN = "4";
const SEX_BOTH = "3";
const METHOD_INTERP = "2";
const TABLE = locations as Record<string, number>;

export function unLocationId(iso3: string): number | null {
  return TABLE[iso3.trim().toUpperCase()] ?? null;
}

/** csv.DictReader with delimiter "|": a "sep" first line is skipped; short rows get "" for missing columns. */
export function parseUnCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines[0]?.startsWith("sep")) lines.shift();
  if (lines.length === 0) return [];
  const header = lines[0].split("|");
  return lines.slice(1).map((line) => {
    const cells = line.split("|");
    const row: Record<string, string> = {};
    header.forEach((name, i) => {
      row[name] = cells[i] ?? "";
    });
    return row;
  });
}

function cite(row: Record<string, string>, locationId: number): string {
  return `UN WPP 2024, ${row.Location || String(locationId)} (${row.Iso3 || String(locationId)}), ${row.TimeLabel ?? ""}`;
}

export function mapUnRows(rows: Record<string, string>[], locationId: number): ResolvedField[] {
  const filtered = rows.filter((r) => r.VariantId === VARIANT_MEDIAN && r.SexId === SEX_BOTH);
  const interp = filtered.filter((r) => r.EstimateMethodId === METHOD_INTERP);
  const results: ResolvedField[] = [];
  const timeId = (r: Record<string, string>) => Number.parseInt(r.TimeId || "0", 10);

  for (const [ind, field] of [["55", "birth_rate"], ["59", "death_rate"]] as const) {
    const candidates = interp.filter((r) => r.IndicatorId === ind && (r.AgeLabel ?? "").trim() === "Total");
    if (candidates.length === 0) continue;
    const best = firstMax(candidates, timeId);
    results.push(resolved(field, pyRound(Number.parseFloat(best.Value), 3), cite(best, locationId)));
  }

  const pop = filtered.filter((r) => r.IndicatorId === "49" && (r.AgeLabel ?? "").trim() === "Total");
  if (pop.length > 0) {
    const best = firstMax(pop, timeId);
    const raw = Number.parseFloat(best.Value);
    const population = best.EstimateMethodId === METHOD_INTERP ? pyRound(raw * 1000, 0) : pyRound(raw, 0);
    results.push(resolved("total_population", population, cite(best, locationId)));
  }

  const ageRows = interp.filter((r) => r.IndicatorId === "71");
  const pct: Record<string, number> = {};
  let ageBest: Record<string, string> | null = null;
  for (const label of ["0-17", "65+"]) {
    const candidates = ageRows.filter((r) => (r.AgeLabel ?? "").trim() === label);
    if (candidates.length === 0) continue;
    ageBest = firstMax(candidates, timeId);
    pct[label] = pyRound(Number.parseFloat(ageBest.Value), 3);
  }
  if ("0-17" in pct && "65+" in pct && ageBest) {
    pct["18-64"] = pyRound(100 - pct["0-17"] - pct["65+"], 3);
    results.push(resolved("age_distribution_pct", pct, cite(ageBest, locationId)));
  }
  return results;
}

export async function fetchUnWpp(query: DataQuery, opts: AdapterOptions & { apiKey?: string } = {}): Promise<ResolvedField[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const year = (opts.now ?? (() => new Date()))().getUTCFullYear();
  const ids = (query.indicators ?? []).join(",");
  const url = `${UN_BASE_URL}/data/indicators/${ids}/locations/${query.locationId}/start/${query.startYear ?? 2020}/end/${year}/?format=csv`;
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(ADAPTER_TIMEOUT_MS) });
    if (!response.ok) return [];
    return mapUnRows(parseUnCsv(await response.text()), query.locationId ?? 0);
  } catch {
    return [];
  }
}
