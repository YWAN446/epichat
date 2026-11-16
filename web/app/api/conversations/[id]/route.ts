import { z } from "zod";
import { supabaseConversationStore } from "@/lib/db/conversations";
import { supabaseShareStore } from "@/lib/db/shares";
import { supabaseStepEventSink } from "@/lib/stepEvents";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";

/** Hide a conversation from the participant (spec 3.3). The study keeps it. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  const admin = adminClient();
  const now = new Date();
  // A hidden conversation must not stay shared; a failure here is logged and the delete proceeds.
  try {
    if (await supabaseShareStore(admin).revoke(id, gate.user.id, now)) {
      await supabaseStepEventSink(admin).log(gate.user.id, [{ kind: "share_revoked", conversationId: id, meta: {} }]);
    }
  } catch (error) {
    console.error("share revoke on delete failed", error instanceof Error ? error.message : error);
  }
  try {
    const hidden = await supabaseConversationStore(admin).softDelete(id, gate.user.id, now);
    return new Response(null, { status: hidden ? 204 : 404 });
  } catch (error) {
    console.error("conversation delete failed", error instanceof Error ? error.message : error);
    return new Response(null, { status: 500 });
  }
}
