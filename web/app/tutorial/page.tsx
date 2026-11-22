import { redirect } from "next/navigation";
import { SessionProvider } from "@/components/SessionProvider";
import { TutorialWorkspace } from "@/components/tutorial/TutorialWorkspace";
import { TUTORIAL_ENTRIES, type TutorialEntry } from "@/lib/enums";
import { loadParticipant, redirectFor } from "@/lib/participant.server";
import { diseaseOptions } from "@/lib/profile/options";
import { EMPTY_PROFILE } from "@/lib/profile/schema";
import { supabaseProfileStore } from "@/lib/profiles";
import { loadRecording } from "@/lib/tutorial/recording";
import { tutorialStartedBefore } from "@/lib/tutorial/seen";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** The first-use tutorial: a recorded practice conversation on the real workspace. Nothing here reaches the assistant. */
export default async function TutorialPage({ searchParams }: { searchParams: Promise<{ entry?: string | string[] }> }) {
  const participant = await loadParticipant();
  const destination = redirectFor(participant.status);
  if (destination || !participant.user) redirect(destination ?? "/sign-in");

  // A recording the steps cannot play must never strand a participant: the chat is always there.
  const recording = loadRecording();
  if (!recording) redirect("/chat?from=tutorial");

  // Seen from the moment the page opens, recorded here rather than by the browser, so leaving can never lead back in.
  // A replay is someone who has started it before; a declined offer is not a start.
  const admin = adminClient();
  const replay = await tutorialStartedBefore(admin, participant.user.id);
  if ((participant.profile?.tutorialSeenAt ?? null) === null) {
    await supabaseProfileStore(admin).markTutorialSeen(participant.user.id, new Date()).catch((error) => console.error("tutorial seen not recorded", error instanceof Error ? error.message : String(error)));
  }

  const { entry: asked } = await searchParams;
  const entry: TutorialEntry = (TUTORIAL_ENTRIES as readonly string[]).includes(String(asked)) ? (asked as TutorialEntry) : "menu";

  return (
    <SessionProvider>
      <TutorialWorkspace
        recording={recording}
        profile={participant.profile?.fields ?? EMPTY_PROFILE}
        diseases={diseaseOptions()}
        replay={replay}
        entry={entry}
        contactEmail={participant.settings.contactEmail}
      />
    </SessionProvider>
  );
}
