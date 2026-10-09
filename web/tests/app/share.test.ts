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
