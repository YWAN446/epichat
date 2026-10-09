import { redirect } from "next/navigation";
import { ChatShell } from "@/components/ChatShell";
import { SessionProvider } from "@/components/SessionProvider";
import { listConversations } from "@/lib/db/conversations";
import { loadParticipant, redirectFor } from "@/lib/participant.server";
import { supabaseProfileStore } from "@/lib/profiles";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const participant = await loadParticipant();
  const destination = redirectFor(participant.status);
  if (destination || !participant.user) redirect(destination ?? "/sign-in");

  const admin = adminClient();
  // Seen today. A failure here must not keep the page from opening.
  void supabaseProfileStore(admin).touch(participant.user.id, new Date()).catch(() => {});
  const conversations = await listConversations(admin, participant.user.id);

  return (
    <SessionProvider>
      <ChatShell email={participant.user.email} conversations={conversations} contactEmail={participant.settings.contactEmail} />
    </SessionProvider>
  );
}
