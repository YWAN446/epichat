import type { Block } from "@/lib/chat/events";
import { withoutHidden } from "@/lib/chat/next";
import { tryNextLabels, type TryNext } from "@/lib/client/tryNext";
import type { ExportFormat } from "@/lib/enums";
import { Markdown } from "./Markdown";
import { ReportLine } from "./ReportLine";
import { RunSummary } from "./RunSummary";

/** One turn's blocks in order: prose, the run summary, the report line, notices. Tool and web steps live in the activity line; stage, suggestions, and recap blocks render nothing here. */
export function TurnBlocks({ blocks, onExport, turnId, tryNext }: { blocks: Block[]; onExport?: (format: ExportFormat) => void; turnId?: string; tryNext?: TryNext }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "text": {
            const text = withoutHidden(block.text);
            return text ? <Markdown key={index} text={text} /> : null;
          }
          case "tool_result":
            if (!block.ok) return null;
            if (block.payload.kind === "run") {
              // follow-up spec 7.4: the latest run offers what_if's replies; every other run is the summary alone
              const offered = tryNext?.key === `${turnId}:${index}` ? tryNext : undefined;
              return <RunSummary key={index} payload={block.payload} options={offered ? tryNextLabels(block.payload) : undefined} onPick={offered?.onPick} />;
            }
            if (block.payload.kind === "report") return <ReportLine key={index} payload={block.payload} onExport={onExport} />;
            return null;
          case "notice":
            return (
              <p key={index} role="status" className="my-2 rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2 text-sm text-warn-ink">
                {block.message}
              </p>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
