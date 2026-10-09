"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { groupsFor } from "@/lib/client/conversations";
import type { ConversationSummary } from "@/lib/db/conversations";

type Props = {
  items: ConversationSummary[];
  currentId: string | null;
  /** A reply is arriving: New waits. */
  busy: boolean;
  onNew: () => void;
  /** A row was pressed (the link navigates); the shell closes its drawer. */
  onPick: () => void;
  /** A conversation was deleted; the owner of the list drops it. */
  onRemoved: (id: string) => void;
};

const ROW = "flex min-w-0 flex-1 flex-col gap-0.5 py-2 text-sm hover:text-accent aria-[current=page]:font-semibold aria-[current=page]:text-accent";
const NEW = "mb-3 block rounded-full border border-line bg-surface px-3.5 py-1.5 text-center text-sm font-medium text-accent hover:border-accent hover:bg-accent-wash";

const LOADED_AT = new Date();
const subscribe = () => () => {};
/** The browser's clock once hydrated, null while the server-rendered tree must still match (the server's zone differs). */
function useClientNow(): Date | null {
  return useSyncExternalStore(subscribe, () => LOADED_AT, () => null);
}

/** The left column: New, then the participant's conversations by day, each with a two-press delete. */
export function ConversationList({ items, currentId, busy, onNew, onPick, onRemoved }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The day labels depend on the browser's clock and zone, which the server does not know; group once hydrated.
  const now = useClientNow();

  async function remove(id: string) {
    setFailed(false);
    const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    if (!response || (response.status !== 204 && response.status !== 404)) {
      setFailed(true);
      return;
    }
    onRemoved(id);
  }

  return (
    <div className="flex flex-col px-3 py-4">
      {busy ? (
        <span className={`${NEW} opacity-50`} aria-disabled="true">
          New conversation
        </span>
      ) : (
        <Link href="/chat" onClick={onNew} className={NEW}>
          New conversation
        </Link>
      )}
      {items.length === 0 ? (
        <p className="px-1 text-sm text-ink-soft">A conversation appears here after your first message.</p>
      ) : (
        groupsFor(items, now).map((group) => (
          <section key={group.label ?? "all"} className="mb-3">
            {group.label && <h2 className="px-1 text-xs font-semibold tracking-wide text-ink-faint uppercase">{group.label}</h2>}
            <ul>
              {group.items.map((item) => (
                <li key={item.id} className="flex items-center gap-1 px-1">
                  <Link href={`/chat/${item.id}`} onClick={onPick} aria-current={item.id === currentId ? "page" : undefined} className={ROW}>
                    <span className="truncate">{item.title}</span>
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
                        ? "rounded-full bg-warn-wash px-2 py-1 text-xs font-medium whitespace-nowrap text-warn-ink"
                        : "rounded-full px-2 py-1 text-xs font-medium whitespace-nowrap text-ink-faint hover:bg-warn-wash hover:text-warn-ink"
                    }
                  >
                    {confirming === item.id ? "Delete?" : "Delete"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {failed && (
        <p role="alert" className="px-1 text-sm text-warn-ink">
          That conversation could not be deleted. Please try again.
        </p>
      )}
    </div>
  );
}
