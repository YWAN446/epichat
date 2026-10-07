import { Brand } from "@/components/Brand";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { SignInForm } from "@/components/SignInForm";
import { loadSettings } from "@/lib/config";

type Props = { searchParams: Promise<{ declined?: string; forbidden?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const settings = loadSettings();
  const { declined, forbidden } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Brand size="large" />
      <p className="mt-5 text-lg text-ink-soft">
        Ask an epidemiological question in plain language and get a validated Starsim simulation,
        grounded in real data. A research prototype from Emory University.
      </p>

      {forbidden && <ForbiddenNotice contactEmail={settings.contactEmail} />}

      {declined && (
        <p className="mt-6 rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2.5 text-sm text-warn-ink">
          You declined to take part in the study, so you were signed out. EpiChat is only available to
          study participants. Questions:{" "}
          {settings.contactEmail ? (
            <a className="underline underline-offset-2" href={`mailto:${settings.contactEmail}`}>
              {settings.contactEmail}
            </a>
          ) : (
            "the research team"
          )}
          .
        </p>
      )}

      <div className="mt-9">
        <SignInForm domains={settings.allowedEmailDomains} />
      </div>

      <section className="mt-12 border-t border-line pt-5 text-sm text-ink-soft">
        <h2 className="font-semibold text-ink">About this study</h2>
        <p className="mt-1.5 leading-relaxed">
          EpiChat is part of a usability study. After you sign in for the first time you will read what the
          study collects, which includes your conversations and how you use the app, and decide whether to
          take part. Using EpiChat requires taking part.
        </p>
        {settings.contactEmail && (
          <p className="mt-3 leading-relaxed">
            Questions:{" "}
            <a className="text-accent underline underline-offset-2" href={`mailto:${settings.contactEmail}`}>
              {settings.contactEmail}
            </a>
          </p>
        )}
      </section>
    </main>
  );
}
