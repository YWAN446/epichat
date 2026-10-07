# Web Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `web/` Next.js app with Supabase code sign-in, consent-as-enrollment, the full study database schema, session and client-event capture, a chat shell, a health cron, CI, and a first Vercel deploy, so sub-projects 2–4 only add the simulation service, the agent, and the cards.

**Architecture:** A Next.js 16 App Router app in `web/` in CampusOtter's shape: thin server pages that gate on sign-in and consent, a secret-key Supabase client used only on the server, pure-function logic in `lib/` with vitest unit tests, SQL migrations tested on an in-process Postgres (pglite), and route handlers that accept only fixed zod shapes. Deployed as the single `web` service of the repo-root `vercel.json`.

**Tech Stack:** Next.js 16.3.8, React 19.2, TypeScript 5 strict, Tailwind CSS 4, zod 4, @supabase/ssr + supabase-js, vitest 5, @electric-sql/pglite, Node.js 22, Vercel Hobby, Supabase Free, Resend Free.

**Spec:** `docs/superpowers/specs/2026-10-07-web-agent-architecture-design.md` (sections 6, 7, 9.1 steps 1–2, 9.6, 9.8, 11, 13, 15.1)

## Global Constraints

- Node.js runtime only: never `export const runtime = "edge"`. Next.js 16.3 does not support it.
- Package versions pinned to CampusOtter's known-good set: `next` `16.3.8`, `react`/`react-dom` `19.2.8`, `eslint-config-next` `16.3.8`, `@supabase/ssr` `^0.12.7`, `@supabase/supabase-js` `^2.117.2`, `zod` `^4.6.5`, `vitest` `^5.0.3`, `@electric-sql/pglite` `^0.5.8`, `tailwindcss` `^4`, `typescript` `^5`.
- Every table: row-level security on, no policies; `anon` and `authenticated` revoked; `service_role` granted. The migration must be safe to run twice.
- Sign-in by an emailed 8-digit code only. No sign-in link, no `app/auth/confirm` route, no `emailRedirectTo`.
- Server checks on every protected request: session, `email_confirmed_at`, allowed domain, current consent.
- Consent is enrollment: required to use the app; declining writes only a `consent_declined` step event and signs out. The consent text is versioned; a new version re-prompts.
- `step_events.meta` holds fixed words and numbers only; `/api/event` accepts only the strict zod shapes in `lib/clientEvents.ts`.
- Settings are environment variables with the defaults of spec section 9.6: `CHAT_MODEL=claude-opus-5-5`, `CHAT_EFFORT=medium`, `THINKING_DISPLAY=summarized`, `MAX_OUTPUT_TOKENS=16000`, `MAX_TOOL_ROUNDS=8`, `MAX_PAUSE_CONTINUATIONS=5`, `MONTHLY_BUDGET_USD=50`, `DAILY_TURNS_PER_USER=40`, `MAX_MESSAGE_CHARS=6000`, `ALLOWED_EMAIL_DOMAINS=emory.edu`, `REFUSAL_FALLBACK=1`.
- Product name is "EpiChat". UI copy is English. Palette and fonts are EpiChat's (warm paper, burgundy accent, Newsreader + JetBrains Mono), not CampusOtter's teal.
- No `prefers-color-scheme` block and no unlayered `body` color rule in `globals.css` (CampusOtter's lesson: it made messages unreadable).
- Commands run from `web/` unless a step says otherwise. Use `npm`, Node 22. Python is not involved in this sub-project.

## Review Focus

1. An email typed as ` Student@Emory.EDU ` must sign in and pass the domain check: `isAllowedEmail` normalizes case and whitespace (Task 5 test).
2. A user whose consent is for an older version is sent to `/consent` from every protected page and gets 403 from `/api/event`; they are never treated as enrolled (Task 7 and Task 8 tests).
3. `session_end` arrives through `navigator.sendBeacon` with a `text/plain` body; the event route must parse it regardless of content type (Task 8 test).
4. Two `reserve_turn` calls racing at the daily limit yield exactly one `ok` (Task 4 test with `Promise.all`).
5. Applying `0001_init.sql` twice must not error, because the owner runs it in the SQL editor by hand (Task 4 test).

## File Structure

```
vercel.json                        services (web only) + health cron           [Task 1]
.vercelignore                      keeps Python, docs, worktrees out of uploads [Task 1]
.gitignore                         + node_modules, .next, .vercel               [Task 1]
.github/workflows/tests.yml        + web job                                    [Task 11]
web/package.json … configs         scaffold                                     [Task 1]
web/public/{logo,favicon,…}        brand assets copied from docs/brand          [Task 1]
web/app/globals.css, layout.tsx    palette tokens, fonts, body classes          [Task 1]
web/components/Brand.tsx           logo + name                                  [Task 1]
web/lib/enums.ts                   fixed word lists shared by DB, zod, UI       [Task 2]
web/lib/config.ts                  settings loader                              [Task 2]
web/content/consent.md             versioned consent text                       [Task 3]
web/lib/consent.ts                 front-matter parse, contact substitution     [Task 3]
web/supabase/migrations/0001_init.sql  every table, functions, RLS, grants      [Task 4]
web/tests/db/helpers.ts            pglite with migrations applied               [Task 4]
web/lib/supabase/{server,client,admin,session}.ts, web/proxy.ts                 [Task 5]
web/lib/auth.ts, signInCode.ts, time.ts                                         [Task 5]
web/app/sign-in/page.tsx, components/SignInForm.tsx                             [Task 6]
web/lib/participant.ts             pure gate decision                           [Task 7]
web/lib/participant.server.ts      loads user + profile + consent for pages     [Task 7]
web/lib/profiles.ts, stepEvents.ts                                              [Task 7]
web/app/api/consent/route.ts, app/consent/page.tsx, components/ConsentForm.tsx  [Task 7]
web/lib/clientEvents.ts, sessions.ts, lib/client/track.ts                       [Task 8]
web/app/api/event/route.ts, components/SessionProvider.tsx                      [Task 8]
web/lib/conversations.ts, app/chat/page.tsx, components/ChatShell.tsx           [Task 9]
web/app/page.tsx, app/admin/page.tsx                                            [Task 9]
web/app/api/health/route.ts, lib/usage.ts                                       [Task 10]
web/docs/DEPLOY.md, web/.env.example                                            [Task 11]
```

Tests live under `web/tests/` mirroring `lib/`, `app/`, and `db/`. Route handlers are tested with `vi.mock` on the Supabase modules, as CampusOtter does; SQL is tested on pglite; React components are covered by static source checks and by the logic they delegate to `lib/`.

---

### Task 1: Scaffold the web app and the Vercel project files

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/next.config.ts`, `web/postcss.config.mjs`, `web/eslint.config.mjs`, `web/vitest.config.ts`, `web/.gitignore`
- Create: `web/app/globals.css`, `web/app/layout.tsx`, `web/app/page.tsx` (temporary), `web/components/Brand.tsx`
- Create: `web/public/logo.png`, `web/public/favicon.ico`, `web/public/apple-touch-icon.png`, `web/public/og-image.png` (copies)
- Create: `vercel.json`, `.vercelignore` (repo root)
- Modify: `.gitignore` (repo root)
- Test: `web/tests/app/static.test.ts`

**Interfaces:**
- Produces: the `@/` import alias to `web/`; Tailwind classes `bg-paper`, `bg-paper-2`, `bg-surface`, `text-ink`, `text-ink-soft`, `text-ink-faint`, `border-line`, `bg-accent`, `bg-accent-deep`, `text-accent`, `bg-accent-wash`, `text-warn`, `bg-warn-wash`, `text-warn-ink`, `font-serif`, `font-mono`; `<Brand size="small" | "large" />`.

- [ ] **Step 1: Create the package manifest and tool configs**

`web/package.json`:

```json
{
  "name": "epichat-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/ssr": "^0.12.7",
    "@supabase/supabase-js": "^2.117.2",
    "next": "16.3.8",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "react-markdown": "^10.1.0",
    "remark-gfm": "^4.0.1",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.5.8",
    "@tailwindcss/postcss": "^4",
    "@types/node": "^22.20.5",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.3.8",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vitest": "^5.0.3"
  }
}
```

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "**/*.mts"],
  "exclude": ["node_modules"]
}
```

`web/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    // Every route that reads the consent text (lib/consent.ts) must ship the file.
    "/": ["./content/**/*.md"],
    "/chat": ["./content/**/*.md"],
    "/consent": ["./content/**/*.md"],
    "/admin": ["./content/**/*.md"],
    "/api/consent": ["./content/**/*.md"],
    "/api/event": ["./content/**/*.md"],
  },
};

export default nextConfig;
```

`web/postcss.config.mjs`:

```js
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

`web/eslint.config.mjs`:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
```

`web/vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, "") } },
});
```

`web/.gitignore`:

```
node_modules/
.next/
out/
.vercel
*.tsbuildinfo
next-env.d.ts
.env
.env.*
!.env.example
```

- [ ] **Step 2: Add the repo-root Vercel files and ignore rules**

`vercel.json` (repo root):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "services": {
    "web": { "root": "web" }
  },
  "rewrites": [{ "source": "/(.*)", "destination": { "service": "web" } }],
  "crons": [{ "path": "/api/health", "schedule": "0 9 * * *" }]
}
```

`.vercelignore` (repo root). The leading slash ties each entry to the repo root:

```
# Nothing here is needed to build or run the web service.
/.claude
/.superpowers
/.pytest_cache
/.streamlit
/__pycache__
/docs
/evals
/results
/tests
/templates
/epichat
/scripts
/assets
/EpiChat website
/web/tests
*.pdf
*.mp4
*.txt
*.py
*.log

.env
.env.*
!.env.example
```

Append to the repo-root `.gitignore`:

```
# web app (Next.js)
node_modules/
.next/
.vercel
*.tsbuildinfo
web/next-env.d.ts
```

- [ ] **Step 3: Copy the brand assets**

Run from the repo root (Git Bash):

```bash
mkdir -p web/public
cp docs/brand/epichat-icon.png web/public/logo.png
cp docs/brand/favicon.ico web/public/favicon.ico
cp docs/brand/apple-touch-icon.png web/public/apple-touch-icon.png
cp docs/brand/og-image.png web/public/og-image.png
```

- [ ] **Step 4: Write the stylesheet, layout, Brand, and a temporary home page**

`web/app/globals.css`. The values are the docs site's palette (`docs/styles.css`), so the app and the site match:

```css
@import "tailwindcss";

/* EpiChat: warm academic paper with a burgundy accent. Each name becomes a
   Tailwind class, such as bg-paper or text-accent. */
@theme {
  --color-paper: oklch(0.97 0.012 80);
  --color-paper-2: oklch(0.94 0.015 78);
  --color-surface: #ffffff;
  --color-line: oklch(0.86 0.018 72);
  --color-ink: oklch(0.22 0.02 40);
  --color-ink-soft: oklch(0.38 0.02 45);
  --color-ink-faint: oklch(0.55 0.02 50);
  --color-accent: oklch(0.42 0.12 25);
  --color-accent-deep: oklch(0.32 0.12 25);
  --color-accent-wash: oklch(0.42 0.12 25 / 0.1);
  --color-warn: #bd5210;
  --color-warn-ink: #7a3508;
  --color-warn-wash: #fbeee4;

  --font-serif: var(--font-newsreader), "Source Serif Pro", Georgia, serif;
  --font-mono: var(--font-jetbrains), ui-monospace, Menlo, monospace;
}

/* Page colors come from the classes on <body> in app/layout.tsx. Do not add an
   unlayered body rule or a dark-mode block here: either one overrides those
   classes and leaves light text on light cards. */
@layer base {
  html {
    color-scheme: light;
  }
  :focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
}

/* Tailwind resets list and heading styles; restore them inside rendered markdown. */
.prose-epichat { line-height: 1.6; }
.prose-epichat > :first-child { margin-top: 0; }
.prose-epichat > :last-child { margin-bottom: 0; }
.prose-epichat p { margin: 0.75rem 0; }
.prose-epichat ul { list-style: disc; padding-left: 1.4rem; margin: 0.75rem 0; }
.prose-epichat ol { list-style: decimal; padding-left: 1.4rem; margin: 0.75rem 0; }
.prose-epichat li { margin: 0.3rem 0; }
.prose-epichat h1, .prose-epichat h2, .prose-epichat h3 { font-weight: 600; margin: 1.4rem 0 0.4rem; }
.prose-epichat h1 { font-size: 1.5rem; }
.prose-epichat h2 { font-size: 1.2rem; }
.prose-epichat strong { font-weight: 600; }
.prose-epichat table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.9375rem; }
.prose-epichat th, .prose-epichat td { border-bottom: 1px solid var(--color-line); padding: 0.4rem 0.9rem 0.4rem 0; text-align: left; vertical-align: top; }
```

`web/app/layout.tsx`:

```tsx
import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "EpiChat",
  description: "A conversational AI agent for epidemiological simulation.",
  icons: { icon: "/favicon.ico", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#f8f5ee" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${newsreader.variable} ${jetbrains.variable}`}>
      <body className="bg-paper font-serif text-ink antialiased">{children}</body>
    </html>
  );
}
```

`web/components/Brand.tsx`:

```tsx
import Image from "next/image";

const SIZES = {
  small: { logo: 32, corner: "rounded-lg", name: "text-[1.3rem] max-[349px]:sr-only", gap: "gap-2" },
  large: { logo: 64, corner: "rounded-2xl", name: "text-[2.6rem]", gap: "gap-3.5" },
};

/** The EpiChat mark beside the product name. The name is the page's main heading. */
export function Brand({ size = "small" }: { size?: keyof typeof SIZES }) {
  const { logo, corner, name, gap } = SIZES[size];
  return (
    <div className={`flex items-center ${gap}`}>
      <Image src="/logo.png" alt="" width={logo} height={logo} unoptimized loading="eager" className={corner} />
      <h1 className={`leading-none font-semibold tracking-tight ${name}`}>EpiChat</h1>
    </div>
  );
}
```

`web/app/page.tsx` (temporary; Task 9 replaces it):

```tsx
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function Home() {
  redirect("/sign-in");
}
```

- [ ] **Step 5: Write the failing static test**

`web/tests/app/static.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("page styles", () => {
  const css = readFileSync("app/globals.css", "utf8");

  it("do not switch colors in dark mode or set page colors outside Tailwind's layers", () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).not.toMatch(/^body\s*\{/m);
  });

  it("define EpiChat's palette and fonts, not CampusOtter's", () => {
    expect(css).toContain("--color-accent:");
    expect(css).toContain("--font-newsreader");
    expect(css).not.toContain("--color-river");
  });
});

describe("Vercel project files", () => {
  it("define the web service at web/ with a daily health cron", () => {
    const config = JSON.parse(readFileSync("../vercel.json", "utf8"));
    expect(config.services.web.root).toBe("web");
    expect(config.rewrites).toEqual([{ source: "/(.*)", destination: { service: "web" } }]);
    expect(config.crons).toEqual([{ path: "/api/health", schedule: "0 9 * * *" }]);
  });

  it("keep the Python package and the worktrees out of the upload", () => {
    const ignore = readFileSync("../.vercelignore", "utf8");
    for (const entry of ["/.claude", "/epichat", "/templates", "/docs", "/evals", "/results"]) {
      expect(ignore).toMatch(new RegExp(`^${entry.replace("/", "\\/")}$`, "m"));
    }
  });

  it("ship the brand assets", () => {
    for (const file of ["logo.png", "favicon.ico", "apple-touch-icon.png", "og-image.png"]) {
      expect(existsSync(`public/${file}`)).toBe(true);
    }
  });
});
```

- [ ] **Step 6: Install and run the test**

Run from `web/`:

```bash
npm install
npx vitest run tests/app/static.test.ts
```

Expected: all tests PASS (the files exist from Steps 1–4). `npm install` also writes `package-lock.json`, which is committed.

- [ ] **Step 7: Typecheck and build once**

```bash
npm run typecheck
npm run build
```

Expected: typecheck clean. The build prints the route table with `/` and finishes. The build fetches Google Fonts; if it cannot (no network), note it and move on — Vercel builds have network.

- [ ] **Step 8: Commit**

Run from the repo root:

```bash
git add vercel.json .vercelignore .gitignore web
git commit -m "web: scaffold the Next.js app, brand assets, and Vercel project files"
```

---

### Task 2: Fixed word lists and the settings loader

**Files:**
- Create: `web/lib/enums.ts`, `web/lib/config.ts`
- Test: `web/tests/lib/config.test.ts`

**Interfaces:**
- Produces: `MODEL_IDS`, `ModelId`, `EFFORTS`, `Effort`, `PARTICIPANT_TYPES`, `ParticipantType`, `PARTICIPANT_LABEL`, `STAGES`, `Stage`, `SERVER_EVENT_KINDS`, `CLIENT_EVENT_KINDS`, `STEP_EVENT_KINDS`, `StepEventKind`, `CARD_KINDS`, `CHART_VIEWS`, `EXPORT_FORMATS`, `RATINGS` from `@/lib/enums`.
- Produces: `type Settings`, `loadSettings(env?)`, `settingsFor(settings, email)`, `isResearcher(settings, email)` from `@/lib/config`.

- [ ] **Step 1: Write the enums**

`web/lib/enums.ts`:

```ts
export const MODEL_IDS = ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export const THINKING_DISPLAYS = ["summarized", "omitted"] as const;
export type ThinkingDisplay = (typeof THINKING_DISPLAYS)[number];

export const PARTICIPANT_TYPES = [
  "graduate_student",
  "faculty_or_researcher",
  "public_health_practitioner",
  "other",
] as const;
export type ParticipantType = (typeof PARTICIPANT_TYPES)[number];
export const PARTICIPANT_LABEL: Record<ParticipantType, string> = {
  graduate_student: "Graduate student",
  faculty_or_researcher: "Faculty or researcher",
  public_health_practitioner: "Public health practitioner",
  other: "Other",
};

/** The simulation workflow, in order (spec 10.1). */
export const STAGES = ["understand", "configure", "ground", "run", "interpret"] as const;
export type Stage = (typeof STAGES)[number];

/** Step events the server writes (spec section 7). */
export const SERVER_EVENT_KINDS = [
  "conversation_started",
  "turn",
  "stage_reached",
  "tool_called",
  "tool_failed",
  "run_completed",
  "run_failed",
  "refusal",
  "new_scenario",
  "consent_given",
  "consent_declined",
  "web_search",
  "web_fetch",
] as const;

/** Step events the browser reports through /api/event. */
export const CLIENT_EVENT_KINDS = [
  "session_start",
  "session_end",
  "conversation_opened",
  "conversation_resumed",
  "suggestion_used",
  "card_expanded",
  "chart_view_changed",
  "series_downloaded",
  "export",
  "feedback_given",
  "scenario_panel_opened",
] as const;

export const STEP_EVENT_KINDS = [...SERVER_EVENT_KINDS, ...CLIENT_EVENT_KINDS] as const;
export type StepEventKind = (typeof STEP_EVENT_KINDS)[number];

export const CARD_KINDS = ["disease", "config", "data", "run", "tool_error"] as const;
export const CHART_VIEWS = ["compartments", "incidence", "cumulative", "deaths"] as const;
export const EXPORT_FORMATS = ["pdf", "docx"] as const;
export const RATINGS = ["up", "down"] as const;
```

- [ ] **Step 2: Write the failing settings test**

`web/tests/lib/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isResearcher, loadSettings, settingsFor } from "@/lib/config";

describe("loadSettings", () => {
  it("uses the spec's defaults when nothing is set", () => {
    expect(loadSettings({})).toEqual({
      model: "claude-opus-5-5",
      effort: "medium",
      thinkingDisplay: "summarized",
      maxOutputTokens: 16000,
      maxToolRounds: 8,
      maxPauseContinuations: 5,
      monthlyBudgetUsd: 50,
      dailyTurnsPerUser: 40,
      maxMessageChars: 6000,
      allowedEmailDomains: ["emory.edu"],
      researcherEmails: [],
      unlimitedEmails: [],
      refusalFallback: true,
      contactEmail: "",
      websiteUrl: "https://ywan446.github.io/epichat/",
      simInternalUrl: "",
      simSharedSecret: "",
      evalBearerToken: "",
    });
  });

  it("reads overrides and normalizes the lists", () => {
    const settings = loadSettings({
      CHAT_MODEL: "claude-sonnet-5-5",
      CHAT_EFFORT: "high",
      MONTHLY_BUDGET_USD: "10",
      ALLOWED_EMAIL_DOMAINS: " Emory.edu , example.org ,",
      RESEARCHER_EMAILS: " Yuke.Wang@emory.edu ",
      REFUSAL_FALLBACK: "0",
      CONTACT_EMAIL: "help@example.org",
    });
    expect(settings.model).toBe("claude-sonnet-5-5");
    expect(settings.effort).toBe("high");
    expect(settings.monthlyBudgetUsd).toBe(10);
    expect(settings.allowedEmailDomains).toEqual(["emory.edu", "example.org"]);
    expect(settings.researcherEmails).toEqual(["yuke.wang@emory.edu"]);
    expect(settings.refusalFallback).toBe(false);
    expect(settings.contactEmail).toBe("help@example.org");
  });

  it("treats an empty string as unset", () => {
    expect(loadSettings({ MONTHLY_BUDGET_USD: "" }).monthlyBudgetUsd).toBe(50);
  });

  it("rejects an unknown model or effort and a non-numeric or negative number", () => {
    expect(() => loadSettings({ CHAT_MODEL: "gpt-4" })).toThrow(/CHAT_MODEL/);
    expect(() => loadSettings({ CHAT_EFFORT: "extreme" })).toThrow(/CHAT_EFFORT/);
    expect(() => loadSettings({ MONTHLY_BUDGET_USD: "lots" })).toThrow(/MONTHLY_BUDGET_USD/);
    expect(() => loadSettings({ DAILY_TURNS_PER_USER: "-1" })).toThrow(/DAILY_TURNS_PER_USER/);
  });
});

describe("settingsFor and isResearcher", () => {
  const settings = loadSettings({
    UNLIMITED_EMAILS: "tester@emory.edu",
    RESEARCHER_EMAILS: "pi@emory.edu",
  });

  it("lifts the daily cap for the named test addresses only, never the budget", () => {
    expect(settingsFor(settings, "Tester@EMORY.edu").dailyTurnsPerUser).toBeGreaterThan(100000);
    expect(settingsFor(settings, "student@emory.edu").dailyTurnsPerUser).toBe(40);
    expect(settingsFor(settings, undefined).dailyTurnsPerUser).toBe(40);
    expect(settingsFor(settings, "tester@emory.edu").monthlyBudgetUsd).toBe(50);
  });

  it("recognizes a researcher by email, ignoring case", () => {
    expect(isResearcher(settings, "PI@emory.edu")).toBe(true);
    expect(isResearcher(settings, "student@emory.edu")).toBe(false);
    expect(isResearcher(settings, null)).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

```bash
npx vitest run tests/lib/config.test.ts
```

Expected: FAIL, cannot resolve `@/lib/config`.

- [ ] **Step 4: Write the settings loader**

`web/lib/config.ts`:

```ts
import { EFFORTS, MODEL_IDS, THINKING_DISPLAYS, type Effort, type ModelId, type ThinkingDisplay } from "./enums";

export type Settings = {
  model: ModelId;
  effort: Effort;
  thinkingDisplay: ThinkingDisplay;
  maxOutputTokens: number;
  maxToolRounds: number;
  maxPauseContinuations: number;
  monthlyBudgetUsd: number;
  dailyTurnsPerUser: number;
  maxMessageChars: number;
  allowedEmailDomains: string[];
  /** Addresses that may open the researcher view and the export. */
  researcherEmails: string[];
  /** Addresses with no daily message limit, for testing. The monthly budget still applies. */
  unlimitedEmails: string[];
  refusalFallback: boolean;
  contactEmail: string;
  websiteUrl: string;
  simInternalUrl: string;
  simSharedSecret: string;
  evalBearerToken: string;
};

type Env = Record<string, string | undefined>;

function numberSetting(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be a non-negative number`);
  return value;
}

function choiceSetting<T extends string>(env: Env, key: string, choices: readonly T[], fallback: T): T {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  if (!(choices as readonly string[]).includes(raw)) {
    throw new Error(`${key} must be one of: ${choices.join(", ")}`);
  }
  return raw as T;
}

function listSetting(env: Env, key: string, fallback = ""): string[] {
  return (env[key] || fallback)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function flagSetting(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

export function loadSettings(env: Env = process.env): Settings {
  return {
    model: choiceSetting(env, "CHAT_MODEL", MODEL_IDS, "claude-opus-5-5"),
    effort: choiceSetting(env, "CHAT_EFFORT", EFFORTS, "medium"),
    thinkingDisplay: choiceSetting(env, "THINKING_DISPLAY", THINKING_DISPLAYS, "summarized"),
    maxOutputTokens: numberSetting(env, "MAX_OUTPUT_TOKENS", 16000),
    maxToolRounds: numberSetting(env, "MAX_TOOL_ROUNDS", 8),
    maxPauseContinuations: numberSetting(env, "MAX_PAUSE_CONTINUATIONS", 5),
    monthlyBudgetUsd: numberSetting(env, "MONTHLY_BUDGET_USD", 50),
    dailyTurnsPerUser: numberSetting(env, "DAILY_TURNS_PER_USER", 40),
    maxMessageChars: numberSetting(env, "MAX_MESSAGE_CHARS", 6000),
    allowedEmailDomains: listSetting(env, "ALLOWED_EMAIL_DOMAINS", "emory.edu"),
    researcherEmails: listSetting(env, "RESEARCHER_EMAILS"),
    unlimitedEmails: listSetting(env, "UNLIMITED_EMAILS"),
    refusalFallback: flagSetting(env, "REFUSAL_FALLBACK", true),
    contactEmail: env.CONTACT_EMAIL ?? "",
    websiteUrl: env.WEBSITE_URL || "https://ywan446.github.io/epichat/",
    simInternalUrl: env.SIM_INTERNAL_URL ?? "",
    simSharedSecret: env.SIM_SHARED_SECRET ?? "",
    evalBearerToken: env.EVAL_BEARER_TOKEN ?? "",
  };
}

// Far more than anyone can send in a day. The database still counts each one.
const NO_DAILY_LIMIT = 1_000_000;

function named(list: string[], email: string | null | undefined): boolean {
  return email !== null && email !== undefined && list.includes(email.trim().toLowerCase());
}

/** The settings as they apply to one signed-in person. */
export function settingsFor(settings: Settings, email: string | null | undefined): Settings {
  return named(settings.unlimitedEmails, email) ? { ...settings, dailyTurnsPerUser: NO_DAILY_LIMIT } : settings;
}

export function isResearcher(settings: Settings, email: string | null | undefined): boolean {
  return named(settings.researcherEmails, email);
}
```

- [ ] **Step 5: Run the test and typecheck**

```bash
npx vitest run tests/lib/config.test.ts
npm run typecheck
```

Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add web/lib/enums.ts web/lib/config.ts web/tests/lib/config.test.ts
git commit -m "web: fixed word lists and the settings loader"
```

---

### Task 3: Consent text and its loader

**Files:**
- Create: `web/content/consent.md`, `web/lib/consent.ts`
- Test: `web/tests/lib/consent.test.ts`

**Interfaces:**
- Produces: `type ConsentText = { version: string; markdown: string }`, `parseConsent(file: string): ConsentText`, `withContact(markdown: string, contactEmail: string): string`, `loadConsent(): Promise<ConsentText>` from `@/lib/consent`.

- [ ] **Step 1: Write the consent text**

`web/content/consent.md`. The version is a date; bump it whenever the words change, and every participant is asked again. The owner replaces the draft marker with the IRB-approved wording before participants are invited.

```markdown
---
version: 2026-10-07-draft
---

# Taking part in the EpiChat usability study

EpiChat is a research prototype from Emory University. We are studying how
people use a conversational agent to set up and understand epidemic
simulations, so that we can evaluate and improve it. By using EpiChat you take
part in that study.

## What we collect

- Your email address and the kind of participant you say you are.
- Everything in your conversations: your messages, the assistant's replies,
  the simulation settings and data it fetched, and the results.
- The assistant's summarized reasoning between steps, which you do not see.
- How you use the app: when you sign in, how long you stay, which buttons and
  suggestions you press, which parts of a result you open, how long each step
  took, and the feedback you give on replies.
- Your browser and device type, screen size, language, and time zone.

Your messages are sent to Anthropic's Claude API to produce replies.
Simulation settings are sent to our own simulation service. Public data
sources (United Nations, World Health Organization, World Bank) receive only a
country code.

## How we use and keep it

The research team reads conversations and the usage records to find where the
assistant helps and where it fails, and to improve its behavior. Results are
reported in aggregate or with quotations that do not identify you. The data is
kept for the duration of the study on servers in the United States. Deleting a
conversation in the app hides it from you but keeps it for the study.

## Your choice

Taking part is voluntary. If you do not agree, you cannot use EpiChat, and
nothing about you is kept except that you declined. To withdraw later, or to
ask for your data to be removed, write to {{contact_email}}.
```

- [ ] **Step 2: Write the failing test**

`web/tests/lib/consent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadConsent, parseConsent, withContact } from "@/lib/consent";

describe("parseConsent", () => {
  it("reads the version from the front matter and returns the body", () => {
    const parsed = parseConsent("---\nversion: 2026-10-07\n---\n\n# Title\n\nBody.\n");
    expect(parsed).toEqual({ version: "2026-10-07", markdown: "# Title\n\nBody." });
  });

  it("refuses a file without a version, so a bad edit cannot silently re-enroll nobody", () => {
    expect(() => parseConsent("# Title\n\nBody.")).toThrow(/version/);
    expect(() => parseConsent("---\nversion:\n---\nBody")).toThrow(/version/);
  });
});

describe("withContact", () => {
  it("substitutes the contact address, or a plain phrase when there is none", () => {
    expect(withContact("write to {{contact_email}}.", "pi@emory.edu")).toBe("write to pi@emory.edu.");
    expect(withContact("write to {{contact_email}}.", "")).toBe("write to the research team.");
  });
});

describe("the consent file", () => {
  it("has a dated version and names what the spec says is collected", async () => {
    const consent = await loadConsent();
    expect(consent.version).toMatch(/^\d{4}-\d{2}-\d{2}/);
    const text = consent.markdown;
    for (const phrase of ["email address", "conversations", "summarized reasoning", "feedback", "browser", "Anthropic", "{{contact_email}}", "cannot use EpiChat"]) {
      expect(text).toContain(phrase);
    }
  });
});
```

- [ ] **Step 3: Run it to see it fail**

```bash
npx vitest run tests/lib/consent.test.ts
```

Expected: FAIL, cannot resolve `@/lib/consent`.

- [ ] **Step 4: Write the loader**

`web/lib/consent.ts`:

```ts
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
```

- [ ] **Step 5: Run the test**

```bash
npx vitest run tests/lib/consent.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/content/consent.md web/lib/consent.ts web/tests/lib/consent.test.ts
git commit -m "web: versioned consent text and its loader"
```

---

### Task 4: The database schema

**Files:**
- Create: `web/supabase/migrations/0001_init.sql`
- Create: `web/tests/db/helpers.ts`
- Test: `web/tests/db/schema.test.ts`, `web/tests/db/usage.test.ts`

**Interfaces:**
- Produces: the tables of spec section 7 and the functions `reserve_turn(uuid, date, date, int, numeric) returns text` and `record_usage(uuid, date, int, bigint, bigint, numeric) returns void`.
- Produces: `createTestDb({ roles?: boolean }): Promise<PGlite>` and `applyMigrations(db: PGlite): Promise<void>` from `tests/db/helpers`.

- [ ] **Step 1: Write the pglite helper**

`web/tests/db/helpers.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const FOLDER = "supabase/migrations";

/** Apply every migration in order, as the owner does in the SQL editor. */
export async function applyMigrations(db: PGlite): Promise<void> {
  for (const file of readdirSync(FOLDER).sort()) {
    await db.exec(readFileSync(path.join(FOLDER, file), "utf8"));
  }
}

/**
 * An in-process Postgres with the migration applied. `roles` first creates the
 * role names Supabase provides, so the migration's grants can be checked.
 */
export async function createTestDb(options: { roles?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  if (options.roles) {
    await db.exec("create role anon; create role authenticated; create role service_role;");
  }
  await applyMigrations(db);
  return db;
}
```

- [ ] **Step 2: Write the failing schema tests**

`web/tests/db/schema.test.ts`:

```ts
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { STEP_EVENT_KINDS } from "@/lib/enums";
import { applyMigrations, createTestDb } from "./helpers";

const ALICE = "11111111-1111-1111-1111-111111111111";
const TABLES = [
  "profiles", "sessions", "conversations", "messages", "turns", "turn_events",
  "scenarios", "runs", "feedback", "step_events", "usage_daily",
];

let db: PGlite;

beforeEach(async () => {
  db = await createTestDb();
});

async function newConversation(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into conversations (user_id, title) values ($1, 'Measles in Kenya') returning id",
    [ALICE],
  );
  return rows[0].id;
}

describe("migration", () => {
  it("creates every table and can be applied twice", async () => {
    const { rows } = await db.query<{ relname: string }>(
      "select relname from pg_class where relkind = 'r' and relname = any($1) order by relname",
      [TABLES],
    );
    expect(rows.map((row) => row.relname)).toEqual([...TABLES].sort());
    await expect(applyMigrations(db)).resolves.toBeUndefined();
  });

  it("has row-level security on every table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname = any($1) order by relname",
      [TABLES],
    );
    expect(rows).toEqual([...TABLES].sort().map((relname) => ({ relname, relrowsecurity: true })));
  });

  it("grants the server role what it needs and the browser roles nothing", async () => {
    const secured = await createTestDb({ roles: true });
    const can = async (sql: string, params: string[]) =>
      (await secured.query<{ allowed: boolean }>(`select ${sql} as allowed`, params)).rows[0].allowed;
    for (const table of TABLES) {
      for (const privilege of ["select", "insert", "update", "delete"]) {
        expect(await can("has_table_privilege('service_role', $1, $2)", [table, privilege])).toBe(true);
        expect(await can("has_table_privilege('anon', $1, $2)", [table, privilege])).toBe(false);
        expect(await can("has_table_privilege('authenticated', $1, $2)", [table, privilege])).toBe(false);
      }
    }
    for (const fn of ["record_usage(uuid, date, integer, bigint, bigint, numeric)", "reserve_turn(uuid, date, date, integer, numeric)"]) {
      expect(await can("has_function_privilege('service_role', $1, 'execute')", [fn])).toBe(true);
      expect(await can("has_function_privilege('anon', $1, 'execute')", [fn])).toBe(false);
    }
  });
});

describe("profiles", () => {
  it("keeps one row per user with a fixed participant type", async () => {
    await db.query(
      "insert into profiles (user_id, email, participant_type, consent_version, consented_at) values ($1, 'a@emory.edu', 'graduate_student', '2026-10-07', now())",
      [ALICE],
    );
    await expect(
      db.query("insert into profiles (user_id, email, participant_type) values ($1, 'a@emory.edu', 'student')", [ALICE]),
    ).rejects.toThrow();
  });
});

describe("conversation tree", () => {
  it("numbers messages, turns, and events per conversation and cascades deletes", async () => {
    const conversation = await newConversation();
    await db.query("insert into messages (conversation_id, seq, role, content) values ($1, 1, 'user', '[]'::jsonb)", [conversation]);
    await expect(
      db.query("insert into messages (conversation_id, seq, role, content) values ($1, 1, 'assistant', '[]'::jsonb)", [conversation]),
    ).rejects.toThrow();
    const { rows } = await db.query<{ id: string }>(
      "insert into turns (conversation_id, seq, user_text, stop) values ($1, 1, 'hi', 'end_turn') returning id",
      [conversation],
    );
    await db.query("insert into turn_events (turn_id, seq, kind, payload) values ($1, 1, 'text', '{\"text\":\"hello\"}'::jsonb)", [rows[0].id]);
    await db.query("insert into feedback (user_id, conversation_id, turn_id, rating) values ($1, $2, $3, 'up')", [ALICE, conversation, rows[0].id]);
    await db.query("delete from conversations where id = $1", [conversation]);
    for (const table of ["messages", "turns", "turn_events", "feedback"]) {
      const { rows: left } = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
      expect(left[0].n).toBe(0);
    }
  });

  it("rejects a stop reason, event kind, or rating outside the fixed lists", async () => {
    const conversation = await newConversation();
    await expect(
      db.query("insert into turns (conversation_id, seq, user_text, stop) values ($1, 1, 'hi', 'crashed')", [conversation]),
    ).rejects.toThrow();
    const { rows } = await db.query<{ id: string }>(
      "insert into turns (conversation_id, seq, user_text, stop) values ($1, 1, 'hi', 'end_turn') returning id",
      [conversation],
    );
    await expect(
      db.query("insert into turn_events (turn_id, seq, kind) values ($1, 1, 'image')", [rows[0].id]),
    ).rejects.toThrow();
    await expect(
      db.query("insert into feedback (user_id, conversation_id, turn_id, rating) values ($1, $2, $3, 'meh')", [ALICE, conversation, rows[0].id]),
    ).rejects.toThrow();
  });

  it("points a conversation at its active scenario and clears the pointer when the scenario goes", async () => {
    const conversation = await newConversation();
    const { rows } = await db.query<{ id: string }>(
      "insert into scenarios (conversation_id, seq, params, stage) values ($1, 1, '{}'::jsonb, 'configure') returning id",
      [conversation],
    );
    await db.query("update conversations set active_scenario_id = $1 where id = $2", [rows[0].id, conversation]);
    await db.query("delete from scenarios where id = $1", [rows[0].id]);
    const { rows: after } = await db.query<{ active_scenario_id: string | null }>(
      "select active_scenario_id from conversations where id = $1",
      [conversation],
    );
    expect(after[0].active_scenario_id).toBeNull();
  });
});

describe("step_events", () => {
  it("accepts every kind the app knows and nothing else", async () => {
    for (const kind of STEP_EVENT_KINDS) {
      await db.query("insert into step_events (user_id, kind) values ($1, $2)", [ALICE, kind]);
    }
    await expect(db.query("insert into step_events (user_id, kind) values ($1, 'chat_text')", [ALICE])).rejects.toThrow();
  });
});

describe("sessions", () => {
  it("records a visit with device facts and can be closed", async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into sessions (user_id, user_agent, viewport, language, timezone) values ($1, 'UA', '390x844', 'en-US', 'America/New_York') returning id",
      [ALICE],
    );
    await db.query("update sessions set ended_at = now() where id = $1 and user_id = $2", [rows[0].id, ALICE]);
    const { rows: closed } = await db.query<{ ended: boolean }>("select ended_at is not null as ended from sessions where id = $1", [rows[0].id]);
    expect(closed[0].ended).toBe(true);
  });
});
```

`web/tests/db/usage.test.ts`:

```ts
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";

const ALICE = "11111111-1111-1111-1111-111111111111";
const BEN = "22222222-2222-2222-2222-222222222222";
const DAY = "2026-10-05";
const MONTH_START = "2026-10-01";
const RECORD = "select record_usage($1, $2, $3, $4, $5, $6)";

let db: PGlite;

async function reserve(user: string, limit = 3, budget = 50): Promise<string> {
  const { rows } = await db.query<{ outcome: string }>(
    "select reserve_turn($1, $2, $3, $4, $5) as outcome",
    [user, DAY, MONTH_START, limit, budget],
  );
  return rows[0].outcome;
}

async function row(user: string) {
  const { rows } = await db.query<{ turns: number; input_tokens: number; cost_usd: string }>(
    "select turns, input_tokens, cost_usd from usage_daily where user_id = $1 and day = $2",
    [user, DAY],
  );
  return rows[0] ?? null;
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("reserve_turn", () => {
  it("reserves turns up to the daily limit and then refuses", async () => {
    const outcomes: string[] = [];
    for (let attempt = 0; attempt < 5; attempt++) outcomes.push(await reserve(ALICE));
    expect(outcomes).toEqual(["ok", "ok", "ok", "daily_turns", "daily_turns"]);
    expect((await row(ALICE))?.turns).toBe(3);
  });

  it("lets exactly one of two racing requests through at the limit", async () => {
    await reserve(ALICE, 3);
    await reserve(ALICE, 3);
    const outcomes = await Promise.all([reserve(ALICE, 3), reserve(ALICE, 3)]);
    expect(outcomes.sort()).toEqual(["daily_turns", "ok"]);
    expect((await row(ALICE))?.turns).toBe(3);
  });

  it("counts each user separately", async () => {
    for (let attempt = 0; attempt < 3; attempt++) await reserve(ALICE);
    expect(await reserve(ALICE)).toBe("daily_turns");
    expect(await reserve(BEN)).toBe("ok");
  });

  it("refuses everyone once this month's cost reaches the budget, without counting a turn", async () => {
    await db.query(RECORD, [BEN, "2026-10-02", 0, 0, 0, 50]);
    expect(await reserve(ALICE)).toBe("monthly_budget");
    expect(await row(ALICE)).toBeNull();
  });

  it("ignores cost from before this month", async () => {
    await db.query(RECORD, [BEN, "2026-09-30", 0, 0, 0, 100]);
    expect(await reserve(ALICE)).toBe("ok");
  });

  it("refuses when the daily limit or the budget is zero", async () => {
    expect(await reserve(ALICE, 0)).toBe("daily_turns");
    expect(await reserve(ALICE, 3, 0)).toBe("monthly_budget");
    expect(await row(ALICE)).toBeNull();
  });
});

describe("record_usage", () => {
  it("adds a finished turn's tokens and cost without adding a turn", async () => {
    await reserve(ALICE);
    await db.query(RECORD, [ALICE, DAY, 0, 100, 50, 0.01]);
    await db.query(RECORD, [ALICE, DAY, 0, 200, 70, 0.02]);
    const saved = await row(ALICE);
    expect(saved?.turns).toBe(1);
    expect(Number(saved?.input_tokens)).toBe(300);
    expect(Number(saved?.cost_usd)).toBeCloseTo(0.03, 6);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

```bash
npx vitest run tests/db
```

Expected: FAIL, `supabase/migrations` does not exist (ENOENT).

- [ ] **Step 4: Write the migration**

`web/supabase/migrations/0001_init.sql`:

```sql
-- EpiChat web app schema. Apply once in the Supabase SQL editor; safe to run twice.
-- No policies are created: with row-level security on and no policies, the
-- publishable key can read nothing. Only the secret key (server) has access.

-- Participants. consented_at null = not yet asked. A consent_version older than
-- content/consent.md's version re-prompts. Declining writes no row here.
create table if not exists profiles (
  user_id uuid primary key,
  email text not null,
  participant_type text check (participant_type in (
    'graduate_student', 'faculty_or_researcher', 'public_health_practitioner', 'other')),
  consent_version text,
  consented_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- One browser visit. The client pings last_active_at and closes it on unload.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  started_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  ended_at timestamptz,
  user_agent text,
  viewport text,
  language text,
  timezone text
);
create index if not exists sessions_user_idx on sessions (user_id, started_at);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default '',
  active_scenario_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A participant's "delete" hides the conversation; the study keeps it.
  deleted_at timestamptz
);
create index if not exists conversations_user_idx on conversations (user_id, updated_at desc);

-- The exact Anthropic message list, append-only.
create table if not exists messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  seq int not null,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq)
);

create table if not exists turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  session_id uuid,
  seq int not null,
  user_text text not null,
  started_at timestamptz not null default now(),
  first_token_at timestamptz,
  finished_at timestamptz,
  stop text not null check (stop in (
    'end_turn', 'max_tokens', 'refusal', 'tool_limit', 'empty', 'paused', 'error', 'aborted')),
  refusal_category text,
  model text,
  effort text,
  -- One entry per model call: tokens by kind, stop reason, latency.
  api_calls jsonb not null default '[]',
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_usd numeric(12,6) not null default 0,
  stage_before text,
  stage_after text,
  unique (conversation_id, seq)
);

-- The display stream of a turn, in order, with timestamps. Replaying it
-- rebuilds the conversation on screen, cards included.
create table if not exists turn_events (
  id bigint generated always as identity primary key,
  turn_id uuid not null references turns(id) on delete cascade,
  seq int not null,
  at timestamptz not null default now(),
  kind text not null check (kind in (
    'text', 'thinking', 'tool_use', 'tool_result', 'web_search', 'web_fetch',
    'stage', 'suggestions', 'notice')),
  payload jsonb not null default '{}',
  unique (turn_id, seq)
);

-- The deterministic simulation state; replaces the in-memory agent state.
create table if not exists scenarios (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  seq int not null,
  params jsonb,
  disease text,
  country_iso3 text,
  total_population bigint,
  data_sources jsonb not null default '[]',
  web_sources jsonb not null default '[]',
  stage text check (stage in ('understand', 'configure', 'ground', 'run', 'interpret')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, seq)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_active_scenario_fk') then
    alter table conversations
      add constraint conversations_active_scenario_fk
      foreign key (active_scenario_id) references scenarios(id) on delete set null;
  end if;
end;
$$;

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid references scenarios(id) on delete set null,
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid not null,
  turn_id uuid,
  params jsonb not null,
  effective_params jsonb,
  pop_scale numeric,
  stats jsonb,
  stats_agents jsonb,
  series jsonb,
  warnings jsonb not null default '[]',
  data_sources jsonb not null default '[]',
  repairs jsonb not null default '[]',
  duration_ms int,
  sim_cold_start boolean,
  error jsonb,
  created_at timestamptz not null default now()
);
create index if not exists runs_user_idx on runs (user_id, created_at);

-- Thumbs on an assistant reply, with an optional comment. One row per press.
create table if not exists feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  conversation_id uuid not null references conversations(id) on delete cascade,
  turn_id uuid not null references turns(id) on delete cascade,
  rating text not null check (rating in ('up', 'down')),
  comment text,
  created_at timestamptz not null default now()
);

-- The structured event log for funnels and counts. meta holds fixed words and
-- numbers; free text lives in messages and feedback. Keep the kind list the
-- same as STEP_EVENT_KINDS in web/lib/enums.ts.
create table if not exists step_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  session_id uuid,
  conversation_id uuid,
  turn_id uuid,
  at timestamptz not null default now(),
  kind text not null,
  stage text,
  tool text,
  meta jsonb not null default '{}'
);
alter table step_events drop constraint if exists step_events_kind_check;
alter table step_events add constraint step_events_kind_check check (kind in (
  'conversation_started', 'turn', 'stage_reached', 'tool_called', 'tool_failed',
  'run_completed', 'run_failed', 'refusal', 'new_scenario', 'consent_given',
  'consent_declined', 'web_search', 'web_fetch',
  'session_start', 'session_end', 'conversation_opened', 'conversation_resumed',
  'suggestion_used', 'card_expanded', 'chart_view_changed', 'series_downloaded',
  'export', 'feedback_given', 'scenario_panel_opened'
));
create index if not exists step_events_user_at_idx on step_events (user_id, at);
create index if not exists step_events_conversation_idx on step_events (conversation_id);
create index if not exists step_events_kind_at_idx on step_events (kind, at);

-- Turns, tokens, and cost per user per day (from CampusOtter).
create table if not exists usage_daily (
  user_id uuid not null,
  day date not null,
  turns int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(12,6) not null default 0,
  primary key (user_id, day)
);

alter table profiles enable row level security;
alter table sessions enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table turns enable row level security;
alter table turn_events enable row level security;
alter table scenarios enable row level security;
alter table runs enable row level security;
alter table feedback enable row level security;
alter table step_events enable row level security;
alter table usage_daily enable row level security;

-- Add a finished turn's tokens and cost to the user's row for the day.
create or replace function record_usage(
  p_user uuid, p_day date, p_turns int, p_input bigint, p_output bigint, p_cost numeric
) returns void language sql as $$
  insert into usage_daily (user_id, day, turns, input_tokens, output_tokens, cost_usd)
  values (p_user, p_day, p_turns, p_input, p_output, p_cost)
  on conflict (user_id, day) do update set
    turns = usage_daily.turns + excluded.turns,
    input_tokens = usage_daily.input_tokens + excluded.input_tokens,
    output_tokens = usage_daily.output_tokens + excluded.output_tokens,
    cost_usd = usage_daily.cost_usd + excluded.cost_usd;
$$;

-- Count one turn unless a cap is already reached. Checking and counting happen
-- in one statement, so parallel requests cannot each slip under the daily
-- limit. Returns 'ok', 'monthly_budget', or 'daily_turns'.
create or replace function reserve_turn(
  p_user uuid, p_day date, p_month_start date, p_daily_limit int, p_monthly_budget numeric
) returns text language plpgsql as $$
declare
  spent numeric;
  reserved int;
begin
  select coalesce(sum(u.cost_usd), 0) into spent
  from usage_daily u
  where u.day >= p_month_start;
  if spent >= p_monthly_budget then
    return 'monthly_budget';
  end if;
  if p_daily_limit <= 0 then
    return 'daily_turns';
  end if;

  insert into usage_daily as u (user_id, day, turns)
  values (p_user, p_day, 1)
  on conflict (user_id, day) do update set turns = u.turns + 1
    where u.turns < p_daily_limit
  returning u.turns into reserved;

  if reserved is null then
    return 'daily_turns';
  end if;
  return 'ok';
end;
$$;

-- Privileges. New Supabase projects grant nothing on new public tables by
-- default, so the server's role is granted what it needs here. The browser
-- roles get nothing, and the functions are not callable by them.
revoke execute on function record_usage(uuid, date, int, bigint, bigint, numeric) from public;
revoke execute on function reserve_turn(uuid, date, date, int, numeric) from public;

do $$
declare
  browser_role text;
  tables text := 'profiles, sessions, conversations, messages, turns, turn_events, scenarios, runs, feedback, step_events, usage_daily';
begin
  foreach browser_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = browser_role) then
      execute format('revoke all on %s from %I', tables, browser_role);
      execute format('revoke execute on function record_usage(uuid, date, int, bigint, bigint, numeric) from %I', browser_role);
      execute format('revoke execute on function reserve_turn(uuid, date, date, int, numeric) from %I', browser_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    execute format('grant select, insert, update, delete on %s to service_role', tables);
    grant usage, select on all sequences in schema public to service_role;
    grant execute on function record_usage(uuid, date, int, bigint, bigint, numeric) to service_role;
    grant execute on function reserve_turn(uuid, date, date, int, numeric) to service_role;
  end if;
end;
$$;
```

- [ ] **Step 5: Run the database tests**

```bash
npx vitest run tests/db
```

Expected: PASS. If the racing test is flaky on pglite (it executes statements serially, so both calls still see the row lock order), it must still produce exactly one `ok`; a failure here is a real bug in `reserve_turn`.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/0001_init.sql web/tests/db
git commit -m "web: database schema for participants, conversations, runs, events, and caps"
```

---

### Task 5: Supabase clients, session refresh, and the sign-in helpers

**Files:**
- Create: `web/lib/supabase/server.ts`, `web/lib/supabase/client.ts`, `web/lib/supabase/admin.ts`, `web/lib/supabase/session.ts`, `web/proxy.ts`
- Create: `web/lib/auth.ts`, `web/lib/signInCode.ts`, `web/lib/time.ts`
- Test: `web/tests/lib/auth.test.ts`, `web/tests/lib/signInCode.test.ts`, `web/tests/lib/time.test.ts`, `web/tests/lib/session.test.ts`

**Interfaces:**
- Produces: `createClient()` (server, cookie-bound) from `@/lib/supabase/server`; `createClient()` (browser) from `@/lib/supabase/client`; `adminClient(): SupabaseClient` from `@/lib/supabase/admin`; `updateSession(request: NextRequest): Promise<NextResponse>` and `PROTECTED_PREFIXES` from `@/lib/supabase/session`.
- Produces: `isAllowedEmail(email, domains): boolean`, `normalizeEmail(email): string` from `@/lib/auth`; `SIGN_IN_CODE_LENGTH`, `tidyCode(typed)`, `isCompleteCode(code)` from `@/lib/signInCode`; `easternDay(now)`, `easternMonthStart(now)` from `@/lib/time`.

- [ ] **Step 1: Write the failing tests**

`web/tests/lib/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAllowedEmail, normalizeEmail } from "@/lib/auth";

describe("isAllowedEmail", () => {
  const domains = ["emory.edu", "example.org"];

  it("accepts an allowed domain whatever the case or surrounding spaces", () => {
    expect(isAllowedEmail(" Student@Emory.EDU ", domains)).toBe(true);
    expect(isAllowedEmail("a@example.org", domains)).toBe(true);
  });

  it("rejects other domains, subdomains, lookalikes, and empty values", () => {
    expect(isAllowedEmail("a@gmail.com", domains)).toBe(false);
    expect(isAllowedEmail("a@mail.emory.edu", domains)).toBe(false);
    expect(isAllowedEmail("a@emory.edu.evil.com", domains)).toBe(false);
    expect(isAllowedEmail("emory.edu", domains)).toBe(false);
    expect(isAllowedEmail("", domains)).toBe(false);
    expect(isAllowedEmail(null, domains)).toBe(false);
    expect(isAllowedEmail(undefined, domains)).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail(" Student@Emory.EDU ")).toBe("student@emory.edu");
  });
});
```

`web/tests/lib/signInCode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SIGN_IN_CODE_LENGTH, isCompleteCode, tidyCode } from "@/lib/signInCode";

describe("sign-in code", () => {
  it("is eight digits", () => {
    expect(SIGN_IN_CODE_LENGTH).toBe(8);
  });

  it("keeps only digits from a paste and cuts to the code length", () => {
    expect(tidyCode(" 1234-5678 extra")).toBe("12345678");
    expect(tidyCode("123456789")).toBe("12345678");
    expect(tidyCode("abc")).toBe("");
  });

  it("is complete only at the full length", () => {
    expect(isCompleteCode("12345678")).toBe(true);
    expect(isCompleteCode("1234567")).toBe(false);
    expect(isCompleteCode("1234567a")).toBe(false);
  });
});
```

`web/tests/lib/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { easternDay, easternMonthStart } from "@/lib/time";

describe("Eastern time days", () => {
  it("rolls the day over at midnight Eastern, not UTC", () => {
    // 03:30 UTC on Oct 6 is 23:30 Eastern on Oct 5 (EDT).
    const late = new Date("2026-10-06T03:30:00Z");
    expect(easternDay(late)).toBe("2026-10-05");
    expect(easternMonthStart(late)).toBe("2026-10-01");
    // 04:30 UTC on Nov 1 is 00:30 Eastern on Nov 1 (EDT ends later that day).
    expect(easternDay(new Date("2026-11-01T04:30:00Z"))).toBe("2026-11-01");
    expect(easternMonthStart(new Date("2026-11-01T04:30:00Z"))).toBe("2026-11-01");
  });
});
```

`web/tests/lib/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PROTECTED_PREFIXES, needsSignIn } from "@/lib/supabase/session";

describe("which pages need a signed-in user", () => {
  it("protects the chat, consent, and admin pages and nothing else", () => {
    expect(PROTECTED_PREFIXES).toEqual(["/chat", "/consent", "/admin"]);
    expect(needsSignIn("/chat")).toBe(true);
    expect(needsSignIn("/chat/abc")).toBe(true);
    expect(needsSignIn("/consent")).toBe(true);
    expect(needsSignIn("/admin")).toBe(true);
    expect(needsSignIn("/sign-in")).toBe(false);
    expect(needsSignIn("/")).toBe(false);
    expect(needsSignIn("/chatter")).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
npx vitest run tests/lib/auth.test.ts tests/lib/signInCode.test.ts tests/lib/time.test.ts tests/lib/session.test.ts
```

Expected: FAIL, modules not found.

- [ ] **Step 3: Write the helpers**

`web/lib/auth.ts`:

```ts
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
```

`web/lib/signInCode.ts`:

```ts
/** The sign-in code Supabase emails. Its length is set in the project's Auth settings. */
export const SIGN_IN_CODE_LENGTH = 8;

/** Keep the digits of what was typed or pasted, up to the code's length. */
export function tidyCode(typed: string): string {
  return typed.replace(/\D/g, "").slice(0, SIGN_IN_CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return /^\d+$/.test(code) && code.length === SIGN_IN_CODE_LENGTH;
}
```

`web/lib/time.ts`:

```ts
const ZONE = "America/New_York";

function easternParts(now: Date): { year: string; month: string; day: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return { year: parts.year, month: parts.month, day: parts.day };
}

/** The calendar day in US Eastern time, as YYYY-MM-DD. */
export function easternDay(now: Date): string {
  const { year, month, day } = easternParts(now);
  return `${year}-${month}-${day}`;
}

/** The first day of the current Eastern-time month, as YYYY-MM-01. */
export function easternMonthStart(now: Date): string {
  const { year, month } = easternParts(now);
  return `${year}-${month}-01`;
}
```

`web/lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** The signed-in user's client, bound to the request cookies. Server components and route handlers only. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server components cannot write cookies. proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
```

`web/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
}
```

`web/lib/supabase/admin.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/** Secret-key client. Bypasses row-level security. Never import this from a client component. */
export function adminClient(): SupabaseClient {
  cached ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
```

`web/lib/supabase/session.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Pages a signed-out visitor is sent away from. The consent check itself happens in the pages. */
export const PROTECTED_PREFIXES = ["/chat", "/consent", "/admin"] as const;

export function needsSignIn(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Refresh the session cookie and send signed-out visitors of protected pages to sign in. */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && needsSignIn(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
```

`web/proxy.ts`:

```ts
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|logo.png|apple-touch-icon.png|og-image.png).*)"],
};
```

- [ ] **Step 4: Run the tests and typecheck**

```bash
npx vitest run tests/lib
npm run typecheck
```

Expected: PASS; typecheck clean. If `session.test.ts` fails to import because `next/server` is pulled in, that is expected to work under vitest's node environment; if it does not, move `PROTECTED_PREFIXES` and `needsSignIn` into `web/lib/protectedPaths.ts`, re-export them from `session.ts`, and point the test at the new module.

- [ ] **Step 5: Commit**

```bash
git add web/lib web/proxy.ts web/tests/lib
git commit -m "web: Supabase clients, session refresh, and sign-in helpers"
```

---

### Task 6: The sign-in page

**Files:**
- Create: `web/app/sign-in/page.tsx`, `web/components/SignInForm.tsx`
- Test: `web/tests/app/signIn.test.ts`

**Interfaces:**
- Consumes: `loadSettings`, `isAllowedEmail`, `normalizeEmail`, `SIGN_IN_CODE_LENGTH`, `tidyCode`, `isCompleteCode`, browser `createClient`, `Brand`.
- Produces: `/sign-in` page; `/sign-in?declined=1` shows the declined message.

- [ ] **Step 1: Write the failing static test**

`web/tests/app/signIn.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sign-in by emailed code only", () => {
  const form = readFileSync("components/SignInForm.tsx", "utf8");
  const page = readFileSync("app/sign-in/page.tsx", "utf8");

  it("asks for the eight-digit code and offers no sign-in link", () => {
    expect(form).toContain("eight-digit code");
    expect(form).toContain('type: "email"');
    expect(form).not.toMatch(/emailRedirectTo|magic link|six-digit/i);
  });

  it("has no page for a sign-in link to land on", () => {
    expect(existsSync("app/auth/confirm/route.ts")).toBe(false);
  });

  it("checks the domain in the form and goes to the chat after sign-in", () => {
    expect(form).toContain("isAllowedEmail(");
    expect(form).toContain('router.replace("/chat")');
  });

  it("tells a visitor who declined consent how to reach the team, and points to the study description", () => {
    expect(page).toContain("declined");
    expect(page).toContain("settings.contactEmail");
    expect(page).toContain("usability study");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run tests/app/signIn.test.ts
```

Expected: FAIL, files do not exist.

- [ ] **Step 3: Write the form and the page**

`web/components/SignInForm.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { isAllowedEmail, normalizeEmail } from "@/lib/auth";
import { SIGN_IN_CODE_LENGTH, isCompleteCode, tidyCode } from "@/lib/signInCode";
import { createClient } from "@/lib/supabase/client";

const INPUT = "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 focus-visible:border-accent";
const BUTTON = "rounded-full bg-accent px-5 py-2.5 font-semibold text-white hover:bg-accent-deep disabled:bg-line disabled:text-ink-faint";
const ERROR = "rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2.5 text-sm text-warn-ink";

export function SignInForm({ domains }: { domains: string[] }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    const address = normalizeEmail(email);
    if (!isAllowedEmail(address, domains)) {
      setError(`Use your @${domains[0]} address.`);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: problem } = await createClient().auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (problem) {
      setError("We could not send the code. Wait a minute and try again.");
      return;
    }
    setEmail(address);
    setCode("");
    setStep("code");
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: problem } = await createClient().auth.verifyOtp({ email, token: code, type: "email" });
    setBusy(false);
    if (problem) {
      setError("That code did not work. Check it, or go back and ask for a new one.");
      return;
    }
    router.replace("/chat");
  }

  if (step === "email") {
    return (
      <form onSubmit={requestCode} className="flex flex-col gap-2.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email address
        </label>
        <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
        <button type="submit" disabled={busy} className={BUTTON}>
          {busy ? "Sending…" : "Email me a sign-in code"}
        </button>
        {error && <p role="alert" className={ERROR}>{error}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={verifyCode} className="flex flex-col gap-2.5">
      <p className="mb-2">
        We sent an eight-digit code to <span className="font-medium">{email}</span>. It can take a minute to arrive.
      </p>
      <label htmlFor="code" className="text-sm font-medium">
        Sign-in code
      </label>
      <input
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        maxLength={SIGN_IN_CODE_LENGTH + 3}
        placeholder="8 digits"
        value={code}
        onChange={(e) => setCode(tidyCode(e.target.value))}
        className={`${INPUT} font-mono tracking-[0.3em] placeholder:tracking-normal`}
      />
      <button type="submit" disabled={busy || !isCompleteCode(code)} className={BUTTON}>
        {busy ? "Checking…" : "Sign in"}
      </button>
      <button type="button" onClick={() => setStep("email")} className="mt-1 w-fit rounded text-left text-sm text-accent underline underline-offset-2">
        Use a different address or send a new code
      </button>
      {error && <p role="alert" className={ERROR}>{error}</p>}
    </form>
  );
}
```

`web/app/sign-in/page.tsx`:

```tsx
import { Brand } from "@/components/Brand";
import { SignInForm } from "@/components/SignInForm";
import { loadSettings } from "@/lib/config";

type Props = { searchParams: Promise<{ declined?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const settings = loadSettings();
  const { declined } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Brand size="large" />
      <p className="mt-5 text-lg text-ink-soft">
        Ask an epidemiological question in plain language and get a validated Starsim simulation,
        grounded in real data. A research prototype from Emory University.
      </p>

      {declined && (
        <p className="mt-6 rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2.5 text-sm text-warn-ink">
          You declined to take part in the study, so you were signed out. EpiChat is only available to
          study participants. Questions:{" "}
          {settings.contactEmail ? (
            <a className="underline underline-offset-2" href={`mailto:${settings.contactEmail}`}>
              {settings.contactEmail}
            </a>
          ) : (
            "the research team"
          )}
          .
        </p>
      )}

      <div className="mt-9">
        <SignInForm domains={settings.allowedEmailDomains} />
      </div>

      <section className="mt-12 border-t border-line pt-5 text-sm text-ink-soft">
        <h2 className="font-semibold text-ink">About this study</h2>
        <p className="mt-1.5 leading-relaxed">
          EpiChat is part of a usability study. After you sign in for the first time you will read what the
          study collects, which includes your conversations and how you use the app, and decide whether to
          take part. Using EpiChat requires taking part.
        </p>
        {settings.contactEmail && (
          <p className="mt-3 leading-relaxed">
            Questions:{" "}
            <a className="text-accent underline underline-offset-2" href={`mailto:${settings.contactEmail}`}>
              {settings.contactEmail}
            </a>
          </p>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run the test, typecheck, lint**

```bash
npx vitest run tests/app/signIn.test.ts
npm run typecheck
npm run lint
```

Expected: PASS; both clean.

- [ ] **Step 5: Commit**

```bash
git add web/app/sign-in web/components/SignInForm.tsx web/tests/app/signIn.test.ts
git commit -m "web: sign-in page with emailed eight-digit code"
```

---

### Task 7: Consent as enrollment

**Files:**
- Create: `web/lib/participant.ts`, `web/lib/participant.server.ts`, `web/lib/profiles.ts`, `web/lib/stepEvents.ts`
- Create: `web/app/api/consent/route.ts`, `web/app/consent/page.tsx`, `web/components/ConsentForm.tsx`
- Create: `web/tests/helpers/fakeAdmin.ts`
- Test: `web/tests/lib/participant.test.ts`, `web/tests/lib/profiles.test.ts`, `web/tests/lib/stepEvents.test.ts`, `web/tests/api/consentRoute.test.ts`

**Interfaces:**
- Produces: `type ParticipantStatus = "sign_in" | "forbidden" | "consent" | "ok"`, `participantStatus(user, profile, settings, currentVersion)` from `@/lib/participant`.
- Produces: `loadParticipant(): Promise<{ status, user, profile, settings, consent }>` from `@/lib/participant.server` (server only).
- Produces: `type Profile`, `interface ProfileStore { get(userId); recordConsent(userId, email, participantType, version, now); touch(userId, now) }`, `supabaseProfileStore(admin)` from `@/lib/profiles`.
- Produces: `type StepEvent`, `interface StepEventSink { log(userId, events) }`, `supabaseStepEventSink(admin)` from `@/lib/stepEvents`.
- Produces: `fakeAdmin(results?)` test helper recording `{ table, calls }` from `tests/helpers/fakeAdmin`.

- [ ] **Step 1: Write the fake Supabase admin client for tests**

`web/tests/helpers/fakeAdmin.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type Recorded = { table: string; calls: [string, unknown[]][] };
export type Outcome = { data?: unknown; error?: { message: string } | null; count?: number | null };

/**
 * A stand-in for the secret-key client. Every call on a query builder is
 * recorded; awaiting the builder resolves to the next outcome for that table
 * (or `{ data: null, error: null }`). Enough for the thin stores in lib/.
 */
export function fakeAdmin(outcomes: Record<string, Outcome[]> = {}) {
  const recorded: Recorded[] = [];
  const rpcCalls: [string, unknown][] = [];
  const queue = Object.fromEntries(Object.entries(outcomes).map(([table, list]) => [table, [...list]]));

  function builder(table: string) {
    const entry: Recorded = { table, calls: [] };
    recorded.push(entry);
    const outcome = () => queue[table]?.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {
      then(resolve: (value: Outcome) => void, reject?: (reason: unknown) => void) {
        return Promise.resolve({ error: null, ...outcome() }).then(resolve, reject);
      },
    };
    for (const method of ["insert", "upsert", "update", "delete", "select", "eq", "is", "order", "limit", "single", "maybeSingle"]) {
      chain[method] = (...args: unknown[]) => {
        entry.calls.push([method, args]);
        return chain;
      };
    }
    return chain;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async (name: string, params: unknown) => {
      rpcCalls.push([name, params]);
      return { error: null, ...(queue[`rpc:${name}`]?.shift() ?? { data: null }) };
    },
  } as unknown as SupabaseClient;

  return { client, recorded, rpcCalls };
}

/** The arguments of the first call of `method` on `table`, or undefined. */
export function callOn(recorded: Recorded[], table: string, method: string): unknown[] | undefined {
  return recorded.find((r) => r.table === table)?.calls.find(([m]) => m === method)?.[1];
}
```

- [ ] **Step 2: Write the failing tests for the pure gate and the stores**

`web/tests/lib/participant.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadSettings } from "@/lib/config";
import { participantStatus } from "@/lib/participant";

const settings = loadSettings({});
const user = { id: "u1", email: "student@emory.edu", email_confirmed_at: "2026-10-01T00:00:00Z" };
const enrolled = { consent_version: "2026-10-07", consented_at: "2026-10-02T00:00:00Z" };

describe("participantStatus", () => {
  it("sends a signed-out visitor to sign in", () => {
    expect(participantStatus(null, null, settings, "2026-10-07")).toBe("sign_in");
  });

  it("forbids an unconfirmed address or a domain that is not allowed", () => {
    expect(participantStatus({ ...user, email_confirmed_at: null }, enrolled, settings, "2026-10-07")).toBe("forbidden");
    expect(participantStatus({ ...user, email: "a@gmail.com" }, enrolled, settings, "2026-10-07")).toBe("forbidden");
  });

  it("asks for consent when there is no profile, no consent, or consent to an older text", () => {
    expect(participantStatus(user, null, settings, "2026-10-07")).toBe("consent");
    expect(participantStatus(user, { consent_version: null, consented_at: null }, settings, "2026-10-07")).toBe("consent");
    expect(participantStatus(user, { ...enrolled, consent_version: "2026-09-01" }, settings, "2026-10-07")).toBe("consent");
  });

  it("admits a confirmed, allowed, currently consented user", () => {
    expect(participantStatus(user, enrolled, settings, "2026-10-07")).toBe("ok");
  });
});
```

`web/tests/lib/profiles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { supabaseProfileStore } from "@/lib/profiles";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-07T15:00:00Z");

describe("supabaseProfileStore", () => {
  it("reads one profile by user id and maps the columns", async () => {
    const { client, recorded } = fakeAdmin({
      profiles: [{ data: { user_id: USER, email: "a@emory.edu", participant_type: "other", consent_version: "v1", consented_at: "2026-10-02T00:00:00Z" } }],
    });
    const profile = await supabaseProfileStore(client).get(USER);
    expect(profile).toEqual({ userId: USER, email: "a@emory.edu", participantType: "other", consentVersion: "v1", consentedAt: "2026-10-02T00:00:00Z" });
    expect(callOn(recorded, "profiles", "eq")).toEqual(["user_id", USER]);
    expect(callOn(recorded, "profiles", "maybeSingle")).toEqual([]);
  });

  it("returns null when there is no row and throws when the database errors", async () => {
    expect(await supabaseProfileStore(fakeAdmin().client).get(USER)).toBeNull();
    const failing = fakeAdmin({ profiles: [{ data: null, error: { message: "down" } }] });
    await expect(supabaseProfileStore(failing.client).get(USER)).rejects.toThrow(/down/);
  });

  it("records consent as an upsert on the user id", async () => {
    const { client, recorded } = fakeAdmin();
    await supabaseProfileStore(client).recordConsent(USER, "a@emory.edu", "graduate_student", "2026-10-07", NOW);
    expect(callOn(recorded, "profiles", "upsert")).toEqual([
      {
        user_id: USER,
        email: "a@emory.edu",
        participant_type: "graduate_student",
        consent_version: "2026-10-07",
        consented_at: NOW.toISOString(),
        last_seen_at: NOW.toISOString(),
      },
      { onConflict: "user_id" },
    ]);
  });

  it("touches last_seen_at", async () => {
    const { client, recorded } = fakeAdmin();
    await supabaseProfileStore(client).touch(USER, NOW);
    expect(callOn(recorded, "profiles", "update")).toEqual([{ last_seen_at: NOW.toISOString() }]);
    expect(callOn(recorded, "profiles", "eq")).toEqual(["user_id", USER]);
  });
});
```

`web/tests/lib/stepEvents.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { supabaseStepEventSink } from "@/lib/stepEvents";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";
const SESSION = "44444444-4444-4444-8444-444444444444";

describe("supabaseStepEventSink", () => {
  it("inserts one row per event with fixed columns and an empty meta by default", async () => {
    const { client, recorded } = fakeAdmin();
    await supabaseStepEventSink(client).log(USER, [
      { kind: "consent_given", meta: { participant_type: "other", version: "v1" } },
      { kind: "session_start", sessionId: SESSION },
    ]);
    expect(callOn(recorded, "step_events", "insert")).toEqual([
      [
        { user_id: USER, session_id: null, conversation_id: null, turn_id: null, kind: "consent_given", stage: null, tool: null, meta: { participant_type: "other", version: "v1" } },
        { user_id: USER, session_id: SESSION, conversation_id: null, turn_id: null, kind: "session_start", stage: null, tool: null, meta: {} },
      ],
    ]);
  });

  it("does nothing for an empty list and never throws on a database error", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, recorded } = fakeAdmin({ step_events: [{ error: { message: "down" } }] });
    const sink = supabaseStepEventSink(client);
    await sink.log(USER, []);
    expect(recorded).toEqual([]);
    await expect(sink.log(USER, [{ kind: "turn" }])).resolves.toBeUndefined();
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

```bash
npx vitest run tests/lib/participant.test.ts tests/lib/profiles.test.ts tests/lib/stepEvents.test.ts
```

Expected: FAIL, modules not found.

- [ ] **Step 4: Write the gate and the stores**

`web/lib/participant.ts`:

```ts
import { isAllowedEmail } from "./auth";
import type { Settings } from "./config";

export type ParticipantStatus = "sign_in" | "forbidden" | "consent" | "ok";

export type AuthUserLike = { id: string; email?: string | null; email_confirmed_at?: string | null } | null;
export type ConsentLike = { consent_version: string | null; consented_at: string | null } | null;

/**
 * Where a visitor stands. The pages redirect on anything but "ok", and the
 * API routes refuse. Consent to an older text counts as no consent.
 */
export function participantStatus(
  user: AuthUserLike,
  profile: ConsentLike,
  settings: Pick<Settings, "allowedEmailDomains">,
  currentVersion: string,
): ParticipantStatus {
  if (!user) return "sign_in";
  if (!user.email_confirmed_at || !isAllowedEmail(user.email, settings.allowedEmailDomains)) return "forbidden";
  if (!profile || !profile.consented_at || profile.consent_version !== currentVersion) return "consent";
  return "ok";
}
```

`web/lib/profiles.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParticipantType } from "./enums";

export type Profile = {
  userId: string;
  email: string;
  participantType: ParticipantType | null;
  consentVersion: string | null;
  consentedAt: string | null;
};

export interface ProfileStore {
  get(userId: string): Promise<Profile | null>;
  recordConsent(userId: string, email: string, participantType: ParticipantType, version: string, now: Date): Promise<void>;
  touch(userId: string, now: Date): Promise<void>;
}

type Row = {
  user_id: string;
  email: string;
  participant_type: ParticipantType | null;
  consent_version: string | null;
  consented_at: string | null;
};

export function supabaseProfileStore(admin: SupabaseClient): ProfileStore {
  return {
    async get(userId) {
      const { data, error } = await admin
        .from("profiles")
        .select("user_id, email, participant_type, consent_version, consented_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`profiles read failed: ${error.message}`);
      if (!data) return null;
      const row = data as Row;
      return {
        userId: row.user_id,
        email: row.email,
        participantType: row.participant_type,
        consentVersion: row.consent_version,
        consentedAt: row.consented_at,
      };
    },

    async recordConsent(userId, email, participantType, version, now) {
      const { error } = await admin.from("profiles").upsert(
        {
          user_id: userId,
          email,
          participant_type: participantType,
          consent_version: version,
          consented_at: now.toISOString(),
          last_seen_at: now.toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(`profiles upsert failed: ${error.message}`);
    },

    async touch(userId, now) {
      const { error } = await admin.from("profiles").update({ last_seen_at: now.toISOString() }).eq("user_id", userId);
      if (error) throw new Error(`profiles touch failed: ${error.message}`);
    },
  };
}
```

`web/lib/stepEvents.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Stage, StepEventKind } from "./enums";

/** A countable thing that happened. `meta` holds fixed words and numbers, never typed text. */
export type StepEvent = {
  kind: StepEventKind;
  sessionId?: string | null;
  conversationId?: string | null;
  turnId?: string | null;
  stage?: Stage | null;
  tool?: string | null;
  meta?: Record<string, string | number | boolean | null>;
};

export interface StepEventSink {
  /** Never throws: tracking must not get in a participant's way. */
  log(userId: string, events: StepEvent[]): Promise<void>;
}

export function supabaseStepEventSink(admin: SupabaseClient): StepEventSink {
  return {
    async log(userId, events) {
      if (events.length === 0) return;
      const rows = events.map((event) => ({
        user_id: userId,
        session_id: event.sessionId ?? null,
        conversation_id: event.conversationId ?? null,
        turn_id: event.turnId ?? null,
        kind: event.kind,
        stage: event.stage ?? null,
        tool: event.tool ?? null,
        meta: event.meta ?? {},
      }));
      const { error } = await admin.from("step_events").insert(rows);
      if (error) console.error(`step_events insert failed: ${error.message}`);
    },
  };
}
```

- [ ] **Step 5: Run the store tests**

```bash
npx vitest run tests/lib/participant.test.ts tests/lib/profiles.test.ts tests/lib/stepEvents.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write the failing route test**

`web/tests/api/consentRoute.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/consent", () => ({ loadConsent: vi.fn(async () => ({ version: "2026-10-07", markdown: "" })) }));

import { POST } from "@/app/api/consent/route";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";
let admin: ReturnType<typeof fakeAdmin>;
let signOut: ReturnType<typeof vi.fn>;

function signedInAs(email: string | null) {
  signOut = vi.fn(async () => ({ error: null }));
  const user = email === null ? null : { id: USER, email, email_confirmed_at: "2026-10-01T12:00:00Z" };
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }), signOut } } as never);
}

function post(body: unknown) {
  return POST(new Request("http://localhost/api/consent", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
}

describe("POST /api/consent", () => {
  beforeEach(() => {
    admin = fakeAdmin();
    vi.mocked(adminClient).mockReturnValue(admin.client);
  });

  it("records agreement with the participant type and the current version, and logs the event", async () => {
    signedInAs("student@emory.edu");
    const response = await post({ decision: "agree", participantType: "graduate_student" });
    expect(response.status).toBe(204);
    const upsert = callOn(admin.recorded, "profiles", "upsert")?.[0] as Record<string, unknown>;
    expect(upsert).toMatchObject({ user_id: USER, email: "student@emory.edu", participant_type: "graduate_student", consent_version: "2026-10-07" });
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "consent_given", meta: { participant_type: "graduate_student", version: "2026-10-07" } });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("on decline logs only the event and signs the user out", async () => {
    signedInAs("student@emory.edu");
    const response = await post({ decision: "decline" });
    expect(response.status).toBe(204);
    expect(callOn(admin.recorded, "profiles", "upsert")).toBeUndefined();
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "consent_declined", meta: { version: "2026-10-07" } });
    expect(signOut).toHaveBeenCalled();
  });

  it("turns away a signed-out request, a disallowed address, and a malformed body", async () => {
    signedInAs(null);
    expect((await post({ decision: "agree", participantType: "other" })).status).toBe(401);
    signedInAs("someone@gmail.com");
    expect((await post({ decision: "agree", participantType: "other" })).status).toBe(403);
    signedInAs("student@emory.edu");
    expect((await post({ decision: "agree" })).status).toBe(400);
    expect((await post({ decision: "agree", participantType: "student" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(admin.recorded).toEqual([]);
  });
});
```

- [ ] **Step 7: Run it to see it fail**

```bash
npx vitest run tests/api/consentRoute.test.ts
```

Expected: FAIL, route module not found.

- [ ] **Step 8: Write the route, the server loader, the form, and the page**

`web/app/api/consent/route.ts`:

```ts
import { z } from "zod";
import { isAllowedEmail, normalizeEmail } from "@/lib/auth";
import { loadConsent } from "@/lib/consent";
import { loadSettings } from "@/lib/config";
import { PARTICIPANT_TYPES } from "@/lib/enums";
import { supabaseProfileStore } from "@/lib/profiles";
import { supabaseStepEventSink } from "@/lib/stepEvents";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const Decision = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("agree"), participantType: z.enum(PARTICIPANT_TYPES) }),
  z.strictObject({ decision: z.literal("decline") }),
]);

/** Enroll the signed-in user, or record that they declined and sign them out. */
export async function POST(request: Request): Promise<Response> {
  const settings = loadSettings();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  if (!user.email_confirmed_at || !isAllowedEmail(user.email, settings.allowedEmailDomains)) {
    return new Response(null, { status: 403 });
  }

  let parsed: z.infer<typeof Decision>;
  try {
    const result = Decision.safeParse(JSON.parse(await request.text()));
    if (!result.success) return new Response(null, { status: 400 });
    parsed = result.data;
  } catch {
    return new Response(null, { status: 400 });
  }

  const admin = adminClient();
  const { version } = await loadConsent();
  const events = supabaseStepEventSink(admin);
  const now = new Date();

  if (parsed.decision === "agree") {
    await supabaseProfileStore(admin).recordConsent(user.id, normalizeEmail(user.email ?? ""), parsed.participantType, version, now);
    await events.log(user.id, [{ kind: "consent_given", meta: { participant_type: parsed.participantType, version } }]);
    return new Response(null, { status: 204 });
  }

  await events.log(user.id, [{ kind: "consent_declined", meta: { version } }]);
  await supabase.auth.signOut();
  return new Response(null, { status: 204 });
}
```

`web/lib/participant.server.ts`:

```ts
import { loadConsent, type ConsentText } from "./consent";
import { loadSettings, type Settings } from "./config";
import { participantStatus, type ParticipantStatus } from "./participant";
import { supabaseProfileStore, type Profile } from "./profiles";
import { adminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";

export type Participant = {
  status: ParticipantStatus;
  user: { id: string; email: string } | null;
  profile: Profile | null;
  settings: Settings;
  consent: ConsentText;
};

/** Everything a page needs to decide whether to render or redirect. Server only. */
export async function loadParticipant(): Promise<Participant> {
  const settings = loadSettings();
  const consent = await loadConsent();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // A profile that cannot be read is treated as missing: the user is asked to consent again.
  const profile = user ? await supabaseProfileStore(adminClient()).get(user.id).catch(() => null) : null;
  const status = participantStatus(
    user,
    profile ? { consent_version: profile.consentVersion, consented_at: profile.consentedAt } : null,
    settings,
    consent.version,
  );
  return { status, user: user ? { id: user.id, email: user.email ?? "" } : null, profile, settings, consent };
}

/** Where to send a visitor who is not an enrolled participant, or null when they may stay. */
export function redirectFor(status: ParticipantStatus): string | null {
  if (status === "sign_in" || status === "forbidden") return "/sign-in";
  if (status === "consent") return "/consent";
  return null;
}
```

`web/components/ConsentForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PARTICIPANT_LABEL, PARTICIPANT_TYPES, type ParticipantType } from "@/lib/enums";

const PRIMARY = "rounded-full bg-accent px-5 py-2.5 font-semibold text-white hover:bg-accent-deep disabled:bg-line disabled:text-ink-faint";
const QUIET = "rounded-full px-5 py-2.5 font-medium text-ink-soft hover:bg-paper-2 hover:text-ink";

export function ConsentForm({ markdown }: { markdown: string }) {
  const router = useRouter();
  const [participantType, setParticipantType] = useState<ParticipantType | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(body: { decision: "agree"; participantType: ParticipantType } | { decision: "decline" }) {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!response || !response.ok) {
      setError("That did not save. Please try again.");
      return;
    }
    router.replace(body.decision === "agree" ? "/chat" : "/sign-in?declined=1");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="prose-epichat rounded-2xl border border-line bg-surface p-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">I am a…</legend>
        {PARTICIPANT_TYPES.map((type) => (
          <label key={type} className="flex items-center gap-2.5">
            <input type="radio" name="participant_type" value={type} checked={participantType === type} onChange={() => setParticipantType(type)} className="accent-accent" />
            {PARTICIPANT_LABEL[type]}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || participantType === null} onClick={() => participantType && decide({ decision: "agree", participantType })} className={PRIMARY}>
          I agree to take part
        </button>
        <button type="button" disabled={busy} onClick={() => decide({ decision: "decline" })} className={QUIET}>
          I do not agree
        </button>
      </div>
      {error && <p role="alert" className="rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2.5 text-sm text-warn-ink">{error}</p>}
    </div>
  );
}
```

`web/app/consent/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { ConsentForm } from "@/components/ConsentForm";
import { withContact } from "@/lib/consent";
import { loadParticipant } from "@/lib/participant.server";

export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const participant = await loadParticipant();
  if (participant.status === "sign_in" || participant.status === "forbidden") redirect("/sign-in");
  if (participant.status === "ok") redirect("/chat");
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-6 py-10">
      <Brand />
      <p className="mt-6 text-sm text-ink-soft">
        Signed in as {participant.user?.email}. Consent text version {participant.consent.version}.
      </p>
      <div className="mt-6">
        <ConsentForm markdown={withContact(participant.consent.markdown, participant.settings.contactEmail)} />
      </div>
    </main>
  );
}
```

- [ ] **Step 9: Run the tests, typecheck, lint**

```bash
npx vitest run tests/api/consentRoute.test.ts tests/lib
npm run typecheck
npm run lint
```

Expected: PASS; both clean.

- [ ] **Step 10: Commit**

```bash
git add web/lib web/app/api/consent web/app/consent web/components/ConsentForm.tsx web/tests
git commit -m "web: consent as enrollment — gate, profile store, step events, consent route and page"
```

---

### Task 8: Sessions and client events

**Files:**
- Create: `web/lib/clientEvents.ts`, `web/lib/sessions.ts`, `web/lib/client/track.ts`
- Create: `web/app/api/event/route.ts`, `web/components/SessionProvider.tsx`
- Test: `web/tests/lib/clientEvents.test.ts`, `web/tests/lib/sessions.test.ts`, `web/tests/api/eventRoute.test.ts`

**Interfaces:**
- Consumes: `participantStatus`, `supabaseProfileStore`, `supabaseStepEventSink`, `loadConsent`, `loadSettings`, `isAllowedEmail`.
- Produces: `type ClientEvent`, `readClientEvent(raw: string): ClientEvent | null` from `@/lib/clientEvents`.
- Produces: `type SessionInfo = { userAgent: string | null; viewport: string | null; language: string | null; timezone: string | null }`, `interface SessionStore { start(userId, info): Promise<string>; ping(id, userId): Promise<void>; end(id, userId): Promise<void> }`, `supabaseSessionStore(admin)` from `@/lib/sessions`.
- Produces: `track(event)`, `startSession(info): Promise<string | null>`, `endSession(id)` from `@/lib/client/track`; `<SessionProvider>` and `useSessionId(): string | null` from `@/components/SessionProvider`.
- Produces: `POST /api/event`: `session_start` → `200 { sessionId }`; every other kind → `204`.

- [ ] **Step 1: Write the failing tests for the shapes and the store**

`web/tests/lib/clientEvents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readClientEvent } from "@/lib/clientEvents";

const SESSION = "44444444-4444-4444-8444-444444444444";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const TURN = "55555555-5555-4555-8555-555555555555";

describe("readClientEvent", () => {
  it("accepts each fixed shape", () => {
    expect(readClientEvent(JSON.stringify({ kind: "session_start", viewport: "390x844", language: "en-US", timezone: "America/New_York" }))).toEqual({
      kind: "session_start", viewport: "390x844", language: "en-US", timezone: "America/New_York",
    });
    expect(readClientEvent(JSON.stringify({ kind: "session_ping", sessionId: SESSION }))).toEqual({ kind: "session_ping", sessionId: SESSION });
    expect(readClientEvent(JSON.stringify({ kind: "session_end", sessionId: SESSION }))).toEqual({ kind: "session_end", sessionId: SESSION });
    expect(readClientEvent(JSON.stringify({ kind: "suggestion_used", sessionId: SESSION, conversationId: CONVERSATION, turnId: TURN, stage: "configure" }))).toMatchObject({ kind: "suggestion_used", stage: "configure" });
    expect(readClientEvent(JSON.stringify({ kind: "card_expanded", conversationId: CONVERSATION, turnId: TURN, card: "run" }))).toMatchObject({ card: "run" });
    expect(readClientEvent(JSON.stringify({ kind: "chart_view_changed", conversationId: CONVERSATION, turnId: TURN, view: "incidence" }))).toMatchObject({ view: "incidence" });
    expect(readClientEvent(JSON.stringify({ kind: "feedback_given", conversationId: CONVERSATION, turnId: TURN, rating: "up" }))).toMatchObject({ rating: "up" });
    expect(readClientEvent(JSON.stringify({ kind: "export", conversationId: CONVERSATION, format: "pdf" }))).toMatchObject({ format: "pdf" });
    expect(readClientEvent(JSON.stringify({ kind: "conversation_opened", conversationId: CONVERSATION }))).toMatchObject({ kind: "conversation_opened" });
  });

  it("refuses unknown kinds, extra fields, free text, bad ids, and oversized bodies", () => {
    expect(readClientEvent(JSON.stringify({ kind: "typed", text: "hello" }))).toBeNull();
    expect(readClientEvent(JSON.stringify({ kind: "session_end", sessionId: SESSION, note: "bye" }))).toBeNull();
    expect(readClientEvent(JSON.stringify({ kind: "session_start", viewport: "huge screen" }))).toBeNull();
    expect(readClientEvent(JSON.stringify({ kind: "card_expanded", conversationId: "abc", turnId: TURN, card: "run" }))).toBeNull();
    expect(readClientEvent(JSON.stringify({ kind: "feedback_given", conversationId: CONVERSATION, turnId: TURN, rating: "meh" }))).toBeNull();
    expect(readClientEvent("not json")).toBeNull();
    expect(readClientEvent("x".repeat(1001))).toBeNull();
  });
});
```

`web/tests/lib/sessions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { supabaseSessionStore } from "@/lib/sessions";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";
const SESSION = "44444444-4444-4444-8444-444444444444";
const info = { userAgent: "UA", viewport: "390x844", language: "en-US", timezone: "America/New_York" };

describe("supabaseSessionStore", () => {
  it("starts a session with the device facts and returns its id", async () => {
    const { client, recorded } = fakeAdmin({ sessions: [{ data: { id: SESSION } }] });
    expect(await supabaseSessionStore(client).start(USER, info)).toBe(SESSION);
    expect(callOn(recorded, "sessions", "insert")).toEqual([{ user_id: USER, user_agent: "UA", viewport: "390x844", language: "en-US", timezone: "America/New_York" }]);
    expect(callOn(recorded, "sessions", "select")).toEqual(["id"]);
    expect(callOn(recorded, "sessions", "single")).toEqual([]);
  });

  it("pings and ends only the caller's own session", async () => {
    const { client, recorded } = fakeAdmin();
    const store = supabaseSessionStore(client);
    await store.ping(SESSION, USER);
    await store.end(SESSION, USER);
    const [ping, end] = recorded;
    expect(ping.calls[0][0]).toBe("update");
    expect(Object.keys(ping.calls[0][1][0] as object)).toEqual(["last_active_at"]);
    expect(ping.calls.filter(([m]) => m === "eq").map(([, a]) => a)).toEqual([["id", SESSION], ["user_id", USER]]);
    expect(Object.keys(end.calls[0][1][0] as object).sort()).toEqual(["ended_at", "last_active_at"]);
    expect(end.calls.filter(([m]) => m === "eq").map(([, a]) => a)).toEqual([["id", SESSION], ["user_id", USER]]);
  });

  it("throws when the database refuses", async () => {
    const { client } = fakeAdmin({ sessions: [{ data: null, error: { message: "down" } }] });
    await expect(supabaseSessionStore(client).start(USER, info)).rejects.toThrow(/down/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
npx vitest run tests/lib/clientEvents.test.ts tests/lib/sessions.test.ts
```

Expected: FAIL, modules not found.

- [ ] **Step 3: Write the shapes and the store**

`web/lib/clientEvents.ts`:

```ts
import { z } from "zod";
import { CARD_KINDS, CHART_VIEWS, EXPORT_FORMATS, RATINGS, STAGES } from "./enums";

/**
 * What the browser may report about what a participant did. Every field is a
 * fixed word, an id, or a short device fact. An unknown field is refused, so
 * no typed text can be stored through this door.
 */
const id = z.uuid();
const sessionId = id.optional();
const device = {
  viewport: z.string().regex(/^\d{2,5}x\d{2,5}$/).optional(),
  language: z.string().max(16).regex(/^[A-Za-z0-9-]+$/).optional(),
  timezone: z.string().max(64).regex(/^[A-Za-z0-9_/+-]+$/).optional(),
};

const ClientEvent = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("session_start"), ...device }),
  z.strictObject({ kind: z.literal("session_ping"), sessionId: id }),
  z.strictObject({ kind: z.literal("session_end"), sessionId: id }),
  z.strictObject({ kind: z.literal("conversation_opened"), sessionId, conversationId: id }),
  z.strictObject({ kind: z.literal("conversation_resumed"), sessionId, conversationId: id }),
  z.strictObject({ kind: z.literal("suggestion_used"), sessionId, conversationId: id, turnId: id.optional(), stage: z.enum(STAGES) }),
  z.strictObject({ kind: z.literal("card_expanded"), sessionId, conversationId: id, turnId: id, card: z.enum(CARD_KINDS) }),
  z.strictObject({ kind: z.literal("chart_view_changed"), sessionId, conversationId: id, turnId: id, view: z.enum(CHART_VIEWS) }),
  z.strictObject({ kind: z.literal("series_downloaded"), sessionId, conversationId: id, runId: id }),
  z.strictObject({ kind: z.literal("export"), sessionId, conversationId: id, format: z.enum(EXPORT_FORMATS) }),
  z.strictObject({ kind: z.literal("feedback_given"), sessionId, conversationId: id, turnId: id, rating: z.enum(RATINGS) }),
  z.strictObject({ kind: z.literal("scenario_panel_opened"), sessionId, conversationId: id }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

const MAX_BODY_CHARS = 1000;

/** Read a reported action. Null when it is not one of the known shapes. */
export function readClientEvent(raw: string): ClientEvent | null {
  if (raw.length > MAX_BODY_CHARS) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = ClientEvent.safeParse(json);
  return parsed.success ? parsed.data : null;
}
```

`web/lib/sessions.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type SessionInfo = {
  userAgent: string | null;
  viewport: string | null;
  language: string | null;
  timezone: string | null;
};

export interface SessionStore {
  /** Open a visit and return its id. */
  start(userId: string, info: SessionInfo): Promise<string>;
  ping(id: string, userId: string): Promise<void>;
  end(id: string, userId: string): Promise<void>;
}

export function supabaseSessionStore(admin: SupabaseClient): SessionStore {
  return {
    async start(userId, info) {
      const { data, error } = await admin
        .from("sessions")
        .insert({ user_id: userId, user_agent: info.userAgent, viewport: info.viewport, language: info.language, timezone: info.timezone })
        .select("id")
        .single();
      if (error || !data) throw new Error(`sessions insert failed: ${error?.message ?? "no row"}`);
      return (data as { id: string }).id;
    },
    async ping(id, userId) {
      const { error } = await admin.from("sessions").update({ last_active_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
      if (error) throw new Error(`sessions ping failed: ${error.message}`);
    },
    async end(id, userId) {
      const now = new Date().toISOString();
      const { error } = await admin.from("sessions").update({ last_active_at: now, ended_at: now }).eq("id", id).eq("user_id", userId);
      if (error) throw new Error(`sessions end failed: ${error.message}`);
    },
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/lib/clientEvents.test.ts tests/lib/sessions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing route test**

`web/tests/api/eventRoute.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/consent", () => ({ loadConsent: vi.fn(async () => ({ version: "2026-10-07", markdown: "" })) }));

import { POST } from "@/app/api/event/route";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";
const SESSION = "44444444-4444-4444-8444-444444444444";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const enrolled = { user_id: USER, email: "student@emory.edu", participant_type: "other", consent_version: "2026-10-07", consented_at: "2026-10-02T00:00:00Z" };

let admin: ReturnType<typeof fakeAdmin>;

function signedInAs(email: string | null) {
  const user = email === null ? null : { id: USER, email, email_confirmed_at: "2026-10-01T12:00:00Z" };
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }) } } as never);
}

function withDb(profile: Record<string, unknown> | null, sessionRow = { id: SESSION }) {
  admin = fakeAdmin({ profiles: [{ data: profile }], sessions: [{ data: sessionRow }] });
  vi.mocked(adminClient).mockReturnValue(admin.client);
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request("http://localhost/api/event", { method: "POST", headers: { "user-agent": "TestBrowser/1", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

describe("POST /api/event", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    signedInAs("student@emory.edu");
    withDb(enrolled);
  });

  it("opens a session with the device facts and returns its id", async () => {
    const response = await post({ kind: "session_start", viewport: "390x844", language: "en-US", timezone: "America/New_York" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId: SESSION });
    expect(callOn(admin.recorded, "sessions", "insert")).toEqual([{ user_id: USER, user_agent: "TestBrowser/1", viewport: "390x844", language: "en-US", timezone: "America/New_York" }]);
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "session_start", session_id: SESSION });
  });

  it("pings without logging, and ends a session from a text/plain beacon body", async () => {
    expect((await post({ kind: "session_ping", sessionId: SESSION })).status).toBe(204);
    expect(callOn(admin.recorded, "step_events", "insert")).toBeUndefined();
    const response = await post(JSON.stringify({ kind: "session_end", sessionId: SESSION }), { "content-type": "text/plain;charset=UTF-8" });
    expect(response.status).toBe(204);
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "session_end", session_id: SESSION });
  });

  it("logs an interaction with its conversation and stage", async () => {
    const response = await post({ kind: "suggestion_used", sessionId: SESSION, conversationId: CONVERSATION, stage: "configure" });
    expect(response.status).toBe(204);
    const events = callOn(admin.recorded, "step_events", "insert")?.[0] as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ kind: "suggestion_used", session_id: SESSION, conversation_id: CONVERSATION, stage: "configure", meta: {} });
  });

  it("turns away a signed-out request, a disallowed address, and a user without current consent", async () => {
    signedInAs(null);
    expect((await post({ kind: "session_ping", sessionId: SESSION })).status).toBe(401);
    signedInAs("someone@gmail.com");
    expect((await post({ kind: "session_ping", sessionId: SESSION })).status).toBe(403);
    signedInAs("student@emory.edu");
    withDb({ ...enrolled, consent_version: "2026-01-01" });
    expect((await post({ kind: "session_ping", sessionId: SESSION })).status).toBe(403);
    withDb(null);
    expect((await post({ kind: "session_ping", sessionId: SESSION })).status).toBe(403);
  });

  it("refuses an action it does not know and stores nothing", async () => {
    expect((await post({ kind: "typed", text: "my question" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(callOn(admin.recorded, "step_events", "insert")).toBeUndefined();
    expect(callOn(admin.recorded, "sessions", "insert")).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run it to see it fail**

```bash
npx vitest run tests/api/eventRoute.test.ts
```

Expected: FAIL, route module not found.

- [ ] **Step 7: Write the route, the client tracker, and the provider**

`web/app/api/event/route.ts`:

```ts
import { isAllowedEmail } from "@/lib/auth";
import { readClientEvent } from "@/lib/clientEvents";
import { loadConsent } from "@/lib/consent";
import { loadSettings } from "@/lib/config";
import { participantStatus } from "@/lib/participant";
import { supabaseProfileStore } from "@/lib/profiles";
import { supabaseSessionStore } from "@/lib/sessions";
import { supabaseStepEventSink, type StepEvent } from "@/lib/stepEvents";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Record something a participant did in the browser. Only the fixed shapes in
 * lib/clientEvents.ts are accepted. The body is read as text so that a
 * sendBeacon payload (text/plain) parses like a fetch payload.
 */
export async function POST(request: Request): Promise<Response> {
  const settings = loadSettings();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  if (!user.email_confirmed_at || !isAllowedEmail(user.email, settings.allowedEmailDomains)) {
    return new Response(null, { status: 403 });
  }

  const admin = adminClient();
  const profile = await supabaseProfileStore(admin).get(user.id).catch(() => null);
  const { version } = await loadConsent();
  const status = participantStatus(user, profile ? { consent_version: profile.consentVersion, consented_at: profile.consentedAt } : null, settings, version);
  if (status !== "ok") return new Response(null, { status: 403 });

  const action = readClientEvent(await request.text());
  if (!action) return new Response(null, { status: 400 });

  const sessions = supabaseSessionStore(admin);
  const events = supabaseStepEventSink(admin);

  try {
    if (action.kind === "session_start") {
      const sessionId = await sessions.start(user.id, {
        userAgent: request.headers.get("user-agent"),
        viewport: action.viewport ?? null,
        language: action.language ?? null,
        timezone: action.timezone ?? null,
      });
      await events.log(user.id, [{ kind: "session_start", sessionId }]);
      return Response.json({ sessionId });
    }
    if (action.kind === "session_ping") {
      await sessions.ping(action.sessionId, user.id);
      return new Response(null, { status: 204 });
    }
    if (action.kind === "session_end") {
      await sessions.end(action.sessionId, user.id);
      await events.log(user.id, [{ kind: "session_end", sessionId: action.sessionId }]);
      return new Response(null, { status: 204 });
    }

    const { kind, sessionId, conversationId, ...rest } = action;
    const event: StepEvent = { kind, sessionId: sessionId ?? null, conversationId, meta: {} };
    if ("turnId" in rest && rest.turnId) event.turnId = rest.turnId;
    if ("stage" in rest) event.stage = rest.stage;
    for (const key of ["card", "view", "format", "rating", "runId"] as const) {
      if (key in rest) event.meta![key] = (rest as Record<string, string>)[key];
    }
    await events.log(user.id, [event]);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("event route failed", error);
    return new Response(null, { status: 500 });
  }
}
```

`web/lib/client/track.ts`:

```ts
import type { ClientEvent } from "@/lib/clientEvents";

const ROUTE = "/api/event";

/** Report an interaction. Fire and forget: tracking must not get in a participant's way. */
export function track(event: ClientEvent, send: typeof fetch = fetch): void {
  try {
    void send(ROUTE, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) }).catch(() => {});
  } catch {
    // No network, or no fetch. Nothing to do.
  }
}

/** Open a visit. Returns the session id, or null when it could not be opened. */
export async function startSession(
  info: { viewport?: string; language?: string; timezone?: string },
  send: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await send(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "session_start", ...info }) });
    if (!response.ok) return null;
    const body = (await response.json()) as { sessionId?: string };
    return body.sessionId ?? null;
  } catch {
    return null;
  }
}

/** Close a visit on unload. sendBeacon survives the page going away; fetch may not. */
export function endSession(sessionId: string, beacon: Navigator["sendBeacon"] | undefined = globalThis.navigator?.sendBeacon?.bind(globalThis.navigator)): void {
  const body = JSON.stringify({ kind: "session_end", sessionId });
  if (beacon) {
    try {
      beacon(ROUTE, body);
      return;
    } catch {
      // Fall through to fetch.
    }
  }
  track({ kind: "session_end", sessionId });
}
```

`web/components/SessionProvider.tsx`:

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { endSession, startSession, track } from "@/lib/client/track";

const SessionContext = createContext<string | null>(null);
const PING_MS = 120_000;

/** Opens a visit when the chat mounts, keeps it alive, and closes it when the tab goes away. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    void startSession({
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).then((opened) => {
      if (cancelled || !opened) return;
      id = opened;
      setSessionId(opened);
    });

    const timer = window.setInterval(() => {
      if (id && document.visibilityState === "visible") track({ kind: "session_ping", sessionId: id });
    }, PING_MS);
    const close = () => {
      if (id) endSession(id);
    };
    window.addEventListener("pagehide", close);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("pagehide", close);
      close();
    };
  }, []);

  return <SessionContext.Provider value={sessionId}>{children}</SessionContext.Provider>;
}

export function useSessionId(): string | null {
  return useContext(SessionContext);
}
```

- [ ] **Step 8: Run the tests, typecheck, lint**

```bash
npx vitest run tests/api/eventRoute.test.ts tests/lib
npm run typecheck
npm run lint
```

Expected: PASS; both clean. If the typecheck complains about the `rest` narrowing in the route, replace the loop with explicit `if ("card" in rest) meta.card = rest.card;` lines for each of the five keys.

- [ ] **Step 9: Commit**

```bash
git add web/lib web/app/api/event web/components/SessionProvider.tsx web/tests
git commit -m "web: sessions with device facts and fixed-shape client events"
```

---

### Task 9: Chat shell, home redirect, and the gated admin placeholder

**Files:**
- Create: `web/lib/conversations.ts`, `web/components/ChatShell.tsx`, `web/app/chat/page.tsx`, `web/app/admin/page.tsx`
- Modify: `web/app/page.tsx` (replace the Task 1 placeholder)
- Test: `web/tests/lib/conversations.test.ts`, `web/tests/app/pages.test.ts`

**Interfaces:**
- Consumes: `loadParticipant`, `redirectFor`, `isResearcher`, `supabaseProfileStore.touch`, `SessionProvider`, `Brand`, browser `createClient`.
- Produces: `type ConversationSummary = { id: string; title: string; updatedAt: string }`, `listConversations(admin, userId): Promise<ConversationSummary[]>` from `@/lib/conversations`.

- [ ] **Step 1: Write the failing tests**

`web/tests/lib/conversations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listConversations } from "@/lib/conversations";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";

describe("listConversations", () => {
  it("lists the user's undeleted conversations, newest first, mapped to summaries", async () => {
    const { client, recorded } = fakeAdmin({
      conversations: [{ data: [{ id: "c1", title: "Measles in Kenya", updated_at: "2026-10-07T10:00:00Z" }] }],
    });
    expect(await listConversations(client, USER)).toEqual([{ id: "c1", title: "Measles in Kenya", updatedAt: "2026-10-07T10:00:00Z" }]);
    expect(callOn(recorded, "conversations", "eq")).toEqual(["user_id", USER]);
    expect(callOn(recorded, "conversations", "is")).toEqual(["deleted_at", null]);
    expect(callOn(recorded, "conversations", "order")).toEqual(["updated_at", { ascending: false }]);
    expect(callOn(recorded, "conversations", "limit")).toEqual([50]);
  });

  it("returns an empty list when the table cannot be read, so the page still opens", async () => {
    const { client } = fakeAdmin({ conversations: [{ data: null, error: { message: "down" } }] });
    expect(await listConversations(client, USER)).toEqual([]);
  });
});
```

`web/tests/app/pages.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("protected pages", () => {
  for (const page of ["app/chat/page.tsx", "app/admin/page.tsx", "app/consent/page.tsx"]) {
    it(`${page} decides from loadParticipant and is never static`, () => {
      const source = readFileSync(page, "utf8");
      expect(source).toContain("loadParticipant()");
      expect(source).toContain('export const dynamic = "force-dynamic"');
    });
  }

  it("the chat and admin pages redirect anyone who is not an enrolled participant", () => {
    for (const page of ["app/chat/page.tsx", "app/admin/page.tsx"]) {
      expect(readFileSync(page, "utf8")).toContain("redirectFor(participant.status)");
    }
  });

  it("the admin page is for researchers only", () => {
    const source = readFileSync("app/admin/page.tsx", "utf8");
    expect(source).toContain("isResearcher(");
    expect(source).toContain("notFound()");
  });

  it("the home page sends a signed-in user to the chat and everyone else to sign in", () => {
    const source = readFileSync("app/page.tsx", "utf8");
    expect(source).toContain('redirect(user ? "/chat" : "/sign-in")');
  });

  it("the chat shell opens a session and explains that the assistant is not connected yet", () => {
    expect(readFileSync("app/chat/page.tsx", "utf8")).toContain("<SessionProvider>");
    expect(readFileSync("components/ChatShell.tsx", "utf8")).toContain("disabled");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
npx vitest run tests/lib/conversations.test.ts tests/app/pages.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the conversation list, the shell, and the pages**

`web/lib/conversations.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type ConversationSummary = { id: string; title: string; updatedAt: string };

const LIMIT = 50;

/** The participant's conversations, newest first. A list that cannot be read is shown as empty. */
export async function listConversations(admin: SupabaseClient, userId: string): Promise<ConversationSummary[]> {
  const { data, error } = await admin
    .from("conversations")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(LIMIT);
  if (error || !data) return [];
  return (data as { id: string; title: string; updated_at: string }[]).map((row) => ({
    id: row.id,
    title: row.title || "New conversation",
    updatedAt: row.updated_at,
  }));
}
```

`web/components/ChatShell.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import type { ConversationSummary } from "@/lib/conversations";
import { createClient } from "@/lib/supabase/client";

type Props = {
  email: string;
  conversations: ConversationSummary[];
  contactEmail: string;
};

const QUIET = "rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-soft hover:bg-paper-2 hover:text-ink disabled:opacity-50";

/**
 * The chat page's frame: header, the participant's conversations, and the
 * composer. The assistant arrives in sub-project 3; until then the composer is
 * disabled and says so.
 */
export function ChatShell({ email, conversations, contactEmail }: Props) {
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2.5">
          <Brand />
          <nav aria-label="Chat" className="flex items-center gap-1">
            <span className="hidden truncate text-xs text-ink-faint sm:inline">{email}</span>
            <button type="button" disabled className={QUIET} aria-label="New conversation">
              New
            </button>
            <button type="button" onClick={signOut} className={QUIET}>
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
        <section className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-xl font-semibold">Your account is ready</h2>
          <p className="mt-2 text-ink-soft">
            Sign-in and enrollment work. The simulation assistant is being connected next; this page will
            become the chat. {contactEmail ? `Questions: ${contactEmail}.` : ""}
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold tracking-wide text-ink-faint uppercase">Your conversations</h2>
          {conversations.length === 0 ? (
            <p className="mt-3 text-ink-soft">None yet. A conversation appears here after your first message.</p>
          ) : (
            <ul className="mt-3 border-t border-line">
              {conversations.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 border-b border-line py-3">
                  <span className="truncate font-medium">{item.title}</span>
                  <time dateTime={item.updatedAt} className="shrink-0 font-mono text-xs text-ink-faint">
                    {new Date(item.updatedAt).toLocaleDateString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="sticky bottom-0 border-t border-line bg-paper/95 backdrop-blur-sm">
        <form className="mx-auto flex max-w-3xl items-end gap-2 px-4 py-3" onSubmit={(e) => e.preventDefault()}>
          <textarea
            disabled
            rows={1}
            placeholder="The assistant is not connected yet."
            aria-label="Message"
            className="min-h-11 flex-1 resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 disabled:text-ink-faint"
          />
          <button type="submit" disabled className="rounded-full bg-accent px-5 py-2.5 font-semibold text-white disabled:bg-line disabled:text-ink-faint">
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}
```

`web/app/chat/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { ChatShell } from "@/components/ChatShell";
import { SessionProvider } from "@/components/SessionProvider";
import { listConversations } from "@/lib/conversations";
import { loadParticipant, redirectFor } from "@/lib/participant.server";
import { supabaseProfileStore } from "@/lib/profiles";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const participant = await loadParticipant();
  const destination = redirectFor(participant.status);
  if (destination || !participant.user) redirect(destination ?? "/sign-in");

  const admin = adminClient();
  // Seen today. A failure here must not keep the page from opening.
  void supabaseProfileStore(admin).touch(participant.user.id, new Date()).catch(() => {});
  const conversations = await listConversations(admin, participant.user.id);

  return (
    <SessionProvider>
      <ChatShell email={participant.user.email} conversations={conversations} contactEmail={participant.settings.contactEmail} />
    </SessionProvider>
  );
}
```

`web/app/admin/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { isResearcher } from "@/lib/config";
import { loadParticipant, redirectFor } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const participant = await loadParticipant();
  const destination = redirectFor(participant.status);
  if (destination || !participant.user) redirect(destination ?? "/sign-in");
  if (!isResearcher(participant.settings, participant.user.email)) notFound();

  const { count } = await adminClient().from("profiles").select("user_id", { count: "exact", head: true });

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-10">
      <Brand />
      <h2 className="mt-8 text-2xl font-semibold">Researcher view</h2>
      <p className="mt-2 text-ink-soft">
        Enrolled participants so far: <span className="font-mono">{count ?? 0}</span>. The funnel, replay, and
        export arrive in sub-project 4.
      </p>
    </main>
  );
}
```

`web/app/page.tsx` (replaces the placeholder):

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** A signed-in visitor goes to the chat (which checks consent); anyone else signs in. */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/chat" : "/sign-in");
}
```

- [ ] **Step 4: Run the tests, typecheck, lint**

```bash
npx vitest run tests/lib/conversations.test.ts tests/app/pages.test.ts
npm run typecheck
npm run lint
```

Expected: PASS; both clean.

- [ ] **Step 5: Commit**

```bash
git add web/lib/conversations.ts web/components/ChatShell.tsx web/app/chat web/app/admin web/app/page.tsx web/tests
git commit -m "web: chat shell with conversation list, home redirect, gated admin placeholder"
```

---

### Task 10: Health route and the usage store

**Files:**
- Create: `web/app/api/health/route.ts`, `web/lib/usage.ts`
- Test: `web/tests/api/health.test.ts`, `web/tests/lib/usage.test.ts`

**Interfaces:**
- Produces: `GET /api/health` → `{ ok: true, participants: number }` or `500 { ok: false }`.
- Produces: `type TurnReservation = "ok" | "monthly_budget" | "daily_turns"`, `type UsageDelta = { turns: number; inputTokens: number; outputTokens: number; costUsd: number }`, `interface UsageStore { reserveTurn(userId, day, monthStart, limits): Promise<TurnReservation>; record(userId, day, delta): Promise<void> }`, `supabaseUsageStore(admin)`, `capMessage(cap, settings)` from `@/lib/usage`. Sub-project 3's chat route consumes these unchanged.

- [ ] **Step 1: Write the failing tests**

`web/tests/api/health.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));

import { GET } from "@/app/api/health/route";
import { adminClient } from "@/lib/supabase/admin";
import { fakeAdmin } from "../helpers/fakeAdmin";

describe("GET /api/health", () => {
  beforeEach(() => vi.mocked(adminClient).mockReset());

  it("touches the database and reports the participant count", async () => {
    const { client, recorded } = fakeAdmin({ profiles: [{ count: 12, error: null }] });
    vi.mocked(adminClient).mockReturnValue(client);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, participants: 12 });
    expect(recorded[0].calls[0]).toEqual(["select", ["user_id", { count: "exact", head: true }]]);
  });

  it("returns 500 when the database cannot be reached", async () => {
    const { client } = fakeAdmin({ profiles: [{ count: null, error: { message: "paused" } }] });
    vi.mocked(adminClient).mockReturnValue(client);
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
  });
});
```

`web/tests/lib/usage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadSettings } from "@/lib/config";
import { capMessage, supabaseUsageStore } from "@/lib/usage";
import { fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";

describe("supabaseUsageStore", () => {
  it("reserves a turn through the database function and returns its answer", async () => {
    const { client, rpcCalls } = fakeAdmin({ "rpc:reserve_turn": [{ data: "ok" }] });
    const outcome = await supabaseUsageStore(client).reserveTurn(USER, "2026-10-07", "2026-10-01", { dailyTurns: 40, monthlyBudgetUsd: 50 });
    expect(outcome).toBe("ok");
    expect(rpcCalls).toEqual([["reserve_turn", { p_user: USER, p_day: "2026-10-07", p_month_start: "2026-10-01", p_daily_limit: 40, p_monthly_budget: 50 }]]);
  });

  it("refuses an answer it does not recognize and surfaces database errors", async () => {
    const odd = fakeAdmin({ "rpc:reserve_turn": [{ data: "maybe" }] });
    await expect(supabaseUsageStore(odd.client).reserveTurn(USER, "d", "m", { dailyTurns: 1, monthlyBudgetUsd: 1 })).rejects.toThrow(/unexpected/);
    const failing = fakeAdmin({ "rpc:reserve_turn": [{ data: null, error: { message: "down" } }] });
    await expect(supabaseUsageStore(failing.client).reserveTurn(USER, "d", "m", { dailyTurns: 1, monthlyBudgetUsd: 1 })).rejects.toThrow(/down/);
  });

  it("records tokens and cost rounded to six decimals", async () => {
    const { client, rpcCalls } = fakeAdmin();
    await supabaseUsageStore(client).record(USER, "2026-10-07", { turns: 0, inputTokens: 1200, outputTokens: 300, costUsd: 0.0108004 });
    expect(rpcCalls).toEqual([["record_usage", { p_user: USER, p_day: "2026-10-07", p_turns: 0, p_input: 1200, p_output: 300, p_cost: 0.0108 }]]);
  });
});

describe("capMessage", () => {
  it("explains each cap in the participant's terms", () => {
    const settings = loadSettings({});
    expect(capMessage("monthly_budget", settings)).toMatch(/budget for this month/);
    expect(capMessage("daily_turns", settings)).toMatch(/40 messages/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
npx vitest run tests/api/health.test.ts tests/lib/usage.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the route and the store**

`web/app/api/health/route.ts`:

```ts
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Called once a day by Vercel so the free database never sits idle long enough to pause. */
export async function GET(): Promise<Response> {
  const { count, error } = await adminClient().from("profiles").select("user_id", { count: "exact", head: true });
  if (error) return Response.json({ ok: false }, { status: 500 });
  return Response.json({ ok: true, participants: count ?? 0 });
}
```

`web/lib/usage.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Settings } from "./config";

export type UsageDelta = { turns: number; inputTokens: number; outputTokens: number; costUsd: number };
export type TurnReservation = "ok" | "monthly_budget" | "daily_turns";
export type CapName = Exclude<TurnReservation, "ok">;
export type TurnLimits = { dailyTurns: number; monthlyBudgetUsd: number };

const RESERVATIONS: readonly string[] = ["ok", "monthly_budget", "daily_turns"];

export interface UsageStore {
  /**
   * Count one turn for this user unless a cap is already reached. The database
   * does this in a single statement, so parallel requests cannot each slip under the cap.
   */
  reserveTurn(userId: string, day: string, monthStart: string, limits: TurnLimits): Promise<TurnReservation>;
  /** Add a finished turn's tokens and cost. The turn itself was counted by reserveTurn. */
  record(userId: string, day: string, delta: UsageDelta): Promise<void>;
}

export function capMessage(cap: CapName, settings: Pick<Settings, "dailyTurnsPerUser">): string {
  if (cap === "monthly_budget") {
    return "EpiChat has used its budget for this month. It will be available again on the 1st.";
  }
  return `You have reached today's limit of ${settings.dailyTurnsPerUser} messages. It resets at midnight Eastern time.`;
}

export function supabaseUsageStore(admin: SupabaseClient): UsageStore {
  return {
    async reserveTurn(userId, day, monthStart, limits) {
      const { data, error } = await admin.rpc("reserve_turn", {
        p_user: userId,
        p_day: day,
        p_month_start: monthStart,
        p_daily_limit: limits.dailyTurns,
        p_monthly_budget: limits.monthlyBudgetUsd,
      });
      if (error) throw new Error(`reserve_turn failed: ${error.message}`);
      if (typeof data !== "string" || !RESERVATIONS.includes(data)) throw new Error("reserve_turn returned an unexpected answer");
      return data as TurnReservation;
    },

    async record(userId, day, delta) {
      const { error } = await admin.rpc("record_usage", {
        p_user: userId,
        p_day: day,
        p_turns: delta.turns,
        p_input: delta.inputTokens,
        p_output: delta.outputTokens,
        p_cost: Number(delta.costUsd.toFixed(6)),
      });
      if (error) throw new Error(`record_usage failed: ${error.message}`);
    },
  };
}
```

- [ ] **Step 4: Run the tests and the whole suite**

```bash
npx vitest run
npm run typecheck
npm run lint
```

Expected: every test PASS; both clean.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/health web/lib/usage.ts web/tests
git commit -m "web: health route for the daily cron and the usage cap store"
```

---

### Task 11: Deployment document, environment example, and CI

**Files:**
- Create: `web/docs/DEPLOY.md`, `web/.env.example`
- Modify: `.github/workflows/tests.yml` (repo root)
- Test: `web/tests/app/deploy.test.ts`

**Interfaces:**
- Produces: the operator's runbook for Task 12; the `web` CI job that runs typecheck, lint, and tests on every push.

- [ ] **Step 1: Write the failing test**

`web/tests/app/deploy.test.ts`:

```ts
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
    ]) {
      expect(example).toContain(line);
    }
  });

  it("the deploy document covers the Supabase auth settings the code depends on", () => {
    const doc = readFileSync("docs/DEPLOY.md", "utf8");
    for (const phrase of ["Email OTP Length", "{{ .Token }}", "0001_init.sql", "smtp.resend.com", "Site URL", "RESEARCHER_EMAILS", "delete from"]) {
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
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run tests/app/deploy.test.ts
```

Expected: FAIL, files missing.

- [ ] **Step 3: Write the environment example**

`web/.env.example`:

```
# Supabase (EpiChat's own project, not CampusOtter's)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=

# Anthropic (used from sub-project 3 on)
ANTHROPIC_API_KEY=

# Settings (defaults shown; see lib/config.ts)
CHAT_MODEL=claude-opus-5-5
CHAT_EFFORT=medium
THINKING_DISPLAY=summarized
MAX_OUTPUT_TOKENS=16000
MAX_TOOL_ROUNDS=8
MAX_PAUSE_CONTINUATIONS=5
MONTHLY_BUDGET_USD=50
DAILY_TURNS_PER_USER=40
MAX_MESSAGE_CHARS=6000
ALLOWED_EMAIL_DOMAINS=emory.edu
# Addresses that may open /admin and the export, separated by commas.
RESEARCHER_EMAILS=
# Addresses with no daily message limit, for testing. The monthly budget still applies.
UNLIMITED_EMAILS=
REFUSAL_FALLBACK=1
CONTACT_EMAIL=
# The public site about EpiChat.
WEBSITE_URL=https://ywan446.github.io/epichat/

# Simulation service (sub-project 2). SIM_INTERNAL_URL is set by the Vercel service binding.
SIM_INTERNAL_URL=
SIM_SHARED_SECRET=

# Golden-set evals (sub-project 5). Leave empty in production unless a run is scheduled.
EVAL_BEARER_TOKEN=
```

- [ ] **Step 4: Write the deployment document**

`web/docs/DEPLOY.md`:

```markdown
# Deploying and running the EpiChat web app

The app is the `web/` service of the repository. Sub-project 2 adds the `sim`
service beside it. Everything below is done once by the owner; the code never
creates projects or changes dashboard settings.

## 1. Supabase (EpiChat's own project)

1. Create a new project on the free plan. Region: US East.
2. SQL editor: paste and run `web/supabase/migrations/0001_init.sql`. It is
   safe to run twice. Later migrations are run in order by file name.
3. Sign-in is by an emailed code only. The app has no page for a sign-in link
   to land on, so the emails must carry the code and no link.
   - Authentication > Sign In / Providers > Email: set "Email OTP Length" to
     8. The app asks for exactly eight digits (`SIGN_IN_CODE_LENGTH` in
     `lib/signInCode.ts`); change both together.
   - Authentication > Emails: in both the "Confirm signup" and "Magic Link"
     templates, replace the body with:

         <h2>Sign in to EpiChat</h2>
         <p>Enter this code on the sign-in page: <strong>{{ .Token }}</strong></p>

     A first-time participant gets the signup template and a returning one
     gets the magic-link template. Both must be changed.
4. Authentication > URL Configuration: set the Site URL to the app's live
   address. No redirect addresses are needed.
5. Authentication > SMTP settings: turn on custom SMTP with Resend (host
   `smtp.resend.com`, port `465`, username `resend`, password = a Resend API
   key with sending access, sender = an address on a domain verified in
   Resend). The built-in mailer sends only 2 emails an hour.
6. Authentication > Rate limits: raise "emails per hour" to 100. Resend's free
   plan allows 100 a day.
7. Project settings > API keys: copy the project URL, the publishable key, and
   the secret key into the environment (section 3).

## 2. Anthropic

Not needed until sub-project 3. When it is: create a workspace for EpiChat in
the Anthropic Console, create an API key in it, and set the workspace's monthly
spend limit a little above `MONTHLY_BUDGET_USD` as the backstop.

## 3. Environment

`web/.env.local` for local runs; the same variables go into Vercel for
Production and Preview. Copy `web/.env.example` and fill in the Supabase keys,
`CONTACT_EMAIL`, and `RESEARCHER_EMAILS` (the addresses that may open `/admin`).
Every other setting has a default.

## 4. Vercel

1. From the repository root, `npx vercel link` and create the project `epichat`
   in the owner's team. The project root is the repository root; `vercel.json`
   there defines the `web` service. Leave the Root Directory setting empty.
   If the dashboard refuses a services config with a single service, set the
   Root Directory to `web` instead and remove the `services` and `rewrites`
   keys from `vercel.json` until sub-project 2 restores them.
2. Settings > Environment Variables: add the variables from section 3 for
   Production and Preview.
3. `npx vercel deploy` prints a preview address. `npx vercel deploy --prod`
   puts the current code live. Pushing to GitHub does the same once the
   repository is connected.
4. After the first live deploy, Settings > Cron Jobs: confirm `/api/health`
   runs daily. Then set the Supabase Site URL (section 1.4) to the live address.
5. Keep the Hobby plan for the pilot. Do not turn on Password Protection; it
   adds a monthly charge.

## 5. Verification after a deploy

- Open the preview address: it redirects to `/sign-in`.
- Sign in with an allowed address; the code arrives from the Resend sender.
- The consent page appears; declining signs out with the declined message;
  agreeing with a participant type opens `/chat`.
- Table Editor: `profiles` has the row; `step_events` has `consent_given`,
  `session_start`; `sessions` has a row with the browser's user agent.
- `/api/health` returns `{"ok":true,"participants":N}`.
- `/admin` opens for an address in `RESEARCHER_EMAILS` and is a 404 for
  anyone else.

## 6. Routine work

- **Changing the consent text:** edit `web/content/consent.md`, bump its
  `version`, deploy. Every participant is asked again on their next visit.
- **Adding a researcher or a test address:** edit `RESEARCHER_EMAILS` or
  `UNLIMITED_EMAILS` in Vercel and redeploy.
- **Removing a participant's data on request** (SQL editor; replace the id):

      delete from conversations where user_id = '<user_id>';   -- cascades to messages, turns, events, feedback, scenarios
      delete from runs where user_id = '<user_id>';
      delete from sessions where user_id = '<user_id>';
      delete from step_events where user_id = '<user_id>';
      delete from usage_daily where user_id = '<user_id>';
      delete from profiles where user_id = '<user_id>';

  then delete the user under Authentication > Users.
- **Monthly:** check Supabase database size and Vercel usage against the free
  allowances (500 MB; 4 active-CPU hours, 360 GB-hours, 1M invocations).
```

- [ ] **Step 5: Add the CI job**

Edit `.github/workflows/tests.yml` (repo root) so the `jobs:` block gains a second job after `pytest`:

```yaml
  web:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
```

- [ ] **Step 6: Run the test and the whole suite once more, then a production build**

```bash
npx vitest run
npm run typecheck
npm run lint
npm run build
```

Expected: every test PASS; typecheck and lint clean; the build lists `/`, `/sign-in`, `/consent`, `/chat`, `/admin`, `/api/consent`, `/api/event`, `/api/health`.

- [ ] **Step 7: Commit**

Run from the repo root:

```bash
git add web/docs/DEPLOY.md web/.env.example web/tests/app/deploy.test.ts .github/workflows/tests.yml
git commit -m "web: deployment runbook, environment example, and CI job"
```

---

### Task 12: Operator setup and the first deploy (done by the owner)

This task is not for an agent: it needs the Supabase and Vercel dashboards and the owner's accounts. It follows `web/docs/DEPLOY.md` and records what was found. Whoever executes the plan stops here and hands the checklist to the owner.

**Files:**
- Modify: `web/docs/DEPLOY.md` (record the live addresses and any deviation)

- [ ] **Step 1: Supabase.** Create the project, run `0001_init.sql`, set the OTP length, both email templates, SMTP (Resend), rate limits, and copy the three keys. (DEPLOY.md section 1.)

- [ ] **Step 2: Local run.** Fill `web/.env.local`, then from `web/`:

```bash
npm run dev
```

Open http://localhost:3000, sign in with an allowed address, decline once (expect the declined message), sign in again and agree. Check the `profiles`, `sessions`, and `step_events` tables.

- [ ] **Step 3: Vercel.** `npx vercel link` at the repo root, add the environment variables, `npx vercel deploy`. Record whether the one-service `services` config was accepted; if not, apply the Root Directory fallback from DEPLOY.md section 4.1 and note it in DEPLOY.md and in the spec's risk table.

- [ ] **Step 4: Verify on the preview** with the list in DEPLOY.md section 5, including `/api/health` and `/admin` for a researcher and a non-researcher address.

- [ ] **Step 5: Production.** `npx vercel deploy --prod`, confirm the cron, set the Supabase Site URL to the live address.

- [ ] **Step 6: Record and commit.** Add the live address, the Vercel project name, and any deviation to `web/docs/DEPLOY.md`; commit:

```bash
git add web/docs/DEPLOY.md
git commit -m "docs: record the first EpiChat web deploy"
```

---

## Self-review notes

- **Spec coverage (15.1):** scaffold and brand (Task 1); migration with every table of section 7, caps, RLS, grants (Task 4); code sign-in with allowlist and long sessions (Tasks 5, 6); consent as enrollment with participant type, versioned text, decline → sign-out, step events (Tasks 3, 7); sessions and `/api/event` with strict shapes (Task 8); settings loader, usage store, step-event sink, Supabase clients, auth helpers (Tasks 2, 5, 7, 10); routes `/`, `/sign-in`, `/consent`, `/chat`, `/admin`, `/api/health`, `/api/event` (Tasks 6–10); `vercel.json` with one service and the cron (Task 1); CI web job and DEPLOY.md with the manual deletion step (Task 11); first deploy and its verification points (Task 12). `/api/maintenance` is deliberately absent: the revised spec has no purge job.
- **Review Focus mapping:** item 1 → Task 5 `auth.test.ts`; item 2 → Task 7 `participant.test.ts` and Task 8 `eventRoute.test.ts` (older consent version → 403); item 3 → Task 8 `eventRoute.test.ts` (text/plain beacon body); item 4 → Task 4 `usage.test.ts` racing test; item 5 → Task 4 `schema.test.ts` applies the migration twice.
- **Type consistency:** `participantStatus(user, profile, settings, currentVersion)` takes `{ consent_version, consented_at }`, and both `participant.server.ts` and the event route convert a `Profile` to that shape the same way. `fakeAdmin` outcomes are keyed by table name, or `rpc:<name>` for functions, in every test that uses it. `StepEvent.meta` values are `string | number | boolean | null`, matching the migration comment and the event route's assignments.
- **Known deviations from CampusOtter worth knowing:** the client sends no history (sub-project 3 loads it from the database); `usage_events` is replaced by `step_events`; `logEvents` is not on the usage store; the proxy also protects `/consent` and `/admin`.

