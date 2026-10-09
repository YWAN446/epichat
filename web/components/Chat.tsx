"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Block, ChatStreamEvent } from "@/lib/chat/events";
import { keepFollowing } from "@/lib/client/scroll";
import { readEvents } from "@/lib/client/sse";
import { track } from "@/lib/client/track";
import { INTERRUPTED, applyEvent, lastStage, lastSuggestions, startTurn, type TurnProgress } from "@/lib/client/turn";
import type { ConversationSummary } from "@/lib/db/conversations";
import { ChatHeader } from "./ChatHeader";
import { ConversationList } from "./ConversationList";
import { FeedbackControl } from "./FeedbackControl";
import { useSessionId } from "./SessionProvider";
import { Suggestions } from "./Suggestions";
import { TurnBlocks } from "./TurnBlocks";

/** A finished turn as the page shows it: the participant's text and the assistant's blocks. */
export type DisplayTurn = { id: string; userText: string; blocks: Block[]; notice: string | null };

type Props = {
  email: string;
  conversations: ConversationSummary[];
  /** The conversation being resumed, or null for a new one. */
  initial: { id: string; title: string; turns: DisplayTurn[] } | null;
  maxMessageChars: number;
  contactEmail: string;
};

const EXAMPLES = ["Model a measles outbreak in Kenya", "What is the R0 of dengue?", "Simulate influenza in Brazil with 60% vaccine coverage"];

function TurnView({ turn, status, feedback }: { turn: DisplayTurn; status: string | null; feedback: { conversationId: string; sessionId: string | null } | null }) {
  return (
    <article className="py-4">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent-wash px-4 py-2.5 whitespace-pre-wrap">{turn.userText}</p>
      <div className="mt-4">
        <TurnBlocks blocks={turn.blocks} />
        {status && (
          <p role="status" className="my-2 text-sm text-ink-faint">
            {status}
          </p>
        )}
        {turn.notice && (
          <p role="status" className="my-2 rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2 text-sm text-warn-ink">
            {turn.notice}
          </p>
        )}
        {feedback && <FeedbackControl conversationId={feedback.conversationId} turnId={turn.id} sessionId={feedback.sessionId} />}
      </div>
    </article>
  );
}

/** The chat: every turn's blocks, the live turn with its status line, suggestion chips, the composer, and the list. */
export function Chat({ email, conversations, initial, maxMessageChars, contactEmail }: Props) {
  const router = useRouter();
  const sessionId = useSessionId();
  const [conversationId, setConversationId] = useState<string | null>(initial?.id ?? null);
  const [turns, setTurns] = useState<DisplayTurn[]>(initial?.turns ?? []);
  const [live, setLive] = useState<{ userText: string; progress: TurnProgress } | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputBox = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef<AbortController | null>(null);
  const following = useRef(true);
  const resumedReported = useRef(false);

  useEffect(() => () => inFlight.current?.abort(), []);

  useEffect(() => {
    if (!initial || !sessionId || resumedReported.current) return;
    resumedReported.current = true;
    track({ kind: "conversation_resumed", sessionId, conversationId: initial.id });
  }, [initial, sessionId]);

  useEffect(() => {
    let previousTop = document.documentElement.scrollTop;
    const onScroll = () => {
      const page = document.documentElement;
      following.current = keepFollowing(following.current, previousTop, page);
      previousTop = page.scrollTop;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (following.current && (live || turns.length > 0)) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [turns, live, error]);

  const suggestions = live ? [] : lastSuggestions(turns);
  const showList = turns.length === 0 && !live;

  /** Send what is in the message box, or a suggested reply the participant pressed. */
  async function send(text: string, suggested = false) {
    const userText = text.trim();
    if (!userText || live) return;
    if (userText.length > maxMessageChars) {
      setError(`That message is too long. Keep it under ${maxMessageChars} characters.`);
      return;
    }
    if (suggested && conversationId) {
      track({ kind: "suggestion_used", sessionId: sessionId ?? undefined, conversationId, turnId: turns.at(-1)?.id, stage: lastStage(turns) });
    }
    const startedWith = conversationId;
    let progress = startTurn();
    following.current = true;
    setError(null);
    if (!suggested) setInput("");
    setLive({ userText, progress });
    const fail = (message: string) => {
      setError(message);
      if (!suggested) setInput(text);
    };
    const request = new AbortController();
    inFlight.current = request;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({ ...(startedWith ? { conversationId: startedWith } : {}), sessionId, text: userText }),
      });
      if (response.status === 401) {
        router.replace("/sign-in");
        return;
      }
      if (!response.ok || !response.body) {
        const problem = (await response.json().catch(() => null)) as { message?: string } | null;
        fail(problem?.message ?? INTERRUPTED);
        return;
      }
      for await (const event of readEvents<ChatStreamEvent>(response.body)) {
        progress = applyEvent(progress, event);
        setLive({ userText, progress });
      }
      if (request.signal.aborted) return;
      if (progress.result?.ok) {
        const { turnId, conversationId: id, notice } = progress.result;
        setTurns((list) => [...list, { id: turnId, userText, blocks: progress.blocks, notice }]);
        if (!startedWith) {
          // The first turn opened the conversation: show its address without reloading the page.
          setConversationId(id);
          window.history.replaceState(null, "", `/chat/${id}`);
        }
      } else {
        fail(progress.result?.message ?? INTERRUPTED);
      }
    } catch {
      if (!request.signal.aborted) fail(INTERRUPTED);
    } finally {
      if (inFlight.current === request) inFlight.current = null;
      setLive(null);
      inputBox.current?.focus();
    }
  }

  /**
   * Start a new conversation. The first turn swaps the address to /chat/[id]
   * without a navigation, so a link back to /chat can land on this same
   * component instance with its state intact; reset it here before the link
   * navigates, rather than relying on a remount.
   */
  function startNew() {
    if (live) return;
    inFlight.current?.abort();
    inFlight.current = null;
    following.current = true;
    setTurns([]);
    setConversationId(null);
    setError(null);
    setInput("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  }

  const feedback = conversationId ? { conversationId, sessionId } : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <ChatHeader email={email} busy={live !== null} onNew={startNew} />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
        {showList && (
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-xl font-semibold">What would you like to model?</h2>
            <p className="mt-2 text-ink-soft">
              EpiChat sets up and runs agent-based epidemic simulations from a conversation: a disease, a country, real demographic data, interventions, and the
              results, with every step shown. Try one of these, or type your own.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" onClick={() => void send(example)} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium text-accent hover:border-accent hover:bg-accent-wash">
                  {example}
                </button>
              ))}
            </div>
            {contactEmail && <p className="mt-4 text-sm text-ink-faint">Questions about the study: {contactEmail}.</p>}
          </section>
        )}

        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} status={null} feedback={feedback} />
        ))}
        {live && <TurnView turn={{ id: "live", userText: live.userText, blocks: live.progress.blocks, notice: null }} status={live.progress.status} feedback={null} />}

        {showList && <ConversationList items={conversations} currentId={conversationId} />}
      </main>

      <footer className="sticky bottom-0 border-t border-line bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-4 pt-2.5">
          {error && (
            <p role="alert" className="mb-2.5 rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2.5 text-sm text-warn-ink">
              {error}
            </p>
          )}
          <Suggestions items={suggestions} disabled={live !== null} onPick={(reply) => void send(reply, true)} />
        </div>
        <form className="mx-auto flex max-w-3xl items-end gap-2 px-4 pb-3" onSubmit={submit}>
          <textarea
            ref={inputBox}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={live !== null}
            rows={1}
            maxLength={maxMessageChars}
            placeholder={live ? "Working…" : "Message EpiChat"}
            aria-label="Message"
            className="min-h-11 flex-1 resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 disabled:text-ink-faint"
          />
          <button type="submit" disabled={live !== null || !input.trim()} className="rounded-full bg-accent px-5 py-2.5 font-semibold text-white hover:bg-accent-deep disabled:bg-line disabled:text-ink-faint">
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}
