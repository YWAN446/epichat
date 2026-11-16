import { describe, expect, it } from "vitest";

import { INTRO_QUESTIONS, TYPEWRITER_DELAYS, TYPEWRITER_START, WELCOME_PHRASES, typewriterStep, typewriterText } from "@/lib/client/welcome";

describe("the welcome line", () => {
  it("asks the question in ten languages, English first", () => {
    expect(WELCOME_PHRASES).toHaveLength(10);
    expect(WELCOME_PHRASES[0]).toBe("Which infectious disease scenario would you like to explore today?");
    expect(new Set(WELCOME_PHRASES).size).toBe(10);
    for (const phrase of WELCOME_PHRASES) expect(phrase.length).toBeLessThanOrEqual(90);
    expect(WELCOME_PHRASES.some((phrase) => /[一-鿿]/.test(phrase))).toBe(true);
    expect(WELCOME_PHRASES.some((phrase) => /[؀-ۿ]/.test(phrase))).toBe(true);
  });

  it("offers four introduction questions", () => {
    expect(INTRO_QUESTIONS).toEqual(["What is EpiChat?", "What can EpiChat do?", "How does a simulation work?", "What data does it use?"]);
  });
});

describe("the typewriter", () => {
  const phrases = ["ab", "xyz"];

  it("types a phrase one character at a time, holds it, erases it, and moves to the next", () => {
    let state = TYPEWRITER_START;
    expect(typewriterText(state, phrases)).toBe("");
    let step = typewriterStep(state, phrases);
    expect(step).toEqual({ state: { phrase: 0, length: 1, phase: "typing" }, delay: TYPEWRITER_DELAYS.type });
    step = typewriterStep(step.state, phrases);
    expect(typewriterText(step.state, phrases)).toBe("ab");
    expect(step.state.phase).toBe("holding");
    expect(step.delay).toBe(TYPEWRITER_DELAYS.hold);
    step = typewriterStep(step.state, phrases);
    expect(step).toEqual({ state: { phrase: 0, length: 1, phase: "deleting" }, delay: TYPEWRITER_DELAYS.erase });
    step = typewriterStep(step.state, phrases);
    expect(step.state).toEqual({ phrase: 0, length: 0, phase: "deleting" });
    step = typewriterStep(step.state, phrases);
    expect(step).toEqual({ state: { phrase: 1, length: 0, phase: "typing" }, delay: TYPEWRITER_DELAYS.pause });
    state = step.state;
    for (let i = 0; i < 3; i += 1) state = typewriterStep(state, phrases).state;
    expect(typewriterText(state, phrases)).toBe("xyz");
  });

  it("wraps from the last phrase to the first and counts characters, not UTF-16 units", () => {
    const wrapped = typewriterStep({ phrase: 1, length: 0, phase: "deleting" }, phrases);
    expect(wrapped.state).toEqual({ phrase: 0, length: 0, phase: "typing" });
    const cjk = ["今日は"];
    const typed = typewriterStep(typewriterStep(TYPEWRITER_START, cjk).state, cjk).state;
    expect(typewriterText(typed, cjk)).toBe("今日");
    expect(typewriterText({ phrase: 0, length: 1, phase: "typing" }, ["😀x"])).toBe("😀");
  });
});
