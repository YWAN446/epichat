import type Anthropic from "@anthropic-ai/sdk";

export const USAGE = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, iterations: null };

export function textBlock(text: string) {
  return { type: "text", text, citations: null };
}
export function toolUse(id: string, name: string, input: unknown) {
  return { type: "tool_use", id, name, input };
}
export function thinkingBlock(thinking = "Plan the model") {
  return { type: "thinking", thinking, signature: "sig-abc" };
}
export function serverSearch(id: string, query: string) {
  return { type: "server_tool_use", id, name: "web_search", input: { query } };
}
export function searchResult(id: string, hits: number) {
  const content = Array.from({ length: hits }, (_, i) => ({ type: "web_search_result", url: `https://example.org/${i}`, title: `Hit ${i}`, encrypted_content: "x", page_age: null }));
  return { type: "web_search_tool_result", tool_use_id: id, content };
}
export function searchError(id: string, error_code: string) {
  return { type: "web_search_tool_result", tool_use_id: id, content: { type: "web_search_tool_result_error", error_code } };
}
export function fetchResult(id: string, url: string, title: string | null) {
  const document = { type: "document", title, citations: null, source: { type: "text", media_type: "text/plain", data: "page text" } };
  return { type: "web_fetch_tool_result", tool_use_id: id, content: { type: "web_fetch_result", url, retrieved_at: null, content: document } };
}
export function fetchError(id: string, error_code: string) {
  return { type: "web_fetch_tool_result", tool_use_id: id, content: { type: "web_fetch_tool_result_error", error_code } };
}

export function message(content: unknown[], stopReason = "end_turn", extra: Record<string, unknown> = {}): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stopReason, stop_sequence: null,
    stop_details: null, container: null, usage: USAGE, ...extra,
  } as unknown as Anthropic.Beta.BetaMessage;
}

export type Step = { message?: Anthropic.Beta.BetaMessage; text?: string[]; error?: Error };

/**
 * A stand-in for the Anthropic client. Each call to beta.messages.stream()
 * plays the next step: its text deltas, then every content block of its
 * message as a completed block (what the SDK's "contentBlock" event
 * delivers), then the final message. The last step repeats if the script
 * runs out. `requestOptions` holds the second argument of each call.
 */
export function fakeClient(script: Step[]) {
  const requests: Record<string, unknown>[] = [];
  const requestOptions: unknown[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>, options?: unknown) {
          const step = script[Math.min(requests.length, script.length - 1)];
          requests.push(structuredClone(params));
          requestOptions.push(options);
          const listeners: Record<string, ((arg: unknown) => void)[]> = {};
          return {
            on(event: string, listener: (arg: unknown) => void) {
              (listeners[event] ??= []).push(listener);
              return this;
            },
            async finalMessage() {
              if (step.error) throw step.error;
              for (const delta of step.text ?? []) for (const listener of listeners.text ?? []) listener(delta);
              for (const block of (step.message?.content ?? []) as unknown[]) for (const listener of listeners.contentBlock ?? []) listener(block);
              return step.message;
            },
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, requests, requestOptions };
}
