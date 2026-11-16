import { z } from "zod";
import { supabaseConversationStore } from "@/lib/db/conversations";
import { supabaseReportStore } from "@/lib/db/reports";
import { supabaseRunStore } from "@/lib/db/runs";
import { supabaseShareStore } from "@/lib/db/shares";
import { supabaseTurnStore } from "@/lib/db/turns";
import { requireParticipant } from "@/lib/participant.server";
import { buildSnapshot } from "@/lib/share/snapshot";
import { newToken } from "@/lib/share/token";
import { supabaseStepEventSink } from "@/lib/stepEvents";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const Body = z.strictObject({ conversationId: z.uuid() });
const BAD_REQUEST = { code: "bad_request", message: "conversationId is required." };
const NOT_FOUND = { code: "not_found", message: "That conversation is no longer available." };
const NOTHING = { code: "nothing_to_share", message: "Nothing to share yet." };
const UNAVAILABLE = { code: "service_unavailable", message: "Something went wrong. Please try again." };

async function readBody(request: Request): Promise<{ conversationId: string } | null> {
  try {
    const parsed = Body.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Create the conversation's share, or refresh the active one's snapshot under the same link (share spec, section 6). */
export async function POST(request: Request): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  if (!body) return Response.json(BAD_REQUEST, { status: 400 });
  const admin = adminClient();
  try {
    const conversation = await supabaseConversationStore(admin).get(body.conversationId, gate.user.id);
    if (!conversation) return Response.json(NOT_FOUND, { status: 404 });
    const replay = await supabaseTurnStore(admin).listForReplay(conversation.id);
    if (replay.length === 0) return Response.json(NOTHING, { status: 400 });
    const runIds = replay.flatMap((turn) => turn.blocks.flatMap((block) => (block.kind === "tool_result" && block.ok && block.payload.kind === "run" && block.payload.run_id ? [block.payload.run_id] : [])));
    const [series, report] = await Promise.all([supabaseRunStore(admin).seriesFor(runIds), supabaseReportStore(admin).latest(conversation.id)]);
    const now = new Date();
    const snapshot = buildSnapshot({ title: conversation.title, replay, series, report: report?.document ?? null }, now);
    const shares = supabaseShareStore(admin);
    const active = await shares.active(conversation.id, gate.user.id);
    let token: string;
    let shareId: string;
    if (active) {
      await shares.update(active.id, { title: conversation.title, snapshot, turnCount: replay.length }, now);
      token = active.token;
      shareId = active.id;
    } else {
      const created = await shares.create({ conversationId: conversation.id, userId: gate.user.id, title: conversation.title, snapshot, turnCount: replay.length, token: newToken() });
      token = created.token;
      shareId = created.id;
    }
    await supabaseStepEventSink(admin).log(gate.user.id, [
      { kind: active ? "share_updated" : "share_created", conversationId: conversation.id, meta: { share_id: shareId, turn_count: replay.length, has_report: report !== null } },
    ]);
    return Response.json({ token, url: `${new URL(request.url).origin}/s/${token}`, takenAt: now.toISOString(), turnCount: replay.length, created: !active });
  } catch (error) {
    console.error("share failed", error instanceof Error ? error.message : String(error));
    return Response.json(UNAVAILABLE, { status: 500 });
  }
}

/** Stop sharing: the link answers the unavailable page from now on. */
export async function DELETE(request: Request): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  if (!body) return Response.json(BAD_REQUEST, { status: 400 });
  const admin = adminClient();
  try {
    const revoked = await supabaseShareStore(admin).revoke(body.conversationId, gate.user.id, new Date());
    if (!revoked) return new Response(null, { status: 404 });
    await supabaseStepEventSink(admin).log(gate.user.id, [{ kind: "share_revoked", conversationId: body.conversationId, meta: {} }]);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("share revoke failed", error instanceof Error ? error.message : String(error));
    return Response.json(UNAVAILABLE, { status: 500 });
  }
}
