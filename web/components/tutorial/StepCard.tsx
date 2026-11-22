import { useId, type CSSProperties, type Ref } from "react";
import { TUTORIAL_LAST_STEP } from "@/lib/enums";
import { CARD_WIDTH } from "@/lib/tutorial/spotlight";

export type StepCardProps = {
  step: number;
  text: string;
  /** Skip step: does the step for the participant. Absent on the first and last cards. */
  onSkip?: () => void;
  onEnd: () => void;
  /** The way out's wording; "End tutorial" unless the card says otherwise. */
  endLabel?: string;
  /** The card's own button: Start, Next when a target cannot be found, Start my own conversation. */
  primary?: { label: string; onPress: () => void };
};

const QUIET = "rounded-full px-2.5 py-1 text-xs font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline";

/** One tutorial card: what to do, the step count, and always a way out. */
export function StepCard({ step, text, onSkip, onEnd, endLabel = "End tutorial", primary, style, cardRef }: StepCardProps & { style?: CSSProperties; cardRef?: Ref<HTMLDivElement> }) {
  const textId = useId();
  const counted = step > 0 && step < TUTORIAL_LAST_STEP;
  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Tutorial"
      aria-describedby={textId}
      tabIndex={-1}
      style={{ width: CARD_WIDTH, maxWidth: "calc(100vw - 16px)", ...style }}
      className="fixed z-50 rounded-xl border border-accent bg-surface p-4 text-sm shadow-lg focus:outline-none"
    >
      {counted && <p className="mb-1 text-xs font-semibold tracking-wide text-accent uppercase">{`Step ${step} of ${TUTORIAL_LAST_STEP}`}</p>}
      <p id={textId} aria-live="polite" className="text-ink">
        {text}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {primary && (
          <button type="button" onClick={primary.onPress} className="mr-1 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-deep">
            {primary.label}
          </button>
        )}
        {onSkip && (
          <button type="button" onClick={onSkip} className={QUIET}>
            Skip step
          </button>
        )}
        <button type="button" onClick={onEnd} className={QUIET}>
          {endLabel}
        </button>
      </div>
    </div>
  );
}
