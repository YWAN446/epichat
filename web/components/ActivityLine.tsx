"use client";

import { useState } from "react";
import type { Block } from "@/lib/chat/events";
import { summarizeActivity } from "@/lib/client/activity";
import { ToolLine } from "./ToolLine";

type Props = { blocks: Block[]; status: string | null; onExpand?: () => void };

const LINE = "text-sm text-ink-soft";

/** One line for the reply's tool and web steps; the status text while the reply is live; a press shows each step. */
export function ActivityLine({ blocks, status, onExpand }: Props) {
  const [open, setOpen] = useState(false);
  const steps = blocks.filter((block) => block.kind === "tool_result" || block.kind === "web_search" || block.kind === "web_fetch");
  const summary = summarizeActivity(blocks);
  if (!status && steps.length === 0) return null;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) onExpand?.();
  }

  return (
    <div className="my-2">
      <button type="button" aria-expanded={open} disabled={steps.length === 0} onClick={toggle} className={`${LINE} rounded px-1 text-left hover:bg-paper-2 disabled:hover:bg-transparent`}>
        {status ?? summary}
        {steps.length > 0 && (
          <span aria-hidden="true" className="ml-1 text-ink-faint">
            {open ? "▾" : "▸"}
          </span>
        )}
      </button>
      {open && (
        <ul className="mt-1 border-l-2 border-line pl-3">
          {steps.map((block, index) => (
            <li key={index}>
              {block.kind === "tool_result" ? (
                <ToolLine name={block.name} payload={block.payload} ok={block.ok} />
              ) : block.kind === "web_search" ? (
                <p className={`my-2 ${LINE}`}>
                  <strong className="font-semibold">🔎 Web search</strong> — {block.query}
                </p>
              ) : (
                <p className={`my-2 ${LINE}`}>
                  <strong className="font-semibold">📄 Read page</strong> —{" "}
                  <a href={block.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {block.title}
                  </a>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
