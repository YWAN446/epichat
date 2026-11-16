const ZONE = "America/New_York";

function easternParts(now: Date): { year: string; month: string; day: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return { year: parts.year, month: parts.month, day: parts.day };
}

/** The calendar day in US Eastern time, as YYYY-MM-DD. */
export function easternDay(now: Date): string {
  const { year, month, day } = easternParts(now);
  return `${year}-${month}-${day}`;
}

/** The first day of the current Eastern-time month, as YYYY-MM-01. */
export function easternMonthStart(now: Date): string {
  const { year, month } = easternParts(now);
  return `${year}-${month}-01`;
}
