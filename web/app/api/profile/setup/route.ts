import { requireParticipant } from "@/lib/participant.server";
import { SetupInput, diseaseKeyOrText } from "@/lib/profile/schema";
import { supabaseProfileStore } from "@/lib/profiles";
import { supabaseStepEventSink } from "@/lib/stepEvents";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UNAVAILABLE = { code: "service_unavailable", message: "Something went wrong. Please try again." };
const badRequest = (field: string) => Response.json({ code: "bad_request", field }, { status: 400 });

/** Save the questionnaire (profile spec, section 12): the one route a participant with an incomplete profile may call. */
export async function POST(request: Request): Promise<Response> {
  const gate = await requireParticipant({ allowIncompleteProfile: true });
  if (!gate.ok) return gate.response;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest("body");
  }
  const parsed = SetupInput.safeParse(json);
  if (!parsed.success) return badRequest(String(parsed.error.issues[0]?.path[0] ?? "body"));
  const input = { ...parsed.data, ...(parsed.data.diseaseInterest ? { diseaseInterest: diseaseKeyOrText(parsed.data.diseaseInterest) } : {}) };
  const admin = adminClient();
  try {
    const { first } = await supabaseProfileStore(admin).saveProfile(gate.user.id, input, new Date());
    // Fixed words and flags only: the typed disease and decisions never reach the event log.
    await supabaseStepEventSink(admin).log(gate.user.id, [
      {
        kind: first ? "profile_completed" : "profile_updated",
        meta: { role: input.role, experience: input.experience, goals: input.goals.join(","), has_disease: Boolean(input.diseaseInterest), has_country: Boolean(input.countryInterest), has_decisions: Boolean(input.decisions) },
      },
    ]);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("profile setup failed", error instanceof Error ? error.message : String(error));
    return Response.json(UNAVAILABLE, { status: 500 });
  }
}
