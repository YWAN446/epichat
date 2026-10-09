import { describe, expect, it } from "vitest";

import type { FetchLike } from "@/lib/data/types";
import { createSimClient } from "@/lib/sim/client";
import { validateParams } from "@/lib/sim/params";

const PARAMS = (() => { const r = validateParams({ beta: 22.8125, n_agents: 1000, sim_dur_years: 0.1, rand_seed: 1 }); if (!r.ok) throw new Error(r.error); return r.params; })();

function answering(status: number, body: unknown, capture: { url?: string; init?: RequestInit } = {}): FetchLike {
  return async (url, init) => {
    capture.url = url;
    capture.init = init;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": typeof body === "string" ? "text/html" : "application/json" } });
  };
}

const SUCCESS = {
  ok: true, effective_params: { ...PARAMS }, population: 1000, stats: { peak_infections: 9, peak_day: 3, total_infected: 40, total_deaths: 0, n_agents: 1000, sim_days: 37 },
  stats_agents: { peak_infections: 9, peak_day: 3, total_infected: 40, total_deaths: 0, n_agents: 1000, sim_days: 37 },
  series: { day: [0, 1], n_infected: [10, 9] }, pop_scale: 1, repairs: [], attempts: 1, duration_ms: 4000, cold_start: true, starsim_version: "3.3.2",
};

describe("sim client", () => {
  it("posts the request with the secret and returns the body on success", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: answering(200, SUCCESS, capture) });
    const result = await client.simulate(PARAMS, 2419.6, "measles in Kenya");
    expect(result).toEqual(SUCCESS);
    expect(capture.url).toBe("http://sim.internal/simulate");
    expect((capture.init?.headers as Record<string, string>).authorization).toBe("Bearer s3");
    expect(JSON.parse(capture.init?.body as string)).toEqual({ params: PARAMS, pop_scale: 2419.6, context_text: "measles in Kenya" });
    expect(capture.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps each error body to a failure the tool can read", async () => {
    const client = (status: number, body: unknown) => createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: answering(status, body) });
    expect(await client(422, { ok: false, error: { kind: "too_large", detail: "n_agents × sim_dur_years = 2,000,000 exceeds the cap", agent_years: 2e6, cap: 5e5 } }).simulate(PARAMS, 1, ""))
      .toEqual({ ok: false, status: 422, kind: "too_large", detail: "n_agents × sim_dur_years = 2,000,000 exceeds the cap", repairs: [], attempts: null });
    expect(await client(422, { ok: false, error: { kind: "invalid_params", detail: [{ loc: ["params", "n_agents"], msg: "too small", type: "x" }] } }).simulate(PARAMS, 1, ""))
      .toMatchObject({ ok: false, kind: "invalid_params", detail: "params.n_agents: too small" });
    const repairs = [{ attempt: 1, error: "e1", changes: [], usage: { model: "m", input_tokens: 1, output_tokens: 1 } }];
    expect(await client(500, { ok: false, error: { kind: "execution_failed", detail: "boom", repairs, attempts: 2 } }).simulate(PARAMS, 1, ""))
      .toEqual({ ok: false, status: 500, kind: "execution_failed", detail: "boom", repairs, attempts: 2 });
    expect(await client(504, { ok: false, error: { kind: "timeout", seconds: 120, repairs: [], attempts: 1 } }).simulate(PARAMS, 1, ""))
      .toEqual({ ok: false, status: 504, kind: "timeout", detail: "The simulation timed out after 120 seconds.", repairs: [], attempts: 1, seconds: 120 });
    expect(await client(502, "<html>bad gateway</html>").simulate(PARAMS, 1, "")).toMatchObject({ ok: false, status: 502, kind: "unavailable" });
    const down = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
    expect(await down.simulate(PARAMS, 1, "")).toMatchObject({ ok: false, status: 0, kind: "unavailable", detail: "ECONNREFUSED" });
    const unset = createSimClient({ baseUrl: "", secret: "", fetchImpl: answering(200, SUCCESS) });
    expect(await unset.simulate(PARAMS, 1, "")).toMatchObject({ ok: false, kind: "not_configured" });
  });

  it("reads the demographics fallback and tolerates its failures", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const ok = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: answering(200, { ok: true, iso3: "KEN", birth_rate: 27.342, death_rate: 7.212, source: "UN WPP 2024 — KEN (2022)" }, capture) });
    expect(await ok.demographicsFallback("ken")).toEqual({ birth_rate: 27.342, death_rate: 7.212, source: "UN WPP 2024 — KEN (2022)" });
    expect(capture.url).toBe("http://sim.internal/demographics/KEN");
    const missing = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: answering(404, { ok: false, error: { kind: "not_found" } }) });
    expect(await missing.demographicsFallback("XXX")).toBeNull();
    const down = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: async () => { throw new Error("down"); } });
    expect(await down.demographicsFallback("KEN")).toBeNull();
  });
});

describe("sim client export", () => {
  const DOC = { version: 1 as const, title: "T", subtitle: "", generatedAt: "", language: "en", sections: [] };
  const binary = (status: number, body: Uint8Array | string, type: string, capture: { url?: string; init?: RequestInit } = {}): FetchLike =>
    async (url, init) => {
      capture.url = url;
      capture.init = init;
      return new Response(body as BodyInit, { status, headers: { "content-type": type } });
    };

  it("posts the document with the secret and returns the bytes and content type", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: binary(200, new Uint8Array([37, 80, 68, 70]), "application/pdf", capture) });
    const result = await client.export("pdf", DOC);
    expect(result).toEqual({ ok: true, bytes: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf" });
    expect(capture.url).toBe("http://sim.internal/export");
    expect(JSON.parse(capture.init?.body as string)).toEqual({ format: "pdf", document: DOC });
    expect((capture.init?.headers as Record<string, string>).authorization).toBe("Bearer s3");
    expect(capture.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps a service error, an unreachable service, and a missing address to failures", async () => {
    const failing = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: binary(422, JSON.stringify({ ok: false, error: { kind: "invalid_document", detail: "bad figure" } }), "application/json") });
    expect(await failing.export("docx", DOC)).toEqual({ ok: false, status: 422, kind: "unavailable", detail: "bad figure" });
    const unauthorized = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: binary(401, JSON.stringify({ ok: false, error: { kind: "unauthorized" } }), "application/json") });
    expect(await unauthorized.export("docx", DOC)).toMatchObject({ ok: false, status: 401, kind: "unauthorized" });
    const down = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: async () => { throw new Error("down"); } });
    expect(await down.export("docx", DOC)).toMatchObject({ ok: false, status: 0, kind: "unavailable", detail: "down" });
    expect(await createSimClient({ baseUrl: "", secret: "s3" }).export("docx", DOC)).toMatchObject({ ok: false, kind: "not_configured" });
  });
});
