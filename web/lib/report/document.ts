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

/** `band`: a replicate run's 10th and 90th percentiles on the same days as the line, drawn as shading under it. */
export type FigureLine = { label: string; x: number[]; y: number[]; band?: { lower: number[]; upper: number[] } };

/** A stretch of text in one weight. A block's runs, joined, are its plain text. */
export type TextRun = { text: string; bold?: true };

/** `runs` and `itemRuns` (one list per item) are present only when some of the text is bold; a renderer without them shows the plain text. */
export type ReportBlock =
  | { kind: "paragraph"; text: string; runs?: TextRun[] }
  | { kind: "bullets"; items: string[]; itemRuns?: TextRun[][] }
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

const NUMBERED = /^\d+[.)]\s+/;
/**
 * `**bold**`: the bold text is not empty and neither starts nor ends with a space, and the marks do not
 * touch a Latin letter, a digit or another star on their outer side, so `2**3 and 4**5` and `***x***` stay as typed.
 */
const BOLD = /(?<![\w*])\*\*(?!\s)((?:(?!\*\*).)+?)(?<!\s)\*\*(?![\w*])/g;

/** The text without its bold marks, and the runs when any of it is bold. Marks that do not pair up stay as typed. */
export function textRuns(source: string): { text: string; runs?: TextRun[] } {
  const runs: TextRun[] = [];
  let at = 0;
  for (const match of source.matchAll(BOLD)) {
    if (match.index > at) runs.push({ text: source.slice(at, match.index) });
    runs.push({ text: match[1], bold: true });
    at = match.index + match[0].length;
  }
  if (runs.length === 0) return { text: source };
  if (at < source.length) runs.push({ text: source.slice(at) });
  return { text: runs.map((run) => run.text).join(""), runs };
}

function paragraph(lines: string[]): ReportBlock {
  return { kind: "paragraph", ...textRuns(lines.join(" ")) };
}

function bullets(lines: string[]): ReportBlock {
  const parsed = lines.map((line) => textRuns(line.replace(BULLET, "")));
  const items = parsed.map((item) => item.text);
  return parsed.some((item) => item.runs) ? { kind: "bullets", items, itemRuns: parsed.map((item) => item.runs ?? [{ text: item.text }]) } : { kind: "bullets", items };
}

/**
 * Blank-line-separated chunks. Within a chunk, a run of dash or star lines is a
 * bullet list, a numbered line is its own paragraph (its number kept), and
 * other neighbouring lines join into one paragraph. `**bold**` becomes runs.
 */
export function narrativeBlocks(text: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  for (const chunk of text.split(/\n\s*\n/)) {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    let prose: string[] = [];
    let list: string[] = [];
    const flush = () => {
      if (prose.length > 0) blocks.push(paragraph(prose));
      if (list.length > 0) blocks.push(bullets(list));
      prose = [];
      list = [];
    };
    for (const line of lines) {
      if (BULLET.test(line)) {
        if (prose.length > 0) flush();
        list.push(line);
      } else if (NUMBERED.test(line)) {
        flush();
        blocks.push(paragraph([line]));
      } else {
        if (list.length > 0) flush();
        prose.push(line);
      }
    }
    flush();
  }
  return blocks;
}

/** One line of a figure, thinned so a long run cannot bloat the document; a band the same length is thinned on the same days. */
export function figureLine(label: string, x: number[], y: number[], band?: { lower: number[]; upper: number[] }): FigureLine {
  const points = thinPoints(x, y, MAX_FIGURE_POINTS);
  const line: FigureLine = { label, x: points.map((p) => p.x), y: points.map((p) => p.y) };
  if (band && band.lower.length === y.length && band.upper.length === y.length && x.length === y.length) {
    const thin = (values: number[]) => thinPoints(x, values, MAX_FIGURE_POINTS).map((p) => p.y);
    line.band = { lower: thin(band.lower), upper: thin(band.upper) };
  }
  return line;
}

export function wordCount(narrative: ReportNarrative): number {
  return [narrative.summary, narrative.meaning, narrative.limitations, narrative.next_steps].reduce((n, text) => n + (text.match(/\S+/g)?.length ?? 0), 0);
}
