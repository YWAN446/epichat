/**
 * The literature behind each disease's parameters, on the server. The tool that applies a chosen reference reads the
 * estimate here, so the value and the citation come from the data and never from the model (follow-up spec 9.2). The
 * panel keeps fetching the same data through /api/diseases/[key]/references.
 */
import raw from "@/data/disease_refs.json";
import type { DiseaseReferences, Reference } from "@/lib/client/references";

const DISEASES = (raw as unknown as { diseases: Record<string, DiseaseReferences> }).diseases;

export function references(disease: string): DiseaseReferences | null {
  return Object.hasOwn(DISEASES, disease) ? DISEASES[disease] : null;
}

/** The estimate the reference list numbers `index` (1 for the first), or null. */
export function estimateAt(disease: string, parameter: string, index: number): Reference | null {
  const entry = references(disease);
  const list = entry && Object.hasOwn(entry.parameters, parameter) ? entry.parameters[parameter].estimates : null;
  return list && Number.isInteger(index) && index >= 1 && index <= list.length ? list[index - 1] : null;
}
