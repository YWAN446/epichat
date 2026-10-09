import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("protected pages", () => {
  for (const page of ["app/chat/page.tsx", "app/chat/[id]/page.tsx", "app/admin/page.tsx", "app/consent/page.tsx"]) {
    it(`${page} decides from loadParticipant and is never static`, () => {
      const source = readFileSync(page, "utf8");
      expect(source).toContain("loadParticipant()");
      expect(source).toContain('export const dynamic = "force-dynamic"');
    });
  }

  it("the chat and admin pages redirect anyone who is not an enrolled participant", () => {
    for (const page of ["app/chat/page.tsx", "app/chat/[id]/page.tsx", "app/admin/page.tsx"]) {
      expect(readFileSync(page, "utf8")).toContain("redirectFor(participant.status)");
    }
  });

  it("the admin page is for researchers only", () => {
    const source = readFileSync("app/admin/page.tsx", "utf8");
    expect(source).toContain("isResearcher(");
    expect(source).toContain("notFound()");
  });

  it("the home page sends a signed-in user to the chat and everyone else to sign in", () => {
    const source = readFileSync("app/page.tsx", "utf8");
    expect(source).toContain('redirect(user ? "/chat" : "/sign-in")');
  });

  it("the resumed-conversation page checks ownership and answers 404 otherwise", () => {
    const source = readFileSync("app/chat/[id]/page.tsx", "utf8");
    expect(source).toContain("supabaseConversationStore(admin).get(id, participant.user.id)");
    expect(source).toContain("notFound()");
    expect(source).toContain("listForReplay(id)");
    expect(source).toContain("z.uuid().safeParse(id)");
  });

  it("both chat pages open a session and render the chat", () => {
    for (const page of ["app/chat/page.tsx", "app/chat/[id]/page.tsx"]) {
      const source = readFileSync(page, "utf8");
      expect(source).toContain("<SessionProvider>");
      expect(source).toContain("<Chat");
    }
    expect(readFileSync("app/chat/page.tsx", "utf8")).toContain("initial={null}");
    expect(existsSync("components/ChatShell.tsx")).toBe(false);
  });

  it("the chat component streams from the chat route, reports suggestion use, and asks for feedback", () => {
    const source = readFileSync("components/Chat.tsx", "utf8");
    expect(source).toContain('fetch("/api/chat"');
    expect(source).toContain("readEvents<ChatStreamEvent>");
    expect(source).toContain("applyEvent(");
    expect(source).toContain('kind: "suggestion_used"');
    expect(source).toContain('kind: "conversation_resumed"');
    expect(source).toContain("useSessionId()");
    expect(source).toContain("<FeedbackControl");
    expect(source).toContain("<Suggestions");
    expect(readFileSync("components/FeedbackControl.tsx", "utf8")).toContain('fetch("/api/feedback"');
    expect(readFileSync("components/ConversationList.tsx", "utf8")).toContain('method: "DELETE"');
  });

  it("New resets the chat's own state, since the first turn swaps the address without remounting the page", () => {
    const chat = readFileSync("components/Chat.tsx", "utf8");
    expect(chat).toContain("function startNew");
    expect(chat).toContain("onNew={startNew}");
    expect(readFileSync("components/ChatHeader.tsx", "utf8")).toContain("onClick={onNew}");
  });
});
