"use client";

import type { ReactNode } from "react";

type Props = { id: string; title: string; open: boolean; count?: number; onToggle: (open: boolean) => void; children: ReactNode };

/** A collapsible section of the details panel. */
export function Section({ id, title, open, count, onToggle, children }: Props) {
  return (
    <section className="border-b border-line">
      <h3>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => onToggle(!open)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold hover:bg-paper-2">
          <span className="flex-1">{title}</span>
          {count !== undefined && count > 0 && <span className="rounded-full bg-paper-2 px-2 text-xs font-medium text-ink-soft">{count}</span>}
          <span aria-hidden="true" className="text-ink-faint">
            {open ? "▾" : "▸"}
          </span>
        </button>
      </h3>
      {open && (
        <div id={id} className="px-4 pb-4 text-sm">
          {children}
        </div>
      )}
    </section>
  );
}
