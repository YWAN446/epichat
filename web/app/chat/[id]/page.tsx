import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Chat, type DisplayTurn } from "@/components/Chat";
import { SessionProvider } from "@/components/SessionProvider";
import { CUT_OFF_NOTICE } from "@/lib/chat/handleChat";
import { listConversations, supabaseConversationStore } from "@/lib/db/conversations";
import { supabaseTurnStore } from "@/lib/db/turns";
import { loadParticipant, redirectFor } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Resume a conversation: the server renders its finished turns from turn_events, then the client takes over. */
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const participant = await loadParticipant();
  const destination = redirectFor(participant.status);
  if (destination || !participant.user) redirect(destination ?? "/sign-in");

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const admin = adminClient();
  const conversation = await supabaseConversationStore(admin).get(id, participant.user.id);
  if (!conversation) notFound();

  const [conversations, replay] = await Promise.all([listConversations(admin, participant.user.id), supabaseTurnStore(admin).listForReplay(id)]);
  const turns: DisplayTurn[] = replay.map((turn) => ({ id: turn.id, userText: turn.userText, blocks: turn.blocks, notice: turn.stop === "max_tokens" ? CUT_OFF_NOTICE : null }));

  return (
    <SessionProvider>
      <Chat
        email={participant.user.email}
        conversations={conversations}
        initial={{ id, title: conversation.title, turns }}
        maxMessageChars={participant.settings.maxMessageChars}
        contactEmail={participant.settings.contactEmail}
      />
    </SessionProvider>
  );
}
