import { describe, expect, it } from "vitest";

import { INTRO_QUESTIONS, WELCOME_HEADING } from "@/lib/client/welcome";

describe("the welcome line", () => {
  it("has one fixed English heading", () => {
    expect(WELCOME_HEADING).toBe("Which infectious disease scenario would you like to explore today?");
  });

  it("offers four introduction questions", () => {
    expect(INTRO_QUESTIONS).toEqual(["What is EpiChat?", "What can EpiChat do?", "How does a simulation work?", "What data does it use?"]);
  });
});
