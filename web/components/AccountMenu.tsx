"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { initialOf } from "@/lib/client/account";
import { createClient } from "@/lib/supabase/client";

type Props = {
  email: string;
  /** The study's contact address; without one there is no Contact support item. */
  contactEmail: string;
  /** The project website, opened in a new tab. */
  websiteUrl: string;
  /** Profile: the owner opens the Dashboard's Profile tab. */
  onProfile: () => void;
};

const ITEM = "block w-full rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-paper-2 focus-visible:bg-paper-2 focus-visible:outline-none";

/**
 * The bottom of the left column: the participant behind an avatar, and a menu
 * of the places the chat itself does not show. Escape or a press outside
 * closes it; the arrow keys, Home, and End move between its items.
 */
export function AccountMenu({ email, contactEmail, websiteUrl, onProfile }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        // The innermost popup only: the shell's Escape listener on window would also close the drawer around the menu.
        event.stopPropagation();
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function items(): HTMLElement[] {
    return Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const all = items();
    if (all.length === 0) return;
    const index = all.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (index + 1) % all.length;
    else if (event.key === "ArrowUp") next = (index - 1 + all.length) % all.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = all.length - 1;
    if (next === null) return;
    event.preventDefault();
    all[next].focus();
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  /** A link was followed: the page changes, so focus is left alone. */
  const close = () => setOpen(false);
  /** A button item: the menu closes, focus returns to the toggle, then the action runs. */
  const choose = (action: () => void) => () => {
    setOpen(false);
    toggle.current?.focus();
    action();
  };

  return (
    <div ref={root} className="relative border-t border-line p-2">
      {open && (
        <div ref={list} role="menu" aria-label="Account" onKeyDown={onKeyDown} className="absolute right-2 bottom-full left-2 mb-1 rounded-xl border border-line bg-surface p-1 shadow-lg">
          <button type="button" role="menuitem" onClick={choose(onProfile)} className={ITEM}>Profile</button>
          {contactEmail && (
            <a role="menuitem" href={`mailto:${contactEmail}`} onClick={close} className={ITEM}>Contact support</a>
          )}
          <Link role="menuitem" href="/consent" onClick={close} className={ITEM}>Consent form</Link>
          <a role="menuitem" href={websiteUrl} target="_blank" rel="noreferrer" onClick={close} className={ITEM}>Homepage</a>
          <button type="button" role="menuitem" onClick={choose(() => void signOut())} className={ITEM}>Sign out</button>
        </div>
      )}
      <button ref={toggle} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((state) => !state)} className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-paper-2">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">{initialOf(email)}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{email}</span>
        <span aria-hidden="true" className="text-ink-faint">{open ? "▾" : "▴"}</span>
      </button>
    </div>
  );
}
