"use client";

type Props = { items: string[]; disabled: boolean; onPick: (reply: string) => void };

/** The assistant's suggested replies, as buttons above the message box. */
export function Suggestions({ items, disabled, onPick }: Props) {
  if (items.length === 0) return null;
  return (
    <div aria-label="Suggested replies" className="mb-2.5 flex gap-2 overflow-x-auto px-1 pb-0.5">
      {items.map((reply) => (
        <button
          key={reply}
          type="button"
          disabled={disabled}
          onClick={() => onPick(reply)}
          className="shrink-0 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-accent hover:border-accent hover:bg-accent-wash disabled:opacity-50"
        >
          {reply}
        </button>
      ))}
    </div>
  );
}
