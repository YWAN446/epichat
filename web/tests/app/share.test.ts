import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("the public share page", () => {
  it("reads by token, counts the open without letting a failure break the render, and is never indexed or cached", () => {
    const page = read("app/s/[token]/page.tsx");
    for (const piece of ["isToken(", "byToken(", "notFound()", "view(", '"share_opened"', "try {", 'dynamic = "force-dynamic"', "robots: { index: false, follow: false }", "<SharedConversation"]) {
      expect(page).toContain(piece);
    }
    expect(read("app/s/[token]/not-found.tsx")).toContain("This shared conversation is no longer available.");
    const config = read("next.config.ts");
    for (const piece of ["X-Robots-Tag", "noindex, nofollow", "no-store", '"/s/:path*"']) expect(config).toContain(piece);
  });

  it("shows the turns and the panel with nothing to type, press, or sign in to", () => {
    const shared = read("components/SharedConversation.tsx");
    for (const piece of [
      "<Turn", "feedback={null}", "<ScenarioSection", "references={false}", "<RunsSection", "<DataSection", "<ActivitySection", "deriveArtifacts(",
      "View report", "No report was written.", "A frozen copy of an EpiChat conversation, shared by a study participant on", "EpiChat is a research prototype from Emory University.",
    ]) {
      expect(shared).toContain(piece);
    }
    for (const piece of ["<Composer", "<Suggestions", "<StageStrip", "<RecapBar", "FeedbackControl", "sign-in", "<DetailsPanel"]) expect(shared).not.toContain(piece);
    expect(read("components/panel/ScenarioSection.tsx")).toContain("references = true");
  });
});

describe("the Share dialog", () => {
  it("creates, updates, copies, and stops sharing from a native dialog, with the spec's sentence", () => {
    const dialog = read("components/ShareDialog.tsx");
    for (const piece of ["<dialog", "showModal()", "Create link", "Update snapshot", "Stop sharing", "Copy", "Copied", "navigator.clipboard", "describeShare(", "requestShare(", "revokeShare(", "Anyone with the link can read this conversation as it is now. Your email is not shown."]) {
      expect(dialog).toContain(piece);
    }
    const header = read("components/ChatHeader.tsx");
    expect(header).toContain("onShare");
    expect(header).toContain(">Share<");
    const chat = read("components/Chat.tsx");
    for (const piece of ["<ShareDialog", "initialShare", "<ChatHeader"]) expect(chat).toContain(piece);
    const reset = /function resetConversation\(\) \{[\s\S]*?\n  \}/.exec(chat)?.[0] ?? "";
    expect(reset).toContain("setShare(null)");
    const page = read("app/chat/[id]/page.tsx");
    expect(page).toContain("active(");
    expect(page).toContain("initialShare=");
  });
});
