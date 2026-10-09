import { redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { ProfileSetup } from "@/components/ProfileSetup";
import { loadParticipant } from "@/lib/participant.server";
import { diseaseOptions } from "@/lib/profile/options";
import { EMPTY_PROFILE, prefillRole } from "@/lib/profile/schema";

export const dynamic = "force-dynamic";

/** The questionnaire after consent (profile spec, section 3); a participant with a saved profile may come back to edit it. */
export default async function ProfilePage() {
  const participant = await loadParticipant();
  if (participant.status === "sign_in" || participant.status === "forbidden") redirect("/sign-in");
  if (participant.status === "consent") redirect("/consent");
  const fields = participant.profile?.fields ?? EMPTY_PROFILE;
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-6 py-10">
      <Brand />
      <p className="mt-6 text-sm text-ink-soft">Signed in as {participant.user?.email}.</p>
      <div className="mt-6">
        <ProfileSetup
          initial={fields}
          prefillRole={fields.role ?? prefillRole(participant.profile?.participantType ?? null)}
          diseases={diseaseOptions()}
          completed={participant.status === "ok"}
        />
      </div>
    </main>
  );
}
