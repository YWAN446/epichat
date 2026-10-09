import { STAGE_INDEX } from "@/lib/chat/stages";
import { STAGE_HINTS, STAGE_LABELS } from "@/lib/client/drafts";
import { STAGES, type Stage } from "@/lib/enums";

const DONE = "rounded-full bg-accent-wash px-2.5 py-1 text-accent";
const CURRENT = "rounded-full bg-accent px-2.5 py-1 text-white";
const AHEAD = "rounded-full px-2.5 py-1 text-ink-faint";

/** The five stages with the current one marked, and a line about what happens now. */
export function StageStrip({ stage }: { stage: Stage }) {
  const current = STAGE_INDEX[stage];
  return (
    <nav aria-label="Workflow stage" className="mb-2.5">
      <ol className="flex gap-1 overflow-x-auto text-xs font-medium whitespace-nowrap">
        {STAGES.map((candidate, index) => (
          <li key={candidate} aria-current={candidate === stage ? "step" : undefined} className={index < current ? DONE : index === current ? CURRENT : AHEAD}>
            {STAGE_LABELS[candidate]}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-xs text-ink-faint">{STAGE_HINTS[stage]}</p>
    </nav>
  );
}
