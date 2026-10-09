import { describe, expect, it } from "vitest";

import { configurationRows, countryName, describeField, formatQuantity, formatRange, parameterLabel } from "@/lib/client/format";

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
});
