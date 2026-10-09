import Anthropic from "@anthropic-ai/sdk";
import { handleChat, type ChatDeps } from "@/lib/chat/handleChat";
import { encodeEvent } from "@/lib/chat/sse";
import { fetchUnWpp } from "@/lib/data/unWpp";
import { fetchWbData360 } from "@/lib/data/wbData360";
import { fetchWhoGho } from "@/lib/data/whoGho";
import { supabaseConversationStore } from "@/lib/db/conversations";
import { supabaseMessageStore } from "@/lib/db/messages";
import { supabaseRunStore } from "@/lib/db/runs";
import { supabaseScenarioStore } from "@/lib/db/scenarios";
import { supabaseTurnStore } from "@/lib/db/turns";
import { requireParticipant } from "@/lib/participant.server";
import { createSimClient } from "@/lib/sim/client";
import { adminClient } from "@/lib/supabase/admin";
import { supabaseUsageStore } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 300;

let anthropic: Anthropic | null = null;

/** One turn of the agent, streamed as server-sent events (agent-core spec, section 3.1). */
export async function POST(request: Request): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const { user, settings } = gate;

  const rawBody = await request.text();
  anthropic ??= new Anthropic();
  const admin = adminClient();
  const deps: ChatDeps = {
    settings,
    client: anthropic,
    usage: supabaseUsageStore(admin),
    conversations: supabaseConversationStore(admin),
    messages: supabaseMessageStore(admin),
    scenarios: supabaseScenarioStore(admin),
    turns: supabaseTurnStore(admin),
    runs: supabaseRunStore(admin),
    sim: createSimClient({ baseUrl: settings.simInternalUrl, secret: settings.simSharedSecret }),
    adapters: {
      unWpp: (query) => fetchUnWpp(query, { apiKey: settings.unApiKey }),
      whoGho: (query) => fetchWhoGho(query),
      wbData360: (query) => fetchWbData360(query),
    },
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  };

  // When the participant closes the page, stop writing and stop the model call.
  const disconnected = new AbortController();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await handleChat(
          deps,
          { id: user.id },
          rawBody,
          (event) => {
            if (open) controller.enqueue(encodeEvent(event));
          },
          disconnected.signal,
        );
      } catch (error) {
        // handleChat never throws by contract; if it ever does, the reader sees the failure instead of a hung stream.
        if (open) controller.error(error);
        open = false;
      } finally {
        if (open) controller.close();
      }
    },
    cancel() {
      open = false;
      disconnected.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
