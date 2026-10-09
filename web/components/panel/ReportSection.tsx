"use client";

import { useEffect, useRef, useState } from "react";
import { fetchReport } from "@/lib/client/download";
import type { ExportFormat } from "@/lib/enums";
import type { ReportPayload } from "@/lib/report/document";

const LINK = "rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-accent hover:border-accent hover:bg-accent-wash disabled:opacity-50";

/** The four downloads, in the order the panel and the conversation offer them. */
export const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: "md", label: "Markdown" },
  { format: "html", label: "HTML" },
  { format: "docx", label: "Word" },
  { format: "pdf", label: "PDF" },
];

/** How long the route's message stays under the buttons. */
const MESSAGE_MS = 60_000;

type DownloadsProps = { reportId: string; onExport: (format: ExportFormat) => void };

/**
 * The download links for one report, plus Open for the HTML in a new tab.
 * Markdown and HTML are plain links (the app renders them). Word and PDF are
 * fetched, so a sim-service failure shows the route's message here for a
 * minute instead of handing the browser a JSON file (report spec, section 11).
 */
export function ReportDownloads({ reportId, onExport }: DownloadsProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const timer = useRef<number | null>(null);
  const base = `/api/reports/${reportId}`;
  const hrefOf = (format: ExportFormat) => `${base}?format=${format}${format === "html" ? "&download=1" : ""}`;

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function download(format: ExportFormat) {
    onExport(format);
    setBusy(format);
    const result = await fetchReport(hrefOf(format));
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMessage(null), MESSAGE_MS);
      return;
    }
    const url = URL.createObjectURL(result.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {FORMATS.map(({ format, label }) =>
          format === "md" || format === "html" ? (
            <a key={format} href={hrefOf(format)} download onClick={() => onExport(format)} className={LINK}>
              {label}
            </a>
          ) : (
            <button key={format} type="button" disabled={busy !== null} onClick={() => void download(format)} className={LINK}>
              {busy === format ? `${label}…` : label}
            </button>
          ),
        )}
        <a href={`${base}?format=html`} target="_blank" rel="noreferrer" onClick={() => onExport("html")} className={LINK}>
          Open
        </a>
      </div>
      {message && (
        <p role="status" className="mt-2 text-xs text-warn-ink">
          {message}
        </p>
      )}
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
