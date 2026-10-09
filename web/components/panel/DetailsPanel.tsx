"use client";

import { useEffect, useRef, useState } from "react";
import type { Artifacts } from "@/lib/client/artifacts";
import type { ChartView } from "@/lib/client/chart";
import type { ExportFormat, PanelSection } from "@/lib/enums";
import { ActivitySection } from "./ActivitySection";
import { DataSection } from "./DataSection";
import { ReportSection } from "./ReportSection";
import { RunsSection } from "./RunsSection";
import { ScenarioSection } from "./ScenarioSection";
import { Section } from "./Section";

/** The sections of this panel; the Profile tab reports its own. */
type DetailsSection = Exclude<PanelSection, "profile">;

type Props = {
  artifacts: Artifacts;
  onSectionOpen: (section: PanelSection) => void;
  onChartView: (view: ChartView, turnId: string) => void;
  onReferencesOpen: (parameter: string) => void;
  onExport: (format: ExportFormat) => void;
};

/** The right column: the present scenario, the data applied, every run, and every step. The newest run opens its section. */
export function DetailsPanel({ artifacts, onSectionOpen, onChartView, onReferencesOpen, onExport }: Props) {
  const [open, setOpen] = useState<Record<DetailsSection, boolean>>({ scenario: true, data: false, runs: true, report: false, activity: false });
  const runCount = useRef(artifacts.runs.length);
  const reportId = useRef(artifacts.report?.report_id ?? null);

  useEffect(() => {
    if (artifacts.runs.length > runCount.current) setOpen((state) => ({ ...state, runs: true }));
    runCount.current = artifacts.runs.length;
  }, [artifacts.runs.length]);

  // A new report (a first one, or a new version) opens its section the way a new run opens Runs.
  useEffect(() => {
    const id = artifacts.report?.report_id ?? null;
    if (id && id !== reportId.current) setOpen((state) => ({ ...state, report: true }));
    reportId.current = id;
  }, [artifacts.report]);

  const toggle = (section: DetailsSection) => (next: boolean) => {
    setOpen((state) => ({ ...state, [section]: next }));
    if (next) onSectionOpen(section);
  };

  return (
    <div className="text-sm">
      <h2 className="px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-ink-faint uppercase">Details</h2>
      <Section id="panel-scenario" title="Scenario" open={open.scenario} onToggle={toggle("scenario")}>
        <ScenarioSection config={artifacts.config} disease={artifacts.disease} onReferencesOpen={onReferencesOpen} />
      </Section>
      <Section id="panel-data" title="Data" count={artifacts.data.length} open={open.data} onToggle={toggle("data")}>
        <DataSection data={artifacts.data} />
      </Section>
      <Section id="panel-runs" title="Runs" count={artifacts.runs.length} open={open.runs} onToggle={toggle("runs")}>
        <RunsSection runs={artifacts.runs} onChartView={onChartView} />
      </Section>
      <Section id="panel-report" title="Report" open={open.report} onToggle={toggle("report")}>
        <ReportSection report={artifacts.report} onExport={onExport} />
      </Section>
      <Section id="panel-activity" title="Activity" count={artifacts.activity.length} open={open.activity} onToggle={toggle("activity")}>
        <ActivitySection items={artifacts.activity} />
      </Section>
    </div>
  );
}
