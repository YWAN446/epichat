"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { DRAFTS, type ChipSource } from "@/lib/client/drafts";
import { INTRO_QUESTIONS, TYPEWRITER_START, WELCOME_PHRASES, typewriterStep, typewriterText, type TypewriterState } from "@/lib/client/welcome";

const CHIP = "rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium text-accent hover:border-accent hover:bg-accent-wash disabled:opacity-50";
const REDUCED = "(prefers-reduced-motion: reduce)";

const subscribe = (notify: () => void) => {
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

/** True when the browser asks for less motion; false on the server and until hydrated. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(REDUCED).matches, () => false);
}

/** The typed line, advanced by a timer. The pure stepper decides what comes next and how long to wait. */
function useTypewriter(phrases: string[], paused: boolean): string {
  const [state, setState] = useState<TypewriterState>(TYPEWRITER_START);
  useEffect(() => {
    if (paused) return;
    const { state: next, delay } = typewriterStep(state, phrases);
    const timer = window.setTimeout(() => setState(next), delay);
    return () => window.clearTimeout(timer);
  }, [state, phrases, paused]);
  return typewriterText(state, phrases);
}

type Props = {
  disabled: boolean;
  contactEmail: string;
  error: string | null;
  onPick: (text: string, source: ChipSource) => void;
  /** The composer, centered under the line. */
  children: ReactNode;
};

/** The empty conversation: the question cycling through ten languages, the composer, four introduction questions, and the examples. */
export function Welcome({ disabled, contactEmail, error, onPick, children }: Props) {
  const reduced = useReducedMotion();
  const typed = useTypewriter(WELCOME_PHRASES, reduced);

  return (
    <section aria-labelledby="welcome-heading" className="flex flex-1 flex-col justify-center">
      <h1 id="welcome-heading" className="mb-6 min-h-[4.5rem] text-center text-2xl font-semibold text-ink sm:text-3xl">
        <span className="sr-only">{WELCOME_PHRASES[0]}</span>
        <span aria-hidden="true">
          {reduced ? WELCOME_PHRASES[0] : typed}
          {!reduced && <span className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-accent align-middle" />}
        </span>
      </h1>
      {error && (
        <p role="alert" className="mb-3 rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2.5 text-sm text-warn-ink">
          {error}
        </p>
      )}
      {children}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {INTRO_QUESTIONS.map((question) => (
          <button key={question} type="button" disabled={disabled} onClick={() => onPick(question, "intro")} className={CHIP}>
            {question}
          </button>
        ))}
      </div>
      <p className="mt-6 text-center text-xs font-semibold tracking-wide text-ink-faint uppercase">Or try an example</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {DRAFTS.understand.map((draft) => (
          <button key={draft} type="button" disabled={disabled} onClick={() => onPick(draft, "draft")} className={CHIP}>
            {draft}
          </button>
        ))}
      </div>
      {contactEmail && <p className="mt-6 text-center text-xs text-ink-faint">Questions about the study: {contactEmail}.</p>}
    </section>
  );
}
