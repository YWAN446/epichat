import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Called once a day by Vercel so the free database never sits idle long enough to pause. */
export async function GET(): Promise<Response> {
  const { count, error } = await adminClient().from("profiles").select("user_id", { count: "exact", head: true });
  if (error) return Response.json({ ok: false }, { status: 500 });
  return Response.json({ ok: true, participants: count ?? 0 });
}
