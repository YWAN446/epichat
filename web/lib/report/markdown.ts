/** The report as Markdown: headings, paragraphs, bullets, GitHub tables; figures become a one-line note (report spec, section 11). */
import type { ReportBlock, ReportDocument } from "./document";

/** Markdown-significant characters become literal text. */
function plain(text: string): string {
  return text.replace(/([\\|*_`#<>[\]])/g, "\\$1");
}

/** A table cell: one line, or the table breaks. */
function cell(text: string): string {
  return plain(text.replace(/\s*\n\s*/g, " "));
}

function table(columns: string[], rows: string[][], caption?: string): string {
  const head = `| ${columns.map(cell).join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(cell).join(" | ")} |`).join("\n");
  return `${caption ? `**${plain(caption)}**\n\n` : ""}${head}\n${body}`;
}

function block(b: ReportBlock): string {
  switch (b.kind) {
    case "paragraph":
      return plain(b.text);
    case "bullets":
      return b.items.map((item) => `- ${plain(item)}`).join("\n");
    case "note":
      return `*${plain(b.text)}*`;
    case "keyValues":
      return table(["Setting", "Value"], b.items.map(([key, value]) => [key, value]));
    case "table":
      return table(b.columns, b.rows, b.caption);
    case "figure":
      return `*Figure: ${plain(b.caption)}. The chart is in the HTML and PDF versions of this report.*`;
  }
}

export function renderMarkdown(doc: ReportDocument): string {
  const sections = doc.sections.map((section) => `## ${plain(section.heading)}\n\n${section.blocks.map(block).join("\n\n")}`).join("\n\n");
  return `# ${plain(doc.title)}\n\n*${plain(doc.subtitle)}*\n\n${sections}\n`;
}
