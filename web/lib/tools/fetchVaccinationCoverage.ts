import { z } from "zod";
import { detectDisease } from "@/lib/disease/db";
import { getVaccine, validateParams } from "@/lib/sim/params";
import { NEEDS_CONFIG, errorMessage, errorOutcome, recordSources, upsertIntervention } from "./shared";
import type { ToolDeps, ToolOutcome } from "./types";

export const FetchVaccinationCoverageInput = z.strictObject({ country_iso3: z.string(), disease: z.string() });
export type FetchVaccinationCoverageArgs = z.infer<typeof FetchVaccinationCoverageInput>;

export const GHO_CODES: Record<string, string[]> = {
  measles: ["WHS8_110", "MCV2"],
  rubella: ["WHS8_110"],
  pertussis: ["WHS3_41"],
  polio: ["WHS3_43"],
  hepatitis_a: ["WHS3_45"],
  tuberculosis: ["WHS3_40"],
  meningococcal: ["MENGA"],
};

/** Ported from epichat/agent.py fetch_vaccination_coverage. */
export async function fetchVaccinationCoverage(input: FetchVaccinationCoverageArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome(NEEDS_CONFIG);
  const iso3 = input.country_iso3.trim().toUpperCase();
  try {
    const canonical = detectDisease(input.disease) ?? input.disease.toLowerCase();
    const codes = GHO_CODES[canonical];
    if (!codes) return { content: `NO VACCINE INDICATOR: no routine-immunization coverage indicator is available for ${canonical}.` };
    const fields = await deps.adapters.whoGho({ source: "who_gho", indicatorCodes: codes, locationCode: iso3 });
    if (fields.length === 0) return errorOutcome(`FETCH ERROR: no vaccination data returned for ${iso3}`);
    const applied: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.field, f.value]));
    const cov = fields.find((f) => f.field.endsWith("_coverage"));
    if (cov && !getVaccine(scenario.params)) {
      const coverage = Math.min(1, Number(cov.value) / 100);
      const validated = validateParams({
        ...scenario.params,
        interventions: upsertIntervention(scenario.params.interventions as unknown as Record<string, unknown>[], "vaccine", { coverage, start_day: 0 }),
      });
      if (!validated.ok) throw new Error(validated.error);
      scenario.params = validated.params;
      applied.applied_vaccine_coverage = coverage;
    }
    const citations = recordSources(scenario, fields);
    return { content: JSON.stringify({ applied, citations }), payload: { kind: "data", source: "who_gho", iso3, applied, citations, params: scenario.params } };
  } catch (error) {
    return errorOutcome(`FETCH ERROR: ${errorMessage(error)}`);
  }
}
