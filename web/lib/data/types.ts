/** epichat/resolver.py's ResolvedField and DataQuery, as the adapters exchange them. */
export type ResolvedField = {
  field: string;
  value: unknown;
  citation: string;
  description: string;
  alternatives: ResolvedField[];
};

export type DataQuery = {
  source: "un_wpp" | "who_gho" | "wb_data360";
  indicators?: number[];
  locationId?: number;
  startYear?: number;
  endYear?: number;
  indicatorCodes?: string[];
  locationCode?: string;
  databaseId?: string;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type AdapterOptions = { fetchImpl?: FetchLike; now?: () => Date };

/** Every outside call gives up after this long; a hung API must not eat the chat route's budget. */
export const ADAPTER_TIMEOUT_MS = 15_000;

export function resolved(field: string, value: unknown, citation: string, description = "", alternatives: ResolvedField[] = []): ResolvedField {
  return { field, value, citation, description, alternatives };
}

/** The three adapters as the tools consume them, bound to one fetch and key. */
export type Adapters = {
  unWpp: (query: DataQuery) => Promise<ResolvedField[]>;
  whoGho: (query: DataQuery) => Promise<ResolvedField[]>;
  wbData360: (query: DataQuery) => Promise<ResolvedField[]>;
};

/** Python's max(): the first of the largest elements. */
export function firstMax<T>(items: T[], key: (item: T) => number | string): T {
  let best = items[0];
  for (const item of items.slice(1)) if (key(item) > key(best)) best = item;
  return best;
}
