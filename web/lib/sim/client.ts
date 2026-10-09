/**
 * The web app's client for the private simulation service (sub-project 2,
 * docs/superpowers/specs/2026-10-08-sim-service-design.md section 3). Every
 * failure comes back as data: the tool decides what the model is told.
 */
import type { FetchLike } from "@/lib/data/types";
import type { ReportDocument } from "@/lib/report/document";
import type { SimParams } from "./params";

export type SimStats = { peak_infections: number; peak_day: number; total_infected: number; total_deaths: number; n_agents: number; sim_days: number };
export type RepairRecord = {
  attempt: number;
  error: string;
  changes?: { field: string; from: unknown; to: unknown }[];
  usage?: { model: string; input_tokens: number; output_tokens: number };
  repair_error?: string;
};
export type SimSuccess = {
  ok: true;
  effective_params: SimParams;
  population: number;
  stats: SimStats;
  stats_agents: SimStats;
  series: Record<string, number[]>;
  pop_scale: number;
  repairs: RepairRecord[];
  attempts: number;
  duration_ms: number;
  cold_start: boolean;
  starsim_version: string;
};
export type SimFailureKind = "invalid_params" | "too_large" | "execution_failed" | "timeout" | "unauthorized" | "misconfigured" | "not_configured" | "unavailable";
export type SimFailure = { ok: false; status: number; kind: SimFailureKind; detail: string; repairs: RepairRecord[]; attempts: number | null; seconds?: number };
export type SimResult = SimSuccess | SimFailure;
export type Demographics = { birth_rate: number; death_rate: number; source: string };

/** A rendered report file, or why the service could not render it. */
export type ExportResult = { ok: true; bytes: Uint8Array; contentType: string } | { ok: false; status: number; kind: SimFailureKind; detail: string };

export type SimClient = {
  simulate(params: SimParams, popScale: number, contextText: string): Promise<SimResult>;
  demographicsFallback(iso3: string): Promise<Demographics | null>;
  /** Word or PDF for a report document (report spec, section 12). */
  export(format: "docx" | "pdf", document: ReportDocument): Promise<ExportResult>;
};

/** Just under the chat route's own 300 s limit. */
const DEFAULT_TIMEOUT_MS = 290_000;
/** Rendering a report takes seconds; a cold matplotlib import a few more. */
const EXPORT_TIMEOUT_MS = 60_000;
const KINDS: readonly string[] = ["invalid_params", "too_large", "execution_failed", "timeout", "unauthorized", "misconfigured"];

function failure(status: number, kind: SimFailureKind, detail: string, extra: Partial<SimFailure> = {}): SimFailure {
  return { ok: false, status, kind, detail, repairs: [], attempts: null, ...extra };
}

type ErrorBody = { ok: false; error: { kind: string; detail?: unknown; repairs?: RepairRecord[]; attempts?: number; seconds?: number } };

function describeDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => (e && typeof e === "object" && "msg" in e ? `${((e as { loc?: unknown[] }).loc ?? []).join(".")}: ${(e as { msg: string }).msg}` : JSON.stringify(e)))
      .join("; ");
  }
  return JSON.stringify(detail);
}

export function createSimClient(opts: { baseUrl: string; secret: string; fetchImpl?: FetchLike; timeoutMs?: number }): SimClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = opts.baseUrl.replace(/\/$/, "");
  const headers = { "content-type": "application/json", authorization: `Bearer ${opts.secret}` };

  return {
    async simulate(params, popScale, contextText) {
      if (!base) return failure(0, "not_configured", "The simulation service address is not configured.");
      let response: Response;
      try {
        response = await fetchImpl(`${base}/simulate`, {
          method: "POST",
          headers,
          body: JSON.stringify({ params, pop_scale: popScale, context_text: contextText }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return failure(0, "unavailable", error instanceof Error ? error.message : String(error));
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return failure(response.status, "unavailable", `The simulation service answered ${response.status} without a readable body.`);
      }
      if (response.ok && body && typeof body === "object" && (body as { ok?: boolean }).ok === true) return body as SimSuccess;
      const err = (body as ErrorBody)?.error;
      if (!err || !KINDS.includes(err.kind)) return failure(response.status, "unavailable", `The simulation service answered ${response.status}.`);
      const kind = err.kind as SimFailureKind;
      const common = { repairs: err.repairs ?? [], attempts: err.attempts ?? null };
      if (kind === "timeout") {
        return failure(response.status, kind, `The simulation timed out after ${err.seconds ?? "?"} seconds.`, { ...common, seconds: err.seconds });
      }
      return failure(response.status, kind, describeDetail(err.detail ?? ""), common);
    },

    async demographicsFallback(iso3) {
      if (!base) return null;
      try {
        const response = await fetchImpl(`${base}/demographics/${iso3.trim().toUpperCase()}`, { headers, signal: AbortSignal.timeout(15_000) });
        if (!response.ok) return null;
        const body = (await response.json()) as { ok?: boolean; birth_rate?: number; death_rate?: number; source?: string };
        if (!body.ok || typeof body.birth_rate !== "number" || typeof body.death_rate !== "number") return null;
        return { birth_rate: body.birth_rate, death_rate: body.death_rate, source: body.source ?? "" };
      } catch {
        return null;
      }
    },

    async export(format, document) {
      if (!base) return { ok: false, status: 0, kind: "not_configured", detail: "The simulation service address is not configured." };
      let response: Response;
      try {
        response = await fetchImpl(`${base}/export`, { method: "POST", headers, body: JSON.stringify({ format, document }), signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS) });
      } catch (error) {
        return { ok: false, status: 0, kind: "unavailable", detail: error instanceof Error ? error.message : String(error) };
      }
      if (response.ok) return { ok: true, bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
      let detail = `The simulation service answered ${response.status}.`;
      try {
        const body = (await response.json()) as ErrorBody;
        if (body?.error?.detail) detail = describeDetail(body.error.detail);
      } catch {
        // The status line is all there is.
      }
      return { ok: false, status: response.status, kind: response.status === 401 ? "unauthorized" : "unavailable", detail };
    },
  };
}
