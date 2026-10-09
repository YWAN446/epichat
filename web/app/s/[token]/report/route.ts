import { supabaseShareStore } from "@/lib/db/shares";
import { renderHtml } from "@/lib/report/html";
import { isToken } from "@/lib/share/token";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": "inline", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

/** The report frozen in a share, as the HTML page the report renderer makes (share spec, section 6). Anyone with the link. */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await context.params;
  if (!isToken(token)) return new Response(null, { status: 404 });
  let row;
  try {
    row = await supabaseShareStore(adminClient()).byToken(token);
  } catch (error) {
    console.error("share report read failed", error instanceof Error ? error.message : String(error));
    return new Response(null, { status: 500 });
  }
  if (!row || !row.snapshot.report) return new Response(null, { status: 404 });
  return new Response(renderHtml(row.snapshot.report), { headers: HEADERS });
}
