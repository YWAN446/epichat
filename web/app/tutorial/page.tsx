import { redirect } from "next/navigation";
import { SessionProvider } from "@/components/SessionProvider";
import { TutorialWorkspace } from "@/components/tutorial/TutorialWorkspace";
import { TUTORIAL_ENTRIES, type TutorialEntry } from "@/lib/enums";
import { loadParticipant, redirectFor } from "@/lib/participant.server";
import { diseaseOptions } from "@/lib/profile/options";
import { EMPTY_PROFILE } from "@/lib/profile/schema";
import { loadRecording } from "@/lib/tutorial/recording";

export const dynamic = "force-dynamic";

/** The first-use tutorial: a recorded practice conversation on the real workspace. Nothing here reaches the assistant. */
export default async function TutorialPage({ searchParams }: { searchParams: Promise<{ entry?: string | string[] }> }) {
  const participant = await loadParticipant();
  const destination = redirectFor(participant.status);
  if (destination || !participant.user) redirect(destination ?? "/sign-in");

  // A recording the steps cannot play must never strand a participant: the chat is always there.
  const recording = loadRecording();
  if (!recording) redirect("/chat");

  const { entry: asked } = await searchParams;
  const entry: TutorialEntry = (TUTORIAL_ENTRIES as readonly string[]).includes(String(asked)) ? (asked as TutorialEntry) : "menu";

  return (
    <SessionProvider>
      <TutorialWorkspace
        recording={recording}
        profile={participant.profile?.fields ?? EMPTY_PROFILE}
        diseases={diseaseOptions()}
        replay={(participant.profile?.tutorialSeenAt ?? null) !== null}
        entry={entry}
        contactEmail={participant.settings.contactEmail}
      />
    </SessionProvider>
  );
}
