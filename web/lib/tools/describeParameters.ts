import { z } from "zod";
import { detectDisease, lookup } from "@/lib/disease/db";
import { flattenParams } from "@/lib/sim/paths";
import { applicableSpecs, type ParamSpec } from "@/lib/sim/registry";
import { dbRange, valueSources, type DbRange, type ParamSource } from "./sources";
import type { ToolDeps, ToolOutcome } from "./types";

export const MODULES = ["disease", "network", "demographics", "interventions", "run"] as const;
export const TIERS = ["core", "advanced", "expert"] as const;
export const DescribeParametersInput = z.strictObject({ module: z.enum(MODULES).nullish(), tier: z.enum(TIERS).nullish() });
export type DescribeParametersArgs = z.infer<typeof DescribeParametersInput>;

export type DescribedParam = {
  path: string;
  label: string;
  description: string;
  unit: string | null;
  bounds: [number, number] | null;
  choices: string[] | null;
  tier: ParamSpec["tier"];
  current: unknown;
  source: ParamSource | null;
  affects: string[];
  requires: string[];
  db_range: DbRange | null;
};

export const INTERVENTIONS_NOTE = "Interventions (vaccine, treatment, seasonality, contact_reduction, transmission_reduction, behavior_response) are entries of configure_simulation's interventions field and are listed in its config; call describe_parameters with module interventions for their fields.";

/**
 * Spec 9.2: the registry for the current model, each parameter with its value and where it came from. Follow-up spec 8.5: for the
 * scenario's network too (the random one before a scenario), so a random-network scenario is not shown the hybrid layers; and with
 * module interventions, the fields of an intervention entry, which have no current value of their own.
 */
export async function describeParameters(input: DescribeParametersArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  const params = scenario.params;
  const model = params?.disease.model ?? "sir";
  const disease = scenario.disease ?? detectDisease(deps.contextText || "");
  const entry = disease ? lookup(disease) : null;
  const flat = params ? flattenParams(params as unknown as Record<string, unknown>) : null;
  const sources = params ? valueSources(params, scenario, disease) : null;
  const network = params?.network.network_type ?? "random";
  const entryFields = input.module === "interventions";
  const parameters: DescribedParam[] = applicableSpecs(model, network)
    .filter((s) => (entryFields ? s.module === "interventions" : s.module !== "interventions" && (!input.module || s.module === input.module)) && (!input.tier || s.tier === input.tier))
    .map((s) => ({
      path: s.path,
      label: s.label,
      description: s.description,
      unit: s.unit,
      bounds: s.bounds,
      choices: s.choices,
      tier: s.tier,
      current: entryFields ? null : flat ? (flat[s.path] ?? null) : s.default,
      source: entryFields ? null : sources ? (sources[s.path] ?? null) : null,
      affects: s.affects,
      requires: s.requires,
      db_range: dbRange(entry, s.db_field),
    }));
  const note = params
    ? `Parameters of the current ${model} scenario${disease ? ` (${disease})` : ""}: current values with their source (user, database, fetch, default, illustrative). ${INTERVENTIONS_NOTE}`
    : `No scenario is configured yet: these are the registry defaults for the ${model} model. Call configure_simulation to start one. ${INTERVENTIONS_NOTE}`;
  const interventions = params ? params.interventions.map((i) => i.type) : [];
  return {
    content: JSON.stringify({ note, model, disease, interventions, parameters }),
    payload: { kind: "parameters", model, disease, count: parameters.length },
  };
}
