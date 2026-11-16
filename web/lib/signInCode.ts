/** The sign-in code Supabase emails. Its length is set in the project's Auth settings. */
export const SIGN_IN_CODE_LENGTH = 8;

/** Keep the digits of what was typed or pasted, up to the code's length. */
export function tidyCode(typed: string): string {
  return typed.replace(/\D/g, "").slice(0, SIGN_IN_CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return /^\d+$/.test(code) && code.length === SIGN_IN_CODE_LENGTH;
}
