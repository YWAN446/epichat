import { requireParticipant } from "@/lib/participant.server";
import { renderHtml } from "@/lib/report/html";
import { renderMarkdown } from "@/lib/report/markdown";
import { loadRecording } from "@/lib/tutorial/recording";

const NOT_FOUND = { code: "not_found", message: "The practice report is available as HTML or Markdown." };

/** The tutorial's recorded report, rendered by the app's own renderers. Nothing is read from the database. */
export async function GET(request: Request): Promise<Response> {
  const gate = await requireParticipant();
  if (!gate.ok) return gate.response;
  const format = new URL(request.url).searchParams.get("format");
  const recording = loadRecording();
  if (!recording || (format !== "html" && format !== "md")) return Response.json(NOT_FOUND, { status: 404 });
  if (format === "md") return new Response(renderMarkdown(recording.report), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": "inline" } });
  return new Response(renderHtml(recording.report), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": "inline" } });
}
