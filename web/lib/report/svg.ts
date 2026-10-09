/** A figure as a standalone SVG: axes, ticks, one path per line, a legend. Pure, so the server draws it for the HTML report. */
import { compact, linePath, niceTicks } from "@/lib/client/chart";
import type { ReportBlock } from "./document";
import { escapeHtml } from "./escape";

type Figure = Extract<ReportBlock, { kind: "figure" }>;

/** One colour per run, in order; the app's accent first. */
export const FIGURE_COLORS = ["#8c3b2a", "#2b5f8a", "#3b7d4f", "#b8860b", "#6a4c93", "#c0392b", "#16a085", "#7f8c8d", "#d35400", "#2c3e50", "#8e44ad", "#27ae60"];

const INK = "#2d2622";
const FAINT = "#6b625a";
const GRID = "#ddd6cc";

export function figureSvg(figure: Figure, width = 720, height = 320): string {
  const margin = { top: 16, right: 16, bottom: 44, left: 60 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const xMax = Math.max(0, ...figure.lines.flatMap((line) => line.x));
  const yMax = Math.max(0, ...figure.lines.flatMap((line) => line.y));
  const yTicks = niceTicks(yMax, 4);
  const yTop = yTicks.at(-1) ?? 1;
  const xTicks = niceTicks(xMax, 6).filter((tick) => xMax === 0 || tick <= xMax);
  const color = (i: number) => FIGURE_COLORS[i % FIGURE_COLORS.length];
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(figure.caption)}" font-family="system-ui, sans-serif" font-size="12">`,
  );
  parts.push(`<g transform="translate(${margin.left},${margin.top})">`);
  for (const tick of yTicks) {
    const y = plotH - (yTop > 0 ? (tick / yTop) * plotH : 0);
    parts.push(`<line x1="0" x2="${plotW}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`);
    parts.push(`<text x="-8" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="${FAINT}">${compact(tick)}</text>`);
  }
  for (const tick of xTicks) {
    const x = xMax > 0 ? (tick / xMax) * plotW : 0;
    parts.push(`<text x="${x.toFixed(1)}" y="${plotH + 18}" text-anchor="middle" fill="${FAINT}">${compact(tick)}</text>`);
  }
  parts.push(`<line x1="0" x2="${plotW}" y1="${plotH}" y2="${plotH}" stroke="${FAINT}"/>`);
  parts.push(`<line x1="0" x2="0" y1="0" y2="${plotH}" stroke="${FAINT}"/>`);
  figure.lines.forEach((line, i) => {
    const points = line.x.map((x, j) => ({ x, y: line.y[j] ?? 0 }));
    if (points.length === 0) return;
    parts.push(`<path d="${linePath(points, plotW, plotH, xMax, yTop)}" fill="none" stroke="${color(i)}" stroke-width="2"/>`);
  });
  parts.push(`<text x="${plotW / 2}" y="${plotH + 36}" text-anchor="middle" fill="${INK}">${escapeHtml(figure.xLabel)}</text>`);
  parts.push(`<text transform="rotate(-90)" x="${-plotH / 2}" y="-46" text-anchor="middle" fill="${INK}">${escapeHtml(figure.yLabel)}</text>`);
  figure.lines.forEach((line, i) => {
    const x = 8 + (i % 3) * (plotW / 3);
    const y = 14 + Math.floor(i / 3) * 16;
    parts.push(`<rect x="${x}" y="${y - 9}" width="12" height="3" fill="${color(i)}"/>`);
    parts.push(`<text x="${x + 16}" y="${y}" fill="${INK}">${escapeHtml(line.label)}</text>`);
  });
  parts.push("</g></svg>");
  return parts.join("");
}
