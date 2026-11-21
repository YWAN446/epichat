/** Round-1 spec 5: the service's 10 to 90% replicate bands, stored beside the series as <key>_p10 and <key>_p90 for the chart. */
export type Bands = Record<string, { p10: number[]; p90: number[] }>;

/** The series with every band whose length matches the days added under suffixed keys; a new object. */
export function mergeBands(series: Record<string, number[]>, bands: Bands | undefined): Record<string, number[]> {
  const out = { ...series };
  const n = series.day?.length ?? 0;
  for (const [key, band] of Object.entries(bands ?? {})) {
    if (band.p10.length !== n || band.p90.length !== n) continue;
    out[`${key}_p10`] = band.p10;
    out[`${key}_p90`] = band.p90;
  }
  return out;
}
