import type { Block } from "@/lib/chat/events";
import { withoutHidden } from "@/lib/chat/next";
import { Markdown } from "./Markdown";
import { RunSummary } from "./RunSummary";

/** One turn's blocks in order: prose, the run summary, notices. Tool and web steps live in the activity line; stage, suggestions, and recap blocks render nothing here. */
export function TurnBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "text": {
            const text = withoutHidden(block.text);
            return text ? <Markdown key={index} text={text} /> : null;
          }
          case "tool_result":
            return block.ok && block.payload.kind === "run" ? <RunSummary key={index} payload={block.payload} /> : null;
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
