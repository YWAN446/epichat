/** The one-line summary of a reply's tool and web steps (workspace spec, section 5). */
import type { Block } from "@/lib/chat/events";
import { toolLabel } from "./toolLine";

/** "42 s" under a minute, "1.8 min" above, whole minutes without the decimal. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  return `${(ms / 60_000).toFixed(1).replace(/\.0$/, "")} min`;
}

/** The chat-line label without its leading emoji: "Configured simulation", "Simulation". */
function plainLabel(name: string): string {
  return toolLabel(name).replace(/^\S+\s/, "");
}

type Counted = "fetch" | "search" | "page";
type Piece = { text: string } | { count: Counted; n: number };

function render(piece: Piece): string {
  if ("text" in piece) return piece.text;
  const plural = piece.n === 1 ? "" : "s";
  if (piece.count === "fetch") return `Fetched ${piece.n} data source${plural}`;
  if (piece.count === "search") return piece.n === 1 ? "Searched the web" : `Searched the web (${piece.n})`;
  return `Read ${piece.n} page${plural}`;
}

/** One sentence for the turn's steps, pieces joined by " · "; empty when the turn made no calls. */
export function summarizeActivity(blocks: Block[]): string {
  const pieces: Piece[] = [];
  const bump = (count: Counted) => {
    const last = pieces.at(-1);
    if (last && "count" in last && last.count === count) last.n += 1;
    else pieces.push({ count, n: 1 });
  };
  for (const block of blocks) {
    if (block.kind === "web_search") bump("search");
    else if (block.kind === "web_fetch") bump("page");
    else if (block.kind === "tool_result") {
      const payload = block.payload;
      if (!block.ok) pieces.push({ text: `⚠ ${plainLabel(block.name)} failed` });
      else if (block.name === "lookup_disease") pieces.push({ text: `Looked up ${payload.kind === "disease" ? payload.display_name : "the disease"}` });
      else if (block.name === "configure_simulation") pieces.push({ text: payload.kind === "config" && payload.new_scenario ? "Started a new scenario" : "Configured the simulation" });
      else if (block.name.startsWith("fetch_")) bump("fetch");
      else if (block.name === "run_simulation") pieces.push({ text: `Ran the simulation${payload.kind === "run" ? `, ${formatDuration(payload.duration_ms)}` : ""}` });
      else if (block.name === "write_report") pieces.push({ text: payload.kind === "report" ? `Wrote the report, version ${payload.version}` : "Wrote the report" });
      else if (block.name === "remember") pieces.push({ text: payload.kind === "memory" ? `Remembered: ${payload.text}` : "Remembered" });
      else pieces.push({ text: plainLabel(block.name) });
    }
  }
  return pieces.map(render).join(" · ");
}
