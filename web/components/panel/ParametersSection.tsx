import { parameterGroups, type ParameterGrid, type ParameterRow } from "@/lib/client/parameters";
import type { SimParams } from "@/lib/sim/params";

type Props = {
  params: SimParams | null;
  /** Where each value came from, by registry path (follow-up spec 8.4); null for a payload stored before the sources. */
  sources?: Record<string, string> | null;
  /** A configuration exists. Without parameters it was stored before the payloads carried them, which is said rather than denied. */
  configured: boolean;
};

const HEADING = "mb-1 text-xs font-semibold tracking-wide text-ink-faint uppercase";
const LIST = "grid grid-cols-[auto_1fr] gap-x-3 gap-y-1";

function Grid({ grid }: { grid: ParameterGrid }) {
  return (
    <table className="mt-1 text-xs font-normal">
      <thead>
        <tr>
          {grid.columns.map((column, index) => (
            <th key={index} scope="col" className="pr-3 text-left font-normal text-ink-faint">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.rows.map((cells) => (
          <tr key={cells[0]}>
            {cells.map((cell, index) =>
              index === 0 ? (
                <th key={index} scope="row" className="pr-3 text-left font-normal text-ink-faint">
                  {cell}
                </th>
              ) : (
                <td key={index} className="pr-3 font-mono">
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Rows({ rows }: { rows: ParameterRow[] }) {
  return (
    <dl className={LIST}>
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-ink-faint">{row.label}</dt>
          <dd className="font-medium">
            {row.value}
            {row.source && <span className="ml-1.5 rounded bg-paper-2 px-1.5 py-px text-[0.6875rem] font-normal text-ink-faint">{row.source}</span>}
            {row.grid && <Grid grid={row.grid} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The scenario's current parameters in words with units, generated from the registry (follow-up spec 8): what the next run uses,
 * or what the latest run used. Five groups; each shows its core parameters and the values that are not the default, and keeps
 * every other parameter of the scenario's model and network behind "Show all". A value's tag says where it came from.
 */
export function ParametersSection({ params, sources, configured }: Props) {
  if (!params) {
    return (
      <p className="text-ink-faint">
        {configured ? "This scenario's parameters were not recorded; they appear after the next change or run." : "Parameters appear here once a scenario is set up."}
      </p>
    );
  }
  const groups = parameterGroups(params, sources);
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-faint">
        The values the next run uses; after a run, the values it used.{sources ? " Each value is tagged with where it came from." : ""}
      </p>
      {groups.map((group) => {
        const shown = group.rows.filter((row) => row.shown);
        const hidden = group.rows.filter((row) => !row.shown);
        return (
          <section key={group.id}>
            <h4 className={HEADING}>{group.title}</h4>
            {group.lines ? (
              group.lines.length === 0 ? (
                <p className="text-ink-faint">No interventions.</p>
              ) : (
                <ul className="list-disc pl-4">
                  {group.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )
            ) : (
              <>
                <Rows rows={shown} />
                {hidden.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-ink-faint">Show all ({group.rows.length})</summary>
                    <div className="mt-1">
                      <Rows rows={hidden} />
                    </div>
                  </details>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
