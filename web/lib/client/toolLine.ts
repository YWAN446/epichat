import { fmtValue } from "@/lib/sim/pyformat";
import type { CardPayload } from "@/lib/tools/types";

/** epichat/chat_controller.py _AGENT_TOOL_LABELS: the persistent chat line's label. */
export const TOOL_LABELS: Record<string, string> = {
  configure_simulation: "⚙️ Configured simulation",
  lookup_disease: "📖 Disease database",
  fetch_demographics: "🔧 UN WPP demographics",
  fetch_health_system: "🔧 World Bank health system",
  fetch_vaccination_coverage: "🔧 WHO vaccination coverage",
  run_simulation: "▶️ Simulation",
  write_report: "📝 Report",
  remember: "🧠 Memory",
  web_search: "🔎 Web search",
  web_fetch: "📄 Read page",
};

/** epichat/chat_controller.py _AGENT_STATUS_LABELS: what the status line says while a tool runs. */
export const TOOL_STATUS: Record<string, string> = {
  configure_simulation: "Configuring the simulation…",
  lookup_disease: "Looking up disease parameters…",
  fetch_demographics: "Fetching UN demographics…",
  fetch_health_system: "Fetching World Bank health-system data…",
  fetch_vaccination_coverage: "Fetching WHO vaccination coverage…",
  run_simulation: "Running the simulation — this usually takes 1–2 minutes…",
  write_report: "Writing the report…",
  remember: "Remembering…",
  web_search: "Searching the web…",
  web_fetch: "Reading the page…",
};

export const THINKING = "Thinking…";

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `🔧 ${name}`;
}

export function statusLabel(name: string): string {
  return TOOL_STATUS[name] ?? `Running ${name}…`;
}

const MAX_CHARS = 160;
/** The card's own bookkeeping, never part of the line. */
const HIDDEN = new Set(["kind", "duration_ms", "series"]);

/** The persistent chat line for one tool call: Python's format_agent_tool_line over the payload's first four fields. */
export function toolLine(name: string, payload: CardPayload | undefined, ok: boolean): { label: string; detail: string; warn: boolean } {
  const fields = Object.entries(payload ?? {}).filter(([key]) => !HIDDEN.has(key)).slice(0, 4);
  let detail = fields.map(([key, value]) => `${key}: ${fmtValue(value)}`).join("; ");
  if (detail.length > MAX_CHARS) detail = `${detail.slice(0, MAX_CHARS - 3)}…`;
  return { label: toolLabel(name), detail, warn: !ok };
}
