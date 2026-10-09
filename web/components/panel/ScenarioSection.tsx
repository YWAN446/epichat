"use client";

import { Fragment, useState } from "react";
import { countryName, formatQuantity, formatRange, parameterLabel } from "@/lib/client/format";
import { commaInt } from "@/lib/sim/pyformat";
import type { ConfigPayload, DiseasePayload } from "@/lib/tools/types";
import { ReferenceList } from "./ReferenceList";

const STATUS: Record<string, string> = { ok: "", under_review: "under review", estimates_only: "estimates only", no_source: "no source" };
const COUNT = "rounded-full border border-line px-2 py-0.5 text-xs font-medium text-accent hover:border-accent hover:bg-accent-wash";

type Props = { config: ConfigPayload | null; disease: DiseasePayload | null; onReferencesOpen?: (parameter: string) => void };

/** The disease's display name when the lookup matches the configuration; the key in sentence case otherwise. */
function diseaseName(key: string | null, disease: DiseasePayload | null): string {
  if (!key) return "—";
  if (disease && disease.canonical_name === key) return disease.display_name;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** The present configuration and the literature parameters behind it, each with its references a press away. */
export function ScenarioSection({ config, disease, onReferencesOpen }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  if (!config && !disease) return <p className="text-ink-faint">The configuration appears here once a scenario is set up.</p>;
  const c = config?.config;
  const rows: [string, string][] = c
    ? [
        ["Disease", diseaseName(c.disease, disease)],
        ["Model", c.disease_type.toUpperCase()],
        ["Country", c.country ? countryName(c.country) : "—"],
        ["Agents", commaInt(c.n_agents)],
        ["Duration", formatQuantity(c.sim_dur_years, "years")],
        ["R₀ (approx.)", (config?.approx_r0 ?? 0).toFixed(1)],
        ["Infectious period", formatQuantity(c.dur_inf, "days")],
        ...(c.dur_exp ? ([["Exposed period", formatQuantity(c.dur_exp, "days")]] as [string, string][]) : []),
        ["Interventions", c.interventions.length > 0 ? c.interventions.join(", ") : "none"],
      ]
    : [];

  function toggle(parameter: string) {
    const next = open === parameter ? null : parameter;
    setOpen(next);
    if (next) onReferencesOpen?.(parameter);
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-faint">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {config && config.warnings.length > 0 && (
        <ul className="rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3 py-2 text-warn-ink">
          {config.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {disease && (
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
                      {p.n_estimates > 0 && (
                        <button type="button" aria-expanded={open === name} aria-controls={`refs-${name}`} onClick={() => toggle(name)} className={`${STATUS[p.status] ? "ml-1 " : ""}${COUNT}`}>
                          {p.n_estimates} {p.n_estimates === 1 ? "source" : "sources"}
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
      )}
    </div>
  );
}
