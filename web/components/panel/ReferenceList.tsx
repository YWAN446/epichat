"use client";

import { useEffect, useState } from "react";
import { loadReferences, referenceHref, referenceMeta, referenceValue, type DiseaseReferences } from "@/lib/client/references";

type Props = { diseaseKey: string; parameter: string; unit?: string };

const LINK = "underline underline-offset-2 hover:text-accent";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The consensus source first, then every literature estimate behind one parameter, each linked to its paper. Mount with a key per disease. */
export function ReferenceList({ diseaseKey, parameter, unit }: Props) {
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
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
