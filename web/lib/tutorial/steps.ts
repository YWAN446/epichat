/** The first-use tutorial's steps (tutorial spec, "The steps"): what each card says, what it points at, and what completes it. */
import type { DetailsSection } from "@/components/panel/DetailsPanel";
import type { PanelTab } from "@/components/panel/PanelTabs";
import type { ChartView } from "@/lib/client/chart";

/** Something the participant did on the practice screen. */
export type TutorialAction =
  | { type: "start" }
  | { type: "example" }
  | { type: "reply" }
  | { type: "option" }
  | { type: "section"; section: DetailsSection; open: boolean }
  | { type: "view"; view: ChartView }
  | { type: "tab"; tab: PanelTab }
  | { type: "dashboard" }
  | { type: "next" }
  | { type: "finish" };

/** What a card points at: a `data-tutorial` value, the Profile tab, or nothing (a card in the middle of the screen). */
export type Target =
  | "centre"
  | "example"
  | "reply"
  | "option"
  | "dashboard-button"
  | "tab-profile"
  | "panel-scenario"
  | "panel-data"
  | "panel-parameters"
  | "panel-runs"
  | "panel-report"
  | "view-incidence";

export type Part = {
  target: Target;
  text: string;
  /** The action that completes the part. */
  completes: TutorialAction;
  /** Turns of the recording on show once the part is complete; absent: unchanged. */
  showTurns?: number;
  /** Which of the recording's chip texts this part presses. */
  press?: "example" | "dataReply" | "runReply" | "option" | "reportReply";
};

export type Step = { number: number; parts: Part[] };

const open = (section: DetailsSection): TutorialAction => ({ type: "section", section, open: true });

export const STEPS: Step[] = [
  {
    number: 0,
    parts: [{ target: "centre", text: "A 3-minute practice run. You'll set up a small outbreak, run it, and find the results. Nothing here is sent or saved.", completes: { type: "start" } }],
  },
  {
    number: 1,
    parts: [{ target: "example", text: "Start by asking. Examples like this one are a quick way in; later you can type anything.", completes: { type: "example" }, showTurns: 1, press: "example" }],
  },
  {
    number: 2,
    parts: [
      {
        target: "panel-scenario",
        text: "This is the Dashboard. The conversation is where you ask; the Dashboard keeps the record: the scenario, its data, every run, and the report. Open Scenario to see the setup the assistant just proposed.",
        completes: open("scenario"),
      },
    ],
  },
  {
    number: 3,
    parts: [
      { target: "reply", text: "The assistant asks before it looks anything up. Press this reply to fetch real data for Kenya.", completes: { type: "reply" }, showTurns: 2, press: "dataReply" },
      { target: "panel-data", text: "Every number has a source. Open Data to see where the population, birth rate and vaccine coverage came from.", completes: open("data") },
    ],
  },
  {
    number: 4,
    parts: [
      { target: "reply", text: "Suggested replies save typing. Press this one to run the simulation.", completes: { type: "reply" }, showTurns: 3, press: "runReply" },
      { target: "panel-runs", text: "The run is in the Dashboard. Open Runs for its key numbers and chart.", completes: open("runs") },
    ],
  },
  {
    number: 5,
    parts: [{ target: "view-incidence", text: "The same run, seen another way. Switch the chart to Incidence to see new cases per day.", completes: { type: "view", view: "incidence" } }],
  },
  {
    number: 6,
    parts: [
      {
        target: "option",
        text: "Try a what-if. This adds a vaccination campaign and runs again; the Dashboard shows both runs so you can compare.",
        completes: { type: "option" },
        showTurns: 4,
        press: "option",
      },
    ],
  },
  {
    number: 7,
    parts: [{ target: "panel-parameters", text: "The exact values the runs used are here, with where each came from.", completes: open("parameters") }],
  },
  {
    number: 8,
    parts: [
      { target: "reply", text: "Ask for a report when you're done.", completes: { type: "reply" }, showTurns: 5, press: "reportReply" },
      { target: "panel-report", text: "Your report and its downloads live in the Dashboard.", completes: open("report") },
    ],
  },
  {
    number: 9,
    parts: [{ target: "tab-profile", text: "Your profile shapes how the assistant answers. You can change it here at any time.", completes: { type: "tab", tab: "profile" } }],
  },
  {
    number: 10,
    parts: [{ target: "centre", text: "That's the tour. The Dashboard will fill in as you go.", completes: { type: "finish" } }],
  },
];

/** The targets that live in the Dashboard, hidden behind its button below 1024 px. */
export const DASHBOARD_TARGETS: ReadonlySet<Target> = new Set<Target>(["panel-scenario", "panel-data", "panel-parameters", "panel-runs", "panel-report", "view-incidence", "tab-profile"]);

export const OPEN_DASHBOARD_TEXT = "Press Dashboard to open it.";
