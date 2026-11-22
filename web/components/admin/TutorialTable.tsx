import type { TutorialSummary } from "@/lib/admin/tutorialUse";

const HEAD = "px-2 py-1.5 text-left font-semibold text-ink-soft";
const CELL = "px-2 py-1.5 font-mono";

/** The researcher page's tutorial counts: the totals, then how far participants got, step by step. */
export function TutorialTable({ summary }: { summary: TutorialSummary }) {
  const totals: [string, number][] = [
    ["Started", summary.started],
    ["Finished", summary.finished],
    ["Did not finish", summary.notFinished],
    ["Offer declined", summary.offerDeclined],
    ["Replayed by", summary.replayedBy],
  ];
  return (
    <div>
      <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {totals.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="text-ink-soft">{label}</dt>
            <dd className="font-mono font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Step", "Reached", "Did it", "Skipped", "Left here"].map((label) => (
                <th key={label} scope="col" className={HEAD}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.steps.map((row) => (
              <tr key={row.step} className="border-b border-line">
                <th scope="row" className={`${CELL} text-left font-normal`}>
                  {row.step}
                </th>
                <td className={CELL}>{row.reached}</td>
                <td className={CELL}>{row.did}</td>
                <td className={CELL}>{row.skipped}</td>
                <td className={CELL}>{row.leftHere}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
