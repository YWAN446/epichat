import { describe, expect, it } from "vitest";

import { detectDisease, knownDiseases, lookup } from "@/lib/disease/db";

describe("disease database", () => {
  it("lists the sixteen diseases in file order", () => {
    const keys = knownDiseases();
    expect(keys).toHaveLength(16);
    expect(keys.slice(0, 3)).toEqual(["measles", "covid19", "mumps"]);
    expect(keys.at(-1)).toBe("mpox");
  });

  it("looks up by key or alias, case-insensitively", () => {
    expect(lookup("measles")?.key).toBe("measles");
    expect(lookup("  German Measles ")?.key).toBe("rubella");
    expect(lookup("unicorn fever")).toBeNull();
    const measles = lookup("measles")!;
    expect(measles.summaries.r0).toMatchObject({ status: "ok", min: 12, max: 18, typical: 15, n_estimates: 11 });
    expect(measles.summaries.r0?.source).toContain("http");
    expect(measles.flat.r0?.range_text).toBe("12–18");
    expect(measles.summaries.immunity_duration?.status).toBe("estimates_only");
    expect(lookup("dengue")!.summaries.fatality_rate).toBeNull();
  });

  it("detects hyphenated aliases and respects word boundaries", () => {
    const cases: [string, string | null][] = [
      ["german measles outbreak", "rubella"], ["the flu season", "influenza"], ["fluid dynamics", null],
      ["sars-cov-2 wave", "covid19"], ["COVID-19 in Brazil", "covid19"], ["whooping cough", "pertussis"],
      ["nothing here", null], ["tb in india", "tuberculosis"], ["Measles", "measles"],
    ];
    for (const [text, expected] of cases) expect(detectDisease(text), text).toBe(expected);
  });
});
