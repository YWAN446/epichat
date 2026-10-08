import { describe, expect, it, vi } from "vitest";

import { parseProbeRun, simHealth, simProbeRun } from "@/lib/sim/health";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function fetchReturning(status: number, body: unknown) {
  return vi.fn<FetchLike>(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

function fetchThrowing(message: string) {
  return vi.fn<FetchLike>(async () => { throw new Error(message); });
}

describe("parseProbeRun", () => {
  it("accepts integers from 10 to 200000 and rejects everything else", () => {
    expect(parseProbeRun("10000")).toBe(10000);
    expect(parseProbeRun("10")).toBe(10);
    expect(parseProbeRun("200000")).toBe(200000);
    for (const bad of [null, "", "9", "200001", "1e4", "12.5", "abc", "-5"]) expect(parseProbeRun(bad)).toBeNull();
  });
});

describe("simHealth", () => {
  it("returns the service's health fields", async () => {
    const fetchImpl = fetchReturning(200, { ok: true, starsim_version: "3.3.2", python_version: "3.12.1", cold_start: true });
    expect(await simHealth("http://sim.internal", fetchImpl as unknown as typeof fetch)).toEqual({
      ok: true, starsim_version: "3.3.2", cold_start: true,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("http://sim.internal/health");
  });

  it("reports a non-200 or a thrown fetch as not ok", async () => {
    expect(await simHealth("http://sim.internal", fetchReturning(503, {}) as unknown as typeof fetch)).toEqual({ ok: false, error: "HTTP 503" });
    const failing = fetchThrowing("ECONNREFUSED");
    expect(await simHealth("http://sim.internal", failing as unknown as typeof fetch)).toEqual({ ok: false, error: "ECONNREFUSED" });
  });
});

describe("simProbeRun", () => {
  it("posts a one-year SIR with the secret and reports the timing", async () => {
    const fetchImpl = fetchReturning(200, { ok: true, duration_ms: 4200, cold_start: true, attempts: 1 });
    const result = await simProbeRun("http://sim.internal", "s3", 10000, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ n_agents: 10000, status: 200, duration_ms: 4200, cold_start: true, attempts: 1 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://sim.internal/simulate");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer s3");
    expect(JSON.parse(init?.body as string)).toEqual({
      params: { disease_type: "sir", beta: 0.05, n_agents: 10000, sim_dur_years: 1, rand_seed: 1 },
      pop_scale: 1, context_text: "health probe",
    });
  });

  it("keeps a failed run as data", async () => {
    const fetchImpl = fetchReturning(422, { ok: false, error: { kind: "too_large" } });
    expect(await simProbeRun("http://sim.internal", "s3", 10, fetchImpl as unknown as typeof fetch)).toEqual({
      n_agents: 10, status: 422, duration_ms: null, cold_start: null, attempts: null, error: "too_large",
    });
    const failing = fetchThrowing("timeout");
    expect(await simProbeRun("http://sim.internal", "s3", 10, failing as unknown as typeof fetch)).toEqual({
      n_agents: 10, status: 0, duration_ms: null, cold_start: null, attempts: null, error: "timeout",
    });
  });
});
