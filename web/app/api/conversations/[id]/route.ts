import { z } from "zod";
import { supabaseConversationStore } from "@/lib/db/conversations";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";

/** Hide a conversation from the participant (spec 3.3). The study keeps it. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  try {
    const hidden = await supabaseConversationStore(adminClient()).softDelete(id, gate.user.id, new Date());
    return new Response(null, { status: hidden ? 204 : 404 });
  } catch (error) {
    console.error("conversation delete failed", error instanceof Error ? error.message : error);
    return new Response(null, { status: 500 });
  }
}
