import { countryName, describeField } from "@/lib/client/format";
import type { DataPayload } from "@/lib/tools/types";

export const SOURCE_LABELS: Record<DataPayload["source"], string> = {
  un_wpp: "UN World Population Prospects",
  wb_data360: "World Bank Data360",
  who_gho: "WHO Global Health Observatory",
  sim_fallback: "Built-in fallback",
};

/** Every data fetch applied to the current scenario, each field in words with its unit. */
export function DataSection({ data }: { data: DataPayload[] }) {
  if (data.length === 0) return <p className="text-ink-faint">Real data appears here once it is fetched.</p>;
  return (
    <ul className="space-y-3">
      {data.map((entry, index) => (
        <li key={index}>
          <p className="font-medium">
            {SOURCE_LABELS[entry.source] ?? entry.source} <span className="font-normal text-ink-faint">· {countryName(entry.iso3)}</span>
          </p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {Object.entries(entry.applied).map(([key, value]) => {
              const field = describeField(key, value);
              return (
                <div key={key} className="contents">
                  <dt className="text-ink-faint">{field.label}</dt>
                  <dd className="font-mono">{field.value}</dd>
                </div>
              );
            })}
          </dl>
          {entry.warnings && entry.warnings.length > 0 && <p className="mt-1 text-xs text-warn-ink">{entry.warnings.join(" ")}</p>}
          {entry.citations.length > 0 && (
            <ul className="mt-1 text-xs text-ink-soft">
              {entry.citations.map((citation) => (
                <li key={citation}>
                  {/^https?:\/\//.test(citation) ? (
                    <a href={citation} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      {citation}
                    </a>
                  ) : (
                    citation
                  )}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
