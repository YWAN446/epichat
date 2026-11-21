import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Chart } from "@/components/Chart";

describe("the chart draws the replicate band (round-1 spec 5)", () => {
  const series = { day: [0, 1, 2], n_infectious: [5, 9, 4], n_infectious_p10: [4, 6, 2], n_infectious_p90: [7, 20, 8] };
  it("shades the band, names it in the legend, and fits its top", () => {
    const html = renderToStaticMarkup(createElement(Chart, { series, view: "infected", replicates: 3 }));
    expect(html).toContain('data-band="n_infectious"');
    expect(html).toContain("10 to 90% of 3 runs");
    expect(html).toContain(">20<");                                     // the y axis reaches the band's top, not just the line's 9
  });
  it("draws no band without the keys", () => {
    const html = renderToStaticMarkup(createElement(Chart, { series: { day: [0, 1], n_infectious: [1, 2] }, view: "infected" }));
    expect(html).not.toContain("data-band");
    expect(html).not.toContain("10 to 90%");
  });
});
