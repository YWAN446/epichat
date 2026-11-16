import { describe, expect, it } from "vitest";

import { encodeEvent } from "@/lib/chat/sse";
import { readEvents } from "@/lib/client/sse";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(chunks: Uint8Array[]): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of readEvents(streamOf(chunks))) events.push(event);
  return events;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const FIRST = { type: "text", delta: "R₀ — 日本語" };
const SECOND = { type: "tool_use", id: "tu_1", name: "configure_simulation", input: { disease: "measles" } };

describe("the event stream", () => {
  it("encodes one data line per event and reads events that arrive whole", async () => {
    expect(new TextDecoder().decode(encodeEvent(SECOND))).toBe(`data: ${JSON.stringify(SECOND)}\n\n`);
    expect(await collect([encodeEvent(FIRST), encodeEvent(SECOND)])).toEqual([FIRST, SECOND]);
  });

  it("reads several events from one chunk", async () => {
    expect(await collect([join([encodeEvent(FIRST), encodeEvent(SECOND)])])).toEqual([FIRST, SECOND]);
  });

  it("reassembles events split at every possible byte, including inside a character", async () => {
    const bytes = join([encodeEvent(FIRST), encodeEvent(SECOND)]);
    for (let cut = 1; cut < bytes.length; cut++) {
      expect(await collect([bytes.slice(0, cut), bytes.slice(cut)])).toEqual([FIRST, SECOND]);
    }
  });

  it("ignores an unfinished event at the end and lines that are not data", async () => {
    const partial = encodeEvent(SECOND).slice(0, 10);
    expect(await collect([encodeEvent(FIRST), partial])).toEqual([FIRST]);
    expect(await collect([new TextEncoder().encode(": keep-alive\n\n"), encodeEvent(FIRST)])).toEqual([FIRST]);
  });
});
