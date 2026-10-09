/**
 * One turn of the agent: model calls, client tools, server tools, until the
 * model stops. CampusOtter's loop (per-call usage, the tool-round cap, the
 * dropped-turn protocol, the broken-stream retry) extended for the beta
 * messages API: adaptive thinking with stored summaries, web search and fetch
 * as events, pause_turn resumption, and the server-side refusal fallback.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ApiCall } from "@/lib/db/turns";
import type { Effort, ModelId, ThinkingDisplay } from "@/lib/enums";
import type { ToolOutcome } from "@/lib/tools/types";
import type { TurnEvent } from "./events";


export type TurnStop = "end_turn" | "max_tokens" | "refusal" | "tool_limit" | "empty" | "paused";

export type TurnResult = {
  /** Messages to append after the user's. Empty means: drop this turn. */
  appended: Anthropic.Beta.BetaMessageParam[];
  stop: TurnStop;
  refusalCategory: string | null;
  /** When the first text delta arrived, or null when none did. */
  firstTokenAt: Date | null;
};

export type TurnArgs = {
  client: Anthropic;
  model: ModelId;
  effort: Effort;
  thinkingDisplay: ThinkingDisplay;
  refusalFallback: boolean;
  system: Anthropic.Beta.BetaTextBlockParam[];
  tools: Anthropic.Beta.BetaToolUnion[];
  /** History plus the new user message. Not modified. */
  messages: Anthropic.Beta.BetaMessageParam[];
  maxOutputTokens: number;
  maxToolRounds: number;
  maxPauseContinuations: number;
  executeTool: (name: string, input: unknown) => Promise<ToolOutcome>;
  onEvent: (event: TurnEvent) => void;
  /** Filled in as each model call completes, so a turn that later throws is still billed. */
  apiCalls: ApiCall[];
  /** Aborts the model call in flight when the participant disconnects. */
  signal?: AbortSignal;
  now?: () => Date;
};

export const TOOL_LIMIT_RESULT = "Tool limit reached for this turn. Answer with what you already have.";

/** The two server tools, after the six client tools (agent-core spec, section 7). */
export const WEB_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, citations: { enabled: true }, max_content_tokens: 20000 },
];

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_STREAM_RETRIES = 2;

function dropped(stop: TurnStop, firstTokenAt: Date | null, refusalCategory: string | null = null): TurnResult {
  return { appended: [], stop, refusalCategory, firstTokenAt };
}

/** The event a completed content block produces, or null for blocks nobody sees (text, search hits, code execution). */
export function eventOfBlock(block: Anthropic.Beta.BetaContentBlock): TurnEvent | null {
  switch (block.type) {
    case "thinking":
      return block.thinking ? { type: "thinking", summary: block.thinking } : null;
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "server_tool_use":
      return block.name === "web_search" ? { type: "web_search", query: String((block.input as { query?: unknown }).query ?? "") } : null;
    case "web_search_tool_result":
      return Array.isArray(block.content) ? null : { type: "notice", message: `WEB ERROR: ${block.content.error_code}` };
    case "web_fetch_tool_result":
      if (block.content.type === "web_fetch_tool_result_error") return { type: "notice", message: `WEB ERROR: ${block.content.error_code}` };
      // The page title lives on the nested document block; the URL is the fallback.
      return { type: "web_fetch", url: block.content.url, title: block.content.content.title || block.content.url };
    default:
      return null;
  }
}

function apiCallOf(model: string, message: Anthropic.Beta.BetaMessage, latency_ms: number): ApiCall {
  const usage = message.usage;
  const fallback = usage.iterations?.find((it): it is Anthropic.Beta.BetaFallbackMessageIterationUsage => it.type === "fallback_message");
  return {
    model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
    stop_reason: message.stop_reason,
    latency_ms,
    served_by: fallback ? String(fallback.model) : model,
  };
}

export async function runTurn(args: TurnArgs): Promise<TurnResult> {
  const now = args.now ?? (() => new Date());
  const working = [...args.messages];
  const appended: Anthropic.Beta.BetaMessageParam[] = [];
  const push = (message: Anthropic.Beta.BetaMessageParam) => {
    working.push(message);
    appended.push(message);
  };
  let firstTokenAt: Date | null = null;
  // A listener that throws inside the SDK's stream would surface as a stream
  // error and be retried as if the model call had failed. Never let it throw.
  const announce = (event: TurnEvent) => {
    try {
      args.onEvent(event);
    } catch {
      // The receiver is gone; the turn still has to finish and be billed.
    }
  };

  let rounds = 0; // model calls that carried a client tool call
  let continuations = 0; // pause_turn resumptions
  let streamRetries = 0;

  for (;;) {
    const startedAt = now();
    const stream = args.client.beta.messages.stream(
      {
        model: args.model,
        max_tokens: args.maxOutputTokens,
        system: args.system,
        cache_control: { type: "ephemeral" },
        tools: args.tools,
        messages: working,
        thinking: { type: "adaptive", display: args.thinkingDisplay },
        output_config: { effort: args.effort },
        ...(args.refusalFallback ? { fallbacks: "default" as const, betas: [FALLBACK_BETA] } : {}),
      },
      args.signal ? { signal: args.signal } : undefined,
    );
    stream.on("text", (delta) => {
      firstTokenAt ??= now();
      announce({ type: "text", delta });
    });
    stream.on("contentBlock", (block) => {
      const event = eventOfBlock(block);
      if (event) announce(event);
    });

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
    } catch (error) {
      // API errors, including an abort, always propagate. What is left is a
      // broken stream, such as an eager tool input that is not valid JSON;
      // that is worth re-issuing a couple of times.
      if (error instanceof Anthropic.APIError || streamRetries >= MAX_STREAM_RETRIES) throw error;
      streamRetries++;
      continue;
    }
    streamRetries = 0;
    args.apiCalls.push(apiCallOf(args.model, message, Math.max(0, now().getTime() - startedAt.getTime())));

    if (message.stop_reason === "refusal") return dropped("refusal", firstTokenAt, message.stop_details?.category ?? null);
    if (message.content.length === 0) return dropped("empty", firstTokenAt);
    const toolUses = message.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use");
    // A tool call cut off by the length limit can parse as a valid partial input.
    if (message.stop_reason === "max_tokens" && toolUses.length > 0) return dropped("max_tokens", firstTokenAt);

    // The response blocks go back verbatim; the param type is wider in places and narrower in others.
    push({ role: "assistant", content: message.content as unknown as Anthropic.Beta.BetaContentBlockParam[] });
    const paused = message.stop_reason === "pause_turn";
    if (paused && continuations >= args.maxPauseContinuations) return dropped("paused", firstTokenAt);
    if (paused) continuations++;

    if (toolUses.length === 0) {
      if (paused) continue;
      return { appended, stop: message.stop_reason === "max_tokens" ? "max_tokens" : "end_turn", refusalCategory: null, firstTokenAt };
    }

    // Tools run on the first maxToolRounds rounds. One further round tells the
    // model the limit was reached, one more lets it answer, then the turn is dropped.
    // A paused message that also called a tool is answered first, so history
    // never holds a tool_use without its result.
    rounds++;
    const overLimit = rounds > args.maxToolRounds;
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      if (overLimit) {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: TOOL_LIMIT_RESULT });
        continue;
      }
      const outcome = await args.executeTool(use.name, use.input);
      const payload = outcome.payload ?? { kind: "tool_error" as const, message: outcome.content };
      announce({ type: "tool_result", id: use.id, name: use.name, ok: !outcome.isError, payload });
      results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) });
    }
    push({ role: "user", content: results });
    if (rounds >= args.maxToolRounds + 2) return dropped("tool_limit", firstTokenAt);
  }
}
