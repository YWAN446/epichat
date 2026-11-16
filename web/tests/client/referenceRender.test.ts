import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReferenceItems } from "@/components/panel/ReferenceList";
import type { ParameterReferences } from "@/lib/client/references";

const param: ParameterReferences = {
  source: "https://pubmed.ncbi.nlm.nih.gov/28757186/",
  estimates: [
    { title: "A systematic review", value: 15, range: [12, 18], year: 2017 },
    { title: "A range only", range: [10, 20], year: 2010 },
    { title: "A second study", value: 14, year: 2019 },
  ],
};
const render = (props: Partial<Parameters<typeof ReferenceItems>[0]>) => renderToStaticMarkup(createElement(ReferenceItems, { param, parameter: "r0", ...props }));

describe("the reference list's Use this value button (follow-up spec 9.2)", () => {
  it("offers one button per estimate that has a single value, and keeps the list's numbering", () => {
    const html = render({ onUse: () => {} });
    expect(html.match(/Use this value/g)).toHaveLength(2);
    expect(html.match(/<li/g)).toHaveLength(3);                                              // the range-only estimate is still number 2
    const second = html.slice(html.indexOf("A range only"), html.indexOf("A second study"));
    expect(second).not.toContain("Use this value");
    expect(html).not.toContain('disabled=""');                                           // enabled: only the class names the disabled style
  });

  it("disables the buttons while a reply streams, and has none without a handler (the share page)", () => {
    expect(render({ onUse: () => {}, busy: true }).match(/disabled=""/g)).toHaveLength(2);
    expect(render({})).not.toContain("Use this value");
    expect(render({})).toContain("A systematic review");
  });
});
