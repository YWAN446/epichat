import { z } from "zod";
import { resolved, type ResolvedField } from "@/lib/data/types";
import { unLocationId } from "@/lib/data/unWpp";
import { approxR0, recalibrateBeta, validateParams } from "@/lib/sim/params";
import { pyRound } from "@/lib/sim/pyformat";
import { NEEDS_CONFIG, errorMessage, errorOutcome, paramWarnings, recordSources } from "./shared";
import type { ToolDeps, ToolOutcome } from "./types";

export const FetchDemographicsInput = z.strictObject({ country_iso3: z.string() });
export type FetchDemographicsArgs = z.infer<typeof FetchDemographicsInput>;

const isRecord = (v: unknown): v is Record<string, number> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Ported from epichat/agent.py fetch_demographics; the CSV fallback is the sim service's route. */
export async function fetchDemographics(input: FetchDemographicsArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome(NEEDS_CONFIG);
  const iso3 = input.country_iso3.trim().toUpperCase();
  try {
    let fields: ResolvedField[] = [];
    let source: "un_wpp" | "sim_fallback" = "un_wpp";
    const locationId = unLocationId(iso3);
    if (locationId) fields = await deps.adapters.unWpp({ source: "un_wpp", indicators: [55, 59, 71, 49], locationId });
    if (fields.length === 0) {
      const demo = await deps.sim.demographicsFallback(iso3);
      if (!demo) throw new Error(`No demographic data found for ${iso3} in UN WPP, WHO Mortality Database, or World Bank Data360`);
      fields = [resolved("birth_rate", demo.birth_rate, demo.source), resolved("death_rate", demo.death_rate, demo.source)];
      source = "sim_fallback";
    }

    const before = scenario.params;
    const r0Before = approxR0(before);
    const base: Record<string, unknown> = { ...before };
    const applied: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.field === "age_distribution_pct" && isRecord(f.value)) {
        base.network_type = "age_structured";
        base.age_pct_under18 = f.value["0-17"];
        base.age_pct_18_64 = f.value["18-64"];
        base.age_pct_over65 = f.value["65+"];
        applied.age_structure_pct = f.value;
      } else if (f.field === "total_population") {
        scenario.totalPopulation = Math.trunc(Number(f.value));
        applied.total_population = scenario.totalPopulation;
      } else if (f.field === "birth_rate" || f.field === "death_rate") {
        base[f.field] = f.value;
        base.use_demographics = true;
        applied[f.field] = f.value;
      }
    }
    base.country = iso3;
    const validated = validateParams(base);
    if (!validated.ok) throw new Error(validated.error);
    let params = validated.params;
    if (params.network_type !== before.network_type) {
      // The network switch changes what R0 a beta implies; hold the R0 the user confirmed.
      params = recalibrateBeta(params, r0Before, before);
      applied.network_type = params.network_type;
      applied.beta_recalibrated_to_hold_r0 = pyRound(r0Before, 2);
    }
    scenario.params = params;
    scenario.countryIso3 = iso3;
    const warnings = paramWarnings(scenario, params, deps.contextText);
    const citations = recordSources(scenario, fields);
    const approx_r0 = pyRound(approxR0(params), 2);
    return {
      content: JSON.stringify({ applied, approx_r0, warnings, citations }),
      payload: { kind: "data", source, iso3, applied, citations, warnings, approx_r0 },
    };
  } catch (error) {
    return errorOutcome(`FETCH ERROR: ${errorMessage(error)}`);
  }
}
