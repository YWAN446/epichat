import { redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { ConsentForm } from "@/components/ConsentForm";
import { withContact } from "@/lib/consent";
import { loadParticipant } from "@/lib/participant.server";

export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const participant = await loadParticipant();
  if (participant.status === "sign_in" || participant.status === "forbidden") redirect("/sign-in");
  if (participant.status === "profile") redirect("/profile");
  if (participant.status === "ok") redirect("/chat");
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-6 py-10">
      <Brand />
      <p className="mt-6 text-sm text-ink-soft">
        Signed in as {participant.user?.email}. Consent text version {participant.consent.version}.
      </p>
      <div className="mt-6">
        <ConsentForm markdown={withContact(participant.consent.markdown, participant.settings.contactEmail)} />
      </div>
    </main>
  );
}
