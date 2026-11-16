import { z } from "zod";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const NOT_FOUND = { code: "not_found", message: "That run is no longer available." };

/** A run's time series for the participant who made it; the replayed run card draws its chart from this. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json(NOT_FOUND, { status: 404 });

  const { data, error } = await adminClient().from("runs").select("user_id, series").eq("id", id).maybeSingle();
  if (error) {
    console.error("run read failed", error.message);
    return Response.json({ code: "service_unavailable", message: "Please try again." }, { status: 500 });
  }
  const row = data as { user_id: string; series: Record<string, number[]> | null } | null;
  if (!row || row.user_id !== gate.user.id || !row.series) return Response.json(NOT_FOUND, { status: 404 });
  return Response.json({ series: row.series }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
