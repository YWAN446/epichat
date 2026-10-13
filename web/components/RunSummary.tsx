"use client";

import { useEffect, useState } from "react";
import type { Series } from "@/lib/client/chart";
import { initialSeriesState, loadSeries } from "@/lib/client/series";
import { commaInt } from "@/lib/sim/pyformat";
import type { RunPayload } from "@/lib/tools/types";
import { Chart } from "./Chart";

/** The run's series: the payload's own, or fetched once for a replayed run. */
export function useRunSeries(payload: RunPayload): Series | null | "loading" {
  const [state, setState] = useState<Series | null | "loading">(() => initialSeriesState(payload));
  useEffect(() => {
    if (payload.series || !payload.run_id) return;
    let active = true;
    void loadSeries(payload.run_id).then((series) => {
      if (active) setState(series);
    });
    return () => {
      active = false;
    };
  }, [payload.series, payload.run_id]);
  return state;
}

/** Peak day, peak infections, attack rate, deaths. */
export function StatTiles({ payload }: { payload: RunPayload }) {
  const tiles: [string, string][] = [
    ["Peak day", `Day ${payload.stats.peak_day}`],
    ["Peak infections", commaInt(payload.stats.peak_infections)],
    ["Attack rate", `${payload.attack_rate_pct.toFixed(1)}%`],
    ["Disease deaths", commaInt(payload.stats.total_deaths ?? 0)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-paper-2 px-3 py-2">
          <dt className="text-xs text-ink-faint">{label}</dt>
          <dd className="font-mono text-base font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Inline under the run's tool call: the tiles and the infected curve. The panel carries the rest. With options (the latest run only; follow-up spec 7.4) the interventions to try are buttons that send the reply. */
export function RunSummary({ payload, options, onPick }: { payload: RunPayload; options?: string[]; onPick?: (label: string) => void }) {
  const series = useRunSeries(payload);
  return (
    <section aria-label="Simulation results" className="my-3 rounded-xl border border-line bg-surface p-3">
      <StatTiles payload={payload} />
      <div className="mt-3">
        {series === "loading" ? (
          <p className="text-sm text-ink-faint">Loading the curve…</p>
        ) : series ? (
          <Chart series={series} view="infected" height={200} />
        ) : (
          <p className="text-sm text-ink-faint">Series unavailable.</p>
        )}
      </div>
      {options && options.length > 0 && onPick && (
        <div aria-label="Try next" className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-faint">Try next</span>
          {options.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => onPick(label)}
              className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-left text-sm font-medium text-accent hover:border-accent hover:bg-accent-wash"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
