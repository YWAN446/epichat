const encoder = new TextEncoder();

/** One server-sent event: a `data:` line holding JSON, then a blank line. */
export function encodeEvent(event: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}
