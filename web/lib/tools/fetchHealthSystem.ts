import { z } from "zod";
import { getTreatment, validateParams } from "@/lib/sim/params";
import { pyRound } from "@/lib/sim/pyformat";
import { NEEDS_CONFIG, errorMessage, errorOutcome, recordSources } from "./shared";
import type { ToolDeps, ToolOutcome } from "./types";

export const FetchHealthSystemInput = z.strictObject({ country_iso3: z.string() });
export type FetchHealthSystemArgs = z.infer<typeof FetchHealthSystemInput>;

export const HEALTH_CODES = ["WB_WDI_SH_MED_BEDS_ZS", "WB_WDI_SH_MED_PHYS_ZS", "WB_WDI_SH_MED_NUMW_P3", "WB_WDI_SH_UHC_SRVS_CV_XD"];

/** Ported from epichat/agent.py fetch_health_system. */
export async function fetchHealthSystem(input: FetchHealthSystemArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome(NEEDS_CONFIG);
  const iso3 = input.country_iso3.trim().toUpperCase();
  try {
    const fields = await deps.adapters.wbData360({ source: "wb_data360", indicatorCodes: HEALTH_CODES, locationCode: iso3 });
    if (fields.length === 0) return errorOutcome(`FETCH ERROR: no health-system data returned for ${iso3}`);
    const applied: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.field, f.value]));
    const cap = fields.find((f) => f.field === "treatment_capacity");
    if (cap && getTreatment(scenario.params)) {
      const capacity = Math.max(1, pyRound((Number(cap.value) * scenario.params.n_agents) / 1000, 0));
      const validated = validateParams({
        ...scenario.params,
        interventions: scenario.params.interventions.map((i) => (i.type === "treatment" ? { ...i, capacity } : i)),
      });
      if (!validated.ok) throw new Error(validated.error);
      scenario.params = validated.params;
      applied.applied_treatment_capacity = capacity;
    }
    const citations = recordSources(scenario, fields);
    return { content: JSON.stringify({ applied, citations }), payload: { kind: "data", source: "wb_data360", iso3, applied, citations } };
  } catch (error) {
    return errorOutcome(`FETCH ERROR: ${errorMessage(error)}`);
  }
}
