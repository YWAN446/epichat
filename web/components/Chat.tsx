"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatStreamEvent } from "@/lib/chat/events";
import { deriveArtifacts } from "@/lib/client/artifacts";
import type { ChartView } from "@/lib/client/chart";
import { summaryFor } from "@/lib/client/conversations";
import { DRAFTS, chipsFor, type ChipSource } from "@/lib/client/drafts";
import { keepFollowing } from "@/lib/client/scroll";
import { readEvents } from "@/lib/client/sse";
import { track } from "@/lib/client/track";
import { INTERRUPTED, applyEvent, lastRecap, lastStage, lastSuggestions, startTurn, type TurnProgress } from "@/lib/client/turn";
import type { ConversationSummary } from "@/lib/db/conversations";
import type { PanelSection } from "@/lib/enums";
import { ChatHeader } from "./ChatHeader";
import { ConversationList } from "./ConversationList";
import { DetailsPanel } from "./panel/DetailsPanel";
import { RecapBar } from "./RecapBar";
import { useSessionId } from "./SessionProvider";
import { StageStrip } from "./StageStrip";
import { Suggestions } from "./Suggestions";
import { Turn, type DisplayTurn } from "./Turn";
import { WorkspaceShell } from "./WorkspaceShell";

export type { DisplayTurn };

type Props = {
  email: string;
  conversations: ConversationSummary[];
  /** The conversation being resumed, or null for a new one. */
  initial: { id: string; title: string; turns: DisplayTurn[] } | null;
  maxMessageChars: number;
  contactEmail: string;
};

const CHIP = "rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium text-accent hover:border-accent hover:bg-accent-wash";

/** The workspace: the list on the left, the conversation and its bottom stack in the middle, the details on the right. Owns the conversation state. */
export function Chat({ email, conversations: initialConversations, initial, maxMessageChars, contactEmail }: Props) {
  const router = useRouter();
  const sessionId = useSessionId();
  const [conversationId, setConversationId] = useState<string | null>(initial?.id ?? null);
  const [conversations, setConversations] = useState(initialConversations);
  const [turns, setTurns] = useState<DisplayTurn[]>(initial?.turns ?? []);
  const [live, setLive] = useState<{ userText: string; progress: TurnProgress } | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const inputBox = useRef<HTMLTextAreaElement>(null);
  const column = useRef<HTMLElement>(null);
  const inFlight = useRef<AbortController | null>(null);
  const following = useRef(true);
  const resumedReported = useRef(false);

  useEffect(() => () => inFlight.current?.abort(), []);

  useEffect(() => {
    if (!initial || !sessionId || resumedReported.current) return;
    resumedReported.current = true;
    track({ kind: "conversation_resumed", sessionId, conversationId: initial.id });
  }, [initial, sessionId]);

  // Follow the reply inside the middle column; the page itself never scrolls.
  useEffect(() => {
    const element = column.current;
    if (!element) return;
    let previousTop = element.scrollTop;
    const onScroll = () => {
      following.current = keepFollowing(following.current, previousTop, element);
      previousTop = element.scrollTop;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const element = column.current;
    if (element && following.current && (live || turns.length > 0)) element.scrollTo({ top: element.scrollHeight });
  }, [turns, live, error]);

  const artifacts = useMemo(() => deriveArtifacts(live ? [...turns, { id: "live", blocks: live.progress.blocks }] : turns), [turns, live]);
  const artifactCount = artifacts.runs.length + artifacts.data.length + (artifacts.config ? 1 : 0);
  const seen = useRef(artifactCount);
  useEffect(() => {
    if (artifactCount > seen.current && !sheet) setUnseen(true);
    seen.current = artifactCount;
  }, [artifactCount, sheet]);

  const stage = live?.progress.stage ?? lastStage(turns);
  const empty = turns.length === 0 && !live;
  const chips = live || empty ? { items: [], source: "draft" as ChipSource } : chipsFor(stage, lastSuggestions(turns));
  const recap = lastRecap(turns);
  const feedback = conversationId ? { conversationId, sessionId } : null;
  const session = sessionId ?? undefined;

  function openSheet() {
    setSheet(true);
    setUnseen(false);
    if (conversationId) track({ kind: "scenario_panel_opened", sessionId: session, conversationId });
  }
  function onSectionOpen(section: PanelSection) {
    if (conversationId) track({ kind: "scenario_panel_opened", sessionId: session, conversationId, section });
  }
  function onChartView(view: ChartView, turnId: string) {
    if (conversationId && turnId !== "live" && view !== "infected") track({ kind: "chart_view_changed", sessionId: session, conversationId, turnId, view });
  }
  function onActivityExpand(turnId: string) {
    if (conversationId && turnId !== "live") track({ kind: "card_expanded", sessionId: session, conversationId, turnId, card: "activity" });
  }
  function onRecapExpand() {
    const turnId = turns.at(-1)?.id;
    if (conversationId && turnId) track({ kind: "card_expanded", sessionId: session, conversationId, turnId, card: "recap" });
  }

  /** Send what is in the message box, or a chip the participant pressed (with where it came from). */
  async function send(text: string, source?: ChipSource) {
    const userText = text.trim();
    if (!userText || live) return;
    if (userText.length > maxMessageChars) {
      setError(`That message is too long. Keep it under ${maxMessageChars} characters.`);
      return;
    }
    const suggested = source !== undefined;
    if (suggested && conversationId) {
      track({ kind: "suggestion_used", sessionId: session, conversationId, turnId: turns.at(-1)?.id, stage, source });
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
          // The first turn opened the conversation: show its address and its row without reloading the page.
          setConversationId(id);
          setConversations((list) => [summaryFor(id, userText, new Date()), ...list]);
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
    resetConversation();
  }

  /** Forget the conversation on screen: abort a reply in flight and clear every piece of its state. */
  function resetConversation() {
    inFlight.current?.abort();
    inFlight.current = null;
    following.current = true;
    setTurns([]);
    setConversationId(null);
    setError(null);
    setInput("");
    setDrawer(false);
    setUnseen(false);
  }

  /**
   * A conversation was deleted from the list. When it is the one on screen,
   * reset the state the same way New does: the first turn swapped the address
   * with replaceState, so a push to /chat can land on this same instance.
   */
  function onRemoved(id: string) {
    setConversations((list) => list.filter((item) => item.id !== id));
    if (id === conversationId) {
      resetConversation();
      router.push("/chat");
    }
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

  return (
    <WorkspaceShell
      header={
        <ChatHeader
          email={email}
          busy={live !== null}
          onNew={startNew}
          onMenu={() => setDrawer((open) => !open)}
          onDetails={() => (sheet ? setSheet(false) : openSheet())}
          menuOpen={drawer}
          detailsOpen={sheet}
          unseen={unseen}
        />
      }
      sidebar={<ConversationList items={conversations} currentId={conversationId} busy={live !== null} onNew={startNew} onPick={() => setDrawer(false)} onRemoved={onRemoved} />}
      panel={<DetailsPanel artifacts={artifacts} onSectionOpen={onSectionOpen} onChartView={onChartView} />}
      drawerOpen={drawer}
      sheetOpen={sheet}
      onClose={() => {
        setDrawer(false);
        setSheet(false);
      }}
      columnRef={column}
    >
      <div className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col px-4 py-6">
        {empty && (
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-xl font-semibold">What would you like to model?</h2>
            <p className="mt-2 text-ink-soft">
              EpiChat sets up and runs agent-based epidemic simulations from a conversation: a disease, a country, real demographic data, interventions, and the
              results, with every step shown. Try one of these, or type your own.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {DRAFTS.understand.map((draft) => (
                <button key={draft} type="button" onClick={() => void send(draft, "draft")} className={CHIP}>
                  {draft}
                </button>
              ))}
            </div>
            {contactEmail && <p className="mt-4 text-sm text-ink-faint">Questions about the study: {contactEmail}.</p>}
          </section>
        )}

        {turns.map((turn) => (
          <Turn key={turn.id} turn={turn} status={null} feedback={feedback} onActivityExpand={() => onActivityExpand(turn.id)} />
        ))}
        {live && <Turn turn={{ id: "live", userText: live.userText, blocks: live.progress.blocks, notice: null }} status={live.progress.status} feedback={null} />}
      </div>

      <footer className="sticky bottom-0 border-t border-line bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto max-w-[46rem] px-4 pt-2.5">
          {error && (
            <p role="alert" className="mb-2.5 rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2.5 text-sm text-warn-ink">
              {error}
            </p>
          )}
          <RecapBar items={recap} onExpand={onRecapExpand} />
          <StageStrip stage={stage} />
          <Suggestions items={chips.items} disabled={live !== null} onPick={(reply) => void send(reply, chips.source)} />
        </div>
        <form className="mx-auto flex max-w-[46rem] items-end gap-2 px-4 pb-3" onSubmit={submit}>
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
    </WorkspaceShell>
  );
}
