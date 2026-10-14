/** Parent spec 10.1: the stage is derived from the scenario, never declared by the model. */
import { STAGES, type Stage } from "@/lib/enums";
import { isChosenReference } from "@/lib/tools/sources";
import type { Scenario } from "@/lib/tools/types";

export const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s, i])) as Record<Stage, number>;

export function deriveStage(scenario: Pick<Scenario, "params" | "dataSources" | "hasRun" | "reportCurrent">, running = false): Stage {
  if (running) return "run";
  if (scenario.reportCurrent) return "report";
  if (scenario.hasRun) return "interpret";
  // a chosen literature reference is a parameter's source, not real data applied (review of the follow-up's phase D)
  if (scenario.dataSources.some((f) => !isChosenReference(f.field))) return "ground";
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
