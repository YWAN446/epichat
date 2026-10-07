import { z } from "zod";
import { isAllowedEmail, normalizeEmail } from "@/lib/auth";
import { loadConsent } from "@/lib/consent";
import { loadSettings } from "@/lib/config";
import { PARTICIPANT_TYPES } from "@/lib/enums";
import { supabaseProfileStore } from "@/lib/profiles";
import { supabaseStepEventSink } from "@/lib/stepEvents";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const Decision = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("agree"), participantType: z.enum(PARTICIPANT_TYPES) }),
  z.strictObject({ decision: z.literal("decline") }),
]);

/** Enroll the signed-in user, or record that they declined and sign them out. */
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

  let parsed: z.infer<typeof Decision>;
  try {
    const result = Decision.safeParse(JSON.parse(await request.text()));
    if (!result.success) return new Response(null, { status: 400 });
    parsed = result.data;
  } catch {
    return new Response(null, { status: 400 });
  }

  const admin = adminClient();
  const { version } = await loadConsent();
  const events = supabaseStepEventSink(admin);
  const now = new Date();

  if (parsed.decision === "agree") {
    await supabaseProfileStore(admin).recordConsent(user.id, normalizeEmail(user.email ?? ""), parsed.participantType, version, now);
    await events.log(user.id, [{ kind: "consent_given", meta: { participant_type: parsed.participantType, version } }]);
    return new Response(null, { status: 204 });
  }

  await events.log(user.id, [{ kind: "consent_declined", meta: { version } }]);
  await supabase.auth.signOut();
  return new Response(null, { status: 204 });
}
