import { EFFORTS, MODEL_IDS, THINKING_DISPLAYS, type Effort, type ModelId, type ThinkingDisplay } from "./enums";

export type Settings = {
  model: ModelId;
  effort: Effort;
  thinkingDisplay: ThinkingDisplay;
  maxOutputTokens: number;
  maxToolRounds: number;
  maxPauseContinuations: number;
  monthlyBudgetUsd: number;
  dailyTurnsPerUser: number;
  maxMessageChars: number;
  allowedEmailDomains: string[];
  /** Addresses that may open the researcher view and the export. */
  researcherEmails: string[];
  /** Addresses with no daily message limit, for testing. The monthly budget still applies. */
  unlimitedEmails: string[];
  refusalFallback: boolean;
  contactEmail: string;
  websiteUrl: string;
  simInternalUrl: string;
  simSharedSecret: string;
  evalBearerToken: string;
};

type Env = Record<string, string | undefined>;

function numberSetting(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be a non-negative number`);
  return value;
}

function choiceSetting<T extends string>(env: Env, key: string, choices: readonly T[], fallback: T): T {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  if (!(choices as readonly string[]).includes(raw)) {
    throw new Error(`${key} must be one of: ${choices.join(", ")}`);
  }
  return raw as T;
}

function listSetting(env: Env, key: string, fallback = ""): string[] {
  return (env[key] || fallback)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function flagSetting(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

export function loadSettings(env: Env = process.env): Settings {
  return {
    model: choiceSetting(env, "CHAT_MODEL", MODEL_IDS, "claude-opus-5-5"),
    effort: choiceSetting(env, "CHAT_EFFORT", EFFORTS, "medium"),
    thinkingDisplay: choiceSetting(env, "THINKING_DISPLAY", THINKING_DISPLAYS, "summarized"),
    maxOutputTokens: numberSetting(env, "MAX_OUTPUT_TOKENS", 16000),
    maxToolRounds: numberSetting(env, "MAX_TOOL_ROUNDS", 8),
    maxPauseContinuations: numberSetting(env, "MAX_PAUSE_CONTINUATIONS", 5),
    monthlyBudgetUsd: numberSetting(env, "MONTHLY_BUDGET_USD", 50),
    dailyTurnsPerUser: numberSetting(env, "DAILY_TURNS_PER_USER", 40),
    maxMessageChars: numberSetting(env, "MAX_MESSAGE_CHARS", 6000),
    allowedEmailDomains: listSetting(env, "ALLOWED_EMAIL_DOMAINS", "emory.edu"),
    researcherEmails: listSetting(env, "RESEARCHER_EMAILS"),
    unlimitedEmails: listSetting(env, "UNLIMITED_EMAILS"),
    refusalFallback: flagSetting(env, "REFUSAL_FALLBACK", true),
    contactEmail: env.CONTACT_EMAIL ?? "",
    websiteUrl: env.WEBSITE_URL || "https://ywan446.github.io/epichat/",
    simInternalUrl: env.SIM_INTERNAL_URL ?? "",
    simSharedSecret: env.SIM_SHARED_SECRET ?? "",
    evalBearerToken: env.EVAL_BEARER_TOKEN ?? "",
  };
}

// Far more than anyone can send in a day. The database still counts each one.
const NO_DAILY_LIMIT = 1_000_000;

function named(list: string[], email: string | null | undefined): boolean {
  return email !== null && email !== undefined && list.includes(email.trim().toLowerCase());
}

/** The settings as they apply to one signed-in person. */
export function settingsFor(settings: Settings, email: string | null | undefined): Settings {
  return named(settings.unlimitedEmails, email) ? { ...settings, dailyTurnsPerUser: NO_DAILY_LIMIT } : settings;
}

export function isResearcher(settings: Settings, email: string | null | undefined): boolean {
  return named(settings.researcherEmails, email);
}
