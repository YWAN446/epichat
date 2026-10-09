"use client";

import { useEffect, useRef, useState } from "react";
import type { Artifacts } from "@/lib/client/artifacts";
import type { ChartView } from "@/lib/client/chart";
import type { PanelSection } from "@/lib/enums";
import { ActivitySection } from "./ActivitySection";
import { DataSection } from "./DataSection";
import { RunsSection } from "./RunsSection";
import { ScenarioSection } from "./ScenarioSection";
import { Section } from "./Section";

type Props = { artifacts: Artifacts; onSectionOpen: (section: PanelSection) => void; onChartView: (view: ChartView, turnId: string) => void };

/** The right column: the present scenario, the data applied, every run, and every step. The newest run opens its section. */
export function DetailsPanel({ artifacts, onSectionOpen, onChartView }: Props) {
  const [open, setOpen] = useState<Record<PanelSection, boolean>>({ scenario: true, data: false, runs: true, activity: false });
  const runCount = useRef(artifacts.runs.length);

  useEffect(() => {
    if (artifacts.runs.length > runCount.current) setOpen((state) => ({ ...state, runs: true }));
    runCount.current = artifacts.runs.length;
  }, [artifacts.runs.length]);

  const toggle = (section: PanelSection) => (next: boolean) => {
    setOpen((state) => ({ ...state, [section]: next }));
    if (next) onSectionOpen(section);
  };

  return (
    <div className="text-sm">
      <h2 className="px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-ink-faint uppercase">Details</h2>
      <Section id="panel-scenario" title="Scenario" open={open.scenario} onToggle={toggle("scenario")}>
        <ScenarioSection config={artifacts.config} disease={artifacts.disease} />
      </Section>
      <Section id="panel-data" title="Data" count={artifacts.data.length} open={open.data} onToggle={toggle("data")}>
        <DataSection data={artifacts.data} />
      </Section>
      <Section id="panel-runs" title="Runs" count={artifacts.runs.length} open={open.runs} onToggle={toggle("runs")}>
        <RunsSection runs={artifacts.runs} onChartView={onChartView} />
      </Section>
      <Section id="panel-activity" title="Activity" count={artifacts.activity.length} open={open.activity} onToggle={toggle("activity")}>
        <ActivitySection items={artifacts.activity} />
      </Section>
    </div>
  );
}
