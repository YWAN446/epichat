import { notFound, redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { isResearcher } from "@/lib/config";
import { loadParticipant, redirectFor } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const participant = await loadParticipant();
  const destination = redirectFor(participant.status);
  if (destination || !participant.user) redirect(destination ?? "/sign-in");
  if (!isResearcher(participant.settings, participant.user.email)) notFound();

  const { count } = await adminClient().from("profiles").select("user_id", { count: "exact", head: true });

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-10">
      <Brand />
      <h2 className="mt-8 text-2xl font-semibold">Researcher view</h2>
      <p className="mt-2 text-ink-soft">
        Enrolled participants so far: <span className="font-mono">{count ?? 0}</span>. The funnel, replay, and
        export arrive in sub-project 4.
      </p>
    </main>
  );
}
