import { commaInt } from "@/lib/sim/pyformat";
import type { ConfigPayload, DiseasePayload } from "@/lib/tools/types";

const STATUS: Record<string, string> = { ok: "", under_review: "under review", estimates_only: "estimates only", no_source: "no source" };

type Props = { config: ConfigPayload | null; disease: DiseasePayload | null };

/** The present configuration and the literature parameters behind it. */
export function ScenarioSection({ config, disease }: Props) {
  if (!config && !disease) return <p className="text-ink-faint">The configuration appears here once a scenario is set up.</p>;
  const c = config?.config;
  const rows: [string, string][] = c
    ? [
        ["Disease", c.disease ?? "—"],
        ["Model", c.disease_type.toUpperCase()],
        ["Country", c.country ?? "—"],
        ["Agents", commaInt(c.n_agents)],
        ["Duration", `${c.sim_dur_years} year${c.sim_dur_years === 1 ? "" : "s"}`],
        ["R0 (approx.)", (config?.approx_r0 ?? 0).toFixed(1)],
        ["Infectious period", `${c.dur_inf} days`],
        ...(c.dur_exp ? ([["Exposed period", `${c.dur_exp} days`]] as [string, string][]) : []),
        ["Interventions", c.interventions.length > 0 ? c.interventions.join(", ") : "none"],
      ]
    : [];
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
                <tr key={name} className="border-t border-line">
                  <td className="py-1 pr-2">{name}</td>
                  <td className="py-1 pr-2 font-mono">{p.typical !== undefined ? `${p.typical}${p.unit ? ` ${p.unit}` : ""}` : "—"}</td>
                  <td className="py-1 pr-2 font-mono">{p.min !== undefined && p.max !== undefined ? `${p.min}–${p.max}` : "—"}</td>
                  <td className="py-1 text-ink-soft">
                    {STATUS[p.status] ?? p.status}
                    {p.n_estimates > 0 ? ` (${p.n_estimates})` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
