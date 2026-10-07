import { loadSettings } from "@/lib/config";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Called once a day by Vercel so the free database never sits idle long
 * enough to pause. With CRON_SECRET set, only Vercel's bearer gets in and
 * the enrollment count is reported; without it the route still pings the
 * database but tells nobody how many people are enrolled.
 */
export async function GET(request: Request): Promise<Response> {
  const { cronSecret } = loadSettings();
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response(null, { status: 401 });
  }
  const { count, error } = await adminClient().from("profiles").select("user_id", { count: "exact", head: true });
  if (error) return Response.json({ ok: false }, { status: 500 });
  return Response.json(cronSecret ? { ok: true, participants: count ?? 0 } : { ok: true });
}
