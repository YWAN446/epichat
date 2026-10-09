"use client";

import type { Block } from "@/lib/chat/events";
import { ActivityLine } from "./ActivityLine";
import { FeedbackControl } from "./FeedbackControl";
import type { ExportFormat } from "@/lib/enums";
import { TurnBlocks } from "./TurnBlocks";

/** A turn as the page shows it: the participant's text and the assistant's blocks. */
export type DisplayTurn = { id: string; userText: string; blocks: Block[]; notice: string | null };

type Props = {
  turn: DisplayTurn;
  /** The live status text, or null once the reply is complete. */
  status: string | null;
  feedback: { conversationId: string; sessionId: string | null } | null;
  onActivityExpand?: () => void;
  onExport?: (format: ExportFormat) => void;
};

export function Turn({ turn, status, feedback, onActivityExpand, onExport }: Props) {
  return (
    <article className="py-4">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent-wash px-4 py-2.5 whitespace-pre-wrap">{turn.userText}</p>
      <div className="mt-4">
        <ActivityLine blocks={turn.blocks} status={status} onExpand={onActivityExpand} />
        <TurnBlocks blocks={turn.blocks} onExport={onExport} />
        {turn.notice && (
          <p role="status" className="my-2 rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2 text-sm text-warn-ink">
            {turn.notice}
          </p>
        )}
        {feedback && <FeedbackControl conversationId={feedback.conversationId} turnId={turn.id} sessionId={feedback.sessionId} />}
      </div>
    </article>
  );
}
