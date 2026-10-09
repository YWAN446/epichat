"use client";

import { useState, type PointerEvent } from "react";
import { compact, linePath, nearestIndex, niceTicks, seriesFor, thinPoints, type ChartView, type Series } from "@/lib/client/chart";

const WIDTH = 640;
const PAD = { top: 12, right: 12, bottom: 28, left: 52 };
const MAX_POINTS = 400;

type Props = { series: Series; view: ChartView; height?: number };

/** An epidemic curve as inline SVG: axes, one path per line, a legend, and a readout of the day under the pointer. */
export function Chart({ series, view, height = 240 }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const lines = seriesFor(view, series);
  const days = Array.isArray(series.day) ? series.day : [];
  if (lines.length === 0 || days.length === 0) return <p className="text-sm text-ink-faint">Series unavailable.</p>;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const xMax = days[days.length - 1] || 1;
  const yTicks = niceTicks(Math.max(...lines.flatMap((line) => line.values)), 4);
  const yTop = yTicks[yTicks.length - 1];
  const xTicks = niceTicks(xMax, 5).filter((tick) => tick <= xMax);
  const x = (day: number) => (day / xMax) * plotW;
  const y = (value: number) => plotH - (value / yTop) * plotH;
  const paths = lines.map((line) => ({ ...line, d: linePath(thinPoints(days, line.values, MAX_POINTS), plotW, plotH, xMax, yTop) }));

  function onMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * WIDTH - PAD.left;
    const day = Math.round(Math.max(0, Math.min(1, px / plotW)) * xMax);
    setHover(nearestIndex(days, day));
  }

  return (
    <figure>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full touch-none"
        role="img"
        aria-label={lines.map((line) => line.label).join(", ")}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <g transform={`translate(${PAD.left} ${PAD.top})`}>
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={0} x2={plotW} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" />
              <text x={-8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-faint)">
                {compact(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text key={tick} x={x(tick)} y={plotH + 18} textAnchor="middle" fontSize={11} fill="var(--color-ink-faint)">
              {tick}
            </text>
          ))}
          {paths.map((path) => (
            <path key={path.key} d={path.d} fill="none" stroke={path.color} strokeWidth={1.8} strokeLinejoin="round" />
          ))}
          {hover !== null && <line x1={x(days[hover])} x2={x(days[hover])} y1={0} y2={plotH} stroke="var(--color-ink-faint)" strokeDasharray="3 3" />}
        </g>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {lines.map((line) => (
          <span key={line.key}>
            <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: line.color }} />
            {line.label}
            {hover !== null && `: ${compact(line.values[hover] ?? 0)}`}
          </span>
        ))}
        <span>{hover === null ? "Days" : `Day ${days[hover]}`}</span>
      </figcaption>
    </figure>
  );
}
