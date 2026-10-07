"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Shown when a signed-in account is not eligible: the address is unconfirmed
 * or its domain is no longer on the allowlist. Signs the account out so the
 * visitor is not sent back and forth between the home page and the chat.
 */
export function ForbiddenNotice({ contactEmail }: { contactEmail: string }) {
  useEffect(() => {
    void createClient().auth.signOut().catch(() => {});
  }, []);

  return (
    <p role="alert" className="mt-6 rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2.5 text-sm text-warn-ink">
      This account is not eligible for the study, so you were signed out. EpiChat is open to addresses
      at the participating institutions only. If you think this is a mistake, write to{" "}
      {contactEmail ? (
        <a className="underline underline-offset-2" href={`mailto:${contactEmail}`}>
          {contactEmail}
        </a>
      ) : (
        "the research team"
      )}
      .
    </p>
  );
}
