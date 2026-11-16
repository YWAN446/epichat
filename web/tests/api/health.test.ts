import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/sim/health", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sim/health")>();
  return { ...actual, simHealth: vi.fn(), simProbeRun: vi.fn() };
});

import { GET } from "@/app/api/health/route";
import { simHealth, simProbeRun } from "@/lib/sim/health";
import { adminClient } from "@/lib/supabase/admin";
import { fakeAdmin } from "../helpers/fakeAdmin";

function get(headers: Record<string, string> = {}, query = "") {
  return GET(new Request(`http://localhost/api/health${query}`, { headers }));
}

const ENV = ["CRON_SECRET", "SIM_INTERNAL_URL", "SIM_SHARED_SECRET"] as const;

describe("GET /api/health", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.mocked(adminClient).mockReset();
    vi.mocked(simHealth).mockReset();
    vi.mocked(simProbeRun).mockReset();
    for (const key of ENV) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  // One queued outcome is consumed per request; a test may make several.
  function healthyDb(count = 12) {
    const { client, recorded } = fakeAdmin({ profiles: Array.from({ length: 8 }, () => ({ count, error: null })) });
    vi.mocked(adminClient).mockReturnValue(client);
    return recorded;
  }

  it("with the cron secret set, admits only the bearer Vercel sends and then reports the participant count", async () => {
    process.env.CRON_SECRET = "s3cret";
    const recorded = healthyDb();
    expect((await get()).status).toBe(401);
    expect((await get({ authorization: "Bearer wrong" })).status).toBe(401);
    expect(recorded).toEqual([]);
    const response = await get({ authorization: "Bearer s3cret" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, participants: 12, sim: null });
    expect(recorded[0].calls[0]).toEqual(["select", ["user_id", { count: "exact", head: true }]]);
    expect(simHealth).not.toHaveBeenCalled();
  });

  it("without a cron secret, still pings the database but tells nobody the count", async () => {
    healthyDb();
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns 500 when the database cannot be reached", async () => {
    const { client } = fakeAdmin({ profiles: [{ count: null, error: { message: "paused" } }] });
    vi.mocked(adminClient).mockReturnValue(client);
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
  });

  it("reports the sim's health through the binding when the URL is set", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.SIM_INTERNAL_URL = "http://sim.internal";
    healthyDb(3);
    vi.mocked(simHealth).mockResolvedValue({ ok: true, starsim_version: "3.3.2", cold_start: true });
    const response = await get({ authorization: "Bearer s3cret" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, participants: 3, sim: { ok: true, starsim_version: "3.3.2", cold_start: true },
    });
    expect(simHealth).toHaveBeenCalledWith("http://sim.internal");
  });

  it("keeps the route healthy when the sim is not", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.SIM_INTERNAL_URL = "http://sim.internal";
    healthyDb();
    vi.mocked(simHealth).mockResolvedValue({ ok: false, error: "ECONNREFUSED" });
    const response = await get({ authorization: "Bearer s3cret" });
    expect(response.status).toBe(200);
    expect((await response.json()).sim).toEqual({ ok: false, error: "ECONNREFUSED" });
  });

  it("runs the measurement probe for the bearer and reports it", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.SIM_INTERNAL_URL = "http://sim.internal";
    process.env.SIM_SHARED_SECRET = "shared";
    healthyDb();
    vi.mocked(simHealth).mockResolvedValue({ ok: true, starsim_version: "3.3.2", cold_start: false });
    vi.mocked(simProbeRun).mockResolvedValue({ n_agents: 10000, status: 200, duration_ms: 4200, cold_start: false, attempts: 1 });
    const response = await get({ authorization: "Bearer s3cret" }, "?run=10000");
    expect(response.status).toBe(200);
    expect((await response.json()).sim_run).toEqual({ n_agents: 10000, status: 200, duration_ms: 4200, cold_start: false, attempts: 1 });
    expect(simProbeRun).toHaveBeenCalledWith("http://sim.internal", "shared", 10000);
  });

  it("reports a failed probe run without failing the route", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.SIM_INTERNAL_URL = "http://sim.internal";
    process.env.SIM_SHARED_SECRET = "shared";
    healthyDb();
    vi.mocked(simHealth).mockResolvedValue({ ok: true, starsim_version: "3.3.2", cold_start: false });
    vi.mocked(simProbeRun).mockResolvedValue({ n_agents: 10, status: 422, duration_ms: null, cold_start: null, attempts: null, error: "too_large" });
    const response = await get({ authorization: "Bearer s3cret" }, "?run=10");
    expect(response.status).toBe(200);
    expect((await response.json()).sim_run.error).toBe("too_large");
  });

  it("ignores the probe without the bearer, without a sim URL, or with an out-of-range value", async () => {
    healthyDb();
    expect(await (await get({}, "?run=10000")).json()).toEqual({ ok: true });
    process.env.CRON_SECRET = "s3cret";
    expect(await (await get({ authorization: "Bearer s3cret" }, "?run=10000")).json()).toEqual({ ok: true, participants: 12, sim: null });
    process.env.SIM_INTERNAL_URL = "http://sim.internal";
    process.env.SIM_SHARED_SECRET = "shared";
    vi.mocked(simHealth).mockResolvedValue({ ok: true, starsim_version: "3.3.2", cold_start: false });
    const body = await (await get({ authorization: "Bearer s3cret" }, "?run=999999")).json();
    expect(body.sim_run).toBeUndefined();
    expect(simProbeRun).not.toHaveBeenCalled();
    expect((await get({}, "?run=10000")).status).toBe(401);
  });
});
