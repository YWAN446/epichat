/**
 * The details panel's content, projected from the turns' blocks (workspace
 * spec, section 4). Pure: the same blocks give the same artifacts, live or
 * replayed.
 */
import type { Block } from "@/lib/chat/events";
import type { ReportPayload } from "@/lib/report/document";
import type { SimParams } from "@/lib/sim/params";
import type { ConfigPayload, DataPayload, DiseasePayload, RunPayload } from "@/lib/tools/types";
import { toolLabel, toolLine } from "./toolLine";

export type RunArtifact = { turnId: string; index: number; payload: RunPayload };
export type ActivityItem = {
  turnId: string;
  kind: "tool" | "web_search" | "web_fetch";
  name: string;
  ok: boolean;
  label: string;
  detail: string;
  durationMs: number | null;
};
export type Artifacts = {
  /** The latest successful disease lookup. */
  disease: DiseasePayload | null;
  /** The latest successful configuration. */
  config: ConfigPayload | null;
  /** Successful data fetches since the last new scenario, in order. */
  data: DataPayload[];
  /**
   * The scenario's current parameters: those of the latest configuration,
   * data step, or run, so after a run they are the values it used and after a
   * revision they are what the next run will use. Null until a scenario is set
   * up, and for conversations stored before the payloads carried them, until
   * their first run.
   */
  params: SimParams | null;
  /** Every successful run of the conversation, oldest first. */
  runs: RunArtifact[];
  /** Every tool and web step, in order. */
  activity: ActivityItem[];
  /** The latest report, cleared by a new scenario. */
  report: ReportPayload | null;
  /** Successful remember calls so far; the Profile tab re-reads its list when this grows. */
  memoryWrites: number;
};

export function emptyArtifacts(): Artifacts {
  return { disease: null, config: null, data: [], params: null, runs: [], activity: [], report: null, memoryWrites: 0 };
}

export function deriveArtifacts(turns: { id: string; blocks: Block[] }[]): Artifacts {
  const out = emptyArtifacts();
  for (const turn of turns) {
    for (const block of turn.blocks) {
      if (block.kind === "web_search") {
        out.activity.push({ turnId: turn.id, kind: "web_search", name: "web_search", ok: true, label: toolLabel("web_search"), detail: block.query, durationMs: null });
        continue;
      }
      if (block.kind === "web_fetch") {
        out.activity.push({ turnId: turn.id, kind: "web_fetch", name: "web_fetch", ok: true, label: toolLabel("web_fetch"), detail: block.title || block.url, durationMs: null });
        continue;
      }
      if (block.kind !== "tool_result") continue;
      const line = toolLine(block.name, block.payload, block.ok);
      const duration = block.payload?.duration_ms;
      out.activity.push({ turnId: turn.id, kind: "tool", name: block.name, ok: block.ok, label: line.label, detail: line.detail, durationMs: typeof duration === "number" ? duration : null });
      if (!block.ok) continue;
      const payload = block.payload;
      if (payload.kind === "disease") out.disease = payload;
      else if (payload.kind === "config") {
        out.config = payload;
        out.params = payload.params ?? null;
        if (payload.new_scenario) {
          out.data = [];
          out.report = null;
        }
      } else if (payload.kind === "data") {
        out.data.push(payload);
        if (payload.params) out.params = payload.params;
      } else if (payload.kind === "run") {
        out.runs.push({ turnId: turn.id, index: out.runs.length + 1, payload });
        out.params = payload.effective_params;
      }
      else if (payload.kind === "report") out.report = payload;
      else if (payload.kind === "memory") out.memoryWrites += 1;
    }
  }
  return out;
}
