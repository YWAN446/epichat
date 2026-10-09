import { notFound } from "next/navigation";
import { SharedConversation } from "@/components/SharedConversation";
import { supabaseShareStore } from "@/lib/db/shares";
import { isToken } from "@/lib/share/token";
import { supabaseStepEventSink } from "@/lib/stepEvents";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/** A shared conversation: the frozen snapshot behind its token, for anyone (share spec, section 7). */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isToken(token)) notFound();
  const admin = adminClient();
  const shares = supabaseShareStore(admin);
  const row = await shares.byToken(token);
  if (!row) notFound();
  // Counting the open must never keep the page from rendering.
  try {
    await shares.view(token);
    await supabaseStepEventSink(admin).log(row.user_id, [{ kind: "share_opened", conversationId: row.conversation_id, meta: { share_id: row.id } }]);
  } catch (error) {
    console.error("share view failed", error instanceof Error ? error.message : String(error));
  }
  return <SharedConversation snapshot={row.snapshot} token={token} takenAt={row.taken_at} />;
}
