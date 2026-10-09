import { describe, expect, it, vi } from "vitest";

import { fetchReport, orderFormats } from "@/lib/client/download";

function answering(status: number, body: BodyInit, headers: Record<string, string>) {
  return vi.fn(async () => new Response(body, { status, headers })) as unknown as typeof fetch;
}

describe("fetchReport", () => {
  it("returns the file and the name the server chose", async () => {
    const send = answering(200, new Uint8Array([37, 80, 68, 70]), { "content-type": "application/pdf", "content-disposition": 'attachment; filename="measles-v2.pdf"' });
    const result = await fetchReport("/api/reports/r1?format=pdf", send);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("ok");
    expect(result.filename).toBe("measles-v2.pdf");
    expect(result.blob.type).toBe("application/pdf");
    expect(await result.blob.arrayBuffer()).toEqual(new Uint8Array([37, 80, 68, 70]).buffer);
    expect(send).toHaveBeenCalledWith("/api/reports/r1?format=pdf");
  });

  it("falls back to a name from the URL when the server names none", async () => {
    const send = answering(200, "x", { "content-type": "application/octet-stream" });
    const result = await fetchReport("/api/reports/r1?format=docx", send);
    expect(result).toMatchObject({ ok: true, filename: "report.docx" });
  });

  it("surfaces the server's message on a failure, and a plain one when there is none", async () => {
    const down = answering(503, JSON.stringify({ code: "export_unavailable", message: "Word and PDF exports are temporarily unavailable. Markdown and HTML still work." }), { "content-type": "application/json" });
    expect(await fetchReport("/api/reports/r1?format=pdf", down)).toEqual({ ok: false, message: "Word and PDF exports are temporarily unavailable. Markdown and HTML still work." });
    const html = answering(500, "<html>oops</html>", { "content-type": "text/html" });
    expect(await fetchReport("/api/reports/r1?format=pdf", html)).toEqual({ ok: false, message: "The download failed. Please try again." });
    const offline = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchReport("/api/reports/r1?format=pdf", offline)).toEqual({ ok: false, message: "The download failed. Please try again." });
  });
});

describe("orderFormats", () => {
  it("puts the preferred format first and keeps the rest in order", () => {
    expect(orderFormats("docx")).toEqual(["docx", "md", "html", "pdf"]);
    expect(orderFormats("md")).toEqual(["md", "html", "docx", "pdf"]);
    expect(orderFormats("pdf")).toEqual(["pdf", "md", "html", "docx"]);
  });
});
