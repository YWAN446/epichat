"use client";

import { useState } from "react";
import { deriveArtifacts } from "@/lib/client/artifacts";
import type { ShareSnapshot } from "@/lib/share/snapshot";
import { Brand } from "./Brand";
import { ActivitySection } from "./panel/ActivitySection";
import { DataSection } from "./panel/DataSection";
import { ParametersSection } from "./panel/ParametersSection";
import { RunsSection } from "./panel/RunsSection";
import { ScenarioSection } from "./panel/ScenarioSection";
import { Section } from "./panel/Section";
import { Turn } from "./Turn";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const LINK = "inline-block rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-accent hover:border-accent hover:bg-accent-wash";

type Props = { snapshot: ShareSnapshot; token: string; takenAt: string };
type Open = Record<"scenario" | "data" | "parameters" | "runs" | "report" | "activity", boolean>;

/**
 * A shared conversation, read-only: the turns without thumbs or chips, the
 * panel's sections without their events, the report behind its own link.
 * Nothing to type, press, or sign in to (share spec, section 7).
 */
export function SharedConversation({ snapshot, token, takenAt }: Props) {
  const [open, setOpen] = useState<Open>({ scenario: true, data: false, parameters: false, runs: true, report: true, activity: false });
  const artifacts = deriveArtifacts(snapshot.turns);
  const toggle = (key: keyof Open) => (next: boolean) => setOpen((state) => ({ ...state, [key]: next }));
  const report = snapshot.report;

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-paper/90 px-4 py-3">
        <div className="mx-auto flex max-w-[76rem] flex-wrap items-center gap-x-4 gap-y-1">
          <Brand />
          <p className="text-xs text-ink-faint">A frozen copy of an EpiChat conversation, shared by a study participant on {DATE.format(new Date(takenAt))}</p>
        </div>
      </header>
      <div className="mx-auto grid max-w-[76rem] gap-6 px-4 py-6 xl:grid-cols-[minmax(0,46rem)_24rem]">
        <main className="min-w-0">
          <h1 className="mb-4 text-xl font-semibold">{snapshot.title}</h1>
          {snapshot.turns.map((turn) => (
            <Turn key={turn.id} turn={turn} status={null} feedback={null} />
          ))}
        </main>
        <aside aria-label="Details" className="text-sm">
          <Section id="shared-scenario" title="Scenario" open={open.scenario} onToggle={toggle("scenario")}>
            <ScenarioSection config={artifacts.config} disease={artifacts.disease} />
          </Section>
          <Section id="shared-data" title="Data" count={artifacts.data.length} open={open.data} onToggle={toggle("data")}>
            <DataSection data={artifacts.data} disease={artifacts.disease} references={false} />
          </Section>
          <Section id="shared-parameters" title="Parameters" open={open.parameters} onToggle={toggle("parameters")}>
            <ParametersSection params={artifacts.params} />
          </Section>
          <Section id="shared-runs" title="Runs" count={artifacts.runs.length} open={open.runs} onToggle={toggle("runs")}>
            <RunsSection runs={artifacts.runs} onChartView={() => {}} />
          </Section>
          <Section id="shared-report" title="Report" open={open.report} onToggle={toggle("report")}>
            {report ? (
              <div className="space-y-2">
                <p className="font-medium">{report.title}</p>
                <p className="text-xs text-ink-faint">{report.subtitle}</p>
                <a href={`/s/${token}/report`} target="_blank" rel="noreferrer" className={LINK}>
                  View report
                </a>
              </div>
            ) : (
              <p className="text-ink-faint">No report was written.</p>
            )}
          </Section>
          <Section id="shared-activity" title="Activity" count={artifacts.activity.length} open={open.activity} onToggle={toggle("activity")}>
            <ActivitySection items={artifacts.activity} />
          </Section>
        </aside>
      </div>
      <footer className="border-t border-line px-4 py-4 text-center text-xs text-ink-faint">EpiChat is a research prototype from Emory University.</footer>
    </div>
  );
}
