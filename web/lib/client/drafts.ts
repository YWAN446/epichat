/** The stage strip's words and the draft messages offered when the model made no suggestion (workspace spec, section 6). */
import type { Stage } from "@/lib/enums";

export const STAGE_LABELS: Record<Stage, string> = {
  understand: "Understand",
  configure: "Configure",
  ground: "Ground in data",
  run: "Run",
  interpret: "Interpret",
};

export const STAGE_HINTS: Record<Stage, string> = {
  understand: "Describe the outbreak you want to model: a disease, a place, and what you want to find out.",
  configure: "Check the configuration. When it looks right, ground it in real data.",
  ground: "Real data is applied. Run the simulation when you are ready.",
  run: "The simulation is running. This usually takes one to two minutes.",
  interpret: "Explore the results, or change something and run again.",
};

export const DRAFTS: Record<Stage, string[]> = {
  understand: ["Model a measles outbreak in Kenya", "Simulate influenza in Brazil with 60% vaccine coverage", "What is the R0 of dengue?"],
  configure: ["Yes, fetch the data", "Use a population of 2 million", "Add a vaccination campaign at 80% coverage"],
  ground: ["Run it", "Which data sources were used?", "Lower the contact rate by 20%"],
  run: [],
  interpret: ["What does the peak mean for hospitals?", "Compare with 90% vaccine coverage", "Start a new scenario"],
};

export type ChipSource = "model" | "draft";

/** The chips above the composer: the model's suggestions when it made any, otherwise the stage's drafts. */
export function chipsFor(stage: Stage, suggestions: string[]): { items: string[]; source: ChipSource } {
  if (suggestions.length > 0) return { items: suggestions, source: "model" };
  return { items: DRAFTS[stage], source: "draft" };
}
