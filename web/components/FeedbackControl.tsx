"use client";

import { useState } from "react";

type Props = { conversationId: string; turnId: string; sessionId: string | null };
type Rating = "up" | "down";

const THUMB = "rounded-full px-2 py-1 text-base hover:bg-paper-2 aria-pressed:bg-accent-wash";

/** Thumbs on an assistant reply, then an optional comment. Every press is one row; the latest wins in reports. */
export function FeedbackControl({ conversationId, turnId, sessionId }: Props) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send(chosen: Rating, text: string): Promise<boolean> {
    setFailed(false);
    const trimmed = text.trim();
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, turnId, rating: chosen, ...(trimmed ? { comment: trimmed } : {}), sessionId }),
    }).catch(() => null);
    if (!response || !response.ok) {
      setFailed(true);
      return false;
    }
    setRating(chosen);
    return true;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-faint">
      <button type="button" aria-label="Helpful" aria-pressed={rating === "up"} onClick={() => void send("up", "")} className={THUMB}>
        👍
      </button>
      <button type="button" aria-label="Not helpful" aria-pressed={rating === "down"} onClick={() => void send("down", "")} className={THUMB}>
        👎
      </button>
      {rating && !commenting && (
        <button type="button" onClick={() => setCommenting(true)} className="underline underline-offset-2 hover:text-ink">
          Add a comment
        </button>
      )}
      {rating && commenting && (
        <form
          className="flex w-full items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send(rating, comment).then((sent) => sent && setCommenting(false));
          }}
        >
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={1000}
            rows={2}
            aria-label="Comment"
            className="flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-ink"
          />
          <button type="submit" className="rounded-full bg-accent px-4 py-1.5 font-semibold text-white hover:bg-accent-deep">
            Send
          </button>
        </form>
      )}
      {failed && (
        <span role="alert" className="text-warn-ink">
          That did not save. Please try again.
        </span>
      )}
    </div>
  );
}
