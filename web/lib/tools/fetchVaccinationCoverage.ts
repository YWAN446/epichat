import { z } from "zod";
import indicators from "@/data/vaccine_indicators.json";
import { detectDisease, lookup } from "@/lib/disease/db";
import { getVaccine, validateParams } from "@/lib/sim/params";
import { NEEDS_CONFIG, errorMessage, errorOutcome, recordSources, upsertIntervention } from "./shared";
import { pruneReferences, scenarioReferences, scenarioSources } from "./sources";
import type { ResolvedField } from "@/lib/data/types";
import type { ToolDeps, ToolOutcome } from "./types";

export const FetchVaccinationCoverageInput = z.strictObject({ country_iso3: z.string(), disease: z.string() });
export type FetchVaccinationCoverageArgs = z.infer<typeof FetchVaccinationCoverageInput>;

/** Follow-up spec 7.2: the diseases with a routine-immunization indicator, exported from epichat/params/indicators.py. The codes
 *  are the sources' own: UNICEF's WHO/UNICEF estimates (IM_), and the World Bank's Pol3 (WB_HNP_), which UNICEF does not publish. */
export const VACCINE_CODES: Record<string, string[]> = indicators.indicators;

/** One disease's codes, fetched from the source that publishes them; WHO's GHO API, the old source, was retired at the end of 2025. */
async function fetchCoverage(codes: string[], iso3: string, deps: ToolDeps): Promise<{ source: "unicef" | "wb_data360"; fields: ResolvedField[] }> {
  const unicef = codes.filter((c) => c.startsWith("IM_"));
  if (unicef.length > 0) return { source: "unicef", fields: await deps.adapters.unicef({ source: "unicef", indicatorCodes: unicef, locationCode: iso3 }) };
  const worldBank = codes.filter((c) => c.startsWith("WB_HNP_"));
  return { source: "wb_data360", fields: await deps.adapters.wbData360({ source: "wb_data360", indicatorCodes: worldBank, locationCode: iso3, databaseId: "WB_HNP", startYear: 2015 }) };
}

/**
 * Ported from epichat/agent.py fetch_vaccination_coverage. Routine coverage is pre-existing immunity at the start (spec 6.1):
 * disease.initial_immune_frac; when the database carries the vaccine's efficacy it is a day-0 campaign with that efficacy instead (Part 2, 7.4).
 */
export async function fetchVaccinationCoverage(input: FetchVaccinationCoverageArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome(NEEDS_CONFIG);
  const iso3 = input.country_iso3.trim().toUpperCase();
  try {
    const canonical = detectDisease(input.disease) ?? input.disease.toLowerCase();
    const codes = VACCINE_CODES[canonical];
    if (!codes) return { content: `NO VACCINE INDICATOR: no routine-immunization coverage indicator is available for ${canonical}.` };
    const { source, fields } = await fetchCoverage(codes, iso3, deps);
    if (fields.length === 0) return errorOutcome(`FETCH ERROR: no vaccination data returned for ${iso3}`);
    const applied: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.field, f.value]));
    const cov = fields.find((f) => f.field.endsWith("_coverage"));
    if (cov && !getVaccine(scenario.params) && scenario.params.disease.initial_immune_frac === 0) {
      const coverage = Math.min(0.99, Number(cov.value) / 100);
      const entry = (deps.lookupDisease ?? lookup)(canonical);
      const efficacy = entry?.summaries.vaccine_efficacy?.typical;
      let next: Record<string, unknown>;
      if (typeof efficacy === "number" && efficacy > 0 && efficacy <= 1) {
        const interventions = upsertIntervention(scenario.params.interventions as unknown as Record<string, unknown>[], "vaccine", { kind: "campaign", coverage, start_day: 0, end_day: 0, efficacy });
        next = { ...scenario.params, interventions };
        applied.applied_vaccine_efficacy = efficacy;
      } else {
        next = { ...scenario.params, disease: { ...scenario.params.disease, initial_immune_frac: coverage } };
      }
      const validated = validateParams(next);
      if (!validated.ok) throw new Error(validated.error);
      scenario.params = validated.params;
      applied.applied_vaccine_coverage = coverage;
    }
    const citations = recordSources(scenario, fields);
    pruneReferences(scenario);                                        // a fetch can change what a chosen reference stood on (the network, say)
    return { content: JSON.stringify({ applied, citations }), payload: { kind: "data", source, iso3, applied, citations, params: scenario.params, sources: scenarioSources(scenario, deps.contextText), ...(scenarioReferences(scenario) ? { references: scenarioReferences(scenario) } : {}) } };
  } catch (error) {
    return errorOutcome(`FETCH ERROR: ${errorMessage(error)}`);
  }
}
