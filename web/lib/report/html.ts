/** The report as one self-contained HTML page: no script, no external resource, prints cleanly (report spec, section 11). */
import type { ReportBlock, ReportDocument } from "./document";
import { escapeHtml } from "./escape";
import { figureSvg } from "./svg";

export { escapeHtml };

const STYLE = `
:root { --paper: #faf7f2; --ink: #2d2622; --soft: #5a504a; --faint: #8a8078; --line: #ddd6cc; --accent: #8c3b2a; }
html { background: var(--paper); color: var(--ink); font: 16px/1.5 Georgia, "Source Serif Pro", serif; }
body { max-width: 46rem; margin: 0 auto; padding: 2rem 1rem; }
h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 .25rem; }
.subtitle { color: var(--faint); margin: 0 0 2rem; font-style: italic; }
h2 { font-size: 1.25rem; margin: 2rem 0 .75rem; border-bottom: 1px solid var(--line); padding-bottom: .25rem; }
table { width: 100%; border-collapse: collapse; margin: .75rem 0; font-size: .9rem; }
th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--soft); font-weight: 600; }
caption { text-align: left; color: var(--faint); font-size: .85rem; padding: .25rem 0; caption-side: top; }
figure { margin: 1rem 0; }
figure svg { width: 100%; height: auto; }
figcaption { color: var(--faint); font-size: .85rem; }
.note { color: var(--faint); font-style: italic; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; }
.kv dt { color: var(--soft); }
.kv dd { margin: 0; font-weight: 600; }
@media print {
  @page { margin: 18mm; }
  body { padding: 0; max-width: none; }
  h2 { break-after: avoid; }
  tr, figure { break-inside: avoid; }
  thead { display: table-header-group; }
}
`;

function block(b: ReportBlock): string {
  switch (b.kind) {
    case "paragraph":
      return `<p>${escapeHtml(b.text)}</p>`;
    case "bullets":
      return `<ul>${b.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    case "note":
      return `<p class="note">${escapeHtml(b.text)}</p>`;
    case "keyValues":
      return `<dl class="kv">${b.items.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
    case "table": {
      const caption = b.caption ? `<caption>${escapeHtml(b.caption)}</caption>` : "";
      const head = `<thead><tr>${b.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>`;
      const body = `<tbody>${b.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
      return `<table>${caption}${head}${body}</table>`;
    }
    case "figure":
      return `<figure id="${escapeHtml(b.id)}">${figureSvg(b)}<figcaption>${escapeHtml(b.caption)}</figcaption></figure>`;
  }
}

export function renderHtml(doc: ReportDocument): string {
  const sections = doc.sections.map((section) => `<section id="${escapeHtml(section.id)}"><h2>${escapeHtml(section.heading)}</h2>${section.blocks.map(block).join("")}</section>`).join("");
  return (
    `<!doctype html><html lang="${escapeHtml(doc.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(doc.title)}</title><style>${STYLE}</style></head>` +
    `<body><h1>${escapeHtml(doc.title)}</h1><p class="subtitle">${escapeHtml(doc.subtitle)}</p>${sections}</body></html>`
  );
}
