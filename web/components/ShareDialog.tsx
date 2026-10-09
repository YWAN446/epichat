"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { describeShare, requestShare, revokeShare, type ShareState } from "@/lib/client/share";

const BUTTON = "rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium text-accent hover:border-accent hover:bg-accent-wash disabled:opacity-50";
const PRIMARY = "rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:bg-line disabled:text-ink-faint";

const subscribe = () => () => {};
/** The page's origin once hydrated; "" on the server, so the link renders relative until then. */
function useOrigin(): string {
  return useSyncExternalStore(subscribe, () => window.location.origin, () => "");
}

type Props = { open: boolean; conversationId: string; share: ShareState | null; onChange: (share: ShareState | null) => void; onClose: () => void };

/** Create, copy, refresh, or revoke the conversation's link, in a native dialog (share spec, section 8). */
export function ShareDialog({ open, conversationId, share, onChange, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const origin = useOrigin();
  const href = share ? (origin ? new URL(share.url, origin).href : share.url) : "";

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  async function create() {
    setBusy(true);
    setMessage(null);
    const result = await requestShare(conversationId);
    setBusy(false);
    if (result.ok) onChange(result.share);
    else setMessage(result.message);
  }

  async function stop() {
    setBusy(true);
    setMessage(null);
    const result = await revokeShare(conversationId);
    setBusy(false);
    if (result.ok) onChange(null);
    else setMessage(result.message);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      input.current?.select();
    }
  }

  function onBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current) onClose();
  }

  return (
    <dialog ref={ref} onClose={onClose} onClick={onBackdrop} className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-ink/30">
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-semibold">Share this conversation</h2>
        <p className="text-sm text-ink-soft">Anyone with the link can read this conversation as it is now. Your email is not shown.</p>
        {share ? (
          <>
            <div className="flex gap-2">
              <input ref={input} readOnly value={href} aria-label="Share link" onFocus={(event) => event.target.select()} className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm" />
              <button type="button" onClick={() => void copy()} className={BUTTON}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-xs text-ink-faint">{describeShare(share)}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void create()} className={BUTTON}>
                Update snapshot
              </button>
              <button type="button" disabled={busy} onClick={() => void stop()} className={BUTTON}>
                Stop sharing
              </button>
            </div>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => void create()} className={PRIMARY}>
            Create link
          </button>
        )}
        {message && (
          <p role="alert" className="rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3 py-2 text-sm text-warn-ink">
            {message}
          </p>
        )}
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-2 hover:text-ink">
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
