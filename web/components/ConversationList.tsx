"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConversationSummary } from "@/lib/db/conversations";

type Props = { items: ConversationSummary[]; currentId: string | null };

/** The participant's earlier conversations, newest first, each with a two-click delete. */
export function ConversationList({ items: initial, currentId }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function remove(id: string) {
    setFailed(false);
    const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    if (!response || (response.status !== 204 && response.status !== 404)) {
      setFailed(true);
      return;
    }
    setItems((list) => list.filter((item) => item.id !== id));
    if (id === currentId) router.push("/chat");
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold tracking-wide text-ink-faint uppercase">Your conversations</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-ink-soft">None yet. A conversation appears here after your first message.</p>
      ) : (
        <ul className="mt-3 border-t border-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 border-b border-line">
              <Link href={`/chat/${item.id}`} aria-current={item.id === currentId ? "page" : undefined} className="flex min-w-0 flex-1 flex-col gap-0.5 py-3 hover:text-accent">
                <span className="truncate font-medium">{item.title}</span>
                <time dateTime={item.updatedAt} className="font-mono text-xs text-ink-faint">
                  {new Date(item.updatedAt).toLocaleDateString()}
                </time>
              </Link>
              <button
                type="button"
                onClick={() => {
                  if (confirming !== item.id) return setConfirming(item.id);
                  setConfirming(null);
                  void remove(item.id);
                }}
                onBlur={() => setConfirming(null)}
                aria-label={`${confirming === item.id ? "Confirm deleting" : "Delete"} the conversation "${item.title}"`}
                className={
                  confirming === item.id
                    ? "rounded-full bg-warn-wash px-3 py-1.5 text-sm font-medium whitespace-nowrap text-warn-ink"
                    : "rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-soft hover:bg-warn-wash hover:text-warn-ink"
                }
              >
                {confirming === item.id ? "Delete?" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p role="alert" className="mt-3 text-sm text-warn-ink">
          That conversation could not be deleted. Please try again.
        </p>
      )}
    </section>
  );
}
