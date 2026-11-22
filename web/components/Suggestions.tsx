"use client";

type Props = { items: string[]; disabled: boolean; onPick: (reply: string) => void; /** The tutorial: the reply it asks the participant to press. */ target?: string };

/** The assistant's suggested replies, as buttons above the message box. */
export function Suggestions({ items, disabled, onPick, target }: Props) {
  if (items.length === 0) return null;
  return (
    <div aria-label="Suggested replies" className="mb-2.5 flex flex-wrap gap-2 px-1 pb-0.5">
      {items.map((reply) => (
        <button
          key={reply}
          type="button"
          data-tutorial={reply === target ? "reply" : undefined}
          disabled={disabled}
          onClick={() => onPick(reply)}
          className="max-w-full rounded-2xl border border-line bg-surface px-3.5 py-1.5 text-left text-sm font-medium text-accent hover:border-accent hover:bg-accent-wash disabled:opacity-50"
        >
          {reply}
        </button>
      ))}
    </div>
  );
}
