import { z } from "zod";
import { supabaseReportStore, type ReportRow } from "@/lib/db/reports";
import { requireParticipant } from "@/lib/participant.server";
import { renderHtml } from "@/lib/report/html";
import { renderMarkdown } from "@/lib/report/markdown";
import { createSimClient } from "@/lib/sim/client";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const FORMATS = ["md", "html", "docx", "pdf"] as const;
const NOT_FOUND = { code: "not_found", message: "That report is no longer available." };
const BAD_FORMAT = { code: "bad_format", message: "format must be md, html, docx, or pdf." };
const UNAVAILABLE = { code: "export_unavailable", message: "Word and PDF exports are temporarily unavailable. Markdown and HTML still work." };
const CACHE = "private, max-age=3600";

/** "measles-in-kenya-sir-model", at most 60 characters; "report" when nothing is left. */
export function slugOf(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "report";
}

/** One report in one of four formats, for the participant who owns it (report spec, section 11). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "";
  if (!(FORMATS as readonly string[]).includes(format)) return Response.json(BAD_FORMAT, { status: 400 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json(NOT_FOUND, { status: 404 });

  let row: ReportRow | null;
  try {
    row = await supabaseReportStore(adminClient()).get(id);
  } catch (error) {
    console.error("report read failed", error instanceof Error ? error.message : String(error));
    return Response.json({ code: "service_unavailable", message: "Please try again." }, { status: 500 });
  }
  if (!row || row.user_id !== gate.user.id) return Response.json(NOT_FOUND, { status: 404 });

  const name = `${slugOf(row.title)}-v${row.version}`;
  const attachment = (ext: string) => `attachment; filename="${name}.${ext}"`;
  if (format === "md") {
    return new Response(renderMarkdown(row.document), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": attachment("md"), "Cache-Control": CACHE } });
  }
  if (format === "html") {
    const download = url.searchParams.get("download") === "1";
    return new Response(renderHtml(row.document), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": download ? attachment("html") : "inline", "Cache-Control": CACHE },
    });
  }
  const sim = createSimClient({ baseUrl: gate.settings.simInternalUrl, secret: gate.settings.simSharedSecret });
  const result = await sim.export(format as "docx" | "pdf", row.document);
  if (!result.ok) {
    console.error("report export failed", result.kind, result.detail);
    return Response.json(UNAVAILABLE, { status: 503 });
  }
  return new Response(result.bytes as BodyInit, { headers: { "Content-Type": result.contentType, "Content-Disposition": attachment(format), "Cache-Control": CACHE } });
}
