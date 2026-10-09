import { interventionLines, parameterRows } from "@/lib/client/format";
import type { SimParams } from "@/lib/sim/params";

type Props = {
  params: SimParams | null;
  /** A configuration exists. Without parameters it was stored before the payloads carried them, which is said rather than denied. */
  configured: boolean;
};

/** The scenario's current parameters in words with units: what the next run uses, or what the latest run used. */
export function ParametersSection({ params, configured }: Props) {
  if (!params) {
    return (
      <p className="text-ink-faint">
        {configured ? "This scenario's parameters were not recorded; they appear after the next change or run." : "Parameters appear here once a scenario is set up."}
      </p>
    );
  }
  const lines = interventionLines(params);
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-faint">The values the next run uses; after a run, the values it used.</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {parameterRows(params).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-faint">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h4 className="mb-1 text-xs font-semibold tracking-wide text-ink-faint uppercase">Interventions</h4>
        {lines.length === 0 ? (
          <p className="text-ink-faint">No interventions.</p>
        ) : (
          <ul className="list-disc pl-4">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
