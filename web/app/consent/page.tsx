import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { ConsentForm } from "@/components/ConsentForm";
import { ConsentText } from "@/components/ConsentText";
import { withContact } from "@/lib/consent";
import { loadParticipant } from "@/lib/participant.server";

export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The consent form for a participant who still has to decide; the text they agreed to, read-only, for everyone else (the account menu's Consent form item). */
export default async function ConsentPage() {
  const participant = await loadParticipant();
  if (participant.status === "sign_in" || participant.status === "forbidden") redirect("/sign-in");
  if (participant.status === "profile") redirect("/profile");
  const markdown = withContact(participant.consent.markdown, participant.settings.contactEmail);
  const consentedAt = participant.profile?.consentedAt;
  if (participant.status === "ok") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-6 py-10">
        <Brand />
        <p className="mt-6 text-sm text-ink-soft">
          You agreed to this text on {consentedAt ? DATE.format(new Date(consentedAt)) : "an earlier date"} (version {participant.consent.version}).
        </p>
        <div className="mt-6">
          <ConsentText markdown={markdown} />
        </div>
        <p className="mt-6">
          <Link href="/chat" className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-accent hover:border-accent hover:bg-accent-wash">
            Back to the chat
          </Link>
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-6 py-10">
      <Brand />
      <p className="mt-6 text-sm text-ink-soft">
        Signed in as {participant.user?.email}. Consent text version {participant.consent.version}.
      </p>
      <div className="mt-6">
        <ConsentForm markdown={markdown} />
      </div>
    </main>
  );
}
