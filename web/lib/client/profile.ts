/** The questionnaire's and the Profile tab's browser-side helpers (profile spec, sections 3 and 11). */
import names from "@/data/country_names.json";
import type { MemoryKind } from "@/lib/enums";
import type { Memory } from "@/lib/profile/about";
import type { DiseaseOption } from "@/lib/profile/options";
import type { ProfileFields, ProfilePatchArgs } from "@/lib/profile/schema";

export const COUNTRY_NAMES = names as Record<string, string>;

/** Every country for the suggestion list, by name. */
export const COUNTRY_OPTIONS: { iso3: string; name: string }[] = Object.entries(COUNTRY_NAMES)
  .map(([iso3, name]) => ({ iso3, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** The ISO3 for a typed name or code (case-insensitive), or null. */
export function countryIso3For(text: string): string | null {
  const typed = text.trim();
  if (typed.length === 0) return null;
  const code = typed.toUpperCase();
  if (Object.hasOwn(COUNTRY_NAMES, code)) return code;
  const wanted = typed.toLowerCase();
  return COUNTRY_OPTIONS.find((country) => country.name.toLowerCase() === wanted)?.iso3 ?? null;
}

/** The name for a stored code; "" for none. */
export function countryLabel(iso3: string | null): string {
  return iso3 ? (COUNTRY_NAMES[iso3] ?? iso3) : "";
}

/** The display name for a stored disease key, else the text as typed; "" for none. */
export function diseaseLabel(value: string | null, diseases: DiseaseOption[]): string {
  if (!value) return "";
  return diseases.find((disease) => disease.key === value)?.name ?? value;
}

/* The tab's requests (profile spec, section 12). Every failure is a message for the tab, never a throw. */

type Done = { ok: true } | { ok: false; message: string };
const SAVE_FAILED = "Could not save. Please try again.";
const JSON_HEADERS = { "Content-Type": "application/json" };

/** The route's message when it sent one. */
async function messageOf(response: Response): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return body && typeof body.message === "string" && body.message.length > 0 ? body.message : null;
}

export async function loadProfile(send: typeof fetch = fetch): Promise<{ ok: true; profile: ProfileFields } | { ok: false }> {
  try {
    const response = await send("/api/profile");
    const body = (await response.json().catch(() => null)) as { profile?: ProfileFields } | null;
    return response.ok && body?.profile ? { ok: true, profile: body.profile } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function patchProfile(patch: ProfilePatchArgs, send: typeof fetch = fetch): Promise<{ ok: true; profile: ProfileFields } | { ok: false; message: string }> {
  try {
    const response = await send("/api/profile", { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(patch) });
    const body = (await response.json().catch(() => null)) as { profile?: ProfileFields } | null;
    return response.ok && body?.profile ? { ok: true, profile: body.profile } : { ok: false, message: SAVE_FAILED };
  } catch {
    return { ok: false, message: SAVE_FAILED };
  }
}

export async function loadMemories(send: typeof fetch = fetch): Promise<{ ok: true; memories: Memory[] } | { ok: false }> {
  try {
    const response = await send("/api/memories");
    const body = (await response.json().catch(() => null)) as { memories?: Memory[] } | null;
    return response.ok && Array.isArray(body?.memories) ? { ok: true, memories: body.memories } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Add one of the participant's own; the cap's refusal carries the route's message. */
export async function addMemory(kind: MemoryKind, text: string, send: typeof fetch = fetch): Promise<{ ok: true; memory: Memory } | { ok: false; message: string }> {
  try {
    const response = await send("/api/memories", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ kind, text }) });
    if (response.status === 409) return { ok: false, message: (await messageOf(response)) ?? SAVE_FAILED };
    const body = (await response.json().catch(() => null)) as { memory?: Memory } | null;
    return response.ok && body?.memory ? { ok: true, memory: body.memory } : { ok: false, message: SAVE_FAILED };
  } catch {
    return { ok: false, message: SAVE_FAILED };
  }
}

export async function updateMemory(id: string, patch: { kind?: MemoryKind; text?: string }, send: typeof fetch = fetch): Promise<Done> {
  try {
    const response = await send(`/api/memories/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(patch) });
    return response.ok ? { ok: true } : { ok: false, message: (await messageOf(response)) ?? SAVE_FAILED };
  } catch {
    return { ok: false, message: SAVE_FAILED };
  }
}

/** Remove one; a memory already gone counts as removed. */
export async function removeMemory(id: string, send: typeof fetch = fetch): Promise<Done> {
  try {
    const response = await send(`/api/memories/${id}`, { method: "DELETE" });
    return response.ok || response.status === 404 ? { ok: true } : { ok: false, message: (await messageOf(response)) ?? SAVE_FAILED };
  } catch {
    return { ok: false, message: SAVE_FAILED };
  }
}

export async function forgetAll(send: typeof fetch = fetch): Promise<Done> {
  try {
    const response = await send("/api/memories", { method: "DELETE" });
    return response.ok ? { ok: true } : { ok: false, message: (await messageOf(response)) ?? SAVE_FAILED };
  } catch {
    return { ok: false, message: SAVE_FAILED };
  }
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "Added by the assistant on 9 October 2026" / "Added by you on 9 October 2026". */
export function memoryAddedLine(memory: Memory): string {
  return `Added by ${memory.source === "agent" ? "the assistant" : "you"} on ${DATE.format(new Date(memory.createdAt))}`;
}
