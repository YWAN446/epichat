"use client";

import type { ExportFormat } from "@/lib/enums";
import type { ReportPayload } from "@/lib/report/document";
import { ReportDownloads } from "./panel/ReportSection";

type Props = { payload: ReportPayload; onExport?: (format: ExportFormat) => void };

/** Under a successful write_report call: the report is ready, with the same downloads as the panel (report spec, section 10). */
export function ReportLine({ payload, onExport }: Props) {
  if (!payload.report_id) return null;
  return (
    <section aria-label="Report" className="my-3 rounded-xl border border-line bg-surface p-3">
      <p className="text-sm">
        <span className="font-medium">Report ready:</span> {payload.title}, version {payload.version}
      </p>
      <div className="mt-2">
        <ReportDownloads reportId={payload.report_id} onExport={onExport ?? (() => {})} />
      </div>
    </section>
  );
}
