import { z } from "zod";
import { MemoryPatchInput, supabaseMemoryStore, type MemoryPatchArgs } from "@/lib/db/memories";
import { requireParticipant } from "@/lib/participant.server";
import { supabaseStepEventSink } from "@/lib/stepEvents";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const UNAVAILABLE = { code: "service_unavailable", message: "Something went wrong. Please try again." };
const NOT_FOUND = { code: "not_found", message: "That memory is no longer there." };
const badRequest = (field: string) => Response.json({ code: "bad_request", field }, { status: 400 });

function failed(what: string, error: unknown): Response {
  console.error(what, error instanceof Error ? error.message : String(error));
  return Response.json(UNAVAILABLE, { status: 500 });
}

async function idOf(context: Context): Promise<string | null> {
  const { id } = await context.params;
  return z.uuid().safeParse(id).success ? id : null;
}

/** Edit one memory, the participant's own or the assistant's; 404 when it is not theirs or no longer active. */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const id = await idOf(context);
  if (!id) return badRequest("id");
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest("body");
  }
  const parsed = MemoryPatchInput.safeParse(json);
  if (!parsed.success) return badRequest(String(parsed.error.issues[0]?.path[0] ?? "body"));
  const patch: MemoryPatchArgs = parsed.data;
  const fields = (Object.keys(patch) as (keyof MemoryPatchArgs)[]).filter((key) => patch[key] !== undefined);
  const admin = adminClient();
  try {
    const changed = await supabaseMemoryStore(admin).update(gate.user.id, id, patch, new Date());
    if (!changed) return Response.json(NOT_FOUND, { status: 404 });
    await supabaseStepEventSink(admin).log(gate.user.id, [{ kind: "memory_updated", meta: { memory_id: id, fields: fields.join(",") } }]);
    return new Response(null, { status: 204 });
  } catch (error) {
    return failed("memory update failed", error);
  }
}

/** Deactivate one memory; the row stays for the study. */
export async function DELETE(_request: Request, context: Context): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const id = await idOf(context);
  if (!id) return badRequest("id");
  const admin = adminClient();
  try {
    const changed = await supabaseMemoryStore(admin).deactivate(gate.user.id, id, new Date());
    if (!changed) return Response.json(NOT_FOUND, { status: 404 });
    await supabaseStepEventSink(admin).log(gate.user.id, [{ kind: "memory_removed", meta: { memory_id: id } }]);
    return new Response(null, { status: 204 });
  } catch (error) {
    return failed("memory remove failed", error);
  }
}
