/** The empty conversation's welcome: the question in ten languages, the introduction questions, and the typewriter that cycles the line. */

export const WELCOME_PHRASES: string[] = [
  "Which infectious disease scenario would you like to explore today?",
  "¿Qué escenario de enfermedad infecciosa le gustaría explorar hoy?",
  "Quel scénario de maladie infectieuse souhaitez-vous explorer aujourd'hui ?",
  "Que cenário de doença infecciosa gostaria de explorar hoje?",
  "今天您想探索哪种传染病情景？",
  "ما سيناريو المرض المعدي الذي تودّ استكشافه اليوم؟",
  "Welches Infektionskrankheits-Szenario möchten Sie heute erkunden?",
  "आज आप किस संक्रामक रोग परिदृश्य का अन्वेषण करना चाहेंगे?",
  "今日はどの感染症シナリオを探りますか？",
  "Ni hali gani ya ugonjwa wa kuambukiza ungependa kuchunguza leo?",
];

/** Four questions a newcomer can press before describing an outbreak; the prompt's About section answers them. */
export const INTRO_QUESTIONS: string[] = ["What is EpiChat?", "What can EpiChat do?", "How does a simulation work?", "What data does it use?"];

export type TypewriterState = { phrase: number; length: number; phase: "typing" | "holding" | "deleting" };

export const TYPEWRITER_START: TypewriterState = { phrase: 0, length: 0, phase: "typing" };

/** Milliseconds: per character typed, per character erased, holding the full line, and the pause before the next line. */
export const TYPEWRITER_DELAYS = { type: 55, erase: 28, hold: 2200, pause: 400 } as const;

/** Characters, not UTF-16 units, so a surrogate pair is never cut in half. */
const chars = (phrase: string): string[] => Array.from(phrase);

/** What the line shows in a state. */
export function typewriterText(state: TypewriterState, phrases: string[]): string {
  return chars(phrases[state.phrase] ?? "")
    .slice(0, state.length)
    .join("");
}

/** The next state and how long to wait before it: type the line, hold it, erase it, move on, wrap at the end. */
export function typewriterStep(state: TypewriterState, phrases: string[]): { state: TypewriterState; delay: number } {
  const total = chars(phrases[state.phrase] ?? "").length;
  if (state.phase === "typing") {
    const length = Math.min(state.length + 1, total);
    if (length >= total) return { state: { ...state, length, phase: "holding" }, delay: TYPEWRITER_DELAYS.hold };
    return { state: { ...state, length }, delay: TYPEWRITER_DELAYS.type };
  }
  if (state.phase === "holding") return { state: { ...state, length: Math.max(state.length - 1, 0), phase: "deleting" }, delay: TYPEWRITER_DELAYS.erase };
  if (state.length > 0) return { state: { ...state, length: state.length - 1 }, delay: TYPEWRITER_DELAYS.erase };
  return { state: { phrase: (state.phrase + 1) % Math.max(phrases.length, 1), length: 0, phase: "typing" }, delay: TYPEWRITER_DELAYS.pause };
}
