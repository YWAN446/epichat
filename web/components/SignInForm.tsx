"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { isAllowedEmail, normalizeEmail } from "@/lib/auth";
import { SIGN_IN_CODE_LENGTH, isCompleteCode, tidyCode } from "@/lib/signInCode";
import { createClient } from "@/lib/supabase/client";

const INPUT = "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 focus-visible:border-accent";
const BUTTON = "rounded-full bg-accent px-5 py-2.5 font-semibold text-white hover:bg-accent-deep disabled:bg-line disabled:text-ink-faint";
const ERROR = "rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2.5 text-sm text-warn-ink";

export function SignInForm({ domains }: { domains: string[] }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    const address = normalizeEmail(email);
    if (!isAllowedEmail(address, domains)) {
      setError(`Use your @${domains[0]} address.`);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: problem } = await createClient().auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (problem) {
      setError("We could not send the code. Wait a minute and try again.");
      return;
    }
    setEmail(address);
    setCode("");
    setStep("code");
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: problem } = await createClient().auth.verifyOtp({ email, token: code, type: "email" });
    setBusy(false);
    if (problem) {
      setError("That code did not work. Check it, or go back and ask for a new one.");
      return;
    }
    router.replace("/chat");
  }

  if (step === "email") {
    return (
      <form onSubmit={requestCode} className="flex flex-col gap-2.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email address
        </label>
        <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
        <button type="submit" disabled={busy} className={BUTTON}>
          {busy ? "Sending…" : "Email me a sign-in code"}
        </button>
        {error && <p role="alert" className={ERROR}>{error}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={verifyCode} className="flex flex-col gap-2.5">
      <p className="mb-2">
        We sent an eight-digit code to <span className="font-medium">{email}</span>. It can take a minute to arrive.
      </p>
      <label htmlFor="code" className="text-sm font-medium">
        Sign-in code
      </label>
      <input
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        maxLength={SIGN_IN_CODE_LENGTH + 3}
        placeholder="8 digits"
        value={code}
        onChange={(e) => setCode(tidyCode(e.target.value))}
        className={`${INPUT} font-mono tracking-[0.3em] placeholder:tracking-normal`}
      />
      <button type="submit" disabled={busy || !isCompleteCode(code)} className={BUTTON}>
        {busy ? "Checking…" : "Sign in"}
      </button>
      <button type="button" onClick={() => setStep("email")} className="mt-1 w-fit rounded text-left text-sm text-accent underline underline-offset-2">
        Use a different address or send a new code
      </button>
      {error && <p role="alert" className={ERROR}>{error}</p>}
    </form>
  );
}
