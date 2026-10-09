import { formatDuration } from "@/lib/client/activity";
import type { ActivityItem } from "@/lib/client/artifacts";

/** Every tool and web step of the conversation, in order. */
export function ActivitySection({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <p className="text-ink-faint">Steps appear here as the assistant works.</p>;
  return (
    <ol className="space-y-1.5">
      {items.map((item, index) => (
        <li key={index} className={item.ok ? "" : "text-warn-ink"}>
          <span className="font-medium">
            {item.ok ? "" : "⚠ "}
            {item.label}
          </span>
          {item.durationMs !== null && <span className="ml-1 text-xs text-ink-faint">{formatDuration(item.durationMs)}</span>}
          {item.detail && <p className="text-xs break-words text-ink-soft">{item.detail}</p>}
        </li>
      ))}
    </ol>
  );
}
