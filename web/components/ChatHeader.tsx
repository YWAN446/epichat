"use client";

import { Brand } from "@/components/Brand";

const QUIET = "rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-soft hover:bg-paper-2 hover:text-ink";
const ICON = "relative rounded-full px-2.5 py-1.5 text-sm text-ink-soft hover:bg-paper-2 hover:text-ink";

type Props = {
  busy: boolean;
  onShare: () => void;
  /** The conversation exists and has a finished turn. */
  canShare: boolean;
  onMenu: () => void;
  onDashboard: () => void;
  menuOpen: boolean;
  dashboardOpen: boolean;
  /** Something new arrived in the dashboard while it was closed. */
  unseen: boolean;
};

/** The full-width bar: the conversations toggle, the brand, Share, and the Dashboard toggle. The toggles open overlays on narrow screens and collapse columns on wide ones. */
export function ChatHeader({ busy, onShare, canShare, onMenu, onDashboard, menuOpen, dashboardOpen, unseen }: Props) {
  return (
    <header className="z-30 border-b border-line bg-paper/90 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={onMenu} aria-expanded={menuOpen} aria-label="Conversations" className={ICON}>
          ☰
        </button>
        <Brand />
        <nav aria-label="Chat" className="ml-auto flex items-center gap-1">
          {canShare && <button type="button" onClick={onShare} disabled={busy} className={QUIET}>Share</button>}
          <button type="button" onClick={onDashboard} aria-expanded={dashboardOpen} aria-label="Dashboard" className={ICON}>
            <span>Dashboard</span>
            {unseen && <span aria-hidden="true" className="absolute top-1 right-1 h-2 w-2 rounded-full bg-accent" />}
          </button>
        </nav>
      </div>
    </header>
  );
}
