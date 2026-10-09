"use client";

import { useState } from "react";
import { formatDuration } from "@/lib/client/activity";
import type { RunArtifact } from "@/lib/client/artifacts";
import type { ChartView } from "@/lib/client/chart";
import { CHART_VIEWS } from "@/lib/enums";
import { fmtValue } from "@/lib/sim/pyformat";
import { Chart } from "../Chart";
import { StatTiles, useRunSeries } from "../RunSummary";

const VIEW_LABELS: Record<(typeof CHART_VIEWS)[number], string> = { compartments: "Compartments", incidence: "Incidence", cumulative: "Cumulative", deaths: "Disease deaths" };
const PARAM_KEYS = ["beta", "n_contacts", "init_prev", "dur_inf", "dur_exp", "dur_immune", "p_death", "sim_dur_years", "n_agents"] as const;

type Props = { runs: RunArtifact[]; onChartView: (view: ChartView, turnId: string) => void };

function RunEntry({ run, open: initiallyOpen, onChartView }: { run: RunArtifact; open: boolean; onChartView: Props["onChartView"] }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [view, setView] = useState<ChartView>("compartments");
  const series = useRunSeries(run.payload);
  const p = run.payload;
  return (
    <li className="rounded-lg border border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-left font-medium hover:bg-paper-2">
        <span>Run {run.index}</span>
        <span className="text-xs text-ink-faint">
          {formatDuration(p.duration_ms)}
          {p.cold_start ? ", cold start" : ""}
        </span>
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          <StatTiles payload={p} />
          <div role="group" aria-label="Chart view" className="flex flex-wrap gap-1">
            {CHART_VIEWS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={view === candidate}
                onClick={() => {
                  setView(candidate);
                  onChartView(candidate, run.turnId);
                }}
                className="rounded-full border border-line px-2.5 py-0.5 text-xs aria-pressed:border-accent aria-pressed:bg-accent-wash"
              >
                {VIEW_LABELS[candidate]}
              </button>
            ))}
          </div>
          {series === "loading" ? <p className="text-ink-faint">Loading the curve…</p> : series ? <Chart series={series} view={view} width={320} /> : <p className="text-ink-faint">Series unavailable.</p>}
          <details>
            <summary className="cursor-pointer text-xs font-semibold tracking-wide text-ink-faint uppercase">Effective parameters</summary>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
              {PARAM_KEYS.filter((key) => p.effective_params[key] !== null && p.effective_params[key] !== undefined).map((key) => (
                <div key={key} className="contents">
                  <dt className="text-ink-faint">{key}</dt>
                  <dd>{fmtValue(p.effective_params[key])}</dd>
                </div>
              ))}
              {p.effective_params.interventions.length > 0 && (
                <div className="contents">
                  <dt className="text-ink-faint">interventions</dt>
                  <dd>{p.effective_params.interventions.map((i) => `${i.type}${i.coverage !== null && i.coverage !== undefined ? ` ${Math.round(i.coverage * 100)}%` : ""}`).join(", ")}</dd>
                </div>
              )}
              <div className="contents">
                <dt className="text-ink-faint">population</dt>
                <dd>
                  {fmtValue(p.population)} (scale {fmtValue(p.pop_scale)})
                </dd>
              </div>
            </dl>
          </details>
          {p.repairs.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold tracking-wide text-warn-ink uppercase">Repairs ({p.repairs.length})</summary>
              <ol className="mt-1 list-decimal pl-4 text-xs text-ink-soft">
                {p.repairs.map((repair) => (
                  <li key={repair.attempt}>
                    {repair.error}
                    {repair.changes && repair.changes.length > 0 && <span> → {repair.changes.map((change) => `${change.field}: ${fmtValue(change.from)} → ${fmtValue(change.to)}`).join("; ")}</span>}
                  </li>
                ))}
              </ol>
            </details>
          )}
          {p.data_sources.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold tracking-wide text-ink-faint uppercase">Data sources ({p.data_sources.length})</summary>
              <ul className="mt-1 text-xs text-ink-soft">
                {p.data_sources.map((source) => (
                  <li key={source.field}>
                    <span className="font-mono">{source.field}</span> = {fmtValue(source.value)} — {source.citation}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {p.warnings.length > 0 && <p className="text-xs text-warn-ink">{p.warnings.join(" ")}</p>}
        </div>
      )}
    </li>
  );
}

/** Every run of the conversation, newest first and open. */
export function RunsSection({ runs, onChartView }: Props) {
  if (runs.length === 0) return <p className="text-ink-faint">Results appear here after the first run.</p>;
  const newest = runs[runs.length - 1];
  return (
    <ul className="space-y-2">
      {[...runs].reverse().map((run) => (
        <RunEntry key={run.turnId + run.index} run={run} open={run === newest} onChartView={onChartView} />
      ))}
    </ul>
  );
}
