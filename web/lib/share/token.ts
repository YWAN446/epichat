/** A share's address: 128 random bits as 22 base64url characters (share spec, section 5.2). */
export const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export function newToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function isToken(value: string): boolean {
  return TOKEN.test(value);
}
