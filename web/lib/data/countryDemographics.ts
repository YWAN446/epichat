/**
 * The bundled per-country demographics of sim-parameters Part 2 (section 10): the UN WPP 2024 age shares for 2024 and 2030, the UN
 * household size and the Prem 2021 contact matrix aggregated to the three age groups (nine values, rows source, columns target).
 * Exported by scripts/export_web_data.py from epichat/params/tables.py.
 */
import FILE from "@/data/country_demographics.json";

export type CountryDemographics = { shares: Record<string, [number, number, number]>; household_size: number | null; contacts: number[] | null };

const COUNTRIES = (FILE as unknown as { version: number; countries: Record<string, CountryDemographics> }).countries;

export function countryDemographics(iso3: string): CountryDemographics | null {
  return COUNTRIES[iso3.toUpperCase()] ?? null;
}

/** The shares (percentages) of the bundled year nearest to the scenario's demographics year. */
export function sharesFor(entry: CountryDemographics, year: number): [number, number, number] | null {
  const years = Object.keys(entry.shares).map(Number);
  if (years.length === 0) return null;
  const nearest = years.reduce((best, y) => (Math.abs(y - year) < Math.abs(best - year) ? y : best));
  return entry.shares[String(nearest)] ?? null;
}
