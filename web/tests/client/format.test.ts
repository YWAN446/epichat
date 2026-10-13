import { describe, expect, it } from "vitest";

import { configurationRows, countryName, describeField, effectiveParameterLabel, effectiveParameterRows, formatQuantity, formatRange, interventionLines, parameterLabel, parameterRows, scenarioRows } from "@/lib/client/format";
import { approxR0 } from "@/lib/sim/params";
import { params } from "../tools/helpers";

describe("country names", () => {
  it("turns ISO3 codes into names and leaves unknown codes alone", () => {
    expect(countryName("KEN")).toBe("Kenya");
    expect(countryName("bra")).toBe("Brazil");
    expect(countryName("COD")).toBe("Democratic Republic of the Congo");
    expect(countryName("XXX")).toBe("XXX");
    expect(countryName("")).toBe("");
  });
});

describe("literature parameters", () => {
  it("labels every parameter of the disease database in words", () => {
    expect(parameterLabel("r0")).toBe("R₀");
    expect(parameterLabel("incubation_days")).toBe("Incubation period");
    expect(parameterLabel("infectious_days")).toBe("Infectious period");
    expect(parameterLabel("fatality_rate")).toBe("Case fatality");
    expect(parameterLabel("average_contacts_daily")).toBe("Contacts per day");
    expect(parameterLabel("immunity_duration")).toBe("Immunity duration");
    expect(parameterLabel("asymptomatic_fraction")).toBe("Asymptomatic share");
    expect(parameterLabel("something_new")).toBe("Something new");
  });

  it("writes a value with its unit the way a reader expects", () => {
    expect(formatQuantity(15, "dimensionless")).toBe("15");
    expect(formatQuantity(2.5, undefined)).toBe("2.5");
    expect(formatQuantity(10, "days")).toBe("10 days");
    expect(formatQuantity(1, "days")).toBe("1 day");
    expect(formatQuantity(6, "months")).toBe("6 months");
    expect(formatQuantity(12, "contacts/day")).toBe("12 contacts/day");
    expect(formatQuantity(15, "percentage")).toBe("15%");
    expect(formatQuantity(0.001, "fraction")).toBe("0.1%");
    expect(formatQuantity(0.15, "fraction")).toBe("15%");
    expect(formatQuantity(0.0005, "fraction")).toBe("0.05%");
    expect(formatQuantity(1, "fraction")).toBe("100%");
    expect(formatQuantity(3, "weeks")).toBe("3 weeks");
  });

  it("writes a range once, with the unit at the end", () => {
    expect(formatRange(12, 18, "dimensionless")).toBe("12–18");
    expect(formatRange(7, 21, "days")).toBe("7–21 days");
    expect(formatRange(0.001, 0.003, "fraction")).toBe("0.1–0.3%");
    expect(formatRange(1, 1, "days")).toBe("1 day");
  });
});

describe("applied data fields", () => {
  it("names the demographic fields with their units", () => {
    expect(describeField("birth_rate", 28.3)).toEqual({ label: "Birth rate", value: "28.3 per 1,000 per year" });
    expect(describeField("death_rate", 7.9)).toEqual({ label: "Death rate", value: "7.9 per 1,000 per year" });
    expect(describeField("total_population", 55100586)).toEqual({ label: "Population", value: "55,100,586" });
    expect(describeField("age_structure_pct", { "0-17": 42.13, "18-64": 53.4, "65+": 4.47 })).toEqual({ label: "Age structure", value: "0–17: 42%, 18–64: 53%, 65+: 4%" });
    expect(describeField("network_type", "age_structured")).toEqual({ label: "Contact network", value: "age-structured" });
    expect(describeField("beta_recalibrated_to_hold_r0", 14.9)).toEqual({ label: "Transmission rate recalibrated to hold R₀", value: "14.9" });
  });

  it("names the health-system and vaccination fields", () => {
    expect(describeField("treatment_capacity", 1.4)).toEqual({ label: "Treatment capacity", value: "1.4 per 1,000 people" });
    expect(describeField("applied_treatment_capacity", 14)).toEqual({ label: "Treatment capacity applied", value: "14 agents" });
    expect(describeField("uhc_coverage", 56)).toEqual({ label: "UHC service coverage index", value: "56 of 100" });
    expect(describeField("mcv1_coverage", 89)).toEqual({ label: "Measles, first dose (MCV1) coverage", value: "89%" });
    expect(describeField("mcv2_coverage", 52)).toEqual({ label: "Measles, second dose (MCV2) coverage", value: "52%" });
    expect(describeField("bcg_coverage", 97)).toEqual({ label: "BCG coverage", value: "97%" });
    expect(describeField("yfv_coverage", 80)).toEqual({ label: "Yellow fever coverage", value: "80%" });
    expect(describeField("applied_vaccine_coverage", 0.72)).toEqual({ label: "Vaccine coverage applied", value: "72%" });
    expect(describeField("tb_incidence", 233)).toEqual({ label: "TB incidence", value: "233 per 100,000 per year" });
    expect(describeField("malaria_incidence", 80.2)).toEqual({ label: "Malaria incidence", value: "80.2 per 1,000 at risk per year" });
  });

  it("falls back to the key in words and the raw value", () => {
    expect(describeField("hiv_prevalence", 4.2)).toEqual({ label: "HIV prevalence", value: "4.2" });
    expect(describeField("some_new_thing", true)).toEqual({ label: "Some new thing", value: "True" });
  });
});

describe("parameter rows", () => {
  it("writes the current parameters in words with units, R₀ first", () => {
    const p = params({ disease_type: "seir", beta: 171.09375, n_contacts: 4, init_prev: 0.01, dur_inf: 8, dur_exp: 11, p_death: 0.001, n_agents: 10000, sim_dur_years: 1 });
    expect(parameterRows(p)).toEqual([
      ["R₀ (approx.)", approxR0(p).toFixed(1)],
      ["Transmission rate (β)", "171.1"],
      ["Contacts per day", "4"],
      ["Contact network", "random"],
      ["Initial infections", "1%"],
      ["Infectious period", "8 days"],
      ["Exposed period", "11 days"],
      ["Death probability", "0.1%"],
      ["Agents", "10,000"],
      ["Duration", "1 year"],
      ["Births and deaths", "not modelled"],
    ]);
  });

  it("adds the rows a model or a data step brings: immunity, the asymptomatic share, vital rates, the age structure, the seed", () => {
    const rows = parameterRows(params({
      disease_type: "seiar", dur_exp: 5, dur_immune: 180, p_asymp: 0.3, rel_trans_asymp: 0.5, use_demographics: true, birth_rate: 28.1, death_rate: 7.9,
      network_type: "age_structured", age_pct_under18: 38.6, age_pct_18_64: 57.6, age_pct_over65: 3.8, rand_seed: 42,
    }));
    expect(rows).toContainEqual(["Contact network", "age-structured"]);
    expect(rows).toContainEqual(["Immunity duration", "180 days"]);
    expect(rows).toContainEqual(["Asymptomatic share", "30%"]);
    expect(rows).toContainEqual(["Asymptomatic transmission", "50% of symptomatic"]);
    expect(rows).toContainEqual(["Births and deaths", "28.1 and 7.9 per 1,000 per year"]);
    expect(rows).toContainEqual(["Age structure", "0–17: 39%, 18–64: 58%, 65+: 4%"]);
    expect(rows).toContainEqual(["Random seed", "42"]);
    expect(parameterRows(params({ disease_type: "sir" })).map(([label]) => label)).not.toContain("Asymptomatic share");
    const v2 = params({ schema_version: 2, disease: { dur_inf: { mean_days: 8, dist: "gamma", sd_days: 2.4 }, seed: { mode: "count", value: 20, day: 5 }, initial_immune_frac: 0.4 }, run: { n_replicates: 3 } });
    expect(parameterRows(v2)).toEqual(expect.arrayContaining([["Infectious period", "8 days, gamma (sd 2.4)"], ["Initial infections", "20 agents on day 5"], ["Initially immune", "40%"], ["Replicates", "3"]]));
  });

  it("writes each intervention as one line", () => {
    expect(interventionLines(params({ interventions: [{ type: "vaccine", coverage: 0.72, start_day: 60 }, { type: "treatment", coverage: 1, capacity: 252 }, { type: "seasonality", scale: 0.3 }] }))).toEqual([
      "Vaccination: 72% coverage from day 60",
      "Treatment: 100% coverage, capacity 252 agents",
      "Seasonality: amplitude 0.3, shift 0",
    ]);
    // a vaccine from the start is initial immunity (spec 6.1): a Parameters row, not an intervention line
    const fromStart = params({ interventions: [{ type: "vaccine", coverage: 0.5 }, { type: "treatment", coverage: 0.8 }] });
    expect(interventionLines(fromStart)).toEqual(["Treatment: 80% coverage, no capacity limit"]);
    expect(parameterRows(fromStart)).toContainEqual(["Initially immune", "50%"]);
    expect(interventionLines(params({}))).toEqual([]);
    expect(interventionLines(params({ interventions: [{ type: "vaccine", coverage: 0.8, start_day: 60 }] }))).toEqual(["Vaccination: 80% coverage from day 60"]);
    expect(interventionLines(params({ interventions: [{ type: "vaccine", coverage: 0.5, start_day: 0 }] }))).toEqual([]); // day 0 is initial immunity, never a line
  });
});

describe("effective parameter rows", () => {
  it("lists the v2 paths a run used by their registry labels, skipping unset ones", () => {
    const rows = effectiveParameterRows(params({ disease_type: "seir", dur_exp: 11, rand_seed: 4 }));
    expect(rows).toContainEqual(["Model", "seir"]);
    expect(rows).toContainEqual(["Latent period (mean)", "11"]);
    expect(rows).toContainEqual(["Random seed", "4"]);
    expect(rows).toContainEqual(["Agents", "10,000"]);
    expect(rows.map(([k]) => k)).not.toContain("Immunity duration (mean)");
    expect(rows.map(([k]) => k)).not.toContain("disease.model");
    expect(effectiveParameterLabel("disease.p_death")).toBe("Case fatality ratio");
    expect(effectiveParameterLabel("not.a.path")).toBe("not.a.path");
  });
});

describe("configuration rows", () => {
  it("writes the configuration in words, the same rows the panel shows", () => {
    const config = { disease: "measles", disease_type: "sir", country: "KEN", n_agents: 10000, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] as string[] };
    expect(configurationRows(config, 14.9, "Measles")).toEqual([
      ["Disease", "Measles"], ["Model", "SIR"], ["Country", "Kenya"], ["Agents", "10,000"], ["Duration", "1 year"], ["R₀ (approx.)", "14.9"], ["Infectious period", "8 days"], ["Interventions", "none"],
    ]);
    expect(configurationRows({ ...config, dur_exp: 10, interventions: ["vaccine"] }, 12, "Measles")).toContainEqual(["Exposed period", "10 days"]);
    expect(configurationRows({ ...config, interventions: ["vaccine", "treatment"] }, 12, "Measles")).toContainEqual(["Interventions", "vaccine, treatment"]);
    expect(configurationRows({ ...config, country: null }, 12, "Measles")).toContainEqual(["Country", "—"]);
  });

  it("keeps the panel's Scenario to what is modelled: the values live in Parameters", () => {
    const config = { disease: "measles", disease_type: "seir", country: "KEN", n_agents: 10000, sim_dur_years: 2, dur_inf: 8, dur_exp: 10, interventions: ["vaccine", "treatment"] };
    expect(scenarioRows(config, "Measles")).toEqual([["Disease", "Measles"], ["Model", "SEIR"], ["Country", "Kenya"], ["Duration", "2 years"], ["Interventions", "vaccine, treatment"]]);
    expect(scenarioRows({ ...config, country: null, interventions: [] }, "Measles")).toEqual([["Disease", "Measles"], ["Model", "SEIR"], ["Country", "—"], ["Duration", "2 years"], ["Interventions", "none"]]);
  });
});

describe("parameter rows for the age-specific values", () => {
  it("shows the age multipliers, the fatality by age and the presymptomatic share only when set", () => {
    const plain = parameterRows(params({ schema_version: 2 })).map(([label]) => label);
    expect(plain).not.toContain("Susceptibility by age");
    expect(plain).not.toContain("Fatality by age");
    expect(plain).not.toContain("Presymptomatic transmission");
    const rows = parameterRows(params({ schema_version: 2, disease: { model: "seir", dur_exp: { mean_days: 5 }, p_death: 0.01, rel_sus_age: { children: 1.5, elderly: 0.7 }, p_death_age: { elderly: 0.1 }, rel_trans_exposed: 0.5 } }));
    expect(rows).toContainEqual(["Susceptibility by age", "children ×1.5, adults ×1, elderly ×0.7"]);
    expect(rows).toContainEqual(["Fatality by age", "children 1%, adults 1%, elderly 10%"]);
    expect(rows).toContainEqual(["Presymptomatic transmission", "50% of the infectious value"]);
  });
});

describe("network rows and field labels (Part 2, section 5)", () => {
  it("names the network, its household size, matrix source and contact options", () => {
    const hybrid = params({ disease_type: "sir" });
    hybrid.network = { ...hybrid.network, network_type: "hybrid", household_size: 4.2 };
    const rows = parameterRows(hybrid);
    expect(rows).toContainEqual(["Contact network", "hybrid (households, schools, workplaces, community)"]);
    expect(rows).toContainEqual(["Household size", "4.2 people"]);
    expect(rows.map(([label]) => label)).not.toContain("Contacts per day");
    const aged = params({ disease_type: "sir" });
    aged.network = { ...aged.network, network_type: "age_structured", contacts_source: "prem_2021:KEN" };
    expect(parameterRows(aged)).toContainEqual(["Contact matrix", "Prem 2021, Kenya"]);
    aged.network.contacts_source = "polymod_default";
    expect(parameterRows(aged)).toContainEqual(["Contact matrix", "POLYMOD default (European)"]);
    const lasting = params({ disease_type: "sir" });
    lasting.network = { ...lasting.network, contact_duration_days: 7, contacts_dist: "poisson" };
    expect(parameterRows(lasting)).toContainEqual(["Contact duration", "7 days"]);
    expect(parameterRows(lasting)).toContainEqual(["Contacts distribution", "Poisson"]);
    expect(describeField("household_size", 4.2)).toEqual({ label: "Household size", value: "4.2 people" });
    expect(describeField("contact_matrix", "prem_2021:KEN")).toEqual({ label: "Contact matrix", value: "Prem 2021, Kenya" });
    expect(describeField("beta_calibrated_by_measurement", 31.25)).toEqual({ label: "Transmission rate calibrated to the measured R₀", value: "31.25" });
    expect(describeField("age_source", "un_wpp")).toEqual({ label: "Age source", value: "UN WPP 2024 pyramid" });
  });
});

describe("intervention lines, the fit row and the applied-field labels (Part 2, section 7)", () => {
  it("writes every intervention type as one line", () => {
    const hybrid = params({ schema_version: 2, network: { network_type: "hybrid" }, interventions: [
      { type: "vaccine", kind: "campaign", coverage: 0.7, start_day: 10, end_day: 40, efficacy: 0.8, age_min: 5, age_max: 17, protection_days: 180 },
      { type: "treatment", coverage: 1, capacity: 20, delay_days: 3, efficacy: 0.7, rel_trans_treated: 0.5, symptomatic_only: true },
      { type: "contact_reduction", layer: "school", scale: 1, start_day: 30, end_day: 72 },
      { type: "transmission_reduction", scale: 0.3, start_day: 0, end_day: 90 },
      { type: "seasonality", scale: 0.3 },
    ] });
    expect(interventionLines(hybrid)).toEqual([
      "Vaccination campaign: 70% coverage, days 10\u201340, efficacy 80%, ages 5\u201317, protection 180 days",
      "Treatment: 100% coverage, capacity 20 agents, after 3 days, efficacy 70%, half transmissibility while waiting, symptomatic only",
      "School contacts reduced by 100% from day 30 to day 72",
      "Transmission reduced by 30% from day 0 to day 90",
      "Seasonality: amplitude 0.3, shift 0",
    ]);
    const more = params({ schema_version: 2, network: { network_type: "hybrid" }, interventions: [
      { type: "vaccine", coverage: 0.5, start_day: 30, end_day: 120 },
      { type: "vaccine", kind: "campaign", coverage: 0.88, start_day: 0, end_day: 0, efficacy: 0.93 },   // the database efficacy path
      { type: "treatment", coverage: 0.8, rel_trans_treated: 0.3, start_day: 20 },
      { type: "contact_reduction", layer: "community", scale: 0.5, start_day: 10 },
      { type: "contact_reduction", scale: 0.4, start_day: 0, end_day: 60 },
    ] });
    expect(interventionLines(more)).toEqual([
      "Vaccination: 50% coverage, days 30\u2013120",
      "Vaccination campaign: 88% coverage on day 0, efficacy 93%",
      "Treatment: 80% coverage, no capacity limit, \u00d70.3 transmissibility while waiting, from day 20",
      "Community contacts reduced by 50% from day 10",
      "All contacts reduced by 40% from day 0 to day 60",
    ]);
  });

  it("shows the fit as a row and labels the applied fields", () => {
    const fitted = params({ schema_version: 2, run: { fit: { target: "attack_rate", value: 0.3 } } });
    const rows = parameterRows(fitted);
    expect(rows).toContainEqual(["Fitted to", "attack rate 30% by moving the transmission rate"]);
    expect(rows.map(([label]) => label).indexOf("Fitted to")).toBe(rows.map(([label]) => label).indexOf("Transmission rate (\u03b2)") + 1);
    expect(parameterRows(params({ schema_version: 2, run: { fit: { target: "peak_day", value: 60, lever: "network.network_beta" } } }))).toContainEqual(["Fitted to", "peak day 60 by moving the network multiplier"]);
    expect(parameterRows(params({ schema_version: 2, run: { fit: { target: "peak_infections", value: 500 } } }))).toContainEqual(["Fitted to", "peak infections 500 agents by moving the transmission rate"]);
    expect(parameterRows(params({})).map(([label]) => label)).not.toContain("Fitted to");
    expect(describeField("applied_vaccine_efficacy", 0.93)).toEqual({ label: "Vaccine efficacy applied", value: "93%" });
    expect(describeField("fit", { target: "attack_rate", value: 0.3 })).toEqual({ label: "Fit", value: "attack rate 30%" });
    expect(describeField("fit", { target: "peak_infections", value: 50000, value_in_agents: 500 })).toEqual({ label: "Fit", value: "peak infections 50,000 people (500 agents)" });
    expect(describeField("fit", null)).toEqual({ label: "Fit", value: "cleared" });
    expect(describeField("remove_interventions", ["transmission_reduction", "contact_reduction:school"])).toEqual({ label: "Interventions removed", value: "transmission reduction, contact reduction (school)" });
    expect(describeField("interventions", [{ type: "contact_reduction", layer: "school", scale: 1 }, { type: "vaccine", coverage: 0.7 }])).toEqual({ label: "Interventions set", value: "contact reduction (school), vaccine" });
    expect(describeField("beta_fitted_to_attack_rate", 9.5)).toEqual({ label: "Transmission rate fitted to attack rate", value: "9.5" });
    expect(describeField("network_beta_fitted_to_peak_day", 1.3)).toEqual({ label: "Network multiplier fitted to peak day", value: "1.3" });
  });
});
