"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** The assistant's prose. Links open in a new tab; code keeps its block or inline form. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-epichat break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
              {children}
            </a>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const content = String(children).replace(/\n$/, "");
            const isBlock = className !== undefined || content.includes("\n");
            return isBlock ? (
              <pre className="my-3 overflow-x-auto rounded-lg border border-line bg-paper-2 p-3 font-mono text-sm">
                <code>{content}</code>
              </pre>
            ) : (
              <code className="rounded bg-paper-2 px-1 py-0.5 font-mono text-[0.9em]">{content}</code>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
