/** The literature behind a disease's parameters comes from GET /api/diseases/[key]/references, fetched on first open. */
import { formatQuantity, formatRange, parameterLabel } from "./format";

export type Reference = {
  title: string;
  value?: number;
  range?: [number, number];
  year?: number;
  country?: string;
  population?: string;
  source_type?: string;
  url?: string;
  doi?: string;
  notes?: string;
  special_value?: string;
  metric?: string;
};
export type ParameterReferences = { source: string | null; estimates: Reference[] };
export type DiseaseReferences = { display_name: string; parameters: Record<string, ParameterReferences> };

const cache = new Map<string, Promise<DiseaseReferences | null>>();

function isDiseaseReferences(value: unknown): value is DiseaseReferences {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DiseaseReferences>;
  return typeof candidate.display_name === "string" && typeof candidate.parameters === "object" && candidate.parameters !== null;
}

/** A disease's references, fetched once per key while the page lives; null when they cannot be had (and forgotten, so a retry can succeed). */
export function loadReferences(key: string, send: typeof fetch = fetch): Promise<DiseaseReferences | null> {
  const pending = cache.get(key);
  if (pending) return pending;
  const request = Promise.resolve()
    .then(() => send(`/api/diseases/${encodeURIComponent(key)}/references`))
    .then(async (response) => (response.ok ? ((await response.json()) as unknown) : null))
    .then((body) => (isDiseaseReferences(body) ? body : null))
    .catch(() => null)
    .then((refs) => {
      if (refs === null) cache.delete(key);
      return refs;
    });
  cache.set(key, request);
  return request;
}

export function clearReferencesCache(): void {
  cache.clear();
}

/** Where the reference links: its URL, else its DOI, else nowhere. Only http(s) links are followed. */
export function referenceHref(ref: Reference): string | null {
  if (ref.url && /^https?:\/\//i.test(ref.url)) return ref.url;
  if (ref.doi && ref.doi !== "N/A") return `https://doi.org/${ref.doi}`;
  return null;
}

/** One line about the study: year, country, population, and the kind of source, whichever are known. */
export function referenceMeta(ref: Reference): string {
  return [ref.year, ref.country, ref.population, ref.source_type?.replace(/_/g, " ")].filter((part) => part !== undefined && part !== "").join(" · ");
}

/** The estimate in the parameter's unit: "15 (12–18)", "10 days", "0.1–0.3%", "CFR 10%" when the study names its metric, or a special value such as "lifelong". */
export function referenceValue(ref: Reference, unit?: string): string {
  if (ref.special_value) return ref.special_value;
  const prefix = ref.metric ? `${ref.metric} ` : "";
  const range = ref.range ? formatRange(ref.range[0], ref.range[1], unit) : null;
  if (ref.value !== undefined) return prefix + (range ? `${formatQuantity(ref.value, unit)} (${range})` : formatQuantity(ref.value, unit));
  return range ? prefix + range : "";
}

/** What the References column's button says: the estimate count, "source" when only a consensus source exists, nothing when there is nothing to open. */
export function referenceButtonLabel(summary: { n_estimates: number; source?: string }): string | null {
  if (summary.n_estimates > 0) return `${summary.n_estimates} ${summary.n_estimates === 1 ? "source" : "sources"}`;
  return summary.source ? "source" : null;
}

/** Follow-up spec 9.2: an estimate can be applied when it is one number; a range alone or a special value such as "lifelong" cannot. */
export function referenceUsable(ref: Reference): boolean {
  return typeof ref.value === "number" && Number.isFinite(ref.value) && !ref.special_value;
}

const TITLE_MAX = 80;
const MESSAGE_MAX = 240;

/**
 * The message a "Use this value" button sends in the participant's name: "Use reference 3 for R₀: 14 (title, 2017)." The number
 * is the one the list shows; the agent passes it to configure_simulation, which reads the value itself. The title is the paper's
 * own text, so it is put on one line, stripped of control characters and cut short before it goes into a message.
 */
export function referenceMessage(parameter: string, index: number, ref: Reference, unit?: string): string {
  const title = ref.title.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  const short = title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1).trimEnd()}…` : title;
  const paper = ref.year !== undefined ? `${short}, ${ref.year}` : short;
  const value = typeof ref.value === "number" ? formatQuantity(ref.value, unit) : "";
  return `Use reference ${index} for ${parameterLabel(parameter)}: ${value} (${paper}).`.slice(0, MESSAGE_MAX);
}
