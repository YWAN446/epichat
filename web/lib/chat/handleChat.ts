/**
 * One chat request end to end (agent-core spec, section 9): parse, reserve a
 * turn against the caps, open or load the conversation, run the turn through
 * the event sink, post-process (suggestions, final stage, usage totals),
 * write everything with finish_turn, answer done or discard, and record usage
 * in `finally`. Never throws, even if `emit` does.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Settings } from "@/lib/config";
import type { Adapters } from "@/lib/data/types";
import { titleFrom, type ConversationStore } from "@/lib/db/conversations";
import type { MessageStore } from "@/lib/db/messages";
import type { RunStore } from "@/lib/db/runs";
import { MEMORY_CAP, type MemoryStore } from "@/lib/db/memories";
import type { ReportStore } from "@/lib/db/reports";
import { scenarioToJson, type ScenarioStore } from "@/lib/db/scenarios";
import type { ApiCall, FinishTurnPayload, StepEventJson, StoredStop, TurnStore } from "@/lib/db/turns";
import type { StepEventKind } from "@/lib/enums";
import { costUsd, repairCostUsd } from "@/lib/models";
import { aboutBlock, withoutKindSuffix, type Memory } from "@/lib/profile/about";
import type { ProfileFields } from "@/lib/profile/schema";
import type { ProfileStore } from "@/lib/profiles";
import type { SimClient } from "@/lib/sim/client";
import { easternDay, easternMonthStart } from "@/lib/time";
import { TOOLS, executeTool } from "@/lib/tools";
import { emptyScenario, type Scenario, type ToolDeps } from "@/lib/tools/types";
import { capMessage, type TurnReservation, type UsageStore } from "@/lib/usage";
import { blockOf, createEventSink, type ChatStreamEvent, type TurnEvent } from "./events";
import { parseNext, parseRecap } from "./next";
import { firstUserMessage, systemBlocks } from "./prompt";
import { parseChatRequest } from "./request";
import { WEB_TOOLS, runTurn, type TurnStop } from "./runTurn";
import { advanceStage } from "./stages";

export type ChatDeps = {
  settings: Settings;
  client: Anthropic;
  usage: UsageStore;
  conversations: ConversationStore;
  messages: MessageStore;
  scenarios: ScenarioStore;
  turns: TurnStore;
  runs: RunStore;
  reports: ReportStore;
  profiles: ProfileStore;
  memories: MemoryStore;
  sim: SimClient;
  adapters: Adapters;
  now: () => Date;
  newId: () => string;
};

// The Python agent's texts for a technical failure, a refusal, and an
// exhausted pause; CampusOtter's for the rest.
export const UNAVAILABLE = "Something went wrong while processing that (a technical error, not a problem with your request). Please try again — the conversation is intact.";
export const CONVERSATION_INVALID = "This conversation can no longer be continued. Please start a new one.";
export const CONVERSATION_NOT_FOUND = "That conversation is no longer available. Please start a new one.";
export const CUT_OFF_NOTICE = "This reply reached the length limit and was cut off. Ask me to continue.";
export const DISCARD_MESSAGES: Record<Exclude<TurnStop, "end_turn">, string> = {
  refusal: "I'm unable to help with that request. Let's get back to epidemic simulations — what would you like to model?",
  paused: "That search ran longer than I can continue in one turn. Ask me again and I'll pick it up.",
  tool_limit: "That needed more steps than one message allows. Try a narrower question.",
  max_tokens: "That reply ran past the length limit before it finished. Try asking for less at once.",
  empty: "No reply came back. Please try again.",
};

type Message = Anthropic.Beta.BetaMessageParam;

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleChat(
  deps: ChatDeps,
  user: { id: string },
  rawBody: string,
  emit: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const send = (event: ChatStreamEvent) => {
    try {
      emit(event);
    } catch {
      // Nobody is listening any more. Finish the bookkeeping regardless.
    }
  };

  const parsed = parseChatRequest(rawBody, deps.settings);
  if (!parsed.ok) {
    send({ type: "error", code: parsed.problem.code, message: parsed.problem.message });
    return;
  }
  const request = parsed.request;

  const startedAt = deps.now();
  const day = easternDay(startedAt);
  let reservation: TurnReservation;
  try {
    reservation = await deps.usage.reserveTurn(user.id, day, easternMonthStart(startedAt), {
      dailyTurns: deps.settings.dailyTurnsPerUser,
      monthlyBudgetUsd: deps.settings.monthlyBudgetUsd,
    });
  } catch {
    send({ type: "error", code: "service_unavailable", message: UNAVAILABLE });
    return;
  }
  if (reservation !== "ok") {
    send({ type: "error", code: reservation, message: capMessage(reservation, deps.settings) });
    return;
  }

  // The conversation and its state. A failure here is a service failure:
  // nothing has run, so nothing is written.
  const scenario: Scenario = emptyScenario();
  const stepEvents: StepEventJson[] = [];
  const step = (kind: StepEventKind, extra: Partial<StepEventJson> = {}) =>
    stepEvents.push({ kind, session_id: request.sessionId, stage: scenario.stage, tool: null, meta: {}, ...extra });
  let conversationId: string;
  let title: string | null = null;
  let conversationTitle = "";
  let history: Message[] = [];
  let earlierTexts: string[] = [];
  try {
    if (request.conversationId) {
      const found = await deps.conversations.get(request.conversationId, user.id);
      if (!found) {
        send({ type: "error", code: "conversation_not_found", message: CONVERSATION_NOT_FOUND });
        return;
      }
      conversationId = found.id;
      conversationTitle = found.title;
      const saved = found.activeScenarioId ? await deps.scenarios.get(found.activeScenarioId) : null;
      if (saved) Object.assign(scenario, saved);
      [history, earlierTexts] = await Promise.all([deps.messages.list(conversationId), deps.turns.userTexts(conversationId)]);
    } else {
      title = titleFrom(request.text);
      conversationId = await deps.conversations.create(user.id, title);
      conversationTitle = title;
      step("conversation_started");
    }
  } catch (error) {
    // These log lines carry no request content.
    console.error("chat could not load the conversation", failureText(error));
    send({ type: "error", code: "service_unavailable", message: UNAVAILABLE });
    return;
  }

  // The profile shapes the turn (profile spec, sections 8 and 9): the About block on a
  // conversation's first message, and whether remember is offered. A failed read must not
  // fail the turn: no block, and memory off for this turn.
  let fields: ProfileFields | null = null;
  try {
    fields = (await deps.profiles.get(user.id))?.fields ?? null;
  } catch (error) {
    console.error("profile read failed", failureText(error));
  }
  const memoryOn = fields?.memoryEnabled === true;
  let memories: Memory[] = [];
  if (history.length === 0 && memoryOn) {
    try {
      memories = await deps.memories.list(user.id);
    } catch (error) {
      console.error("memories read failed", failureText(error));
    }
  }
  const about = fields && history.length === 0 ? aboutBlock(fields, memories) : null;

  const turnId = deps.newId();
  const stageBefore = scenario.stage;
  const contextText = [...earlierTexts, request.text].join(" ").trim();
  const userMessage: Message = { role: "user", content: history.length === 0 ? firstUserMessage(day, request.text, about) : request.text };
  const sink = createEventSink(send, deps.now);
  const apiCalls: ApiCall[] = [];
  let repairCost = 0;

  /** Re-derive the stage; stream it when it changed, count it when it is newly reached. */
  const advance = (running = false) => {
    const { stage, changed, reached } = advanceStage(scenario, running);
    if (changed) sink.block({ kind: "stage", stage });
    if (reached) step("stage_reached", { stage: reached });
  };

  const toolDeps: ToolDeps = {
    scenario,
    sim: deps.sim,
    adapters: deps.adapters,
    contextText,
    turnId,
    async onRun(record) {
      // A run is a fact: counted and inserted as soon as it finishes, whatever the turn does later.
      for (const repair of record.result.repairs) if (repair.usage) repairCost += repairCostUsd(repair.usage);
      if (record.result.ok) {
        step("run_completed", { tool: "run_simulation", meta: { duration_ms: record.result.duration_ms, cold_start: record.result.cold_start, n_agents: record.params.n_agents, sim_dur_years: record.params.sim_dur_years, repairs: record.result.repairs.length } });
      } else {
        step("run_failed", { tool: "run_simulation", meta: { kind: record.result.kind, repairs: record.result.repairs.length } });
      }
      try {
        return await deps.runs.insert({ conversationId, userId: user.id, turnId, scenarioId: scenario.id, record });
      } catch (error) {
        console.error("runs insert failed", failureText(error));
        return null;
      }
    },
    onScenarioStart() {
      step("new_scenario");
    },
    reports: {
      runs: () => deps.runs.listForReport(conversationId, scenario.id, turnId),
      recap: () => deps.turns.lastRecap(conversationId),
      nextVersion: async () => (await deps.reports.count(conversationId)) + 1,
      async insert(report) {
        try {
          return await deps.reports.insert({ conversationId, userId: user.id, turnId, scenarioId: scenario.id, ...report });
        } catch (error) {
          console.error("reports insert failed", failureText(error));
          return null;
        }
      },
      conversationTitle,
    },
    memory: {
      enabled: memoryOn,
      added: 0,
      list: () => deps.memories.list(user.id),
      async add(kind, text, replaces) {
        const now = deps.now();
        if (replaces !== undefined) {
          // The model names the earlier memory by its text, with or without the "(kind)" the About block appends.
          const wanted = withoutKindSuffix(replaces).toLowerCase();
          const earlier = (await deps.memories.list(user.id)).find((memory) => memory.text.trim().toLowerCase() === wanted);
          if (!earlier) return "not_found";
          // Insert first: a failed insert must never cost the participant the memory it replaces.
          const id = await deps.memories.add(user.id, kind, text, "agent", conversationId);
          await deps.memories.deactivate(user.id, earlier.id, now);
          return { id };
        }
        if ((await deps.memories.countActive(user.id)) >= MEMORY_CAP && !(await deps.memories.evictOldestAgent(user.id, now))) {
          // Every active memory is the participant's own: nothing gives way. (An evicted one is the
          // assistant's own oldest, which the spec lets go; losing it to a failed insert costs nothing the cap would not.)
          return "full";
        }
        return { id: await deps.memories.add(user.id, kind, text, "agent", conversationId) };
      },
    },
  };

  const runTool = async (name: string, input: unknown) => {
    const outcome = await executeTool(name, input, toolDeps, () => deps.now().getTime());
    step(outcome.isError ? "tool_failed" : "tool_called", { tool: name, meta: { duration_ms: outcome.payload?.duration_ms ?? 0 } });
    if (outcome.payload?.kind === "memory") {
      step("memory_added", { tool: name, meta: { memory_id: outcome.payload.memory_id, kind: outcome.payload.memory_kind, replaced: outcome.payload.replaced } });
    }
    return outcome;
  };

  const onEvent = (event: TurnEvent) => {
    if (event.type === "text") {
      sink.text(event.delta);
      return;
    }
    sink.block(blockOf(event));
    switch (event.type) {
      case "tool_use":
        // The stage is "run" while the simulation runs; a call that cannot run (no params) never gets there.
        if (event.name === "run_simulation" && scenario.params) advance(true);
        break;
      case "tool_result":
        advance();
        break;
      case "web_search":
        step("web_search");
        break;
      case "web_fetch":
        step("web_fetch");
        if (!scenario.webSources.some((source) => source.url === event.url)) scenario.webSources.push({ title: event.title, url: event.url });
        break;
    }
  };

  let stop: StoredStop = "error";
  let refusalCategory: string | null = null;
  let firstTokenAt: Date | null = null;
  let messages: Message[] | null = null;
  // The last event, sent only once the turn is stored. Null when the participant is gone.
  let outcome: ChatStreamEvent | null = null;
  try {
    const result = await runTurn({
      client: deps.client,
      model: deps.settings.model,
      effort: deps.settings.effort,
      thinkingDisplay: deps.settings.thinkingDisplay,
      refusalFallback: deps.settings.refusalFallback,
      system: systemBlocks(),
      tools: [...(memoryOn ? TOOLS : TOOLS.filter((tool) => tool.name !== "remember")), ...WEB_TOOLS],
      messages: [...history, userMessage],
      maxOutputTokens: deps.settings.maxOutputTokens,
      maxToolRounds: deps.settings.maxToolRounds,
      maxPauseContinuations: deps.settings.maxPauseContinuations,
      executeTool: runTool,
      onEvent,
      apiCalls,
      signal,
      now: deps.now,
    });
    stop = result.stop;
    refusalCategory = result.refusalCategory;
    firstTokenAt = result.firstTokenAt;
    if (result.stop === "refusal") step("refusal", { meta: { category: result.refusalCategory ?? "unknown" } });
    if (result.appended.length > 0) {
      messages = [userMessage, ...result.appended];
      // Read the final text once: storing a block clears the sink's buffer.
      const finalText = sink.lastText();
      const recap = parseRecap(finalText);
      if (recap && recap.length > 0) sink.block({ kind: "recap", items: recap });
      const items = parseNext(finalText);
      if (items && items.length > 0) sink.block({ kind: "suggestions", items });
      outcome = { type: "done", turnId, conversationId, notice: result.stop === "max_tokens" ? CUT_OFF_NOTICE : null };
    } else {
      outcome = { type: "discard", message: DISCARD_MESSAGES[result.stop === "end_turn" ? "empty" : result.stop] };
    }
  } catch (error) {
    if (signal?.aborted) {
      stop = "aborted";
    } else if (error instanceof Anthropic.BadRequestError) {
      outcome = { type: "error", code: "conversation_invalid", message: CONVERSATION_INVALID };
    } else {
      console.error("chat turn failed", failureText(error));
      outcome = { type: "error", code: "service_unavailable", message: UNAVAILABLE };
    }
  }

  advance();
  const events = sink.finish();
  const tokens = apiCalls.reduce(
    (sum, call) => ({ input: sum.input + call.input_tokens, output: sum.output + call.output_tokens, cacheRead: sum.cacheRead + call.cache_read_tokens, cacheWrite: sum.cacheWrite + call.cache_write_tokens }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
  // Priced at the configured model; a rerouted call is recorded by served_by for the researcher.
  const modelCost = apiCalls.reduce(
    (sum, call) => sum + costUsd(deps.settings.model, { input_tokens: call.input_tokens, output_tokens: call.output_tokens, cache_read_input_tokens: call.cache_read_tokens, cache_creation_input_tokens: call.cache_write_tokens }),
    0,
  );
  const cost = modelCost + repairCost;
  step("turn", { meta: { stop, api_calls: apiCalls.length, tool_calls: events.filter((event) => event.kind === "tool_use").length } });

  const payload: FinishTurnPayload = {
    user_id: user.id,
    conversation_id: conversationId,
    title,
    turn: {
      id: turnId,
      session_id: request.sessionId,
      user_text: request.text,
      started_at: startedAt.toISOString(),
      first_token_at: firstTokenAt?.toISOString() ?? null,
      finished_at: deps.now().toISOString(),
      stop,
      refusal_category: refusalCategory,
      model: deps.settings.model,
      effort: deps.settings.effort,
      api_calls: apiCalls,
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cache_read_tokens: tokens.cacheRead,
      cache_write_tokens: tokens.cacheWrite,
      cost_usd: cost,
      stage_before: stageBefore,
      stage_after: scenario.stage,
    },
    events,
    messages,
    scenario: scenarioToJson(scenario),
    step_events: stepEvents,
  };

  try {
    await deps.turns.finishTurn(payload);
    if (outcome) send(outcome);
  } catch (error) {
    console.error("finish_turn failed", failureText(error));
    send({ type: "error", code: "service_unavailable", message: UNAVAILABLE });
  } finally {
    // The turn was counted when it was reserved. Add what the model calls and any repair cost.
    await deps.usage
      .record(user.id, day, { turns: 0, inputTokens: tokens.input + tokens.cacheRead + tokens.cacheWrite, outputTokens: tokens.output, costUsd: cost })
      .catch(() => console.error("usage record failed"));
  }
}
