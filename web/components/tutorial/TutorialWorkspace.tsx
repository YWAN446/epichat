"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { deriveArtifacts } from "@/lib/client/artifacts";
import { chipsFor } from "@/lib/client/drafts";
import { layoutStore, useColumn, useLayout, type Side } from "@/lib/client/layout";
import { track } from "@/lib/client/track";
import { tryNextKey } from "@/lib/client/tryNext";
import { lastRecap, lastStage, lastSuggestions } from "@/lib/client/turn";
import type { TutorialEntry } from "@/lib/enums";
import type { DiseaseOption } from "@/lib/profile/options";
import type { ProfileFields } from "@/lib/profile/schema";
import { INITIAL, advance, completedStep, currentPart, skip, type TutorialState } from "@/lib/tutorial/machine";
import type { Recording } from "@/lib/tutorial/recording";
import { clearProgress, loadProgress, saveProgress } from "@/lib/tutorial/session";
import type { TutorialAction } from "@/lib/tutorial/steps";
import { ChatHeader } from "../ChatHeader";
import { Composer } from "../Composer";
import { DetailsPanel } from "../panel/DetailsPanel";
import { PanelTabs } from "../panel/PanelTabs";
import { PracticeReport } from "../panel/ReportSection";
import { RecapBar } from "../RecapBar";
import { useSessionId } from "../SessionProvider";
import { StageStrip } from "../StageStrip";
import { Suggestions } from "../Suggestions";
import { Turn } from "../Turn";
import { Welcome } from "../Welcome";
import { WorkspaceShell } from "../WorkspaceShell";
import { ProfileSummary } from "./ProfileSummary";
import { Spotlight } from "./Spotlight";
import type { StepCardProps } from "./StepCard";

type Props = {
  recording: Recording;
  profile: ProfileFields;
  diseases: DiseaseOption[];
  /** The participant has seen the tutorial before: this run-through is logged as a replay. */
  replay: boolean;
  entry: TutorialEntry;
  contactEmail: string;
};

/** How long a recorded answer takes to appear after the participant's message. */
const ANSWER_MS = 900;
const NOTHING = () => {};

/**
 * The tutorial's practice run: the chat workspace, built from its own components, playing the recording one step at
 * a time. Nothing here sends a message, saves a conversation or starts a run; the only requests are the counts of
 * steps done and skipped.
 */
export function TutorialWorkspace({ recording, profile, diseases, replay, entry, contactEmail }: Props) {
  const router = useRouter();
  const sessionId = useSessionId() ?? undefined;
  const layout = useLayout();
  const leftColumn = useColumn("left");
  const rightColumn = useColumn("right");
  const narrow = !rightColumn;

  const [state, setState] = useState<TutorialState>(INITIAL);
  /** Turns whose answer has appeared; the newest shown turn waits a moment for its answer. */
  const [answered, setAnswered] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const isReplay = useRef(replay);
  const skippedInStep = useRef(false);
  const booted = useRef(false);
  const column = useRef<HTMLElement>(null);
  const inputBox = useRef<HTMLTextAreaElement>(null);

  // A reload resumes where the participant was; otherwise this is a start, and it is counted once.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const saved = loadProgress();
    if (!saved) {
      track({ kind: "tutorial_started", sessionId, replay: isReplay.current, entry });
      return;
    }
    isReplay.current = saved.replay;
    queueMicrotask(() => {
      setState(saved.state);
      setAnswered(saved.state.turnsShown);
    });
  }, [entry, sessionId]);

  // The recorded answer follows the message after a moment, or at once when the browser asks for less motion.
  useEffect(() => {
    if (answered >= state.turnsShown) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setAnswered(state.turnsShown), still ? 0 : ANSWER_MS);
    return () => window.clearTimeout(timer);
  }, [answered, state.turnsShown]);

  useEffect(() => {
    const element = column.current;
    if (element && state.turnsShown > 0) element.scrollTo({ top: element.scrollHeight });
  }, [state.turnsShown, answered]);

  const appearing = answered < state.turnsShown;
  const shown = useMemo(() => recording.turns.slice(0, state.turnsShown), [recording, state.turnsShown]);
  const settled = useMemo(() => recording.turns.slice(0, Math.min(answered, state.turnsShown)), [recording, answered, state.turnsShown]);
  const artifacts = useMemo(() => deriveArtifacts(settled), [settled]);
  const part = currentPart(state, narrow);
  const pressText = part.press ? recording.press[part.press] : undefined;

  function leave() {
    clearProgress();
    router.push("/chat");
  }

  function settle(next: TutorialState, how: "done" | "skipped") {
    if (next === state) return;
    if (how === "skipped") skippedInStep.current = true;
    const step = completedStep(state, next);
    if (step !== null) {
      track({ kind: "tutorial_step", sessionId, replay: isReplay.current, step, how: skippedInStep.current ? "skipped" : "done" });
      skippedInStep.current = false;
    }
    setState(next);
    if (next.finished) {
      track({ kind: "tutorial_finished", sessionId, replay: isReplay.current });
      leave();
    } else saveProgress(next, isReplay.current);
  }

  /** Something the participant pressed; ignored unless it is what the current card asks for, or while an answer is appearing. */
  function did(action: TutorialAction) {
    if (!appearing) settle(advance(state, action, narrow), "done");
  }
  function skipStep() {
    if (!appearing) settle(skip(state, narrow), "skipped");
  }
  function end() {
    track({ kind: "tutorial_ended", sessionId, replay: isReplay.current, step: state.step });
    leave();
  }

  const card: StepCardProps =
    state.step === 0
      ? { step: 0, text: part.text, onEnd: end, endLabel: "Skip the tutorial", primary: { label: "Start", onPress: () => did({ type: "start" }) } }
      : part.completes.type === "finish"
        ? { step: state.step, text: part.text, onEnd: end, primary: { label: "Start my own conversation", onPress: () => did({ type: "finish" }) } }
        : { step: state.step, text: part.text, onSkip: skipStep, onEnd: end };

  const stage = lastStage(settled);
  const chips = appearing || state.turnsShown === 0 ? [] : chipsFor(stage, lastSuggestions(settled)).items;
  const tryNext = { key: tryNextKey(settled, appearing), onPick: (label: string) => label === recording.press.option && did({ type: "option" }) };
  const composer = <Composer value="" onChange={NOTHING} onSubmit={(event) => event.preventDefault()} onKeyDown={NOTHING} disabled maxLength={1} inputRef={inputBox} placeholder="Typing is off in the practice run." large={state.turnsShown === 0} />;

  return (
    <>
      <WorkspaceShell
        header={
          <ChatHeader
            busy={false}
            onShare={NOTHING}
            canShare={false}
            onMenu={() => (leftColumn ? layoutStore.toggle("left") : setDrawer((open) => !open))}
            onDashboard={() => did({ type: "dashboard" })}
            menuOpen={leftColumn ? layout.left.open : drawer}
            dashboardOpen={rightColumn || state.sheetOpen}
            unseen={false}
          />
        }
        sidebar={
          <div className="p-3">
            <p className="rounded-lg bg-accent-wash px-3 py-2 text-sm font-medium text-ink">Practice run</p>
            <p className="mt-2 px-1 text-xs text-ink-faint">A recorded example. Your own conversations will be listed here.</p>
          </div>
        }
        panel={
          <PanelTabs
            tab={state.tab}
            onTab={(tab) => did({ type: "tab", tab })}
            details={
              <DetailsPanel
                artifacts={artifacts}
                onSectionOpen={NOTHING}
                onChartView={(view) => did({ type: "view", view })}
                onReferencesOpen={NOTHING}
                onUseReference={NOTHING}
                busy
                onExport={NOTHING}
                preferredFormat={profile.reportFormat}
                practice={{
                  open: state.open,
                  onToggle: (section, open) => did({ type: "section", section, open }),
                  view: state.view,
                  report: artifacts.report ? <PracticeReport title={recording.report.title} subtitle={recording.report.subtitle} /> : <p className="text-ink-faint">Ask the assistant for a report and it appears here, with downloads.</p>,
                }}
              />
            }
            profile={<ProfileSummary profile={profile} diseases={diseases} />}
          />
        }
        drawerOpen={drawer}
        sheetOpen={narrow && state.sheetOpen}
        onClose={() => setDrawer(false)}
        columnRef={column}
        // The Dashboard is what the tutorial is about: its column stays open here even if it was collapsed in the chat.
        layout={{ left: layout.left, right: { ...layout.right, open: true } }}
        onResize={(side: Side, width: number) => layoutStore.resize(side, width)}
      >
        {state.turnsShown === 0 ? (
          <div className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col px-4 py-6">
            <Welcome disabled={false} contactEmail={contactEmail} error={null} target={recording.press.example} onPick={(text) => text === recording.press.example && did({ type: "example" })}>
              {composer}
            </Welcome>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col px-4 py-6">
            {shown.map((turn, index) =>
              index < answered ? (
                <Turn key={turn.id} turn={turn} status={null} tryNext={tryNext} optionTarget={recording.press.option} practice />
              ) : (
                <Turn key={turn.id} turn={{ ...turn, blocks: [] }} status="Working…" practice />
              ),
            )}
          </div>
        )}

        {state.turnsShown > 0 && (
          <footer className="sticky bottom-0 border-t border-line bg-paper/95 backdrop-blur-sm">
            <div className="mx-auto max-w-[46rem] px-4 pt-2.5">
              <RecapBar items={lastRecap(settled)} />
              <StageStrip stage={stage} />
              <Suggestions items={chips} disabled={false} target={part.target === "reply" ? pressText : undefined} onPick={(reply) => reply === pressText && did({ type: "reply" })} />
            </div>
            {composer}
          </footer>
        )}
      </WorkspaceShell>
      {!state.finished && <Spotlight key={`${state.step}.${state.part}.${part.target}`} target={part.target} card={card} onMissing={skipStep} />}
    </>
  );
}
