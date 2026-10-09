import { isAllowedEmail } from "@/lib/auth";
import { readClientEvent } from "@/lib/clientEvents";
import { loadConsent } from "@/lib/consent";
import { loadSettings } from "@/lib/config";
import { participantStatus } from "@/lib/participant";
import { supabaseProfileStore } from "@/lib/profiles";
import { supabaseSessionStore } from "@/lib/sessions";
import { supabaseStepEventSink, type StepEvent } from "@/lib/stepEvents";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Record something a participant did in the browser. Only the fixed shapes in
 * lib/clientEvents.ts are accepted. The body is read as text so that a
 * sendBeacon payload (text/plain) parses like a fetch payload.
 */
export async function POST(request: Request): Promise<Response> {
  const settings = loadSettings();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  if (!user.email_confirmed_at || !isAllowedEmail(user.email, settings.allowedEmailDomains)) {
    return new Response(null, { status: 403 });
  }

  const admin = adminClient();
  const profile = await supabaseProfileStore(admin).get(user.id).catch(() => null);
  const { version } = await loadConsent();
  const status = participantStatus(user, profile ? { consent_version: profile.consentVersion, consented_at: profile.consentedAt, profile_completed_at: profile.fields.completedAt } : null, settings, version);
  if (status !== "ok") return new Response(null, { status: 403 });

  const action = readClientEvent(await request.text());
  if (!action) return new Response(null, { status: 400 });

  const sessions = supabaseSessionStore(admin);
  const events = supabaseStepEventSink(admin);

  try {
    if (action.kind === "session_start") {
      const sessionId = await sessions.start(user.id, {
        userAgent: request.headers.get("user-agent"),
        viewport: action.viewport ?? null,
        language: action.language ?? null,
        timezone: action.timezone ?? null,
      });
      await events.log(user.id, [{ kind: "session_start", sessionId }]);
      return Response.json({ sessionId });
    }
    if (action.kind === "session_ping") {
      await sessions.ping(action.sessionId, user.id);
      return new Response(null, { status: 204 });
    }
    if (action.kind === "session_end") {
      await sessions.end(action.sessionId, user.id);
      await events.log(user.id, [{ kind: "session_end", sessionId: action.sessionId }]);
      return new Response(null, { status: 204 });
    }

    const { kind, sessionId, conversationId, ...rest } = action;
    const event: StepEvent = { kind, sessionId: sessionId ?? null, conversationId, meta: {} };
    if ("turnId" in rest && rest.turnId) event.turnId = rest.turnId;
    if ("stage" in rest) event.stage = rest.stage;
    for (const key of ["card", "view", "format", "rating", "runId", "source", "section"] as const) {
      if (key in rest) event.meta![key] = (rest as Record<string, string>)[key];
    }
    await events.log(user.id, [event]);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("event route failed", error);
    return new Response(null, { status: 500 });
  }
}
