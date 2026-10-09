import type { Block } from "@/lib/chat/events";
import { withoutNext } from "@/lib/chat/next";
import { Markdown } from "./Markdown";
import { ToolLine } from "./ToolLine";

const LINE = "my-2 text-sm text-ink-soft";

/** One turn's blocks in order: prose, tool lines, web lines, notices. Stage and suggestion blocks render nothing here. */
export function TurnBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "text": {
            const text = withoutNext(block.text);
            return text ? <Markdown key={index} text={text} /> : null;
          }
          case "tool_result":
            return <ToolLine key={index} name={block.name} payload={block.payload} ok={block.ok} />;
          case "web_search":
            return (
              <p key={index} className={LINE}>
                <strong className="font-semibold">🔎 Web search</strong> — {block.query}
              </p>
            );
          case "web_fetch":
            return (
              <p key={index} className={LINE}>
                <strong className="font-semibold">📄 Read page</strong> —{" "}
                <a href={block.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {block.title}
                </a>
              </p>
            );
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
