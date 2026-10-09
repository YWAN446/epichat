"use client";

import { Fragment, useState } from "react";
import { formatQuantity, formatRange, parameterLabel } from "@/lib/client/format";
import { referenceButtonLabel } from "@/lib/client/references";
import type { DiseasePayload } from "@/lib/tools/types";
import { ReferenceList } from "./ReferenceList";

const STATUS: Record<string, string> = { ok: "", under_review: "under review", estimates_only: "estimates only", no_source: "no source" };
const COUNT = "rounded-full border border-line px-2 py-0.5 text-xs font-medium text-accent hover:border-accent hover:bg-accent-wash";

type Props = { disease: DiseasePayload; onReferencesOpen?: (parameter: string) => void; /** False on the public share page, where the references route is out of reach. */ references?: boolean };

/** The literature parameters behind the disease, each with its references a press away. The top of the Data section. */
export function LiteratureTable({ disease, onReferencesOpen, references = true }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  function toggle(parameter: string) {
    const next = open === parameter ? null : parameter;
    setOpen(next);
    if (next) onReferencesOpen?.(parameter);
  }

  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold tracking-wide text-ink-faint uppercase">{disease.display_name} in the literature</h4>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-ink-faint">
            <th className="py-1 pr-2 font-medium">Parameter</th>
            <th className="py-1 pr-2 font-medium">Typical</th>
            <th className="py-1 pr-2 font-medium">Range</th>
            <th className="py-1 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(disease.parameters).map(([name, p]) => (
            <Fragment key={name}>
              <tr className="border-t border-line">
                <td className="py-1 pr-2">{parameterLabel(name)}</td>
                <td className="py-1 pr-2 font-mono">{p.typical !== undefined ? formatQuantity(p.typical, p.unit) : "—"}</td>
                <td className="py-1 pr-2 font-mono">{p.min !== undefined && p.max !== undefined ? formatRange(p.min, p.max, p.unit) : "—"}</td>
                <td className="py-1 text-ink-soft">
                  {STATUS[p.status] ?? p.status}
                  {references && referenceButtonLabel(p) && (
                    <button type="button" aria-expanded={open === name} aria-controls={`refs-${name}`} onClick={() => toggle(name)} className={`${STATUS[p.status] ? "ml-1 " : ""}${COUNT}`}>
                      {referenceButtonLabel(p)}
                    </button>
                  )}
                </td>
              </tr>
              {open === name && (
                <tr>
                  <td colSpan={4} id={`refs-${name}`} className="pb-2 pl-2">
                    <ReferenceList key={disease.canonical_name} diseaseKey={disease.canonical_name} parameter={name} unit={p.unit} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
