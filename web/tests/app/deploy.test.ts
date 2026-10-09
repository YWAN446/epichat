import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("deployment files", () => {
  it("the environment example names every setting the loader reads, with the spec's defaults", () => {
    const example = readFileSync(".env.example", "utf8");
    for (const line of [
      "NEXT_PUBLIC_SUPABASE_URL=", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=", "SUPABASE_SECRET_KEY=", "ANTHROPIC_API_KEY=",
      "CHAT_MODEL=claude-opus-5-5", "CHAT_EFFORT=medium", "THINKING_DISPLAY=summarized", "MAX_OUTPUT_TOKENS=16000",
      "MAX_TOOL_ROUNDS=8", "MAX_PAUSE_CONTINUATIONS=5", "MONTHLY_BUDGET_USD=50", "DAILY_TURNS_PER_USER=40",
      "MAX_MESSAGE_CHARS=6000", "ALLOWED_EMAIL_DOMAINS=emory.edu", "RESEARCHER_EMAILS=", "UNLIMITED_EMAILS=",
      "REFUSAL_FALLBACK=1", "CONTACT_EMAIL=", "WEBSITE_URL=", "SIM_INTERNAL_URL=", "SIM_SHARED_SECRET=", "EVAL_BEARER_TOKEN=",
      "CRON_SECRET=", "UN_API_KEY=",
    ]) {
      expect(example).toContain(line);
    }
  });

  it("the deploy document covers the Supabase auth settings the code depends on", () => {
    const doc = readFileSync("docs/DEPLOY.md", "utf8");
    for (const phrase of [
      "Email OTP Length", "{{ .Token }}", "0001_init.sql", "smtp.resend.com", "Site URL", "RESEARCHER_EMAILS", "CRON_SECRET", "delete from",
      "0002_turns.sql", "UN_API_KEY", "ANTHROPIC_API_KEY", "Agent core verification", "0003_recap.sql",
    ]) {
      expect(doc).toContain(phrase);
    }
  });

  it("CI runs the web checks", () => {
    const workflow = readFileSync("../.github/workflows/tests.yml", "utf8");
    expect(workflow).toContain("working-directory: web");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm test");
  });
});
