import { requireParticipant } from "@/lib/participant.server";
import { EMPTY_PROFILE, ProfilePatch, diseaseKeyOrText, type ProfilePatchArgs } from "@/lib/profile/schema";
import { supabaseProfileStore } from "@/lib/profiles";
import { supabaseStepEventSink, type StepEvent } from "@/lib/stepEvents";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UNAVAILABLE = { code: "service_unavailable", message: "Something went wrong. Please try again." };
const badRequest = (field: string) => Response.json({ code: "bad_request", field }, { status: 400 });

function failed(what: string, error: unknown): Response {
  console.error(what, error instanceof Error ? error.message : String(error));
  return Response.json(UNAVAILABLE, { status: 500 });
}

/** The participant's fields and preferences (profile spec, section 12). */
export async function GET(): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  try {
    const profile = await supabaseProfileStore(adminClient()).get(gate.user.id);
    return Response.json({ profile: profile?.fields ?? EMPTY_PROFILE });
  } catch (error) {
    return failed("profile read failed", error);
  }
}

/** A partial update from the Profile tab; the memory switch logs its own event. Answers the profile as re-read. */
export async function PATCH(request: Request): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest("body");
  }
  const parsed = ProfilePatch.safeParse(json);
  if (!parsed.success) return badRequest(String(parsed.error.issues[0]?.path[0] ?? "body"));
  const patch: ProfilePatchArgs = { ...parsed.data };
  if (patch.diseaseInterest) patch.diseaseInterest = diseaseKeyOrText(patch.diseaseInterest);
  const keys = (Object.keys(patch) as (keyof ProfilePatchArgs)[]).filter((key) => patch[key] !== undefined);
  if (keys.length === 0) return badRequest("body");

  const admin = adminClient();
  const store = supabaseProfileStore(admin);
  try {
    await store.patchProfile(gate.user.id, patch, new Date());
    const profileKeys = keys.filter((key) => key !== "memoryEnabled");
    const events: StepEvent[] = [];
    // Field names only: the typed text never reaches the event log.
    if (profileKeys.length > 0) events.push({ kind: "profile_updated", meta: { fields: profileKeys.join(",") } });
    if (patch.memoryEnabled !== undefined) events.push({ kind: "memory_toggled", meta: { enabled: patch.memoryEnabled } });
    await supabaseStepEventSink(admin).log(gate.user.id, events);
    const profile = await store.get(gate.user.id);
    return Response.json({ profile: profile?.fields ?? EMPTY_PROFILE });
  } catch (error) {
    return failed("profile update failed", error);
  }
}
