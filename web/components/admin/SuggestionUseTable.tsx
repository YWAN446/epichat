import { SOURCE_LABELS, SOURCE_ORDER, type WeekRow } from "@/lib/admin/suggestionUse";

const HEAD = "px-2 py-1.5 text-left font-semibold text-ink-soft";
const CELL = "px-2 py-1.5 font-mono";

/** The researcher page's weekly counts of turns sent from a button. The Other column appears only when a press has no known kind. */
export function SuggestionUseTable({ rows }: { rows: WeekRow[] }) {
  const sources = SOURCE_ORDER.filter((source) => source !== "other" || rows.some((row) => row.bySource.other > 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={HEAD}>
              Week of
            </th>
            <th scope="col" className={HEAD}>
              Turns
            </th>
            <th scope="col" className={HEAD}>
              From a button
            </th>
            {sources.map((source) => (
              <th key={source} scope="col" className={HEAD}>
                {SOURCE_LABELS[source]}
              </th>
            ))}
            <th scope="col" className={HEAD}>
              Participants using one
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.weekStart} className="border-b border-line">
              <th scope="row" className={`${CELL} text-left font-normal`}>
                {row.weekStart}
              </th>
              <td className={CELL}>{row.turns}</td>
              <td className={CELL}>{row.fromButton}</td>
              {sources.map((source) => (
                <td key={source} className={CELL}>
                  {row.bySource[source]}
                </td>
              ))}
              <td className={CELL}>{`${row.usersWithButton} of ${row.activeUsers}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
