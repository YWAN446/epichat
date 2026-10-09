/** A report file fetched for a download: the panel shows the route's message when the sim service cannot render (report spec, section 11). */

export type FetchedReport = { ok: true; blob: Blob; filename: string } | { ok: false; message: string };

const FAILED = "The download failed. Please try again.";

/** The file name the route chose, from Content-Disposition; the format from the URL otherwise. */
function filenameOf(response: Response, url: string): string {
  const match = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
  if (match) return match[1];
  const format = /[?&]format=([a-z]+)/.exec(url)?.[1] ?? "bin";
  return `report.${format}`;
}

export async function fetchReport(url: string, send: typeof fetch = fetch): Promise<FetchedReport> {
  let response: Response;
  try {
    response = await send(url);
  } catch {
    return { ok: false, message: FAILED };
  }
  if (!response.ok) {
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === "string" && body.message) return { ok: false, message: body.message };
    } catch {
      // Not JSON: the plain message below.
    }
    return { ok: false, message: FAILED };
  }
  return { ok: true, blob: await response.blob(), filename: filenameOf(response, url) };
}
