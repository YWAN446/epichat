/**
 * The web app's only knowledge of the simulation service until sub-project 3:
 * its health route, and a fixed probe run used to measure timings through the
 * real binding. Both treat every failure as data; the health route must never
 * fail because the sim did.
 */
export type SimHealth =
  | { ok: true; starsim_version: string; cold_start: boolean }
  | { ok: false; error: string };

export type SimProbeRun = {
  n_agents: number;
  status: number;
  duration_ms: number | null;
  cold_start: boolean | null;
  attempts: number | null;
  error?: string;
};

// The daily cron hits a cold Python instance; 5 s was not enough once the
// platform's start-up is added, and a false "dead binding" is worse than a
// slow check.
export const HEALTH_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 280_000;

export function parseProbeRun(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 10 && n <= 200_000 ? n : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function simHealth(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<SimHealth> {
  try {
    const response = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const body = (await response.json()) as { starsim_version: string; cold_start: boolean };
    return { ok: true, starsim_version: body.starsim_version, cold_start: body.cold_start };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function simProbeRun(
  baseUrl: string,
  secret: string,
  nAgents: number,
  fetchImpl: typeof fetch = fetch,
): Promise<SimProbeRun> {
  const empty = { n_agents: nAgents, duration_ms: null, cold_start: null, attempts: null };
  try {
    const response = await fetchImpl(`${baseUrl}/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        params: { disease_type: "sir", beta: 0.05, n_agents: nAgents, sim_dur_years: 1, rand_seed: 1 },
        pop_scale: 1,
        context_text: "health probe",
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = (await response.json()) as {
      ok: boolean; duration_ms?: number; cold_start?: boolean; attempts?: number; error?: { kind?: string };
    };
    if (!response.ok || !body.ok) {
      return { ...empty, status: response.status, error: body.error?.kind ?? `HTTP ${response.status}` };
    }
    return {
      n_agents: nAgents, status: response.status,
      duration_ms: body.duration_ms ?? null, cold_start: body.cold_start ?? null, attempts: body.attempts ?? null,
    };
  } catch (error) {
    return { ...empty, status: 0, error: message(error) };
  }
}
