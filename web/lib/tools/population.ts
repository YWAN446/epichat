/** Round-1 spec 1: the population a scenario's counts are scaled to, with where it came from, for the panel and the report. */
import { countryName, sourceOfCitation } from "@/lib/client/format";
import type { PopulationView, Scenario } from "./types";

export function populationView(s: Scenario): PopulationView | null {
  const country = s.countryIso3 ? countryName(s.countryIso3) : null;
  if (s.area) {
    const { area } = s;
    return {
      value: area.population,
      place: country ? `${area.name}, ${country}` : area.name,
      origin: area.source.kind === "user" ? "you set it" : area.source.title,
      url: area.source.kind === "web" ? area.source.url : null,
      national: false,
    };
  }
  if (s.totalPopulation) {
    const field = s.dataSources.find((f) => f.field === "total_population");
    return { value: s.totalPopulation, place: country ?? "the country", origin: field ? sourceOfCitation(field.citation) : "the country's total", url: null, national: true };
  }
  return null;
}
