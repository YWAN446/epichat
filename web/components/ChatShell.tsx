"use client";

import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import type { ConversationSummary } from "@/lib/db/conversations";
import { createClient } from "@/lib/supabase/client";

type Props = {
  email: string;
  conversations: ConversationSummary[];
  contactEmail: string;
};

const QUIET = "rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-soft hover:bg-paper-2 hover:text-ink disabled:opacity-50";

/**
 * The chat page's frame: header, the participant's conversations, and the
 * composer. The assistant arrives in sub-project 3; until then the composer is
 * disabled and says so.
 */
export function ChatShell({ email, conversations, contactEmail }: Props) {
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2.5">
          <Brand />
          <nav aria-label="Chat" className="flex items-center gap-1">
            <span className="hidden truncate text-xs text-ink-faint sm:inline">{email}</span>
            <button type="button" disabled className={QUIET} aria-label="New conversation">
              New
            </button>
            <button type="button" onClick={signOut} className={QUIET}>
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
        <section className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-xl font-semibold">Your account is ready</h2>
          <p className="mt-2 text-ink-soft">
            Sign-in and enrollment work. The simulation assistant is being connected next; this page will
            become the chat. {contactEmail ? `Questions: ${contactEmail}.` : ""}
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold tracking-wide text-ink-faint uppercase">Your conversations</h2>
          {conversations.length === 0 ? (
            <p className="mt-3 text-ink-soft">None yet. A conversation appears here after your first message.</p>
          ) : (
            <ul className="mt-3 border-t border-line">
              {conversations.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 border-b border-line py-3">
                  <span className="truncate font-medium">{item.title}</span>
                  <time dateTime={item.updatedAt} className="shrink-0 font-mono text-xs text-ink-faint">
                    {new Date(item.updatedAt).toLocaleDateString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="sticky bottom-0 border-t border-line bg-paper/95 backdrop-blur-sm">
        <form className="mx-auto flex max-w-3xl items-end gap-2 px-4 py-3" onSubmit={(e) => e.preventDefault()}>
          <textarea
            disabled
            rows={1}
            placeholder="The assistant is not connected yet."
            aria-label="Message"
            className="min-h-11 flex-1 resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 disabled:text-ink-faint"
          />
          <button type="submit" disabled className="rounded-full bg-accent px-5 py-2.5 font-semibold text-white disabled:bg-line disabled:text-ink-faint">
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}
