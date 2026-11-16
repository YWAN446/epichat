"use client";

import type { FormEvent, KeyboardEvent, RefObject } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
  maxLength: number;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** The welcome's composer: taller, centered, no footer padding. */
  large?: boolean;
};

/** The message box and Send, shared by the welcome and the footer. */
export function Composer({ value, onChange, onSubmit, onKeyDown, disabled, maxLength, inputRef, large = false }: Props) {
  return (
    <form className={`mx-auto flex w-full max-w-[46rem] items-end gap-2 ${large ? "" : "px-4 pb-3"}`} onSubmit={onSubmit}>
      <textarea
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        rows={large ? 2 : 1}
        maxLength={maxLength}
        placeholder={disabled ? "Working…" : "Message EpiChat"}
        aria-label="Message"
        className={`flex-1 resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 disabled:text-ink-faint ${large ? "min-h-16 text-base shadow-sm" : "min-h-11"}`}
      />
      <button type="submit" disabled={disabled || !value.trim()} className="rounded-full bg-accent px-5 py-2.5 font-semibold text-white hover:bg-accent-deep disabled:bg-line disabled:text-ink-faint">
        Send
      </button>
    </form>
  );
}
