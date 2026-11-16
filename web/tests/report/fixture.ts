/** A scenario with three runs for the report tests: a baseline, a 90% vaccine run, and a run whose series was lost. */
import type { ReportRun } from "@/lib/db/runs";
import type { ComposeInput } from "@/lib/report/compose";
import { emptyScenario, type DiseasePayload } from "@/lib/tools/types";
import { params, rf } from "../tools/helpers";

const DAYS = Array.from({ length: 366 }, (_, i) => i);
/** A bump peaking on `peakDay` at `peak`. */
const curve = (peak: number, peakDay: number) => DAYS.map((d) => Math.round(peak * Math.exp(-((d - peakDay) ** 2) / (2 * 20 ** 2))));

const stats = (peak: number, peakDay: number, total: number, deaths: number) => ({ peak_infections: peak, peak_day: peakDay, total_infected: total, total_deaths: deaths, n_agents: 10000, sim_days: 366 });

function run(id: string, createdAt: string, over: Partial<ReportRun> = {}): ReportRun {
  return {
    id,
    createdAt,
    effectiveParams: params({ n_agents: 10000, sim_dur_years: 1 }),
    stats: stats(900, 40, 4000, 12),
    statsAgents: stats(900, 40, 4000, 12),
    popScale: 1,
    series: { day: DAYS, n_infected: curve(900, 40) },
    repairs: [],
    warnings: [],
    dataSources: [],
    ...over,
  };
}

export const LITERATURE: DiseasePayload = {
  kind: "disease",
  canonical_name: "measles",
  display_name: "Measles",
  parameters: { r0: { status: "ok", n_estimates: 11, unit: "dimensionless", min: 12, max: 18, typical: 15, source: "https://pubmed.ncbi.nlm.nih.gov/28757186/" } },
};

export const FIXTURE: ComposeInput = {
  scenario: {
    ...emptyScenario(),
    params: params({ n_agents: 10000, sim_dur_years: 1, country: "KEN" }),
    disease: "measles",
    countryIso3: "KEN",
    totalPopulation: 55_100_586,
    dataSources: [rf("birth_rate", 28.3, "https://population.un.org/"), rf("total_population", 55_100_586, "https://population.un.org/")],
    hasRun: true,
  },
  runs: [
    run("run-1", "2026-10-09T10:00:00Z"),
    run("run-2", "2026-10-09T10:05:00Z", {
      effectiveParams: params({ n_agents: 10000, sim_dur_years: 1, interventions: [{ type: "vaccine", coverage: 0.9, start_day: 0 }] }),
      stats: stats(300, 55, 1250, 3),
      statsAgents: stats(300, 55, 1250, 3),
      series: { day: DAYS, n_infected: curve(300, 55) },
    }),
    run("run-3", "2026-10-09T10:10:00Z", { stats: stats(700, 45, 3000, 9), statsAgents: stats(700, 45, 3000, 9), series: null }),
  ],
  recap: ["Measles in Kenya, SIR model, one year", "UN demographics applied"],
  literature: LITERATURE,
  narrative: {
    summary: "Measles would spread fast.\n\nVaccination at 90% halves the peak.",
    meaning: "- Run 2 beats run 1\n- Deaths stay low",
    limitations: "Homogeneous mixing.",
    next_steps: "Try 95%.",
  },
  version: 2,
  conversationTitle: "Measles in Kenya",
  starsimVersion: "3.3.2",
};
