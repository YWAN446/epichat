import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RunsSection } from "@/components/panel/RunsSection";
import type { Block } from "@/lib/chat/events";
import { deriveArtifacts } from "@/lib/client/artifacts";
import { params } from "../tools/helpers";

const STATS = { peak_infections: 900, peak_day: 40, total_infected: 4000, total_deaths: 12, n_agents: 10000, sim_days: 365 };
const run = (effective_params: unknown): Block => ({
  kind: "tool_result", id: "tu", name: "run_simulation", ok: true,
  payload: { kind: "run", run_id: "run-1", stats: STATS, stats_agents: STATS, attack_rate_pct: 40, pop_scale: 1, population: 10000, effective_params, warnings: [], repairs: [], data_sources: [], duration_ms: 1000, cold_start: false, series: { day: [0, 1], n_infectious: [1, 2], n_susceptible: [9, 8], cum_infections: [1, 2], new_infections: [1, 1], n_recovered: [0, 0], new_deaths: [0, 0], cum_deaths: [0, 0] } },
} as unknown as Block);
const render = (blocks: Block[]) => renderToStaticMarkup(createElement(RunsSection, { runs: deriveArtifacts([{ id: "t1", blocks }]).runs, onChartView: () => {} }));

describe("the runs panel as it renders (review of phase C)", () => {
  it("lists a run's parameters by the Parameters section's rows", () => {
    const html = render([run(params({ schema_version: 2, disease: { rel_sus_cv: 1 }, interventions: [{ type: "seasonality", scale: 0.3 }] }))]);
    expect(html).toContain("Effective parameters");
    expect(html).toContain("Variation in susceptibility");
    expect(html).toContain("CV 1");
    expect(html).toContain("interventions");
    expect(html).not.toContain("R₀ (approx.)");
  });

  it("still renders a run whose stored parameters no longer validate, and says so", () => {
    // v1 allowed an infectious period of ten years; v2 does not, so the stored parameters cannot be read as today's
    const legacy = { disease_type: "sir", beta: 22.8, dur_inf: 3650, n_agents: 10000, sim_dur_years: 1 };
    const html = render([run(legacy), run({ schema_version: 2, disease: { model: "sir" } }), run(null)]);
    expect(html.match(/Run \d/g)).toHaveLength(3);
    expect(html).toContain("stored in a form that can no longer be listed");
    expect(deriveArtifacts([{ id: "t1", blocks: [run(legacy)] }]).runs[0].effective).toBeNull();
    expect(deriveArtifacts([{ id: "t1", blocks: [run(params({}))] }]).runs[0].effective).not.toBeNull();
  });
});
