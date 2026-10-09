import refs from "@/data/disease_refs.json";
import { requireParticipant } from "@/lib/participant.server";

export const runtime = "nodejs";

type ParameterReferences = { source: string | null; estimates: Record<string, unknown>[] };
type DiseaseReferences = { display_name: string; parameters: Record<string, ParameterReferences> };

const DISEASES = (refs as { diseases: Record<string, DiseaseReferences> }).diseases;
const KEY = /^[a-z0-9_]{1,40}$/;
const NOT_FOUND = { code: "not_found", message: "No such disease." };

/** The literature behind every parameter of a disease in the database; the panel's reference list reads it on first open. */
export async function GET(_request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const { key } = await context.params;
  if (!KEY.test(key) || !Object.hasOwn(DISEASES, key)) return Response.json(NOT_FOUND, { status: 404 });
  return Response.json(DISEASES[key], { headers: { "Cache-Control": "private, max-age=86400" } });
}
