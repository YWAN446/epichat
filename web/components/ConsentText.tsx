"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** The consent text in its box, shared by the form and the read-only page behind the account menu. */
export function ConsentText({ markdown }: { markdown: string }) {
  return (
    <div className="prose-epichat rounded-2xl border border-line bg-surface p-6">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
