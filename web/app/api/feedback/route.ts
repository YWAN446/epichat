import { z } from "zod";
import { supabaseConversationStore } from "@/lib/db/conversations";
import { supabaseFeedbackStore } from "@/lib/db/feedback";
import { RATINGS } from "@/lib/enums";
import { requireParticipant } from "@/lib/participant.server";
import { supabaseStepEventSink } from "@/lib/stepEvents";
import { adminClient } from "@/lib/supabase/admin";

const Feedback = z.strictObject({
  conversationId: z.uuid(),
  turnId: z.uuid(),
  rating: z.enum(RATINGS),
  comment: z.string().max(1000).optional(),
  sessionId: z.uuid().nullable().optional(),
});

/** A thumb on an assistant reply (spec 3.2): one row per press, mirrored as a step event for the funnel. */
export async function POST(request: Request): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;

  let body: z.infer<typeof Feedback>;
  try {
    const parsed = Feedback.safeParse(JSON.parse(await request.text()));
    if (!parsed.success) return new Response(null, { status: 400 });
    body = parsed.data;
  } catch {
    return new Response(null, { status: 400 });
  }

  const admin = adminClient();
  try {
    const conversation = await supabaseConversationStore(admin).get(body.conversationId, gate.user.id);
    const feedback = supabaseFeedbackStore(admin);
    if (!conversation || !(await feedback.turnBelongs(body.turnId, body.conversationId))) return new Response(null, { status: 404 });
    const comment = body.comment?.trim() || null;
    await feedback.insert({ userId: gate.user.id, conversationId: body.conversationId, turnId: body.turnId, rating: body.rating, comment });
    await supabaseStepEventSink(admin).log(gate.user.id, [
      { kind: "feedback_given", sessionId: body.sessionId ?? null, conversationId: body.conversationId, turnId: body.turnId, meta: { rating: body.rating, has_comment: comment !== null } },
    ]);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("feedback route failed", error instanceof Error ? error.message : error);
    return new Response(null, { status: 500 });
  }
}
