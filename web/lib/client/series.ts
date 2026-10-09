/** A replayed run's series comes from GET /api/runs/[id]; a live one arrives with the event (workspace spec, section 5). */
import type { RunPayload } from "@/lib/tools/types";
import type { Series } from "./chart";

const cache = new Map<string, Promise<Series | null>>();

/** The series for a run, fetched once per id while the page lives; null when it cannot be had. */
export function loadSeries(runId: string, send: typeof fetch = fetch): Promise<Series | null> {
  const pending = cache.get(runId);
  if (pending) return pending;
  const request = Promise.resolve()
    .then(() => send(`/api/runs/${runId}`))
    .then(async (response) => (response.ok ? (((await response.json()) as { series?: Series }).series ?? null) : null))
    .catch(() => null)
    .then((series) => {
      if (series === null) cache.delete(runId);
      return series;
    });
  cache.set(runId, request);
  return request;
}

export function clearSeriesCache(): void {
  cache.clear();
}

/** What a run card starts with: the payload's own series, "loading" when there is a run to fetch, or nothing. */
export function initialSeriesState(payload: RunPayload): Series | null | "loading" {
  if (payload.series) return payload.series;
  return payload.run_id ? "loading" : null;
}
