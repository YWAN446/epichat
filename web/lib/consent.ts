import { readFile } from "node:fs/promises";
import path from "node:path";

export type ConsentText = { version: string; markdown: string };

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split the versioned front matter from the consent text. Throws when the version is missing. */
export function parseConsent(file: string): ConsentText {
  const match = FRONT_MATTER.exec(file);
  const version = match ? /^version:\s*(\S+)\s*$/m.exec(match[1])?.[1] : undefined;
  if (!version) throw new Error("content/consent.md needs a front matter line: version: YYYY-MM-DD");
  return { version, markdown: file.slice(match![0].length).trim() };
}

/** Put the contact address into the text, or a plain phrase when none is configured. */
export function withContact(markdown: string, contactEmail: string): string {
  return markdown.replaceAll("{{contact_email}}", contactEmail || "the research team");
}

let cached: Promise<ConsentText> | null = null;

/** The current consent text, read once per server process. */
export function loadConsent(): Promise<ConsentText> {
  cached ??= readFile(path.join(process.cwd(), "content", "consent.md"), "utf8").then(parseConsent);
  return cached;
}
