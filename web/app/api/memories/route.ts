import { MEMORY_CAP, MemoryInput, supabaseMemoryStore } from "@/lib/db/memories";
import { requireParticipant } from "@/lib/participant.server";
import { supabaseStepEventSink } from "@/lib/stepEvents";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UNAVAILABLE = { code: "service_unavailable", message: "Something went wrong. Please try again." };
const FULL = { code: "memory_full", message: `Your memory list is full (${MEMORY_CAP}). Remove one to add another.` };
const badRequest = (field: string) => Response.json({ code: "bad_request", field }, { status: 400 });

function failed(what: string, error: unknown): Response {
  console.error(what, error instanceof Error ? error.message : String(error));
  return Response.json(UNAVAILABLE, { status: 500 });
}

/** The participant's active memories, newest first (profile spec, section 12). */
export async function GET(): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  try {
    return Response.json({ memories: await supabaseMemoryStore(adminClient()).list(gate.user.id) });
  } catch (error) {
    return failed("memories read failed", error);
  }
}

/** Add a memory of the participant's own. The cap refuses with 409; nothing is evicted for them. */
export async function POST(request: Request): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest("body");
  }
  const parsed = MemoryInput.safeParse(json);
  if (!parsed.success) return badRequest(String(parsed.error.issues[0]?.path[0] ?? "body"));
  const { kind, text } = parsed.data;
  const admin = adminClient();
  const store = supabaseMemoryStore(admin);
  try {
    if ((await store.countActive(gate.user.id)) >= MEMORY_CAP) return Response.json(FULL, { status: 409 });
    const now = new Date();
    const id = await store.add(gate.user.id, kind, text, "participant", null);
    await supabaseStepEventSink(admin).log(gate.user.id, [{ kind: "memory_added", meta: { memory_id: id, kind, source: "participant", replaced: false } }]);
    return Response.json({ memory: { id, kind, text, source: "participant", createdAt: now.toISOString() } }, { status: 201 });
  } catch (error) {
    return failed("memory add failed", error);
  }
}

/** Forget everything: every active memory is deactivated; the rows stay for the study. */
export async function DELETE(): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const admin = adminClient();
  try {
    const count = await supabaseMemoryStore(admin).deactivateAll(gate.user.id, new Date());
    await supabaseStepEventSink(admin).log(gate.user.id, [{ kind: "memory_removed", meta: { all: true, count } }]);
    return Response.json({ count });
  } catch (error) {
    return failed("memories forget failed", error);
  }
}
