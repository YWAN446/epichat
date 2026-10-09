import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import type { TurnEvent } from "@/lib/chat/events";
import { TOOL_LIMIT_RESULT, WEB_TOOLS, eventOfBlock, runTurn, type TurnArgs } from "@/lib/chat/runTurn";
import type { ApiCall } from "@/lib/db/turns";
import type { ToolOutcome } from "@/lib/tools/types";
import { fakeClient, fetchError, fetchResult, message, searchError, searchResult, serverSearch, textBlock, thinkingBlock, toolUse, type Step } from "./helpers";

const SYSTEM = [{ type: "text" as const, text: "SYSTEM", cache_control: { type: "ephemeral" as const } }];
const TOOLS = [{ name: "configure_simulation", input_schema: { type: "object" } }, ...WEB_TOOLS] as unknown as Anthropic.Beta.BetaToolUnion[];
const HISTORY: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: "Model measles in Kenya" }];
const CALL = message([toolUse("tu_1", "configure_simulation", { disease: "measles" })], "tool_use");
const CONFIG = { kind: "config" as const, applied: {}, approx_r0: 12, config: { disease: "measles", disease_type: "sir", country: null, n_agents: 10000, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] }, warnings: [], new_scenario: false };

function clock() {
  let t = Date.parse("2026-10-08T15:00:00Z");
  return () => new Date((t += 250));
}

function setup(script: Step[], options: Partial<TurnArgs> & { outcome?: ToolOutcome } = {}) {
  const { client, requests, requestOptions } = fakeClient(script);
  const events: TurnEvent[] = [];
  const toolCalls: { name: string; input: unknown }[] = [];
  const apiCalls: ApiCall[] = [];
  const { outcome, ...overrides } = options;
  const run = () =>
    runTurn({
      client, model: "claude-opus-5-5", effort: "medium", thinkingDisplay: "summarized", refusalFallback: true,
      system: SYSTEM, tools: TOOLS, messages: HISTORY, maxOutputTokens: 4000, maxToolRounds: 5, maxPauseContinuations: 2,
      executeTool: async (name, input) => {
        toolCalls.push({ name, input });
        return outcome ?? { content: "RESULT", payload: CONFIG };
      },
      onEvent: (event) => events.push(event),
      apiCalls, now: clock(), ...overrides,
    });
  return { run, requests, requestOptions, events, toolCalls, apiCalls };
}

describe("runTurn", () => {
  it("returns a plain answer, streams its text, and records the model call", async () => {
    const answer = message([textBlock("Hello there")]);
    const { run, events, apiCalls } = setup([{ message: answer, text: ["Hello ", "there"] }]);
    const result = await run();
    expect(result).toEqual({ appended: [{ role: "assistant", content: answer.content }], stop: "end_turn", refusalCategory: null, firstTokenAt: new Date("2026-10-08T15:00:00.500Z") });
    expect(events).toEqual([{ type: "text", delta: "Hello " }, { type: "text", delta: "there" }]);
    expect(apiCalls).toEqual([{ model: "claude-opus-5-5", input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0, stop_reason: "end_turn", latency_ms: 500, served_by: "claude-opus-5-5" }]);
  });

  it("runs a requested tool, reports it with its payload, and sends the result back", async () => {
    const answer = message([textBlock("Configured.")]);
    const { run, requests, events, toolCalls } = setup([{ message: CALL }, { message: answer }]);
    const result = await run();
    expect(toolCalls).toEqual([{ name: "configure_simulation", input: { disease: "measles" } }]);
    expect(result.stop).toBe("end_turn");
    expect(result.appended).toEqual([
      { role: "assistant", content: CALL.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "RESULT" }] },
      { role: "assistant", content: answer.content },
    ]);
    expect(requests[1].messages).toEqual([...HISTORY, ...result.appended.slice(0, 2)]);
    expect(events).toEqual([
      { type: "tool_use", id: "tu_1", name: "configure_simulation", input: { disease: "measles" } },
      { type: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: CONFIG },
    ]);
  });

  it("marks a failed tool result as an error for the model and the event", async () => {
    const { run, events } = setup([{ message: CALL }, { message: message([textBlock("Sorry.")]) }], { outcome: { content: "CONFIG ERROR: x", isError: true, payload: { kind: "tool_error", message: "CONFIG ERROR: x" } } });
    const result = await run();
    expect(result.appended[1]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "CONFIG ERROR: x", is_error: true }] });
    expect(events[1]).toMatchObject({ type: "tool_result", ok: false, payload: { kind: "tool_error" } });
  });

  it("keeps thinking blocks in the message and reports their summaries, skipping empty ones", async () => {
    const content = [thinkingBlock("Plan the model"), thinkingBlock(""), textBlock("Hi")];
    const { run, events } = setup([{ message: message(content), text: ["Hi"] }]);
    const result = await run();
    expect(result.appended[0].content).toEqual(content);
    expect(events).toEqual([{ type: "text", delta: "Hi" }, { type: "thinking", summary: "Plan the model" }]);
  });

  it("drops the whole turn on a refusal with its category but still counts the call", async () => {
    const refusal = message([], "refusal", { stop_details: { type: "refusal", category: "bio", explanation: null } });
    const { run, apiCalls } = setup([{ message: CALL }, { message: refusal }]);
    const result = await run();
    expect(result).toMatchObject({ appended: [], stop: "refusal", refusalCategory: "bio" });
    expect(apiCalls).toHaveLength(2);
    expect(apiCalls[1].stop_reason).toBe("refusal");
  });

  it("drops a cut-off tool call, keeps a cut-off text answer, and drops an empty reply", async () => {
    const cut = message([toolUse("tu_1", "configure_simulation", { disease: "mea" })], "max_tokens");
    const { run, toolCalls } = setup([{ message: cut }]);
    expect(await run()).toMatchObject({ appended: [], stop: "max_tokens" });
    expect(toolCalls).toEqual([]);
    const long = setup([{ message: message([textBlock("A long answer that stops")], "max_tokens") }]);
    const kept = await long.run();
    expect(kept.stop).toBe("max_tokens");
    expect(kept.appended).toHaveLength(1);
    expect(await setup([{ message: message([]) }]).run()).toMatchObject({ appended: [], stop: "empty" });
  });

  it("stops running tools after the limit, gives up after two more calls, and lets the model answer in between", async () => {
    const exhausted = setup([{ message: CALL }], { maxToolRounds: 2 });
    const dropped = await exhausted.run();
    expect(exhausted.toolCalls).toHaveLength(2);
    expect(exhausted.requests).toHaveLength(4);
    expect(dropped).toMatchObject({ appended: [], stop: "tool_limit" });

    const answered = setup([{ message: CALL }, { message: CALL }, { message: CALL }, { message: message([textBlock("Here is what I have.")]) }], { maxToolRounds: 2 });
    const result = await answered.run();
    expect(result.stop).toBe("end_turn");
    expect(answered.toolCalls).toHaveLength(2);
    expect(result.appended).toHaveLength(7);
    expect(result.appended[5]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", is_error: true, content: TOOL_LIMIT_RESULT }] });
  });

  it("resumes a paused message without counting a tool round, and drops the turn when continuations run out", async () => {
    const paused = message([serverSearch("st_1", "measles Kenya"), searchResult("st_1", 3)], "pause_turn");
    const answer = message([textBlock("Found it.")]);
    const resumed = setup([{ message: paused }, { message: paused }, { message: answer }], { maxToolRounds: 1, maxPauseContinuations: 2 });
    const result = await resumed.run();
    expect(result.stop).toBe("end_turn");
    expect(result.appended).toEqual([{ role: "assistant", content: paused.content }, { role: "assistant", content: paused.content }, { role: "assistant", content: answer.content }]);
    expect(resumed.requests[2].messages).toEqual([...HISTORY, ...result.appended.slice(0, 2)]);
    expect(resumed.events.filter((e) => e.type === "web_search")).toHaveLength(2);

    const exhausted = setup([{ message: paused }], { maxPauseContinuations: 1 });
    expect(await exhausted.run()).toMatchObject({ appended: [], stop: "paused" });
    expect(exhausted.requests).toHaveLength(2);
  });

  it("answers a tool call on a paused message before resuming", async () => {
    const pausedCall = message([serverSearch("st_1", "q"), searchResult("st_1", 1), toolUse("tu_1", "configure_simulation", { disease: "measles" })], "pause_turn");
    const answer = message([textBlock("Done.")]);
    const { run, requests, toolCalls } = setup([{ message: pausedCall }, { message: answer }]);
    const result = await run();
    expect(toolCalls).toHaveLength(1);
    expect(result.appended).toEqual([
      { role: "assistant", content: pausedCall.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "RESULT" }] },
      { role: "assistant", content: answer.content },
    ]);
    expect(requests[1].messages).toEqual([...HISTORY, ...result.appended.slice(0, 2)]);
  });

  it("reports web fetches by title or URL and web errors as notices", async () => {
    const content = [
      serverSearch("st_1", "measles Kenya"), searchResult("st_1", 2),
      { type: "server_tool_use", id: "st_2", name: "web_fetch", input: { url: "https://www.who.int/measles" } }, fetchResult("st_2", "https://www.who.int/measles", "Measles"),
      fetchResult("st_3", "https://example.org/page", null),
      searchError("st_4", "max_uses_exceeded"), fetchError("st_5", "url_not_accessible"),
      { type: "server_tool_use", id: "st_6", name: "code_execution", input: { code: "1+1" } }, { type: "code_execution_tool_result", tool_use_id: "st_6", content: { type: "code_execution_result", stdout: "2", stderr: "", return_code: 0, content: [] } },
      textBlock("Found it."),
    ];
    const { run, events } = setup([{ message: message(content), text: ["Found it."] }]);
    await run();
    expect(events).toEqual([
      { type: "text", delta: "Found it." },
      { type: "web_search", query: "measles Kenya" },
      { type: "web_fetch", url: "https://www.who.int/measles", title: "Measles" },
      { type: "web_fetch", url: "https://example.org/page", title: "https://example.org/page" },
      { type: "notice", message: "WEB ERROR: max_uses_exceeded" },
      { type: "notice", message: "WEB ERROR: url_not_accessible" },
    ]);
    expect(eventOfBlock({ type: "redacted_thinking", data: "x" } as Anthropic.Beta.BetaContentBlock)).toBeNull();
  });

  it("sends the exact request object, with the fallback only when enabled, and the abort signal to every call", async () => {
    const controller = new AbortController();
    const { run, requests, requestOptions } = setup([{ message: CALL }, { message: message([textBlock("ok")]) }], { signal: controller.signal });
    await run();
    expect(requests[0]).toEqual({
      model: "claude-opus-5-5", max_tokens: 4000, system: SYSTEM, cache_control: { type: "ephemeral" }, tools: TOOLS, messages: HISTORY,
      thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "medium" }, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"],
    });
    expect(requestOptions).toEqual([{ signal: controller.signal }, { signal: controller.signal }]);
    const plain = setup([{ message: message([textBlock("ok")]) }], { refusalFallback: false, effort: "high", thinkingDisplay: "omitted" });
    await plain.run();
    expect("fallbacks" in plain.requests[0]).toBe(false);
    expect("betas" in plain.requests[0]).toBe(false);
    expect(plain.requests[0]).toMatchObject({ thinking: { type: "adaptive", display: "omitted" }, output_config: { effort: "high" } });
    expect(plain.requestOptions).toEqual([undefined]);
  });

  it("records the fallback model that served a rerouted call", async () => {
    const served = message([textBlock("ok")], "end_turn", {
      usage: { ...message([]).usage, iterations: [{ type: "fallback_message", model: "claude-opus-5", input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null }] },
    });
    const { run, apiCalls } = setup([{ message: served }]);
    await run();
    expect(apiCalls[0]).toMatchObject({ model: "claude-opus-5-5", served_by: "claude-opus-5" });
  });

  it("re-issues a call whose eager tool input could not be parsed, gives up after three, and never retries an API error", async () => {
    const broken = { error: new SyntaxError("Unexpected end of JSON input") };
    const retried = setup([broken, broken, { message: message([textBlock("ok")]) }]);
    expect((await retried.run()).stop).toBe("end_turn");
    expect(retried.requests).toHaveLength(3);
    const hopeless = setup([broken]);
    await expect(hopeless.run()).rejects.toBeInstanceOf(SyntaxError);
    expect(hopeless.requests).toHaveLength(3);
    const apiError = new Anthropic.APIError(500, undefined, "server error", new Headers());
    const failed = setup([{ error: apiError }]);
    await expect(failed.run()).rejects.toBe(apiError);
    expect(failed.requests).toHaveLength(1);
  });

  it("does not change the caller's message list, and never repeats a call because the listener threw", async () => {
    const { run, requests, apiCalls } = setup([{ message: CALL }, { message: message([textBlock("ok")], "end_turn"), text: ["ok"] }], {
      onEvent: () => {
        throw new Error("Invalid state: Controller is already closed");
      },
    });
    const result = await run();
    expect(result.stop).toBe("end_turn");
    expect(result.appended).toHaveLength(3);
    expect(requests).toHaveLength(2);
    expect(apiCalls).toHaveLength(2);
    expect(HISTORY).toEqual([{ role: "user", content: "Model measles in Kenya" }]);
  });
});
