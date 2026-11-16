import { loadSettings } from "@/lib/config";
import { parseProbeRun, simHealth, simProbeRun } from "@/lib/sim/health";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Called once a day by Vercel so the free database never sits idle long
 * enough to pause. With CRON_SECRET set, only Vercel's bearer gets in and
 * the enrollment count is reported, along with the simulation service's
 * health through the service binding; without it the route still pings the
 * database but tells nobody anything.
 *
 * `?run=<n_agents>` (bearer only) also runs a one-year SIR on the sim and
 * reports its timing. It exists to measure the service through the real
 * binding; the cron never sends it.
 */
export async function GET(request: Request): Promise<Response> {
  const { cronSecret, simInternalUrl, simSharedSecret } = loadSettings();
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response(null, { status: 401 });
  }
  const { count, error } = await adminClient().from("profiles").select("user_id", { count: "exact", head: true });
  if (error) return Response.json({ ok: false }, { status: 500 });
  if (!cronSecret) return Response.json({ ok: true });

  const sim = simInternalUrl ? await simHealth(simInternalUrl) : null;
  const probe = parseProbeRun(new URL(request.url).searchParams.get("run"));
  const sim_run = probe !== null && simInternalUrl ? await simProbeRun(simInternalUrl, simSharedSecret, probe) : undefined;
  return Response.json({ ok: true, participants: count ?? 0, sim, ...(sim_run ? { sim_run } : {}) });
}
