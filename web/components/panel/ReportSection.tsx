"use client";

import type { ExportFormat } from "@/lib/enums";
import type { ReportPayload } from "@/lib/report/document";

const LINK = "rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-accent hover:border-accent hover:bg-accent-wash";

/** The four downloads, in the order the panel and the conversation offer them. */
export const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: "md", label: "Markdown" },
  { format: "html", label: "HTML" },
  { format: "docx", label: "Word" },
  { format: "pdf", label: "PDF" },
];

type DownloadsProps = { reportId: string; onExport: (format: ExportFormat) => void };

/** The download links for one report, plus Open for the HTML in a new tab. */
export function ReportDownloads({ reportId, onExport }: DownloadsProps) {
  const base = `/api/reports/${reportId}`;
  return (
    <div className="flex flex-wrap gap-2">
      {FORMATS.map(({ format, label }) => (
        <a key={format} href={`${base}?format=${format}${format === "html" ? "&download=1" : ""}`} download onClick={() => onExport(format)} className={LINK}>
          {label}
        </a>
      ))}
      <a href={`${base}?format=html`} target="_blank" rel="noreferrer" onClick={() => onExport("html")} className={LINK}>
        Open
      </a>
    </div>
  );
}

type Props = { report: ReportPayload | null; onExport: (format: ExportFormat) => void };

/** The latest report: its title and version, its sections, and the four downloads (report spec, section 10). */
export function ReportSection({ report, onExport }: Props) {
  if (!report || !report.report_id) return <p className="text-ink-faint">The report appears here once you ask for one.</p>;
  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{report.title}</p>
        <p className="text-xs text-ink-faint">
          Version {report.version} · {report.sections.length} sections · about {report.words} words of narrative
        </p>
      </div>
      <ol className="list-decimal pl-5 text-xs text-ink-soft">
        {report.sections.map((section) => (
          <li key={section.id}>{section.heading}</li>
        ))}
      </ol>
      <ReportDownloads reportId={report.report_id} onExport={onExport} />
    </div>
  );
}
