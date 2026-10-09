import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearSeriesCache, initialSeriesState, loadSeries } from "@/lib/client/series";

const SERIES = { day: [0, 1], n_infected: [1, 2] };

describe("loadSeries", () => {
  beforeEach(() => clearSeriesCache());

  it("fetches a run's series once per id and shares the promise", async () => {
    const send = vi.fn(async () => Response.json({ series: SERIES }));
    const [a, b] = await Promise.all([loadSeries("run-1", send), loadSeries("run-1", send)]);
    expect(a).toEqual(SERIES);
    expect(b).toBe(a);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("/api/runs/run-1");
    await loadSeries("run-1", send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("answers null on a failure and does not cache it", async () => {
    const send = vi.fn(async () => new Response(null, { status: 404 }));
    expect(await loadSeries("run-2", send)).toBeNull();
    expect(await loadSeries("run-2", send)).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
    const thrower = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await loadSeries("run-3", thrower)).toBeNull();
  });

  it("starts from the payload: its series, loading when a run id can fetch one, or nothing", () => {
    const base = { kind: "run" as const, run_id: "run-1", stats: {} as never, stats_agents: {} as never, attack_rate_pct: 0, pop_scale: 1, population: 1, effective_params: {} as never, warnings: [], repairs: [], data_sources: [], duration_ms: 1, cold_start: false };
    expect(initialSeriesState({ ...base, series: SERIES })).toEqual(SERIES);
    expect(initialSeriesState(base)).toBe("loading");
    expect(initialSeriesState({ ...base, run_id: null })).toBeNull();
  });
});
