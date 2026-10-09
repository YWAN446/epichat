/** Pure chart math for the SVG epidemic curves (workspace spec, section 9). */
import type { CHART_VIEWS } from "@/lib/enums";

export type ChartView = "infected" | (typeof CHART_VIEWS)[number];
export type Series = Record<string, number[]>;
export type Line = { key: string; label: string; color: string; values: number[] };
export type Point = { x: number; y: number };

const ACCENT = "var(--color-accent)";
const INK = "var(--color-ink)";
const LINES: Record<ChartView, { key: string; label: string; color: string }[]> = {
  infected: [{ key: "n_infected", label: "Currently infected", color: ACCENT }],
  compartments: [
    { key: "n_susceptible", label: "Susceptible", color: "var(--color-ink-soft)" },
    { key: "n_exposed", label: "Exposed", color: "var(--color-warn)" },
    { key: "n_infected", label: "Infectious", color: ACCENT },
    { key: "n_recovered", label: "Recovered", color: "#3a7d5a" },
  ],
  incidence: [{ key: "new_infections", label: "New infections per day", color: ACCENT }],
  cumulative: [{ key: "cum_infections", label: "Cumulative infections", color: INK }],
  deaths: [{ key: "cum_deaths", label: "Cumulative deaths", color: INK }],
};

/** The view's lines that the series actually has, in display order. */
export function seriesFor(view: ChartView, series: Series): Line[] {
  return LINES[view].filter((line) => Array.isArray(series[line.key]) && series[line.key].length > 0).map((line) => ({ ...line, values: series[line.key] }));
}

/** At most `max` evenly strided points, always ending on the last one. */
export function thinPoints(days: number[], values: number[], max: number): Point[] {
  const n = Math.min(days.length, values.length);
  if (n === 0) return [];
  const stride = n <= max ? 1 : Math.ceil(n / max);
  const points: Point[] = [];
  for (let i = 0; i < n; i += stride) points.push({ x: days[i], y: values[i] });
  if (points.at(-1)?.x !== days[n - 1]) points.push({ x: days[n - 1], y: values[n - 1] });
  return points;
}

/** Round tick values from 0 to at least `max`, about `count` of them; [0, 1] for an empty range. */
export function niceTicks(max: number, count: number): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let value = 0; value < max + step; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

/** 999, 1.2k, 20k, 3.4M. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  const trim = (s: string) => s.replace(/\.0$/, "");
  if (abs >= 1_000_000) return `${trim((n / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${trim((n / 1_000).toFixed(1))}k`;
  return Math.round(n).toString();
}

/** An SVG path through the points, x over [0, xMax] → [0, width], y over [0, yMax] → [height, 0]. */
export function linePath(points: Point[], width: number, height: number, xMax: number, yMax: number): string {
  const sx = xMax > 0 ? width / xMax : 0;
  const sy = yMax > 0 ? height / yMax : 0;
  const fmt = (v: number) => Number(v.toFixed(1)).toString();
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p.x * sx)} ${fmt(height - p.y * sy)}`).join(" ");
}

/** The index of the day closest to `day`; 0 for an empty series. */
export function nearestIndex(days: number[], day: number): number {
  let best = 0;
  for (let i = 1; i < days.length; i++) if (Math.abs(days[i] - day) < Math.abs(days[best] - day)) best = i;
  return best;
}
