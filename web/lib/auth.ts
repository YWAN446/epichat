export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True only when the address's domain is exactly one of the allowed domains. */
export function isAllowedEmail(email: string | null | undefined, domains: string[]): boolean {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return false;
  return domains.includes(normalized.slice(at + 1));
}
