import { describe, expect, it, vi } from "vitest";

import { COUNTRY_OPTIONS, addMemory, countryIso3For, countryLabel, diseaseLabel, forgetAll, loadMemories, loadProfile, memoryAddedLine, patchProfile, removeMemory, updateMemory } from "@/lib/client/profile";
import type { Memory } from "@/lib/profile/about";
import { EMPTY_PROFILE } from "@/lib/profile/schema";

describe("the country suggestion input", () => {
  it("resolves a typed name or code to the ISO3, whatever the case, and nothing else", () => {
    expect(countryIso3For("Kenya")).toBe("KEN");
    expect(countryIso3For("kenya")).toBe("KEN");
    expect(countryIso3For("KEN")).toBe("KEN");
    expect(countryIso3For("ken")).toBe("KEN");
    expect(countryIso3For("  Kenya ")).toBe("KEN");
    expect(countryIso3For("Narnia")).toBeNull();
    expect(countryIso3For("")).toBeNull();
  });

  it("shows the name for a code and lists the countries by name", () => {
    expect(countryLabel("KEN")).toBe("Kenya");
    expect(countryLabel(null)).toBe("");
    expect(COUNTRY_OPTIONS.length).toBeGreaterThan(150);
    const names = COUNTRY_OPTIONS.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(COUNTRY_OPTIONS.find((c) => c.iso3 === "KEN")).toEqual({ iso3: "KEN", name: "Kenya" });
  });

  it("shows a stored disease key by its name and unknown text as typed", () => {
    const diseases = [{ key: "measles", name: "Measles" }];
    expect(diseaseLabel("measles", diseases)).toBe("Measles");
    expect(diseaseLabel("Unicorn pox", diseases)).toBe("Unicorn pox");
    expect(diseaseLabel(null, diseases)).toBe("");
  });
});

describe("the Profile tab's requests", () => {
  const MEMORY: Memory = { id: "m1", kind: "preference", text: "Prefers tables", source: "agent", createdAt: "2026-10-09T18:00:00Z" };
  const answering = (status: number, body?: unknown) =>
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const offline = () =>
    vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
  const SAVE_FAILED = "Could not save. Please try again.";

  it("reads and patches the profile", async () => {
    const get = answering(200, { profile: EMPTY_PROFILE });
    expect(await loadProfile(get)).toEqual({ ok: true, profile: EMPTY_PROFILE });
    expect(get).toHaveBeenCalledWith("/api/profile");
    expect(await loadProfile(answering(500))).toEqual({ ok: false });
    expect(await loadProfile(offline())).toEqual({ ok: false });
    const send = answering(200, { profile: { ...EMPTY_PROFILE, goals: ["exploring"] } });
    expect(await patchProfile({ goals: ["exploring"] }, send)).toEqual({ ok: true, profile: { ...EMPTY_PROFILE, goals: ["exploring"] } });
    expect(send).toHaveBeenCalledWith("/api/profile", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ goals: ["exploring"] }) }));
    expect(await patchProfile({ goals: ["exploring"] }, answering(500, { code: "service_unavailable" }))).toEqual({ ok: false, message: SAVE_FAILED });
    expect(await patchProfile({ goals: ["exploring"] }, offline())).toEqual({ ok: false, message: SAVE_FAILED });
  });

  it("lists, adds, edits, removes, and forgets memories, carrying the route's message when it has one", async () => {
    const list = answering(200, { memories: [MEMORY] });
    expect(await loadMemories(list)).toEqual({ ok: true, memories: [MEMORY] });
    expect(list).toHaveBeenCalledWith("/api/memories");
    expect(await loadMemories(offline())).toEqual({ ok: false });
    const add = answering(201, { memory: MEMORY });
    expect(await addMemory("preference", "Prefers tables", add)).toEqual({ ok: true, memory: MEMORY });
    expect(add).toHaveBeenCalledWith("/api/memories", expect.objectContaining({ method: "POST", body: JSON.stringify({ kind: "preference", text: "Prefers tables" }) }));
    const FULL = "Your memory list is full (30). Remove one to add another.";
    expect(await addMemory("preference", "Prefers tables", answering(409, { code: "memory_full", message: FULL }))).toEqual({ ok: false, message: FULL });
    expect(await addMemory("preference", "Prefers tables", answering(500))).toEqual({ ok: false, message: SAVE_FAILED });
    const edit = answering(204);
    expect(await updateMemory("m1", { text: "Prefers charts" }, edit)).toEqual({ ok: true });
    expect(edit).toHaveBeenCalledWith("/api/memories/m1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ text: "Prefers charts" }) }));
    const GONE = "That memory is no longer there.";
    expect(await updateMemory("m1", { text: "Prefers charts" }, answering(404, { code: "not_found", message: GONE }))).toEqual({ ok: false, message: GONE });
    const remove = answering(204);
    expect(await removeMemory("m1", remove)).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith("/api/memories/m1", expect.objectContaining({ method: "DELETE" }));
    expect(await removeMemory("m1", answering(404, { code: "not_found", message: GONE }))).toEqual({ ok: true });
    expect(await removeMemory("m1", offline())).toEqual({ ok: false, message: SAVE_FAILED });
    const forget = answering(200, { count: 2 });
    expect(await forgetAll(forget)).toEqual({ ok: true });
    expect(forget).toHaveBeenCalledWith("/api/memories", expect.objectContaining({ method: "DELETE" }));
    expect(await forgetAll(answering(500))).toEqual({ ok: false, message: SAVE_FAILED });
  });

  it("says who added a memory and when", () => {
    expect(memoryAddedLine(MEMORY)).toBe("Added by the assistant on 9 October 2026");
    expect(memoryAddedLine({ ...MEMORY, source: "participant" })).toBe("Added by you on 9 October 2026");
  });
});
