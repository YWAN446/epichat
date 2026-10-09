"use client";

import { useEffect, useRef, useState } from "react";
import type { Artifacts } from "@/lib/client/artifacts";
import type { ChartView } from "@/lib/client/chart";
import type { ExportFormat, PanelSection } from "@/lib/enums";
import { ActivitySection } from "./ActivitySection";
import { DataSection } from "./DataSection";
import { ParametersSection } from "./ParametersSection";
import { ReportSection } from "./ReportSection";
import { RunsSection } from "./RunsSection";
import { ScenarioSection } from "./ScenarioSection";
import { Section } from "./Section";

/** The sections of this panel; the Profile tab reports its own. */
type DetailsSection = Exclude<PanelSection, "profile">;

/** The tools that change the parameters the next run uses. */
const PARAMETER_TOOLS = new Set(["configure_simulation", "fetch_demographics", "fetch_vaccination_coverage", "fetch_health_system"]);

type Props = {
  artifacts: Artifacts;
  onSectionOpen: (section: PanelSection) => void;
  onChartView: (view: ChartView, turnId: string) => void;
  onReferencesOpen: (parameter: string) => void;
  onExport: (format: ExportFormat) => void;
  /** The participant's preferred report format, offered first. */
  preferredFormat: ExportFormat;
};

/** The Details tab: the present scenario, the literature and the data applied, the current parameters, every run, the report, and every step. The newest run opens its section. */
export function DetailsPanel({ artifacts, onSectionOpen, onChartView, onReferencesOpen, onExport, preferredFormat }: Props) {
  const [open, setOpen] = useState<Record<DetailsSection, boolean>>({ scenario: true, data: false, parameters: false, runs: true, report: false, activity: false });
  const runCount = useRef(artifacts.runs.length);
  const reportId = useRef(artifacts.report?.report_id ?? null);
  const revisions = artifacts.activity.filter((step) => step.ok && PARAMETER_TOOLS.has(step.name)).length;
  const revisionCount = useRef(revisions);

  useEffect(() => {
    if (artifacts.runs.length > runCount.current) setOpen((state) => ({ ...state, runs: true }));
    runCount.current = artifacts.runs.length;
  }, [artifacts.runs.length]);

  // A parameter change after a run opens Parameters, so the next run can be reviewed before it starts.
  useEffect(() => {
    if (revisions > revisionCount.current && artifacts.runs.length > 0) setOpen((state) => ({ ...state, parameters: true }));
    revisionCount.current = revisions;
  }, [revisions, artifacts.runs.length]);

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
      <Section id="panel-scenario" title="Scenario" open={open.scenario} onToggle={toggle("scenario")}>
        <ScenarioSection config={artifacts.config} disease={artifacts.disease} />
      </Section>
      <Section id="panel-data" title="Data" count={artifacts.data.length} open={open.data} onToggle={toggle("data")}>
        <DataSection data={artifacts.data} disease={artifacts.disease} onReferencesOpen={onReferencesOpen} />
      </Section>
      <Section id="panel-parameters" title="Parameters" open={open.parameters} onToggle={toggle("parameters")}>
        <ParametersSection params={artifacts.params} />
      </Section>
      <Section id="panel-runs" title="Runs" count={artifacts.runs.length} open={open.runs} onToggle={toggle("runs")}>
        <RunsSection runs={artifacts.runs} onChartView={onChartView} />
      </Section>
      <Section id="panel-report" title="Report" open={open.report} onToggle={toggle("report")}>
        <ReportSection report={artifacts.report} onExport={onExport} preferredFormat={preferredFormat} />
      </Section>
      <Section id="panel-activity" title="Activity" count={artifacts.activity.length} open={open.activity} onToggle={toggle("activity")}>
        <ActivitySection items={artifacts.activity} />
      </Section>
    </div>
  );
}
