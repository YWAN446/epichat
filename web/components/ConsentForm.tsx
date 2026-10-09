"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PARTICIPANT_LABEL, PARTICIPANT_TYPES, type ParticipantType } from "@/lib/enums";

const PRIMARY = "rounded-full bg-accent px-5 py-2.5 font-semibold text-white hover:bg-accent-deep disabled:bg-line disabled:text-ink-faint";
const QUIET = "rounded-full px-5 py-2.5 font-medium text-ink-soft hover:bg-paper-2 hover:text-ink";

export function ConsentForm({ markdown }: { markdown: string }) {
  const router = useRouter();
  const [participantType, setParticipantType] = useState<ParticipantType | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(body: { decision: "agree"; participantType: ParticipantType } | { decision: "decline" }) {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!response || !response.ok) {
      setError("That did not save. Please try again.");
      return;
    }
    // After consent comes the questionnaire (profile spec, section 3); the profile page sends a finished participant on to the chat.
    router.replace(body.decision === "agree" ? "/profile" : "/sign-in?declined=1");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="prose-epichat rounded-2xl border border-line bg-surface p-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">I am a…</legend>
        {PARTICIPANT_TYPES.map((type) => (
          <label key={type} className="flex items-center gap-2.5">
            <input type="radio" name="participant_type" value={type} checked={participantType === type} onChange={() => setParticipantType(type)} className="accent-accent" />
            {PARTICIPANT_LABEL[type]}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || participantType === null} onClick={() => participantType && decide({ decision: "agree", participantType })} className={PRIMARY}>
          I agree to take part
        </button>
        <button type="button" disabled={busy} onClick={() => decide({ decision: "decline" })} className={QUIET}>
          I do not agree
        </button>
      </div>
      {error && <p role="alert" className="rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2.5 text-sm text-warn-ink">{error}</p>}
    </div>
  );
}
