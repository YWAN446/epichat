/** The avatar's letter: the first letter of the email in capitals, or a question mark when there is none. */
export function initialOf(email: string): string {
  const first = email.trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}
