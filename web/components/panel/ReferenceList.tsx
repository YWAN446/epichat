"use client";

import { useEffect, useState } from "react";
import { loadReferences, referenceHref, referenceMessage, referenceMeta, referenceUsable, referenceValue, type DiseaseReferences, type ParameterReferences } from "@/lib/client/references";

type Use = {
  /** Follow-up spec 9.2: sends the message that applies an estimate; absent where nothing can be applied (the share page). */
  onUse?: (message: string) => void;
  /** A reply is streaming: the buttons wait. */
  busy?: boolean;
};
type Props = { diseaseKey: string; parameter: string; unit?: string } & Use;

const LINK = "underline underline-offset-2 hover:text-accent";
const USE = "mt-0.5 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-accent hover:border-accent hover:bg-accent-wash disabled:opacity-50";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The loaded references of one parameter: the consensus source, then the numbered estimates, each with a "Use this value" button when it is one number and something can be applied. */
export function ReferenceItems({ param, parameter, unit, disease, onUse, busy }: { param: ParameterReferences; parameter: string; unit?: string; /** The display name of the disease whose list this is. */ disease?: string } & Use) {
  return (
    <div className="space-y-1.5 text-xs">
      {param.source && (
        <p>
          <span className="text-ink-faint">Consensus value from </span>
          <a href={param.source} target="_blank" rel="noreferrer" className={LINK}>
            {hostOf(param.source)}
          </a>
        </p>
      )}
      {param.estimates.length > 0 && (
        <ol className="list-decimal space-y-1 pl-4">
          {param.estimates.map((ref, index) => {
            const href = referenceHref(ref);
            const detail = [referenceValue(ref, unit), referenceMeta(ref)].filter(Boolean).join(" · ");
            return (
              <li key={index}>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" className={LINK}>
                    {ref.title}
                  </a>
                ) : (
                  ref.title
                )}
                {detail && <span className="block text-ink-faint">{detail}</span>}
                {ref.notes && <span className="block text-ink-faint">{ref.notes}</span>}
                {onUse && referenceUsable(ref) && (
                  <button type="button" disabled={busy} onClick={() => onUse(referenceMessage(parameter, index + 1, ref, unit, disease))} className={USE}>
                    Use this value
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** The consensus source first, then every literature estimate behind one parameter, each linked to its paper. Mount with a key per disease. */
export function ReferenceList({ diseaseKey, parameter, unit, onUse, busy }: Props) {
  const [refs, setRefs] = useState<DiseaseReferences | null | "loading">("loading");

  useEffect(() => {
    let active = true;
    void loadReferences(diseaseKey).then((result) => {
      if (active) setRefs(result);
    });
    return () => {
      active = false;
    };
  }, [diseaseKey]);

  if (refs === "loading") return <p className="text-ink-faint">Loading references…</p>;
  if (!refs) return <p className="text-ink-faint">References unavailable.</p>;
  const param = refs.parameters[parameter];
  if (!param || (param.estimates.length === 0 && !param.source)) return <p className="text-ink-faint">No references for this parameter.</p>;

  return <ReferenceItems param={param} parameter={parameter} unit={unit} disease={refs.display_name} onUse={onUse} busy={busy} />;
}
