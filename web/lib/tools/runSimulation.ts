// Stub, replaced in Task 10.
import { z } from "zod";
import { errorOutcome } from "./shared";
import type { ToolDeps, ToolOutcome } from "./types";
export const RunSimulationInput = z.strictObject({});
export async function runSimulation(_input: z.infer<typeof RunSimulationInput>, _deps: ToolDeps): Promise<ToolOutcome> { return errorOutcome("SIMULATION ERROR: not implemented"); }
