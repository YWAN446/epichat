/** How the chat's start page treats the tutorial for this participant (tutorial spec, "Behaviour around the tutorial"). */
export type TutorialEntryRule = "redirect" | "offer" | "none";

/**
 * A participant who has never seen or declined the tutorial is sent into it when they have no conversations yet,
 * and offered it once when they already have some. Anyone else is left alone; the account menu still has it.
 */
export function tutorialEntry(seenAt: string | null, conversations: number): TutorialEntryRule {
  if (seenAt !== null) return "none";
  return conversations === 0 ? "redirect" : "offer";
}
