import { describe, expect, it } from "vitest";

import type { PreviousRun } from "@/lib/db/runs";
import type { Diagnostic } from "@/lib/sim/client";
import { configureSimulation } from "@/lib/tools/configureSimulation";
import fixture from "../fixtures/what_if_levers.json";
import { makeDeps, params } from "./helpers";

type Case = { network: string; disease: string | null; anchor: number; diagnostics: Diagnostic[] };
const CASES = fixture.cases as unknown as Case[];
const stats = { peak_infections: 800, peak_day: 60, total_infected: 8600, total_deaths: 0, n_agents: 10000, sim_days: 366 };

/**
 * Review of phase B: the levers as the service serializes them (scripts/export_parity_fixtures.py writes them from diagnose) go
 * through the tool the agent applies them with, and the recording finds them again. The Python tests prove the Python validator
 * takes them; this proves the TypeScript one does, field for field.
 */
describe("the service's levers through configure_simulation (follow-up spec 7.1, 7.5)", () => {
  it("covers the three networks, a campaign and a 1% seeding's day 0", () => {
    expect(CASES.map((c) => [c.network, c.anchor])).toEqual([["random", 20], ["hybrid", 20], ["age_structured", 20], ["hybrid", 0], ["random", 0]]);
    const types = new Set(CASES.flatMap((c) => c.diagnostics).flatMap((d) => d.levers).flatMap((l) => (l.interventions ?? []).map((i) => `${i.type}${i.layer ? `:${i.layer}` : ""}`)));
    for (const type of ["vaccine", "contact_reduction:school", "contact_reduction:community", "contact_reduction:all", "transmission_reduction", "behavior_response"]) expect(types).toContain(type);
  });

  for (const c of CASES) {
    for (const diagnostic of c.diagnostics) {
      diagnostic.levers.forEach((lever, index) => {
        it(`${c.network}, day ${c.anchor}: ${diagnostic.id} lever ${index + 1} (${lever.label}) is applied as it is and recorded`, async () => {
          const previous = { id: "run-1", effectiveParams: params({}), stats, statsAgents: stats, popScale: 1, diagnostics: c.diagnostics } as unknown as PreviousRun;
          const deps = makeDeps({ previousRun: previous });
          await configureSimulation({ disease: c.disease ?? "influenza", r0: 2.5, network_type: c.network } as never, deps);
          deps.scenario.hasRun = true;
          const entries = lever.interventions ?? [];
          const input = { ...(entries.length ? { interventions: entries } : {}), ...(Object.keys(lever.patch).length ? { advanced: lever.patch } : {}) };
          const out = await configureSimulation(input as never, deps);
          expect(out.isError, out.content).toBeFalsy();
          for (const entry of entries) expect(deps.scenario.params!.interventions).toContainEqual(expect.objectContaining(entry));
          expect(deps.options).toContainEqual({ runId: "run-1", diagnosticId: diagnostic.id, patch: lever.patch, ...(entries.length ? { interventions: entries } : {}) });
          expect(lever.label!.length).toBeLessThanOrEqual(80);
        });
      });
    }
  }
});
