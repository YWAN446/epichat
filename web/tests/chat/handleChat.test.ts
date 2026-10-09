import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatStreamEvent } from "@/lib/chat/events";
import { CONVERSATION_INVALID, CUT_OFF_NOTICE, DISCARD_MESSAGES, UNAVAILABLE, handleChat, type ChatDeps } from "@/lib/chat/handleChat";
import { systemBlocks } from "@/lib/chat/prompt";
import { loadSettings } from "@/lib/config";
import type { ConversationRow, ConversationStore } from "@/lib/db/conversations";
import type { MessageStore } from "@/lib/db/messages";
import type { RunInsert, RunStore } from "@/lib/db/runs";
import type { ScenarioStore } from "@/lib/db/scenarios";
import type { FinishTurnPayload, TurnStore } from "@/lib/db/turns";
import type { SimClient, SimResult } from "@/lib/sim/client";
import { emptyScenario, type Scenario } from "@/lib/tools/types";
import type { TurnReservation, UsageDelta, UsageStore } from "@/lib/usage";
import { makeDeps, params } from "../tools/helpers";
import { fakeClient, fetchResult, message, searchResult, serverSearch, textBlock, toolUse, type Step } from "./helpers";

const USER = { id: "11111111-1111-1111-1111-111111111111" };
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const TURN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const HISTORY: Anthropic.Beta.BetaMessageParam[] = [
  { role: "user", content: "Today's date: 2026-10-04.\n\nModel measles in Kenya" },
  { role: "assistant", content: [{ type: "text", text: "Configured." }] },
];
const STATS = { peak_infections: 9, peak_day: 40, total_infected: 400, total_deaths: 1, n_agents: 10000, sim_days: 365 };
const SUCCESS: SimResult = {
  ok: true, effective_params: params({}), population: 10000, stats: STATS, stats_agents: STATS, series: { day: [0, 1], n_infected: [1, 2] },
  pop_scale: 1, repairs: [], attempts: 1, duration_ms: 6800, cold_start: false, starsim_version: "3.3.2",
};
const HELLO = { text: "Model measles in Kenya" };
const ANSWER = message([textBlock("Sure.\n\n```next\nConfigure measles\nFetch Kenya data\n```")]);
const CONFIGURE = message([toolUse("tu_1", "configure_simulation", { disease: "measles", r0: 12 })], "tool_use");
const RUN = message([toolUse("tu_2", "run_simulation", {})], "tool_use");

function clock() {
  let t = Date.parse("2026-10-05T16:00:00Z");
  return () => new Date((t += 1000));
}

function configured(): Scenario {
  return { ...emptyScenario(), id: "s1", params: params({ n_agents: 10000 }), disease: "measles", stage: "configure", stageReached: "configure" };
}

type Over = {
  reservation?: TurnReservation; conversation?: ConversationRow | null; history?: Anthropic.Beta.BetaMessageParam[]; scenario?: Scenario | null;
  texts?: string[]; finishError?: Error; runError?: Error; loadError?: Error; simulate?: SimResult | Error;
};

function setup(script: Step[], over: Over = {}, env: Record<string, string> = {}) {
  const { client, requests, requestOptions } = fakeClient(script);
  const calls = {
    reservations: [] as unknown[][], records: [] as [string, string, UsageDelta][], created: [] as [string, string][],
    gets: [] as [string, string][], finished: [] as FinishTurnPayload[], runs: [] as RunInsert[], simulated: [] as { popScale: number; contextText: string }[],
  };
  const usage: UsageStore = {
    async reserveTurn(userId, day, monthStart, limits) { calls.reservations.push([userId, day, monthStart, limits]); return over.reservation ?? "ok"; },
    async record(userId, day, delta) { calls.records.push([userId, day, delta]); },
  };
  const conversations: ConversationStore = {
    async create(userId, title) { calls.created.push([userId, title]); return CONVERSATION; },
    async get(id, userId) {
      if (over.loadError) throw over.loadError;
      calls.gets.push([id, userId]);
      return over.conversation === undefined ? { id, title: "T", activeScenarioId: over.scenario ? "s1" : null } : over.conversation;
    },
    async softDelete() { return true; },
  };
  const messages: MessageStore = { async list() { return over.history ?? []; } };
  const scenarios: ScenarioStore = { async get() { return over.scenario ?? null; } };
  const turns: TurnStore = {
    async finishTurn(payload) { if (over.finishError) throw over.finishError; calls.finished.push(structuredClone(payload)); return "s1"; },
    async userTexts() { return over.texts ?? []; },
    async listForReplay() { return []; },
    async lastRecap() { return []; },
  };
  const runs: RunStore = { async insert(run) { if (over.runError) throw over.runError; calls.runs.push(run); return "run-1"; }, async listForReport() { return []; } };
  const sim: SimClient = {
    async simulate(_params, popScale, contextText) {
      calls.simulated.push({ popScale, contextText });
      if (over.simulate instanceof Error) throw over.simulate;
      return over.simulate ?? SUCCESS;
    },
    async demographicsFallback() { return null; },
  };
  const deps: ChatDeps = {
    settings: loadSettings(env), client, usage, conversations, messages, scenarios, turns, runs, sim,
    adapters: makeDeps().adapters, now: clock(), newId: () => TURN,
  };
  const emitted: ChatStreamEvent[] = [];
  const run = (body: unknown, signal?: AbortSignal) =>
    handleChat(deps, USER, typeof body === "string" ? body : JSON.stringify(body), (event) => emitted.push(event), signal);
  return { run, deps, emitted, requests, requestOptions, ...calls };
}

afterEach(() => vi.restoreAllMocks());

describe("handleChat", () => {
  it("answers a first message: creates the conversation, dates the first message, streams, stores the turn, and records usage", async () => {
    const { run, emitted, requests, created, finished, records, reservations } = setup([{ message: ANSWER, text: ["Sure.", "\n\n```next\nConfigure measles\nFetch Kenya data\n```"] }]);
    await run({ ...HELLO, sessionId: SESSION });

    expect(reservations).toEqual([[USER.id, "2026-10-05", "2026-10-01", { dailyTurns: 40, monthlyBudgetUsd: 50 }]]);
    expect(created).toEqual([[USER.id, "Model measles in Kenya"]]);
    const userMessage = { role: "user", content: "Today's date: 2026-10-05.\n\nModel measles in Kenya" };
    expect(requests[0].messages).toEqual([userMessage]);
    expect(requests[0].system).toEqual(systemBlocks());
    expect((requests[0].tools as { name: string }[]).map((tool) => tool.name)).toEqual([
      "configure_simulation", "lookup_disease", "fetch_demographics", "fetch_health_system", "fetch_vaccination_coverage", "run_simulation", "web_search", "web_fetch",
    ]);
    expect(emitted).toEqual([
      { type: "text", delta: "Sure." },
      { type: "text", delta: "\n\n```next\nConfigure measles\nFetch Kenya data\n```" },
      { type: "suggestions", items: ["Configure measles", "Fetch Kenya data"] },
      { type: "done", turnId: TURN, conversationId: CONVERSATION, notice: null },
    ]);

    expect(finished).toHaveLength(1);
    const payload = finished[0];
    expect(payload).toMatchObject({ user_id: USER.id, conversation_id: CONVERSATION, title: "Model measles in Kenya" });
    expect(payload.turn).toMatchObject({
      id: TURN, session_id: SESSION, user_text: "Model measles in Kenya", stop: "end_turn", refusal_category: null, model: "claude-opus-5-5", effort: "medium",
      input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0, stage_before: "understand", stage_after: "understand",
    });
    expect(payload.turn.started_at).toBe("2026-10-05T16:00:01.000Z");
    expect(payload.turn.first_token_at).not.toBeNull();
    expect(payload.turn.cost_usd).toBeCloseTo(0.0008, 10);
    expect(payload.turn.api_calls[0]).toMatchObject({ model: "claude-opus-5-5", input_tokens: 100, stop_reason: "end_turn", served_by: "claude-opus-5-5" });
    expect(payload.events.map((e) => e.kind)).toEqual(["text", "suggestions"]);
    expect(payload.events[0]).toMatchObject({ seq: 1, text: "Sure." });
    expect(payload.messages).toEqual([userMessage, { role: "assistant", content: ANSWER.content }]);
    expect(payload.scenario).toMatchObject({ id: null, seq: 1, params: null, stage: "understand", has_run: false });
    expect(payload.step_events.map((e) => e.kind)).toEqual(["conversation_started", "turn"]);
    expect(payload.step_events[0]).toMatchObject({ session_id: SESSION, stage: "understand" });
    expect(payload.step_events[1].meta).toMatchObject({ stop: "end_turn", api_calls: 1, tool_calls: 0 });

    expect(records).toHaveLength(1);
    expect(records[0][0]).toBe(USER.id);
    expect(records[0][1]).toBe("2026-10-05");
    expect(records[0][2]).toMatchObject({ turns: 0, inputTokens: 100, outputTokens: 20 });
    expect(records[0][2].costUsd).toBeCloseTo(0.0008, 10);
  });

  it("continues a conversation: history first, no date line, no title, no conversation_started", async () => {
    const { run, requests, gets, created, finished } = setup([{ message: message([textBlock("Running.")]) }], { history: HISTORY, texts: ["Model measles in Kenya"] });
    await run({ conversationId: CONVERSATION, text: "Run it" });
    expect(gets).toEqual([[CONVERSATION, USER.id]]);
    expect(created).toEqual([]);
    expect(requests[0].messages).toEqual([...HISTORY, { role: "user", content: "Run it" }]);
    expect(finished[0].title).toBeNull();
    expect(finished[0].step_events.map((e) => e.kind)).toEqual(["turn"]);
  });

  it("treats an empty suggestions block as no suggestions", async () => {
    const { run, emitted, finished } = setup([{ message: message([textBlock("Done.\n\n```next\n\n```")]), text: ["Done.\n\n```next\n\n```"] }]);
    await run(HELLO);
    expect(emitted.some((e) => e.type === "suggestions")).toBe(false);
    expect(finished[0].events.map((e) => e.kind)).toEqual(["text"]);
    expect(finished[0].events[0]).toMatchObject({ text: "Done." });
  });

  it("stops before the model on a cap, a bad request, an unknown or deleted conversation, and a store failure", async () => {
    const budget = setup([{ message: ANSWER }], { reservation: "monthly_budget" });
    await budget.run(HELLO);
    expect(budget.emitted).toEqual([{ type: "error", code: "monthly_budget", message: expect.stringMatching(/this month/) }]);
    expect(budget.requests).toEqual([]);
    expect(budget.records).toEqual([]);
    expect(budget.finished).toEqual([]);

    const daily = setup([{ message: ANSWER }], { reservation: "daily_turns" });
    await daily.run(HELLO);
    expect(daily.emitted[0]).toMatchObject({ type: "error", code: "daily_turns", message: expect.stringMatching(/40/) });

    const bad = setup([{ message: ANSWER }]);
    await bad.run("not json");
    expect(bad.emitted[0]).toMatchObject({ type: "error", code: "bad_request" });
    expect(bad.reservations).toEqual([]);

    const gone = setup([{ message: ANSWER }], { conversation: null });
    await gone.run({ conversationId: CONVERSATION, text: "Run it" });
    expect(gone.emitted).toEqual([{ type: "error", code: "conversation_not_found", message: expect.stringMatching(/no longer available/) }]);
    expect(gone.requests).toEqual([]);

    const noReserve = setup([{ message: ANSWER }]);
    noReserve.deps.usage.reserveTurn = async () => { throw new Error("database down"); };
    await noReserve.run(HELLO);
    expect(noReserve.emitted).toEqual([{ type: "error", code: "service_unavailable", message: UNAVAILABLE }]);

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const noLoad = setup([{ message: ANSWER }], { loadError: new Error("database down") });
    await noLoad.run({ conversationId: CONVERSATION, text: "Run it" });
    expect(noLoad.emitted).toEqual([{ type: "error", code: "service_unavailable", message: UNAVAILABLE }]);
    expect(noLoad.requests).toEqual([]);
    expect(logged).toHaveBeenCalled();
  });

  it("runs a tool round: the tool events and the stage change stream in order, the scenario is saved, the steps are counted", async () => {
    const { run, emitted, finished } = setup([{ message: CONFIGURE }, { message: message([textBlock("Configured measles.")]), text: ["Configured measles."] }]);
    await run(HELLO);
    expect(emitted.map((e) => e.type)).toEqual(["tool_use", "tool_result", "stage", "text", "done"]);
    expect(emitted[1]).toMatchObject({ type: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: { kind: "config", approx_r0: 12 } });
    expect(emitted[2]).toEqual({ type: "stage", stage: "configure" });

    const payload = finished[0];
    expect(payload.events.map((e) => e.kind)).toEqual(["tool_use", "tool_result", "stage", "text"]);
    expect((payload.events[1] as { payload: { duration_ms?: number } }).payload.duration_ms).toBe(1000);
    expect(payload.messages).toHaveLength(4);
    expect(payload.scenario).toMatchObject({ id: null, seq: 1, disease: "measles", stage: "configure", stage_reached: "configure", has_run: false });
    expect((payload.scenario.params as { n_agents: number }).n_agents).toBeGreaterThan(0);
    expect(payload.turn).toMatchObject({ stage_before: "understand", stage_after: "configure", input_tokens: 200, output_tokens: 40 });
    expect(payload.step_events.map((e) => [e.kind, e.tool, e.stage])).toEqual([
      ["conversation_started", null, "understand"], ["tool_called", "configure_simulation", "understand"], ["stage_reached", null, "configure"], ["turn", null, "configure"],
    ]);
    expect(payload.step_events[1].meta).toEqual({ duration_ms: 1000 });
    expect(payload.step_events[3].meta).toMatchObject({ tool_calls: 1, api_calls: 2 });
  });

  it("records a failed tool as tool_failed and keeps going", async () => {
    const { run, emitted, finished } = setup([{ message: RUN }, { message: message([textBlock("Configure first.")]) }]);
    await run(HELLO);
    expect(emitted[1]).toMatchObject({ type: "tool_result", ok: false, payload: { kind: "tool_error" } });
    expect(finished[0].step_events.map((e) => e.kind)).toEqual(["conversation_started", "tool_failed", "turn"]);
    expect(emitted.at(-1)?.type).toBe("done");
  });

  it("runs the simulation: the run row carries the turn id, the stage passes through run to interpret, and the context has no date line", async () => {
    const { run, emitted, finished, runs, simulated, records } = setup(
      [{ message: RUN }, { message: message([textBlock("Peak on day 40.")]), text: ["Peak on day 40."] }],
      { history: HISTORY, texts: ["Model measles in Kenya"], scenario: configured() },
    );
    await run({ conversationId: CONVERSATION, sessionId: SESSION, text: "Run it" });
    expect(simulated).toEqual([{ popScale: 1, contextText: "Model measles in Kenya Run it" }]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ conversationId: CONVERSATION, userId: USER.id, turnId: TURN, scenarioId: "s1" });
    expect(runs[0].record.result).toEqual(SUCCESS);
    expect(emitted.map((e) => e.type)).toEqual(["tool_use", "stage", "tool_result", "stage", "text", "done"]);
    expect(emitted[1]).toEqual({ type: "stage", stage: "run" });
    expect(emitted[3]).toEqual({ type: "stage", stage: "interpret" });
    expect(emitted[2]).toMatchObject({ type: "tool_result", ok: true, payload: { kind: "run", run_id: "run-1", series: { day: [0, 1] } } });

    const payload = finished[0];
    const stored = payload.events[2] as { payload: Record<string, unknown> };
    expect(stored.payload.kind).toBe("run");
    expect("series" in stored.payload).toBe(false);
    expect(payload.scenario).toMatchObject({ id: "s1", has_run: true, stage: "interpret", stage_reached: "interpret" });
    expect(payload.turn).toMatchObject({ stage_before: "configure", stage_after: "interpret" });
    expect(payload.step_events.map((e) => e.kind)).toEqual(["stage_reached", "run_completed", "tool_called", "stage_reached", "turn"]);
    expect(payload.step_events[1]).toMatchObject({ tool: "run_simulation", stage: "run", meta: { duration_ms: 6800, cold_start: false, n_agents: 10000, repairs: 0 } });
    expect(records[0][2].costUsd).toBeCloseTo(0.0016, 10);
  });

  it("adds the sim's repair tokens to the cost, and keeps the run when its row cannot be inserted", async () => {
    const repaired: SimResult = { ...SUCCESS, repairs: [{ attempt: 1, error: "beta too high", changes: [], usage: { model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 100 } }] };
    const { run, finished, records } = setup([{ message: RUN }, { message: message([textBlock("Repaired and run.")]) }], { history: HISTORY, scenario: configured(), simulate: repaired });
    await run({ conversationId: CONVERSATION, text: "Run it" });
    // 2 calls at 0.0008 each, plus 1000 × 4 + 100 × 20 per million for the repair.
    expect(records[0][2].costUsd).toBeCloseTo(0.0016 + 0.006, 10);
    expect(finished[0].turn.cost_usd).toBeCloseTo(0.0076, 10);

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const noRow = setup([{ message: RUN }, { message: message([textBlock("Ran.")]) }], { history: HISTORY, scenario: configured(), runError: new Error("down") });
    await noRow.run({ conversationId: CONVERSATION, text: "Run it" });
    expect(noRow.emitted.at(-1)?.type).toBe("done");
    expect(noRow.emitted[2]).toMatchObject({ type: "tool_result", ok: true, payload: { run_id: null } });
    expect(logged).toHaveBeenCalled();
  });

  it("records a failed simulation as run_failed with the run row's error", async () => {
    const failure: SimResult = { ok: false, status: 504, kind: "timeout", detail: "The simulation timed out after 120 seconds.", repairs: [], attempts: 1, seconds: 120 };
    const { run, emitted, finished, runs } = setup([{ message: RUN }, { message: message([textBlock("It timed out.")]) }], { history: HISTORY, scenario: configured(), simulate: failure });
    await run({ conversationId: CONVERSATION, text: "Run it" });
    expect(runs[0].record.result).toEqual(failure);
    expect(emitted[2]).toMatchObject({ type: "tool_result", ok: false, payload: { kind: "tool_error", message: expect.stringMatching(/^SIMULATION ERROR: The simulation timed out/) } });
    expect(finished[0].step_events.map((e) => e.kind)).toEqual(["stage_reached", "run_failed", "tool_failed", "turn"]);
    expect(finished[0].step_events[1].meta).toEqual({ kind: "timeout", repairs: 0 });
    expect(finished[0].scenario).toMatchObject({ has_run: false, stage: "configure" });
  });

  it("drops a refused turn with the Python message, counts the refusal, stores the turn without messages, and still bills it", async () => {
    const refusal = message([], "refusal", { stop_details: { type: "refusal", category: "bio", explanation: null } });
    const { run, emitted, finished, records } = setup([{ message: refusal }]);
    await run(HELLO);
    expect(emitted).toEqual([{ type: "discard", message: DISCARD_MESSAGES.refusal }]);
    expect(DISCARD_MESSAGES.refusal).toBe("I'm unable to help with that request. Let's get back to epidemic simulations — what would you like to model?");
    expect(finished[0].turn).toMatchObject({ stop: "refusal", refusal_category: "bio" });
    expect(finished[0].messages).toBeNull();
    expect(finished[0].step_events).toContainEqual(expect.objectContaining({ kind: "refusal", meta: { category: "bio" } }));
    expect(records).toHaveLength(1);
  });

  it("shows the paused message when continuations run out, and the other discard messages", async () => {
    const paused = setup([{ message: message([serverSearch("st_1", "q"), searchResult("st_1", 1)], "pause_turn") }], {}, { MAX_PAUSE_CONTINUATIONS: "0" });
    await paused.run(HELLO);
    expect(paused.emitted.at(-1)).toEqual({ type: "discard", message: "That search ran longer than I can continue in one turn. Ask me again and I'll pick it up." });
    expect(paused.finished[0].turn.stop).toBe("paused");
    expect(paused.finished[0].messages).toBeNull();

    const empty = setup([{ message: message([]) }]);
    await empty.run(HELLO);
    expect(empty.emitted).toEqual([{ type: "discard", message: "No reply came back. Please try again." }]);

    const limited = setup([{ message: CONFIGURE }], {}, { MAX_TOOL_ROUNDS: "1" });
    await limited.run(HELLO);
    expect(limited.emitted.at(-1)).toEqual({ type: "discard", message: "That needed more steps than one message allows. Try a narrower question." });
    expect(limited.finished[0].turn.stop).toBe("tool_limit");

    const cut = setup([{ message: message([toolUse("tu_1", "configure_simulation", { disease: "mea" })], "max_tokens") }]);
    await cut.run(HELLO);
    expect(cut.emitted.at(-1)).toEqual({ type: "discard", message: "That reply ran past the length limit before it finished. Try asking for less at once." });
  });

  it("marks a reply that hit the length limit", async () => {
    const { run, emitted } = setup([{ message: message([textBlock("Cut")], "max_tokens") }]);
    await run(HELLO);
    expect(emitted.at(-1)).toEqual({ type: "done", turnId: TURN, conversationId: CONVERSATION, notice: CUT_OFF_NOTICE });
  });

  it("records an aborted turn without appending messages and still records usage", async () => {
    const controller = new AbortController();
    controller.abort();
    const { run, emitted, finished, runs, records } = setup(
      [{ message: RUN }, { error: new Anthropic.APIUserAbortError() }],
      { history: HISTORY, scenario: configured() },
    );
    await run({ conversationId: CONVERSATION, text: "Run it" }, controller.signal);
    expect(runs).toHaveLength(1);
    expect(finished[0].turn.stop).toBe("aborted");
    expect(finished[0].messages).toBeNull();
    expect(finished[0].events.map((e) => e.kind)).toEqual(["tool_use", "stage", "tool_result", "stage"]);
    expect(emitted.map((e) => e.type)).toEqual(["tool_use", "stage", "tool_result", "stage"]);
    expect(records).toHaveLength(1);
    expect(records[0][2].inputTokens).toBe(100);
  });

  it("asks for a new conversation when the API rejects the history, and reports other failures as unavailable, keeping the turn as an error", async () => {
    const rejected = setup([{ error: new Anthropic.BadRequestError(400, undefined, "invalid history", new Headers()) }], { history: HISTORY });
    await rejected.run({ conversationId: CONVERSATION, text: "Run it" });
    expect(rejected.emitted).toEqual([{ type: "error", code: "conversation_invalid", message: CONVERSATION_INVALID }]);
    expect(rejected.finished[0].turn).toMatchObject({ stop: "error", input_tokens: 0 });
    expect(rejected.finished[0].messages).toBeNull();
    expect(rejected.records).toHaveLength(1);

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const down = setup([{ message: CONFIGURE }, { error: new Anthropic.APIError(529, undefined, "overloaded", new Headers()) }]);
    await down.run(HELLO);
    expect(down.emitted.at(-1)).toEqual({ type: "error", code: "service_unavailable", message: UNAVAILABLE });
    expect(down.finished[0].turn).toMatchObject({ stop: "error", input_tokens: 100 });
    expect(down.finished[0].events.map((e) => e.kind)).toEqual(["tool_use", "tool_result", "stage"]);
    expect(down.finished[0].scenario).toMatchObject({ disease: "measles" });
    expect(logged).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).not.toContain("measles");
  });

  it("answers service_unavailable when the turn cannot be stored, and still records usage", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { run, emitted, records } = setup([{ message: ANSWER }], { finishError: new Error("db down") });
    await run(HELLO);
    expect(emitted.at(-1)).toEqual({ type: "error", code: "service_unavailable", message: UNAVAILABLE });
    expect(records).toHaveLength(1);
  });

  it("records a fetched page once, and web events as steps", async () => {
    const content = [
      serverSearch("st_1", "measles Kenya"), searchResult("st_1", 2),
      fetchResult("st_2", "https://www.who.int/measles", "Measles"), fetchResult("st_3", "https://www.who.int/measles", null),
      textBlock("Found it."),
    ];
    const { run, emitted, finished } = setup([{ message: message(content), text: ["Found it."] }]);
    await run(HELLO);
    expect(emitted.filter((e) => e.type === "web_search" || e.type === "web_fetch")).toHaveLength(3);
    expect(finished[0].scenario.web_sources).toEqual([{ title: "Measles", url: "https://www.who.int/measles" }]);
    expect(finished[0].step_events.map((e) => e.kind)).toEqual(["conversation_started", "web_search", "web_fetch", "web_fetch", "turn"]);
  });

  it("still answers when usage cannot be recorded, and leaves a text-free log line", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { run, deps, emitted } = setup([{ message: ANSWER }]);
    deps.usage.record = async () => { throw new Error("database down"); };
    await expect(run(HELLO)).resolves.toBeUndefined();
    expect(emitted.at(-1)?.type).toBe("done");
    expect(logged).toHaveBeenCalledWith("usage record failed");
  });

  it("finishes quietly and stores the turn when the participant has gone away", async () => {
    const { client, requests } = fakeClient([{ message: ANSWER, text: ["Sure."] }]);
    const base = setup([{ message: ANSWER }]);
    const deps: ChatDeps = { ...base.deps, client };
    const closed = () => { throw new Error("Invalid state: Controller is already closed"); };
    await expect(handleChat(deps, USER, JSON.stringify(HELLO), closed)).resolves.toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(base.finished).toHaveLength(1);
    expect(base.records[0][2]).toMatchObject({ inputTokens: 100, outputTokens: 20 });
  });

  it("passes the abort signal through to the model call", async () => {
    const controller = new AbortController();
    const { run, requestOptions } = setup([{ message: ANSWER }]);
    await run(HELLO, controller.signal);
    expect(requestOptions).toEqual([{ signal: controller.signal }]);
  });

  it("emits and stores the recap before the suggestions, and neither when the reply has none", async () => {
    const text = "Sure.\n\n```recap\nMeasles in Kenya\n- Population 2 million\n```\n\n```next\nRun it\n```";
    const { run, emitted, finished } = setup([{ message: message([textBlock(text)]), text: [text] }]);
    await run(HELLO);
    expect(emitted.map((e) => e.type)).toEqual(["text", "recap", "suggestions", "done"]);
    expect(emitted[1]).toEqual({ type: "recap", items: ["Measles in Kenya", "Population 2 million"] });
    expect(finished[0].events.map((e) => e.kind)).toEqual(["text", "recap", "suggestions"]);
    expect(finished[0].events[0]).toMatchObject({ text: "Sure." });
    expect(finished[0].events[1]).toMatchObject({ kind: "recap", items: ["Measles in Kenya", "Population 2 million"] });

    const plain = setup([{ message: message([textBlock("Plain.")]), text: ["Plain."] }]);
    await plain.run(HELLO);
    expect(plain.emitted.map((e) => e.type)).toEqual(["text", "done"]);
  });
});
