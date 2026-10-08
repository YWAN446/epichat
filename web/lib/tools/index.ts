import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { ConfigureSimulationInput, configureSimulation } from "./configureSimulation";
import { FetchDemographicsInput, fetchDemographics } from "./fetchDemographics";
import { FetchHealthSystemInput, fetchHealthSystem } from "./fetchHealthSystem";
import { FetchVaccinationCoverageInput, fetchVaccinationCoverage } from "./fetchVaccinationCoverage";
import { LookupDiseaseInput, lookupDisease } from "./lookupDisease";
import { RunSimulationInput, runSimulation } from "./runSimulation";
import { errorMessage } from "./shared";
import type { ToolDeps, ToolOutcome } from "./types";

const num = (description: string) => ({ type: ["number", "null"], description });
const int = (description: string) => ({ type: ["integer", "null"], description });
const str = (description: string) => ({ type: ["string", "null"], description });

/**
 * Tool definitions sent to the model, in the Python agent's order. Part of the
 * cached prompt prefix: keep the order fixed and never put per-request values
 * in it. Descriptions are the Python docstrings verbatim.
 */
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "configure_simulation",
    description:
      "Create or update the validated simulation configuration.\n\nCall this whenever the user specifies or changes any setting, passing\nonly the fields that changed — earlier settings are preserved. Pass\nr0 to have beta calibrated deterministically to that R0. The result\nreports the validated configuration and any literature-range\nwarnings; a CONFIG ERROR result explains what to fix.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        disease: str('Disease name as the user said it (e.g. "dengue").'),
        country_iso3: str('ISO3 country code (e.g. "BRA").'),
        disease_type: str("Model type: sir, seir, sis, sirs, seirs, or seiar."),
        n_agents: int("Number of simulated agents."),
        sim_dur_years: num("Simulation duration in years."),
        r0: num("Target basic reproduction number; beta is calibrated to it."),
        dur_inf: num("Infectious period in days."),
        dur_exp: num("Incubation period in days (SEIR-family models)."),
        dur_immune: num("Immunity duration in days (SIRS-family models)."),
        p_death: num("Infection fatality rate as a fraction of 1."),
        p_asymp: num("Asymptomatic fraction (SEIAR), fraction of 1."),
        init_prev: num("Initial prevalence as a fraction of 1."),
        vaccine_coverage: num("Vaccine coverage fraction; adds/updates the\nvaccine intervention."),
        vaccine_start_day: int("Day the vaccination campaign begins. 0 (the\ndefault) means pre-existing immunity at the start rather than\na campaign. Requires vaccine_coverage."),
        treatment_capacity: int("Daily treatment capacity; adds/updates the\ntreatment intervention."),
        seasonality_scale: num("Seasonal forcing amplitude 0-1; adds/updates\nthe seasonality intervention."),
        start_new_scenario: { type: ["boolean", "null"], description: "True to begin a new scenario from scratch (a different disease or country) instead of editing the current one. Earlier scenarios are kept for comparison." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "lookup_disease",
    description:
      'Look up a disease in the curated, citation-backed parameter database.\n\nCall this before configuring a known disease. Each parameter comes\nback with a status: "ok" (a usable consensus value, with\nestimate_range showing how far published estimates spread and\nestimate_extremes naming where each bound came from), "under_review"\n(held back — cite review_note, never invent a number),\n"estimates_only" (citations exist but the database has adopted no\nconsensus value — report the estimates and say there is no agreed\nvalue), or "no_source" (nothing at all in the database). Pass only\n"ok" values to configure_simulation. Covers 16 diseases.',
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { disease_name: { type: "string", description: 'Disease name or alias (e.g. "whooping cough").' } },
      required: ["disease_name"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch_demographics",
    description:
      "Fetch real demographics for a country and apply them deterministically.\n\nUses the UN World Population Prospects (live API, offline CSV\nfallback). Automatically applies age structure (switching to an\nage-structured contact network), birth/death rates, and records the\ntotal population for result scaling — you never copy these numbers\nyourself. Switching the network changes the R0 a given beta implies, so\nbeta is back-solved to hold the configured R0; the result reports\napprox_r0 and any literature warnings it now triggers. Call after\nconfigure_simulation, before running.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { country_iso3: { type: "string", description: 'ISO3 country code (e.g. "BRA", "KEN").' } },
      required: ["country_iso3"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch_health_system",
    description:
      "Fetch health-system indicators (World Bank WDI) for a country.\n\nReturns hospital beds, physicians, nurses per 1,000, and UHC\ncoverage. If the simulation has a treatment intervention, its daily\ncapacity is set deterministically from hospital beds scaled to the\nsimulated population. Call after configure_simulation.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { country_iso3: { type: "string", description: 'ISO3 country code (e.g. "BRA").' } },
      required: ["country_iso3"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch_vaccination_coverage",
    description:
      "Fetch reported vaccination coverage (WHO GHO) for a disease/country.\n\nIf no vaccine intervention is configured yet, one is added\ndeterministically at the reported coverage. Only some diseases have\nroutine-immunization indicators; the result says when none exists.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        country_iso3: { type: "string", description: 'ISO3 country code (e.g. "BRA").' },
        disease: { type: "string", description: 'Disease name (e.g. "measles").' },
      },
      required: ["country_iso3", "disease"],
      additionalProperties: false,
    },
  },
  {
    name: "run_simulation",
    description:
      "Run the configured Starsim simulation and return the results.\n\nOnly call this after the configuration is complete and the user has\nconfirmed they want to run. Results are scaled to the real\npopulation when demographics were fetched. The result plot is shown\nto the user automatically.",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

type Entry = { schema: z.ZodType; run: (input: never, deps: ToolDeps) => Promise<ToolOutcome> };

const REGISTRY: Record<string, Entry> = {
  configure_simulation: { schema: ConfigureSimulationInput, run: configureSimulation },
  lookup_disease: { schema: LookupDiseaseInput, run: lookupDisease },
  fetch_demographics: { schema: FetchDemographicsInput, run: fetchDemographics },
  fetch_health_system: { schema: FetchHealthSystemInput, run: fetchHealthSystem },
  fetch_vaccination_coverage: { schema: FetchVaccinationCoverageInput, run: fetchVaccinationCoverage },
  run_simulation: { schema: RunSimulationInput, run: runSimulation },
};

const FAILED = "This tool failed. Tell the user this part is temporarily unavailable.";

/** Validate a tool call from the model and run it, timing it. Never throws. */
export async function executeTool(name: string, input: unknown, deps: ToolDeps, now: () => number = Date.now): Promise<ToolOutcome> {
  const entry = Object.hasOwn(REGISTRY, name) ? REGISTRY[name] : undefined;
  if (!entry) return { content: `Unknown tool "${name}".`, isError: true, payload: { kind: "tool_error", message: `Unknown tool "${name}".` } };
  const parsed = entry.schema.safeParse(input ?? {});
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
    return { content: JSON.stringify({ INVALID_INPUT: problems }), isError: true, payload: { kind: "tool_error", message: problems.join("; ") } };
  }
  const started = now();
  let outcome: ToolOutcome;
  try {
    outcome = await entry.run(parsed.data as never, deps);
  } catch (error) {
    // The model gets the generic line; the stored payload and the function log keep the cause.
    console.error(`tool ${name} threw`, error);
    outcome = { content: FAILED, isError: true, payload: { kind: "tool_error", message: errorMessage(error) } };
  }
  const duration_ms = Math.max(0, now() - started);
  return outcome.payload ? { ...outcome, payload: { ...outcome.payload, duration_ms } } : outcome;
}
