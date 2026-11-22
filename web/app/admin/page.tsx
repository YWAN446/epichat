import { notFound, redirect } from "next/navigation";
import { SuggestionUseTable } from "@/components/admin/SuggestionUseTable";
import { TutorialTable } from "@/components/admin/TutorialTable";
import { Brand } from "@/components/Brand";
import { loadUseEvents, researcherUserIds, sinceFor, weeklySuggestionUse } from "@/lib/admin/suggestionUse";
import { loadTutorialEvents, summarizeTutorial } from "@/lib/admin/tutorialUse";
import { isResearcher } from "@/lib/config";
import { loadParticipant, redirectFor } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const participant = await loadParticipant();
  const destination = redirectFor(participant.status);
  if (destination || !participant.user) redirect(destination ?? "/sign-in");
  if (!isResearcher(participant.settings, participant.user.email)) notFound();

  const admin = adminClient();
  const now = new Date();
  const [{ count }, events, researchers, tutorialEvents] = await Promise.all([
    admin.from("profiles").select("user_id", { count: "exact", head: true }),
    loadUseEvents(admin, sinceFor(now)),
    researcherUserIds(admin, participant.settings.researcherEmails),
    loadTutorialEvents(admin),
  ]);
  const weeks = weeklySuggestionUse(events, now, researchers);

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-6 py-10">
      <Brand />
      <h2 className="mt-8 text-2xl font-semibold">Researcher view</h2>
      <p className="mt-2 text-ink-soft">
        Enrolled participants so far: <span className="font-mono">{count ?? 0}</span>. Replay and export come later.
      </p>
      <h3 className="mt-8 text-lg font-semibold">Suggested replies, by week</h3>
      <p className="mt-1 mb-3 text-sm text-ink-soft">
        Turns sent, and how many of them came from pressing a button rather than typing. Weeks start on Monday (UTC). Researcher accounts are left out.
      </p>
      <SuggestionUseTable rows={weeks} />
      <h3 className="mt-10 text-lg font-semibold">Tutorial</h3>
      <p className="mt-1 mb-3 text-sm text-ink-soft">Participants on their first run-through. Researcher accounts are left out. A participant reaches a step by completing the one before it.</p>
      <TutorialTable summary={summarizeTutorial(tutorialEvents, researchers)} />
    </main>
  );
}
