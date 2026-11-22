import { describe, expect, it } from "vitest";

import { composeReport } from "@/lib/report/compose";
import { narrativeBlocks, type ReportBlock, type ReportDocument } from "@/lib/report/document";
import { escapeHtml, renderHtml } from "@/lib/report/html";
import { FIXTURE } from "./fixture";

const docOf = (blocks: ReportBlock[]): ReportDocument => ({ version: 1, title: "T", subtitle: "S", generatedAt: "2026-11-21T00:00:00Z", language: "en", sections: [{ id: "summary", heading: "Summary", blocks }] });

describe("bold runs in HTML (round-1 UI cleanup)", () => {
  it("renders bold runs as strong, in paragraphs and list items", () => {
    const html = renderHtml(docOf(narrativeBlocks("**Peak:** day 40\n\nOptions:\n- close schools\n- **vaccinate** early")));
    expect(html).toContain("<p><strong>Peak:</strong> day 40</p>");
    expect(html).toContain("<p>Options:</p><ul><li>close schools</li><li><strong>vaccinate</strong> early</li></ul>");
  });

  it("escapes inside runs and leaves a block without runs as it was", () => {
    expect(renderHtml(docOf([{ kind: "paragraph", text: "a <b> & **c**" }]))).toContain("<p>a &lt;b&gt; &amp; **c**</p>");
    expect(renderHtml(docOf([{ kind: "paragraph", text: "x<y", runs: [{ text: "x<y", bold: true }] }]))).toContain("<p><strong>x&lt;y</strong></p>");
  });
});

describe("renderHtml", () => {
  const html = renderHtml(composeReport(FIXTURE, new Date("2026-10-09T15:00:00Z")));

  it("is one self-contained page with the sections, tables, and an inline chart, and no script", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Measles in Kenya, SIR model, 1 year</title>");
    expect(html).toContain("@page");
    expect(html).toContain("<h2>Key results</h2>");
    expect(html).toContain("<th>Attack rate</th>");
    expect(html).toContain("<td>40.0%</td>");
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html.match(/<path /g)).toHaveLength(2);
    expect(html).toContain("<li>Run 2 beats run 1</li>");
    expect(html).toContain("<dt>Country</dt><dd>Kenya</dd>");
    expect(html).toContain('<p class="note">Run 3, no vaccine&#39;s curve is not available.</p>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("href=");
  });

  it("escapes every text node", () => {
    const doc = composeReport({ ...FIXTURE, narrative: { ...FIXTURE.narrative, title: "<script>alert(1)</script> & co", summary: "Tom & Jerry <3" } }, new Date());
    const text = renderHtml(doc);
    expect(text).toContain("<title>&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</title>");
    expect(text).toContain("Tom &amp; Jerry &lt;3");
    expect(text).not.toContain("<script>alert");
    expect(escapeHtml(`"quoted" & 'single'`)).toBe("&quot;quoted&quot; &amp; &#39;single&#39;");
  });
});
