import { z } from "zod";
import { resolved, type ResolvedField } from "@/lib/data/types";
import { unLocationId } from "@/lib/data/unWpp";
import { countryDemographics, sharesFor } from "@/lib/data/countryDemographics";
import { CONTACT_PAIRS, approxR0, recalibrateBeta, validateParams } from "@/lib/sim/params";
import { commaInt, pyRound } from "@/lib/sim/pyformat";
import { detectDisease } from "@/lib/disease/db";
import { NEEDS_CONFIG, errorMessage, errorOutcome, paramWarnings, recordSources } from "./shared";
import { populationView } from "./population";
import { pruneReferences, scenarioReferences, scenarioSources, valueSources } from "./sources";
import { carryOverScenario, type ToolDeps, type ToolOutcome } from "./types";
import { countryName } from "@/lib/client/format";

export const FetchDemographicsInput = z.strictObject({ country_iso3: z.string() });
export type FetchDemographicsArgs = z.infer<typeof FetchDemographicsInput>;

const isRecord = (v: unknown): v is Record<string, number> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Citations of the bundled tables (Part 2, section 10); "bundled" marks them for the parameter sources. */
export const BUNDLED_PYRAMID = "UN World Population Prospects 2024, population by single year of age, medium variant (bundled table)";
export const BUNDLED_HOUSEHOLDS = "UN DESA Population Division, Household Size and Composition 2026 (bundled table)";
export const BUNDLED_MATRICES = "Prem, van Zandvoort et al. 2021, synthetic contact matrices for 177 countries, all locations (bundled table)";

/** Ported from epichat/agent.py fetch_demographics; the CSV fallback is the sim service's route. */
export async function fetchDemographics(input: FetchDemographicsArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome(NEEDS_CONFIG);
  const iso3 = input.country_iso3.trim().toUpperCase();
  try {
    let fields: ResolvedField[] = [];
    let source: "un_wpp" | "sim_fallback" = "un_wpp";
    const locationId = unLocationId(iso3);
    if (locationId) fields = await deps.adapters.unWpp({ source: "un_wpp", indicators: [55, 59, 71, 49], locationId });
    if (fields.length === 0) {
      const demo = await deps.sim.demographicsFallback(iso3);
      if (!demo) throw new Error(`No demographic data found for ${iso3} in UN WPP, WHO Mortality Database, or World Bank Data360`);
      fields = [resolved("birth_rate", demo.birth_rate, demo.source), resolved("death_rate", demo.death_rate, demo.source)];
      source = "sim_fallback";
    }

    const before = scenario.params;
    const r0Before = approxR0(before);
    // round-1 spec 1: a household size set in the conversation stays; the fetch says it kept it
    const userHousehold = valueSources(before, scenario, scenario.disease ?? detectDisease(deps.contextText || ""))["network.household_size"] === "user";
    const base = structuredClone(before) as unknown as Record<string, unknown>;
    const network = base.network as Record<string, unknown>;
    const demographics = base.demographics as Record<string, unknown>;
    const applied: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.field === "age_distribution_pct" && isRecord(f.value)) {
        if (network.network_type === "random") network.network_type = "age_structured";
        demographics.age_pct_under18 = f.value["0-17"];
        demographics.age_pct_18_64 = f.value["18-64"];
        demographics.age_pct_over65 = f.value["65+"];
        applied.age_structure_pct = f.value;
      } else if (f.field === "total_population") {
        scenario.totalPopulation = Math.trunc(Number(f.value));
        applied.total_population = scenario.totalPopulation;
      } else if (f.field === "birth_rate" || f.field === "death_rate") {
        demographics[f.field] = f.value;
        demographics.use_demographics = true;
        applied[f.field] = f.value;
      }
    }
    // Part 2, 5.3, 5.4, 6.1: the bundled tables, so the panel, the R0 and the builder agree on the ages, the household size and the matrix.
    const bundled = countryDemographics(iso3);
    if (bundled) {
      const shares = sharesFor(bundled, Number(demographics.demographics_year ?? 2024));
      if (shares) {
        [demographics.age_pct_under18, demographics.age_pct_18_64, demographics.age_pct_over65] = shares;
        demographics.age_source = "un_wpp";
        if (network.network_type === "random") network.network_type = "age_structured";
        const ages = { "0-17": shares[0], "18-64": shares[1], "65+": shares[2] };
        applied.age_structure_pct = ages;
        applied.age_source = "un_wpp";
        fields = [...fields.filter((f) => f.field !== "age_distribution_pct"), resolved("age_distribution_pct", ages, BUNDLED_PYRAMID)];
      }
      if (bundled.household_size !== null && userHousehold) {
        applied.household_size_kept = network.household_size;
      } else if (bundled.household_size !== null) {
        network.household_size = bundled.household_size;
        applied.household_size = bundled.household_size;
        fields.push(resolved("household_size", bundled.household_size, BUNDLED_HOUSEHOLDS));
      }
      if (bundled.contacts) {
        network.contacts = Object.fromEntries(CONTACT_PAIRS.map((k, i) => [k, bundled.contacts![i]]));
        network.contacts_source = `prem_2021:${iso3}`;
        applied.contact_matrix = `prem_2021:${iso3}`;
        fields.push(resolved("contact_matrix", `prem_2021:${iso3}`, BUNDLED_MATRICES));
      }
    }
    demographics.country = iso3;
    const validated = validateParams(base);
    if (!validated.ok) throw new Error(validated.error);
    let params = validated.params;
    if (params.network.network_type !== before.network.network_type) applied.network_type = params.network.network_type;
    if (Math.abs(approxR0(params) - r0Before) > 1e-9 * Math.max(1, r0Before)) {
      // The network, its matrix or the shares changed what R0 a beta implies; hold the R0 the user confirmed when the new network can carry it.
      const held = recalibrateBeta(params, r0Before, before);
      if (held.disease.beta !== params.disease.beta) {
        params = held;
        applied.beta_recalibrated_to_hold_r0 = pyRound(r0Before, 2);
      } else {
        applied.r0_unreachable_on_new_network = pyRound(r0Before, 2);
      }
    }
    // final review 6: an area belongs to its country; data for another country clears it (a new scenario after a run, as configure does)
    if (scenario.area?.countryIso3 && scenario.area.countryIso3.toUpperCase() !== iso3) {
      if (scenario.hasRun) {
        carryOverScenario(scenario);
        deps.onScenarioStart();
      }
      scenario.area = null;
      applied.area_cleared = true;
    } else if (scenario.area && !scenario.area.countryIso3) {
      scenario.area = { ...scenario.area, countryIso3: iso3 };
    }
    scenario.params = params;
    scenario.countryIso3 = iso3;
    const warnings = paramWarnings(scenario, params, deps.contextText);
    if (scenario.area && scenario.totalPopulation && scenario.area.population > scenario.totalPopulation) {
      warnings.push(`${scenario.area.name}'s population (${commaInt(scenario.area.population)}) is larger than ${countryName(iso3)}'s (${commaInt(scenario.totalPopulation)}); check the figure.`);
    }
    const citations = recordSources(scenario, fields);
    pruneReferences(scenario);                                        // a fetch can change what a chosen reference stood on (the network, say)
    const approx_r0 = pyRound(approxR0(params), 2);
    // round-1 spec 1: the country's total is recorded, and an area's population is what counts are scaled to
    const area = scenario.area ? `Area population kept: ${commaInt(scenario.area.population)} (${scenario.area.name}); counts are scaled to it, not to the country's total.` : undefined;
    return {
      content: JSON.stringify({ applied, approx_r0, warnings, citations, ...(area ? { area } : {}) }),
      payload: { kind: "data", source, iso3, applied, citations, warnings, approx_r0, params, population: populationView(scenario), sources: scenarioSources(scenario, deps.contextText), ...(scenarioReferences(scenario) ? { references: scenarioReferences(scenario) } : {}) },
    };
  } catch (error) {
    return errorOutcome(`FETCH ERROR: ${errorMessage(error)}`);
  }
}
