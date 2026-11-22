import { SOURCE_LABELS, countryName, describeField, nationalNote } from "@/lib/client/format";
import type { DataPayload, DiseasePayload, PopulationView } from "@/lib/tools/types";
import { LiteratureTable } from "./LiteratureTable";

export { SOURCE_LABELS };

type Props = {
  data: DataPayload[];
  /** The latest disease lookup: its literature table heads the section. */
  disease: DiseasePayload | null;
  onReferencesOpen?: (parameter: string) => void;
  /** False on the public share page, where the references route is out of reach. */
  references?: boolean;
  /** Follow-up spec 9.2: sends the message that applies one literature estimate; absent on the share page. */
  onUseReference?: (message: string) => void;
  /** A reply is streaming. */
  busy?: boolean;
  /** Round-1 spec 1: for an area, the section says what stays national. */
  population?: PopulationView | null;
  countryIso3?: string | null;
};

/** The literature behind the disease, then every data fetch applied to the current scenario, each field in words with its unit. */
export function DataSection({ data, disease, onReferencesOpen, references, onUseReference, busy, population, countryIso3 }: Props) {
  const note = population && countryIso3 ? nationalNote(population, countryIso3) : null;
  return (
    <div className="space-y-4">
      {note && <p className="rounded-r-lg border-l-[3px] border-accent bg-accent-wash px-3 py-2 text-ink-soft">{note}</p>}
      {disease && <LiteratureTable disease={disease} onReferencesOpen={onReferencesOpen} references={references} onUseReference={onUseReference} busy={busy} />}
      {data.length === 0 ? (
        <p className="text-ink-faint">Once the assistant looks up real data, each figure and its source is listed here.</p>
      ) : (
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
      )}
    </div>
  );
}
