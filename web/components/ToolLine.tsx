import { toolLine } from "@/lib/client/toolLine";
import type { CardPayload } from "@/lib/tools/types";

/** The persistent one-line record of a tool call, as the Python chat showed it. */
export function ToolLine({ name, payload, ok }: { name: string; payload: CardPayload | undefined; ok: boolean }) {
  const line = toolLine(name, payload, ok);
  return (
    <p className={`my-2 text-sm ${line.warn ? "text-warn-ink" : "text-ink-soft"}`}>
      {line.warn ? "⚠ " : ""}
      <strong className="font-semibold">{line.label}</strong>
      {line.detail ? ` — ${line.detail}` : ""}
    </p>
  );
}
