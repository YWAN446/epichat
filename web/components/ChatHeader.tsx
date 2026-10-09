"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { createClient } from "@/lib/supabase/client";

const QUIET = "rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-soft hover:bg-paper-2 hover:text-ink";

/** The bar at the top of the chat: the brand, the address, New, Sign out. New waits while a reply is arriving. */
export function ChatHeader({ email, busy, onNew }: { email: string; busy: boolean; onNew: () => void }) {
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2.5">
        <Brand />
        <nav aria-label="Chat" className="flex items-center gap-1">
          <span className="hidden truncate text-xs text-ink-faint sm:inline">{email}</span>
          {busy ? (
            <span className={`${QUIET} opacity-50`} aria-disabled="true">
              New
            </span>
          ) : (
            <Link href="/chat" onClick={onNew} className={QUIET} aria-label="New conversation">
              New
            </Link>
          )}
          <button type="button" onClick={signOut} className={QUIET}>
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
}
