import { z } from "zod";
import { PARAMETERS, detectDisease, knownDiseases, lookup, type ParameterSummary } from "@/lib/disease/db";
import type { ToolDeps, ToolOutcome } from "./types";

export const LookupDiseaseInput = z.strictObject({ disease_name: z.string() });
export type LookupDiseaseArgs = z.infer<typeof LookupDiseaseInput>;

/** Ported from epichat/agent.py lookup_disease; the summaries come pre-computed from Python. */
export async function lookupDisease(input: LookupDiseaseArgs, _deps: ToolDeps): Promise<ToolOutcome> {
  const canonical = detectDisease(input.disease_name);
  const entry = canonical ? lookup(canonical) : lookup(input.disease_name);
  if (!entry) {
    return { content: `UNKNOWN DISEASE: '${input.disease_name}'. Known diseases: ${knownDiseases().join(", ")}` };
  }
  const parameters: Record<string, ParameterSummary> = {};
  for (const p of PARAMETERS) {
    const summary = entry.summaries[p];
    if (summary) parameters[p] = summary;
  }
  const body = { canonical_name: canonical ?? input.disease_name.toLowerCase(), display_name: entry.display_name, parameters };
  return { content: JSON.stringify(body), payload: { kind: "disease", ...body } };
}
