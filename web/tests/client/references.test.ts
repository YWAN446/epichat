import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearReferencesCache, loadReferences, referenceButtonLabel, referenceHref, referenceMeta, referenceValue, type Reference } from "@/lib/client/references";

const BODY = { display_name: "Measles", parameters: { r0: { source: "https://pubmed.ncbi.nlm.nih.gov/28757186/", estimates: [{ title: "A review", value: 15 }] } } };

function fakeFetch(status: number, body: unknown = BODY) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
}

describe("loadReferences", () => {
  beforeEach(() => clearReferencesCache());

  it("fetches a disease's references once and shares the result", async () => {
    const send = fakeFetch(200);
    const [a, b] = await Promise.all([loadReferences("measles", send), loadReferences("measles", send)]);
    expect(a).toEqual(BODY);
    expect(b).toBe(a);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("/api/diseases/measles/references");
  });

  it("answers null for a failed or malformed response and forgets it so a retry can succeed", async () => {
    expect(await loadReferences("measles", fakeFetch(404))).toBeNull();
    expect(await loadReferences("measles", fakeFetch(200, { nope: true }))).toBeNull();
    const failing = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await loadReferences("measles", failing)).toBeNull();
    expect(await loadReferences("measles", fakeFetch(200))).toEqual(BODY);
  });
});

describe("one reference, in words", () => {
  const full: Reference = { value: 15, range: [12, 18], year: 2017, country: "Multiple countries", population: "General", source_type: "systematic_review", title: "A review", url: "https://pubmed.ncbi.nlm.nih.gov/28757186/", doi: "10.1016/S1473-3099(17)30307-9", notes: "58 estimates" };

  it("links the URL first, then the DOI, else nothing", () => {
    expect(referenceHref(full)).toBe("https://pubmed.ncbi.nlm.nih.gov/28757186/");
    expect(referenceHref({ ...full, url: undefined })).toBe("https://doi.org/10.1016/S1473-3099(17)30307-9");
    expect(referenceHref({ title: "Unlinked" })).toBeNull();
    expect(referenceHref({ title: "Odd", url: "javascript:alert(1)" })).toBeNull();
    expect(referenceHref({ title: "Odd", doi: "N/A" })).toBeNull();
  });

  it("describes the study in one line and its estimate with the parameter's unit", () => {
    expect(referenceMeta(full)).toBe("2017 · Multiple countries · General · systematic review");
    expect(referenceMeta({ title: "Bare" })).toBe("");
    expect(referenceMeta({ title: "Partial", year: 2001, source_type: "outbreak" })).toBe("2001 · outbreak");
    expect(referenceValue(full, "dimensionless")).toBe("15 (12–18)");
    expect(referenceValue({ title: "Days", value: 10, unit: undefined } as Reference, "days")).toBe("10 days");
    expect(referenceValue({ title: "Range only", range: [0.001, 0.003] }, "fraction")).toBe("0.1–0.3%");
    expect(referenceValue({ title: "Special", special_value: "lifelong" }, "months")).toBe("lifelong");
    expect(referenceValue({ title: "None" }, "days")).toBe("");
    expect(referenceValue({ title: "Case", value: 10, range: [8, 11], metric: "CFR" }, "percentage")).toBe("CFR 10% (8–11%)");
    expect(referenceValue({ title: "Infection", value: 0.27, metric: "IFR" }, "percentage")).toBe("IFR 0.27%");
  });
});

describe("the button that opens the list", () => {
  it("counts the estimates, offers the consensus source alone when there are none, and hides when there is nothing", () => {
    expect(referenceButtonLabel({ n_estimates: 11, source: "https://pubmed.ncbi.nlm.nih.gov/28757186/" })).toBe("11 sources");
    expect(referenceButtonLabel({ n_estimates: 1 })).toBe("1 source");
    expect(referenceButtonLabel({ n_estimates: 0, source: "https://www.cdc.gov/dengue" })).toBe("source");
    expect(referenceButtonLabel({ n_estimates: 0 })).toBeNull();
    expect(referenceButtonLabel({ n_estimates: 0, source: "" })).toBeNull();
  });
});
