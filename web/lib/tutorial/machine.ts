/** Where the tutorial is and what the practice screen shows. Pure: the page feeds it what the participant did. */
import type { DetailsSection } from "@/components/panel/DetailsPanel";
import type { PanelTab } from "@/components/panel/PanelTabs";
import type { ChartView } from "@/lib/client/chart";
import { CHART_VIEWS } from "@/lib/enums";
import { DASHBOARD_TARGETS, OPEN_DASHBOARD_TEXT, STEPS, type Part, type TutorialAction } from "./steps";

export type TutorialState = {
  step: number;
  part: number;
  /** How many turns of the recording are on show. */
  turnsShown: number;
  open: Record<DetailsSection, boolean>;
  view: ChartView;
  tab: PanelTab;
  /** Below 1024 px: the Dashboard's sheet is open. */
  sheetOpen: boolean;
  finished: boolean;
};

const SECTIONS: DetailsSection[] = ["scenario", "data", "parameters", "runs", "report", "activity"];
const MAX_TURNS = Math.max(...STEPS.flatMap((step) => step.parts.map((part) => part.showTurns ?? 0)));

export const INITIAL: TutorialState = {
  step: 0,
  part: 0,
  turnsShown: 0,
  open: { scenario: false, data: false, parameters: false, runs: false, report: false, activity: false },
  view: "infected",
  tab: "details",
  sheetOpen: false,
  finished: false,
};

/** On a narrow screen a Dashboard target is behind the Dashboard button until the sheet is open. */
const OPEN_DASHBOARD: Part = { target: "dashboard-button", text: OPEN_DASHBOARD_TEXT, completes: { type: "dashboard" } };

function ownPart(state: TutorialState): Part {
  return STEPS[state.step].parts[state.part];
}

/** What the card shows now. */
export function currentPart(state: TutorialState, narrow: boolean): Part {
  const part = ownPart(state);
  return narrow && !state.sheetOpen && DASHBOARD_TARGETS.has(part.target) ? OPEN_DASHBOARD : part;
}

function same(a: TutorialAction, b: TutorialAction): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "section" && b.type === "section") return a.section === b.section && a.open === b.open;
  if (a.type === "view" && b.type === "view") return a.view === b.view;
  if (a.type === "tab" && b.type === "tab") return a.tab === b.tab;
  return true;
}

/** The state after something the participant did; the same object when it was not the current part's action. */
export function advance(state: TutorialState, action: TutorialAction, narrow: boolean): TutorialState {
  if (state.finished) return state;
  const part = currentPart(state, narrow);
  if (!same(action, part.completes)) return state;
  if (part === OPEN_DASHBOARD) return { ...state, sheetOpen: true };

  const next: TutorialState = { ...state };
  if (action.type === "section") next.open = { ...state.open, [action.section]: true };
  if (action.type === "view") next.view = action.view;
  if (action.type === "tab") next.tab = action.tab;
  if (part.showTurns !== undefined) next.turnsShown = Math.max(state.turnsShown, part.showTurns);

  if (state.part + 1 < STEPS[state.step].parts.length) next.part = state.part + 1;
  else if (state.step + 1 < STEPS.length) {
    next.step = state.step + 1;
    next.part = 0;
  } else next.finished = true;

  // The next card points at the conversation: the sheet would cover it.
  if (!DASHBOARD_TARGETS.has(ownPart(next).target)) next.sheetOpen = false;
  return next;
}

/** Skip step: the current part's own action, applied for the participant. */
export function skip(state: TutorialState, narrow: boolean): TutorialState {
  return advance(state, currentPart(state, narrow).completes, narrow);
}

/** The number of the step that a change just completed, for the log; null when the step is still going. */
export function completedStep(before: TutorialState, after: TutorialState): number | null {
  if (after.step > before.step) return before.step;
  if (after.finished && !before.finished) return before.step;
  return null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isCount = (value: unknown, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

/** A state read back from the browser's storage; null unless it is one this machine could have produced. */
export function restore(saved: unknown): TutorialState | null {
  if (!isRecord(saved) || !isRecord(saved.open)) return null;
  const { step, part, turnsShown, open, view, tab, sheetOpen, finished } = saved;
  if (!isCount(step, STEPS.length - 1) || !isCount(part, STEPS[step].parts.length - 1) || !isCount(turnsShown, MAX_TURNS)) return null;
  if (!SECTIONS.every((section) => typeof open[section] === "boolean")) return null;
  if (typeof view !== "string" || !(CHART_VIEWS as readonly string[]).includes(view)) return null;
  if (tab !== "details" && tab !== "profile") return null;
  if (typeof sheetOpen !== "boolean" || typeof finished !== "boolean") return null;
  return {
    step,
    part,
    turnsShown,
    open: Object.fromEntries(SECTIONS.map((section) => [section, open[section]])) as Record<DetailsSection, boolean>,
    view: view as ChartView,
    tab,
    sheetOpen,
    finished,
  };
}
