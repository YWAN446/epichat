import { scenarioRows } from "@/lib/client/format";
import type { ConfigPayload, DiseasePayload } from "@/lib/tools/types";

type Props = { config: ConfigPayload | null; disease: DiseasePayload | null };

/** The disease's display name when the lookup matches the configuration; the key in sentence case otherwise. */
function diseaseName(key: string | null, disease: DiseasePayload | null): string {
  if (!key) return "—";
  if (disease && disease.canonical_name === key) return disease.display_name;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** What is being modelled, in words, and the configuration's warnings. The literature lives in Data, the values in Parameters. */
export function ScenarioSection({ config, disease }: Props) {
  if (!config) return <p className="text-ink-faint">The configuration appears here once a scenario is set up.</p>;
  const rows = scenarioRows(config.config, diseaseName(config.config.disease, disease));
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-faint">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {config.warnings.length > 0 && (
        <ul className="rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3 py-2 text-warn-ink">
          {config.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
