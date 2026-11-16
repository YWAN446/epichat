"use client";

import { useState } from "react";

type Props = { items: string[]; onExpand?: () => void };

/** The decisions made so far, from the newest recap block; one line until pressed. */
export function RecapBar({ items, onExpand }: Props) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) onExpand?.();
  }

  return (
    <div className="mb-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
      <button type="button" aria-expanded={open} onClick={toggle} className="flex w-full items-baseline gap-2 text-left">
        <span className="shrink-0 font-semibold">Decisions so far</span>
        {!open && (
          <span className="min-w-0 truncate text-ink-soft">
            {items[0]}
            {items.length > 1 && <span className="text-ink-faint"> +{items.length - 1} more</span>}
          </span>
        )}
        <span aria-hidden="true" className="ml-auto text-ink-faint">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-ink-soft">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
