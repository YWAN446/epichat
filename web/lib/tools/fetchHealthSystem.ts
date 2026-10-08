// Stub, replaced in Task 9.
import { z } from "zod";
import { errorOutcome } from "./shared";
import type { ToolDeps, ToolOutcome } from "./types";
export const FetchHealthSystemInput = z.strictObject({ country_iso3: z.string() });
export async function fetchHealthSystem(_input: z.infer<typeof FetchHealthSystemInput>, _deps: ToolDeps): Promise<ToolOutcome> { return errorOutcome("FETCH ERROR: not implemented"); }
