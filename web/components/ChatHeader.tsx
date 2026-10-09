"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { createClient } from "@/lib/supabase/client";

const QUIET = "rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-soft hover:bg-paper-2 hover:text-ink";
const ICON = "relative rounded-full px-2.5 py-1.5 text-sm text-ink-soft hover:bg-paper-2 hover:text-ink";

type Props = {
  email: string;
  busy: boolean;
  onNew: () => void;
  onMenu: () => void;
  onDetails: () => void;
  menuOpen: boolean;
  detailsOpen: boolean;
  /** Something new arrived in the panel while it was closed. */
  unseen: boolean;
};

/** The full-width bar: the conversations toggle, the brand, New, the Details toggle, the address, Sign out. The toggles open overlays on narrow screens and collapse columns on wide ones. */
export function ChatHeader({ email, busy, onNew, onMenu, onDetails, menuOpen, detailsOpen, unseen }: Props) {
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <header className="z-30 border-b border-line bg-paper/90 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={onMenu} aria-expanded={menuOpen} aria-label="Conversations" className={ICON}>
          ☰
        </button>
        <Brand />
        <nav aria-label="Chat" className="ml-auto flex items-center gap-1">
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
          <button type="button" onClick={onDetails} aria-expanded={detailsOpen} aria-label="Details" className={ICON}>
            Details
            {unseen && <span aria-hidden="true" className="absolute top-1 right-1 h-2 w-2 rounded-full bg-accent" />}
          </button>
          <button type="button" onClick={signOut} className={QUIET}>
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
}
