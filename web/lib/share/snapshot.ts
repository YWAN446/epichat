/** What a share shows: a frozen copy of the conversation (share spec, section 4). Pure. */
import type { Block } from "@/lib/chat/events";
import { CUT_OFF_NOTICE } from "@/lib/chat/handleChat";
import { thinPoints, type Series } from "@/lib/client/chart";
import type { ReplayTurn } from "@/lib/db/turns";
import type { ReportDocument } from "@/lib/report/document";

export type ShareTurn = { id: string; userText: string; blocks: Block[]; notice: string | null };
export type ShareSnapshot = { version: 1; title: string; takenAt: string; turns: ShareTurn[]; report: ReportDocument | null };

/** Past this the series are thinned harder, then dropped; the stats stay. */
export const SNAPSHOT_MAX_BYTES = 2_000_000;

export function snapshotBytes(snapshot: ShareSnapshot): number {
  return Buffer.byteLength(JSON.stringify(snapshot), "utf8");
}

/** Every key of the series thinned to at most `max` points, on the same days. */
function thinSeries(series: Series, max: number): Series {
  const days = series.day ?? [];
  const out: Series = {};
  for (const [key, values] of Object.entries(series)) {
    if (key === "day") continue;
    const points = thinPoints(days, values, max);
    out[key] = points.map((p) => p.y);
    out.day = points.map((p) => p.x);
  }
  if (!out.day) out.day = thinPoints(days, days, max).map((p) => p.x);
  return out;
}

function turnsWith(replay: ReplayTurn[], series: Map<string, Series>, max: number | null): ShareTurn[] {
  return replay.map((turn) => ({
    id: turn.id,
    userText: turn.userText,
    notice: turn.stop === "max_tokens" ? CUT_OFF_NOTICE : null,
    blocks: turn.blocks
      .filter((block) => (block.kind as string) !== "thinking")
      .map((block) => {
        if (block.kind !== "tool_result" || !block.ok || block.payload.kind !== "run" || !block.payload.run_id) return block;
        const found = series.get(block.payload.run_id);
        if (!found || max === null) {
          const { series: _dropped, ...payload } = block.payload;
          void _dropped;
          return { ...block, payload };
        }
        return { ...block, payload: { ...block.payload, series: thinSeries(found, max) } };
      }),
  }));
}

/** The snapshot, with each run's series embedded so the public page needs no participant-only route. */
export function buildSnapshot(input: { title: string; replay: ReplayTurn[]; series: Map<string, Series>; report: ReportDocument | null }, now: Date): ShareSnapshot {
  const base = { version: 1 as const, title: input.title, takenAt: now.toISOString(), report: input.report };
  for (const max of [400, 200, null] as const) {
    const snapshot: ShareSnapshot = { ...base, turns: turnsWith(input.replay, input.series, max) };
    if (max === null || snapshotBytes(snapshot) <= SNAPSHOT_MAX_BYTES) return snapshot;
  }
  throw new Error("unreachable");
}
