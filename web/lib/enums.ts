export const MODEL_IDS = ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export const THINKING_DISPLAYS = ["summarized", "omitted"] as const;
export type ThinkingDisplay = (typeof THINKING_DISPLAYS)[number];

export const PARTICIPANT_TYPES = [
  "graduate_student",
  "faculty_or_researcher",
  "public_health_practitioner",
  "other",
] as const;
export type ParticipantType = (typeof PARTICIPANT_TYPES)[number];
export const PARTICIPANT_LABEL: Record<ParticipantType, string> = {
  graduate_student: "Graduate student",
  faculty_or_researcher: "Faculty or researcher",
  public_health_practitioner: "Public health practitioner",
  other: "Other",
};

/** The profile questionnaire (profile spec, section 4). */
export const ROLES = ["student", "modeler", "epidemiologist", "clinician", "public_health_practitioner", "policy_maker", "communicator", "general_public", "other"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  student: "Student",
  modeler: "Modeler",
  epidemiologist: "Epidemiologist",
  clinician: "Clinician",
  public_health_practitioner: "Public health practitioner",
  policy_maker: "Policy maker",
  communicator: "Journalist or communicator",
  general_public: "General public",
  other: "Other",
};
export const EXPERIENCES = ["none", "some", "a_lot"] as const;
export type Experience = (typeof EXPERIENCES)[number];
export const EXPERIENCE_LABELS: Record<Experience, string> = { none: "None", some: "Some", a_lot: "A lot" };
export const GOALS = ["learning", "exploring", "deciding", "communicating"] as const;
export type Goal = (typeof GOALS)[number];
export const GOAL_LABELS: Record<Goal, string> = { learning: "Learning", exploring: "Exploring scenarios", deciding: "Making decisions", communicating: "Communicating to others" };
export const RESULTS_PREFS = ["summary", "tables", "charts", "all"] as const;
export type ResultsPref = (typeof RESULTS_PREFS)[number];
export const RESULTS_PREF_LABELS: Record<ResultsPref, string> = { summary: "Plain-language summary", tables: "Tables and numbers", charts: "Charts", all: "All of them" };
/** What the assistant may remember (profile spec, section 5). */
export const MEMORY_KINDS = ["role", "situation", "preference", "decision", "solution", "other"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  role: "Role",
  situation: "Situation",
  preference: "Preference",
  decision: "Decision they can make",
  solution: "Solution they already use",
  other: "Other",
};

/** The simulation workflow, in order (spec 10.1). */
export const STAGES = ["understand", "configure", "ground", "run", "interpret", "report"] as const;
export type Stage = (typeof STAGES)[number];

/** Step events the server writes (spec section 7). */
export const SERVER_EVENT_KINDS = [
  "conversation_started",
  "turn",
  "stage_reached",
  "tool_called",
  "tool_failed",
  "run_completed",
  "run_failed",
  "refusal",
  "new_scenario",
  "consent_given",
  "consent_declined",
  "web_search",
  "web_fetch",
  "share_created",
  "share_updated",
  "share_revoked",
  "share_opened",
  "profile_completed",
  "profile_updated",
  "memory_added",
  "memory_updated",
  "memory_removed",
  "memory_toggled",
] as const;

/** Step events the browser reports through /api/event. */
export const CLIENT_EVENT_KINDS = [
  "session_start",
  "session_end",
  "conversation_opened",
  "conversation_resumed",
  "suggestion_used",
  "card_expanded",
  "chart_view_changed",
  "series_downloaded",
  "export",
  "feedback_given",
  "scenario_panel_opened",
] as const;

export const STEP_EVENT_KINDS = [...SERVER_EVENT_KINDS, ...CLIENT_EVENT_KINDS] as const;
export type StepEventKind = (typeof STEP_EVENT_KINDS)[number];

export const CARD_KINDS = ["disease", "config", "data", "run", "tool_error", "activity", "recap", "references", "report"] as const;
/** The details panel's sections, for scenario_panel_opened. */
export const PANEL_SECTIONS = ["scenario", "data", "runs", "report", "activity", "profile"] as const;
export type PanelSection = (typeof PANEL_SECTIONS)[number];
/** Where a pressed chip came from. */
export const SUGGESTION_SOURCES = ["model", "draft", "intro"] as const;
export const CHART_VIEWS = ["compartments", "incidence", "cumulative", "deaths"] as const;
export const EXPORT_FORMATS = ["md", "html", "docx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const RATINGS = ["up", "down"] as const;
