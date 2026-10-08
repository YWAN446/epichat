/** Parent spec 10.1: the stage is derived from the scenario, never declared by the model. */
import { STAGES, type Stage } from "@/lib/enums";
import type { Scenario } from "@/lib/tools/types";

export const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s, i])) as Record<Stage, number>;

export function deriveStage(scenario: Pick<Scenario, "params" | "dataSources" | "hasRun">, running = false): Stage {
  if (running) return "run";
  if (scenario.hasRun) return "interpret";
  if (scenario.dataSources.length > 0) return "ground";
  if (scenario.params) return "configure";
  return "understand";
}

/** Update the scenario's stage; report a change and, when the furthest stage advances, the stage newly reached. */
export function advanceStage(scenario: Scenario, running = false): { stage: Stage; changed: boolean; reached: Stage | null } {
  const stage = deriveStage(scenario, running);
  const changed = stage !== scenario.stage;
  scenario.stage = stage;
  let reached: Stage | null = null;
  if (STAGE_INDEX[stage] > STAGE_INDEX[scenario.stageReached]) {
    scenario.stageReached = stage;
    reached = stage;
  }
  return { stage, changed, reached };
}
