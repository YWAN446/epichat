import { describe, expect, it } from "vitest";

import { executeTool } from "@/lib/tools";
import { MEMORY_FULL, MEMORY_LIMIT, MEMORY_NOT_FOUND, MEMORY_OFF, PER_TURN, remember } from "@/lib/tools/remember";
import { makeDeps } from "./helpers";

const INPUT = { kind: "preference" as const, text: "Prefers results as tables" };

describe("remember", () => {
  it("stores an agent memory and answers the model with the payload", async () => {
    const deps = makeDeps();
    const out = await remember(INPUT, deps);
    expect(out).toEqual({
      content: "Remembered: Prefers results as tables",
      payload: { kind: "memory", memory_id: "m-new", memory_kind: "preference", text: "Prefers results as tables", replaced: false },
    });
    expect(deps.remembered).toEqual([{ kind: "preference", text: "Prefers results as tables", replaces: undefined }]);
    expect(deps.memory.added).toBe(1);
  });

  it("is refused when memory is off, after three in a turn, at the cap, and for an unknown replaces, never as an error", async () => {
    expect(await remember(INPUT, makeDeps({ memoryEnabled: false }))).toEqual({ content: MEMORY_OFF });
    const deps = makeDeps();
    for (let i = 0; i < PER_TURN; i++) expect((await remember(INPUT, deps)).payload?.kind).toBe("memory");
    expect(await remember(INPUT, deps)).toEqual({ content: MEMORY_LIMIT });
    expect(deps.remembered).toHaveLength(PER_TURN);
    expect(await remember(INPUT, makeDeps({ memoryAdd: "full" }))).toEqual({ content: MEMORY_FULL });
    expect(await remember({ ...INPUT, replaces: "Likes charts" }, makeDeps({ memoryAdd: "not_found" }))).toEqual({ content: MEMORY_NOT_FOUND });
    expect(MEMORY_OFF).toBe("MEMORY OFF: this participant switched memory off.");
    expect(MEMORY_LIMIT).toBe("MEMORY LIMIT: three per turn.");
    expect(MEMORY_FULL).toBe("MEMORY FULL: ask the participant to tidy their memory list.");
    expect(MEMORY_NOT_FOUND).toBe("MEMORY NOT FOUND: no such memory to replace.");
  });

  it("marks a replacement and validates through the registry, treating a null replaces as none", async () => {
    const deps = makeDeps();
    const out = await executeTool("remember", { kind: "situation", text: "Works at a county health office", replaces: "Works at a clinic" }, deps);
    expect(out.payload).toMatchObject({ kind: "memory", replaced: true, duration_ms: expect.any(Number) });
    expect(deps.remembered[0]).toEqual({ kind: "situation", text: "Works at a county health office", replaces: "Works at a clinic" });
    expect((await executeTool("remember", { kind: "wish", text: "A modeler" }, deps)).isError).toBe(true);
    expect((await executeTool("remember", { kind: "role", text: "ab" }, deps)).isError).toBe(true);
    expect((await executeTool("remember", { kind: "role", text: "A modeler", replaces: null }, deps)).payload).toMatchObject({ kind: "memory", replaced: false });
  });

  it("reports a thrown store failure as the generic tool failure", async () => {
    const deps = makeDeps({ memoryAdd: new Error("down") });
    const out = await executeTool("remember", INPUT, deps);
    expect(out).toMatchObject({ isError: true, payload: { kind: "tool_error", message: "down" } });
  });
});
