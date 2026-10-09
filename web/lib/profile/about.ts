/**
 * The "About this participant" block (profile spec, section 8): built once per
 * new conversation from the profile and the active memories, and put on the
 * first user message so the system prompt stays byte-stable.
 */
import { countryName } from "@/lib/client/format";
import { lookup } from "@/lib/disease/db";
import { EXPERIENCE_LABELS, GOAL_LABELS, MEMORY_KINDS, RESULTS_PREF_LABELS, ROLE_LABELS, type MemoryKind } from "@/lib/enums";
import type { ProfileFields } from "./schema";

export type Memory = {
  id: string;
  kind: MemoryKind;
  text: string;
  source: "agent" | "participant";
  createdAt: string;
};

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const KIND_SUFFIX = new RegExp(`\\s*\\((?:${MEMORY_KINDS.join("|")})\\)\\s*$`);

/** A memory's text as the model may quote it from the Remembered line: with or without the "(kind)" suffix. */
export function withoutKindSuffix(text: string): string {
  return text.replace(KIND_SUFFIX, "").trim();
}
const FORMAT_NAMES: Record<ProfileFields["reportFormat"], string> = { md: "Markdown", html: "HTML", docx: "Word", pdf: "PDF" };

/** Null until the questionnaire is done. The Remembered line lists the memories oldest first and is left out when memory is off. */
export function aboutBlock(profile: ProfileFields, memories: Memory[]): string | null {
  if (!profile.completedAt || !profile.role || !profile.experience) return null;
  const lines = [
    "About this participant (from their profile and your memory; pitch the detail and the framing by it; do not repeat it back; do not ask for what it already says):",
    `- Role: ${lower(ROLE_LABELS[profile.role])} · Experience with epidemic models: ${lower(EXPERIENCE_LABELS[profile.experience])} · Wants: ${profile.goals.map((goal) => lower(GOAL_LABELS[goal])).join(", ")}`,
  ];
  const disease = profile.diseaseInterest ? (lookup(profile.diseaseInterest)?.display_name.toLowerCase() ?? profile.diseaseInterest) : null;
  const country = profile.countryInterest ? countryName(profile.countryInterest) : null;
  const interest = disease && country ? `${disease} in ${country}` : (disease ?? country);
  const second = [interest ? `Interest: ${interest}` : null, profile.decisions ? `Decisions they can influence: ${profile.decisions}` : null].filter((part): part is string => part !== null);
  if (second.length > 0) lines.push(`- ${second.join(" · ")}`);
  lines.push(`- Prefers: ${lower(RESULTS_PREF_LABELS[profile.resultsPref])} · Report format: ${FORMAT_NAMES[profile.reportFormat]}`);
  if (profile.memoryEnabled && memories.length > 0) {
    const oldestFirst = [...memories].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    lines.push(`- Remembered: ${oldestFirst.map((memory) => `${memory.text} (${memory.kind})`).join(" · ")}`);
  }
  return lines.join("\n");
}
