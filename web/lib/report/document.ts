/** The report as one structured document (report spec, section 4). Every renderer reads this; nothing else. */
import { thinPoints } from "@/lib/client/chart";

export const DOCUMENT_VERSION = 1 as const;
export const MAX_FIGURE_POINTS = 400;

export type SectionId = "summary" | "results" | "meaning" | "modelled" | "decisions" | "limitations" | "next_steps" | "appendix";

/** Reader order. */
export const SECTION_HEADINGS: Record<SectionId, string> = {
  summary: "Summary",
  results: "Key results",
  meaning: "What the results mean",
  modelled: "What was modelled",
  decisions: "Decisions made",
  limitations: "Limitations and assumptions",
  next_steps: "Suggested next steps",
  appendix: "Appendix",
};

export type FigureLine = { label: string; x: number[]; y: number[] };

export type ReportBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "table"; caption?: string; columns: string[]; rows: string[][] }
  | { kind: "keyValues"; items: [string, string][] }
  | { kind: "figure"; id: string; caption: string; xLabel: string; yLabel: string; lines: FigureLine[] }
  | { kind: "note"; text: string };

export type ReportSection = { id: SectionId; heading: string; blocks: ReportBlock[] };

export type ReportDocument = {
  version: typeof DOCUMENT_VERSION;
  title: string;
  subtitle: string;
  generatedAt: string;
  language: string;
  sections: ReportSection[];
};

/** The model's part, validated by the tool's schema. */
export type ReportNarrative = { title?: string; summary: string; meaning: string; limitations: string; next_steps: string };

/** The stored tool result: enough for the panel; the document lives in the reports table. */
export type ReportPayload = { kind: "report"; report_id: string | null; version: number; title: string; sections: { id: SectionId; heading: string }[]; words: number };

const BULLET = /^\s*[-*]\s+/;

/** Blank-line-separated chunks: a chunk whose every line is a dash or star line is a bullet list; anything else is one paragraph. */
export function narrativeBlocks(text: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  for (const chunk of text.split(/\n\s*\n/)) {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) continue;
    if (lines.every((line) => BULLET.test(line))) blocks.push({ kind: "bullets", items: lines.map((line) => line.replace(BULLET, "")) });
    else blocks.push({ kind: "paragraph", text: lines.join(" ") });
  }
  return blocks;
}

/** One line of a figure, thinned so a long run cannot bloat the document. */
export function figureLine(label: string, x: number[], y: number[]): FigureLine {
  const points = thinPoints(x, y, MAX_FIGURE_POINTS);
  return { label, x: points.map((p) => p.x), y: points.map((p) => p.y) };
}

export function wordCount(narrative: ReportNarrative): number {
  return [narrative.summary, narrative.meaning, narrative.limitations, narrative.next_steps].reduce((n, text) => n + (text.match(/\S+/g)?.length ?? 0), 0);
}
