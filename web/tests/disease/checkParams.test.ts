import { describe, expect, it } from "vitest";

import { checkParams } from "@/lib/disease/checkParams";

describe("checkParams", () => {
  it("reproduces the Python warnings", () => {
    expect(checkParams("measles", 100, 8, null)).toEqual([
      "R₀ ≈ 100.0 is outside the literature range for measles (12–18). Source: https://pubmed.ncbi.nlm.nih.gov/28757186/",
    ]);
    expect(checkParams("measles", 15, 30, 20, { pDeath: 0.05, nContacts: 40, durImmune: 10 })).toEqual([
      "Infectious period 30 days is outside the literature range for measles (8–8 days). Source: https://www.cdc.gov/measles/hcp/clinical-overview/index.html",
      "Daily contacts 40 is outside the literature range for measles (0–20). Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC4438575/",
    ]);
    expect(checkParams("dengue", 0.5, 4, 6)).toEqual([
      "R₀ ≈ 0.5 is outside the literature range for dengue (1.0–103.0). Source: https://www.sciencedirect.com/science/article/pii/S0013935120300050",
    ]);
    expect(checkParams("covid19", 3, 7, 5, { pAsymp: 0.99 })).toEqual([
      "R₀ ≈ 3.0 is outside the literature range for covid19 (5.5–24). Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC8992231/#sec3",
      "Asymptomatic fraction 0.99 is outside the literature range for covid19 (20–44 percentage). Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC8403749/",
    ]);
    expect(checkParams("measles", 15, 8, 11, { pDeath: 0.001, nContacts: 6 })).toEqual([
      "Fatality rate 0.1% is outside the literature range for measles (0.5–6.0%). Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC6418190/#ceab10",
    ]);
  });

  it("returns nothing for an unknown disease", () => {
    expect(checkParams("unicorn fever", 100, 8, null)).toEqual([]);
  });
});
