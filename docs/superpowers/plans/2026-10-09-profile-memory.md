# Participant Profile and Agent Memory (sub-project 4d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A required profile questionnaire after consent, a Profile tab in the right column with the profile, the preferences, and the assistant's memory, a `remember` tool, and an About block on every conversation's first message that shapes detail, framing, and the report.

**Architecture:** Profile fields live on the `profiles` row; memories are rows in a `memories` table; both are read once per new conversation and injected into the first user message so the system prompt stays byte-stable. A `profile` participant status gates the chat until the questionnaire is saved. The Profile tab reads and writes through four participant-only routes; the assistant writes through one tool.

**Tech Stack:** Next.js 16 App Router, React 19, zod 4, vitest 5 with `@electric-sql/pglite`, Supabase, Anthropic SDK beta messages.

**Spec:** `docs/superpowers/specs/2026-10-09-profile-memory-design.md`

## Global Constraints

- No new npm dependency. Files are CRLF; edit with scripts that preserve line endings or write whole files.
- Enum values, verbatim (spec section 4 and 5): roles `student, modeler, epidemiologist, clinician, public_health_practitioner, policy_maker, communicator, general_public, other`; experience `none, some, a_lot`; goals `learning, exploring, deciding, communicating`; results `summary, tables, charts, all` (default `all`); report format `md, html, docx, pdf` (default `pdf`); memory kinds `role, situation, preference, decision, solution, other`.
- Limits: `decisions` ≤ 200 chars; `disease_interest` ≤ 60 chars; memory text 3–200 chars; 3 `remember` calls per turn; 30 active memories per participant, the assistant's oldest evicted first, the participant's own never.
- Copy, verbatim: the page title `Tell us about yourself`; the tab note `Changes reach the assistant from your next conversation.`; the memory switch `Remember things about me across conversations`; the memory empty state `Nothing remembered yet. The assistant adds what you tell it about your role, your situation, and your preferences; you can add your own.`; the tool refusals `MEMORY OFF: this participant switched memory off.`, `MEMORY LIMIT: three per turn.`, `MEMORY FULL: ask the participant to tidy their memory list.`, `MEMORY NOT FOUND: no such memory to replace.`; the 403 `profile_required` message `Please tell us about yourself before continuing.`; the consent bullet `Your answers to the profile questions and what the assistant remembers about you, which you can see and edit.`; consent version `2026-10-10`.
- Every table: RLS on, browser roles revoked, service role granted; `tests/db/schema.test.ts` `TABLES` gains `memories`.
- Commit messages end with the session's two attribution lines.

## Review Focus

1. A participant with status `profile` who reaches the chat (an old tab) gets 403 `profile_required` from `/api/chat` and is sent to `/profile`, never a dead end (Task 2 refusal test; Task 4 static pin on `Chat.tsx`).
2. Memory switched off: the `remember` tool is withheld from the model and the About block has no Remembered line (Task 5 handler test; Task 1 about test).
3. The thirtieth memory: an assistant memory evicts the oldest assistant memory; when every active memory is the participant's, the tool answers MEMORY FULL and nothing is dropped (Task 5 tool test on a fake store; Task 2 store test for the eviction query).
4. The About block goes only on a conversation's first message, never on a resumed turn (Task 5 handler test with history).
5. An unknown country is refused with 400 and the disease text is kept as typed (Task 1 schema test; Task 3 route test).

---

### Task 1: Enums, the profile schema, and the About block

**Files:**
- Modify: `web/lib/enums.ts`, `web/lib/chat/prompt.ts` (`firstUserMessage`)
- Create: `web/lib/profile/schema.ts`, `web/lib/profile/about.ts`
- Test: `web/tests/profile/schema.test.ts`, `web/tests/profile/about.test.ts`, `web/tests/chat/prompt.test.ts`

**Interfaces:**
- Produces in `lib/enums.ts`: `ROLES`, `EXPERIENCES`, `GOALS`, `RESULTS_PREFS`, `MEMORY_KINDS` (const tuples) with `Role`, `Experience`, `Goal`, `ResultsPref`, `MemoryKind` types and `ROLE_LABELS`, `EXPERIENCE_LABELS`, `GOAL_LABELS`, `RESULTS_PREF_LABELS`, `MEMORY_KIND_LABELS` records; `SERVER_EVENT_KINDS` gains `profile_completed, profile_updated, memory_added, memory_updated, memory_removed, memory_toggled`; `PANEL_SECTIONS` gains `profile`; `EXPORT_FORMATS` is reused for the report format.
- Produces in `lib/profile/schema.ts`: `ProfileFields = { role: Role | null; experience: Experience | null; goals: Goal[]; diseaseInterest: string | null; countryInterest: string | null; decisions: string | null; resultsPref: ResultsPref; reportFormat: ExportFormat; memoryEnabled: boolean; completedAt: string | null }`, `EMPTY_PROFILE`, `SetupInput` (zod: role, experience, goals non-empty required; the rest optional), `ProfilePatch` (every field optional), `prefillRole(participantType): Role | null`, `isCountry(iso3)` (from `data/country_names.json`), `diseaseKeyOrText(text)` (a database key when the text matches a key or display name case-insensitively, else the trimmed text).
- Produces in `lib/profile/about.ts`: `Memory = { id: string; kind: MemoryKind; text: string; source: "agent" | "participant"; createdAt: string }`, `aboutBlock(profile: ProfileFields, memories: Memory[]): string | null` (null when the profile is incomplete).
- Produces in `lib/chat/prompt.ts`: `firstUserMessage(dateIso: string, text: string, about?: string | null): string`.

- [ ] **Step 1: Write the failing tests**

`tests/profile/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE, ProfilePatch, SetupInput, diseaseKeyOrText, isCountry, prefillRole } from "@/lib/profile/schema";

describe("the questionnaire", () => {
  it("requires a role, an experience level, and at least one goal; the rest is optional", () => {
    expect(SetupInput.safeParse({ role: "policy_maker", experience: "some", goals: ["deciding", "communicating"] }).success).toBe(true);
    expect(SetupInput.safeParse({ role: "policy_maker", experience: "some", goals: [] }).success).toBe(false);
    expect(SetupInput.safeParse({ experience: "some", goals: ["learning"] }).success).toBe(false);
    expect(SetupInput.safeParse({ role: "wizard", experience: "some", goals: ["learning"] }).success).toBe(false);
    const full = SetupInput.safeParse({ role: "student", experience: "none", goals: ["learning"], diseaseInterest: "Measles", countryInterest: "KEN", decisions: "none yet", resultsPref: "charts", reportFormat: "docx" });
    expect(full.success).toBe(true);
  });

  it("limits the free text and refuses an unknown country while keeping unknown disease text", () => {
    expect(SetupInput.safeParse({ role: "student", experience: "none", goals: ["learning"], decisions: "x".repeat(201) }).success).toBe(false);
    expect(SetupInput.safeParse({ role: "student", experience: "none", goals: ["learning"], countryInterest: "XXX" }).success).toBe(false);
    expect(isCountry("KEN")).toBe(true);
    expect(isCountry("ken")).toBe(false);
    expect(diseaseKeyOrText("Measles")).toBe("measles");
    expect(diseaseKeyOrText("measles")).toBe("measles");
    expect(diseaseKeyOrText("  Unicorn pox ")).toBe("Unicorn pox");
  });

  it("patches any field alone and pre-fills the role from the study category", () => {
    expect(ProfilePatch.safeParse({ memoryEnabled: false }).success).toBe(true);
    expect(ProfilePatch.safeParse({ goals: ["exploring"] }).success).toBe(true);
    expect(ProfilePatch.safeParse({ goals: [] }).success).toBe(false);
    expect(ProfilePatch.safeParse({ resultsPref: "loud" }).success).toBe(false);
    expect(prefillRole("graduate_student")).toBe("student");
    expect(prefillRole("public_health_practitioner")).toBe("public_health_practitioner");
    expect(prefillRole("faculty_or_researcher")).toBeNull();
    expect(prefillRole(null)).toBeNull();
    expect(EMPTY_PROFILE).toMatchObject({ role: null, goals: [], resultsPref: "all", reportFormat: "pdf", memoryEnabled: true, completedAt: null });
  });
});
```

`tests/profile/about.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE } from "@/lib/profile/schema";
import { aboutBlock, type Memory } from "@/lib/profile/about";

const PROFILE = { ...EMPTY_PROFILE, role: "policy_maker" as const, experience: "some" as const, goals: ["deciding", "communicating"] as const, diseaseInterest: "measles", countryInterest: "KEN", decisions: "vaccination campaigns", resultsPref: "summary" as const, reportFormat: "pdf" as const, completedAt: "2026-10-09T10:00:00Z" };
const MEMORIES: Memory[] = [
  { id: "m1", kind: "situation", text: "Works at a county health office", source: "agent", createdAt: "2026-10-08T10:00:00Z" },
  { id: "m2", kind: "preference", text: "Asked for results as tables last time", source: "participant", createdAt: "2026-10-09T10:00:00Z" },
];

describe("aboutBlock", () => {
  it("writes the profile and the memory in the spec's lines", () => {
    expect(aboutBlock(PROFILE, MEMORIES)).toBe(
      [
        "About this participant (from their profile and your memory; pitch the detail and the framing by it; do not repeat it back; do not ask for what it already says):",
        "- Role: policy maker · Experience with epidemic models: some · Wants: making decisions, communicating to others",
        "- Interest: measles in Kenya · Decisions they can influence: vaccination campaigns",
        "- Prefers: plain-language summary · Report format: PDF",
        "- Remembered: Works at a county health office (situation) · Asked for results as tables last time (preference)",
      ].join("\n"),
    );
  });

  it("leaves out empty lines, writes a disease without a country, and a country without a disease", () => {
    const text = aboutBlock({ ...PROFILE, diseaseInterest: null, countryInterest: null, decisions: null }, []);
    expect(text).not.toContain("- Interest");
    expect(text).not.toContain("- Remembered");
    expect(aboutBlock({ ...PROFILE, countryInterest: null }, [])).toContain("- Interest: measles");
    expect(aboutBlock({ ...PROFILE, diseaseInterest: null }, [])).toContain("- Interest: Kenya");
    expect(aboutBlock({ ...PROFILE, diseaseInterest: "Unicorn pox" }, [])).toContain("- Interest: Unicorn pox in Kenya");
  });

  it("is null for an incomplete profile and has no Remembered line with memory off", () => {
    expect(aboutBlock(EMPTY_PROFILE, MEMORIES)).toBeNull();
    expect(aboutBlock({ ...PROFILE, memoryEnabled: false }, MEMORIES)).not.toContain("Remembered");
  });
});
```

`tests/chat/prompt.test.ts`: change the `firstUserMessage` test to also expect `firstUserMessage("2026-10-08", "Hi", "About this participant: x")` to be `"Today's date: 2026-10-08.\n\nAbout this participant: x\n\nHi"` and `firstUserMessage("2026-10-08", "Hi", null)` to equal the two-part form.

- [ ] **Step 2: Run them to verify they fail** — `npx vitest run tests/profile tests/chat/prompt.test.ts`.

- [ ] **Step 3: Implement**

`lib/enums.ts` additions:

```ts
export const ROLES = ["student", "modeler", "epidemiologist", "clinician", "public_health_practitioner", "policy_maker", "communicator", "general_public", "other"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = { student: "Student", modeler: "Modeler", epidemiologist: "Epidemiologist", clinician: "Clinician", public_health_practitioner: "Public health practitioner", policy_maker: "Policy maker", communicator: "Journalist or communicator", general_public: "General public", other: "Other" };
export const EXPERIENCES = ["none", "some", "a_lot"] as const;
export type Experience = (typeof EXPERIENCES)[number];
export const EXPERIENCE_LABELS: Record<Experience, string> = { none: "None", some: "Some", a_lot: "A lot" };
export const GOALS = ["learning", "exploring", "deciding", "communicating"] as const;
export type Goal = (typeof GOALS)[number];
export const GOAL_LABELS: Record<Goal, string> = { learning: "Learning", exploring: "Exploring scenarios", deciding: "Making decisions", communicating: "Communicating to others" };
export const RESULTS_PREFS = ["summary", "tables", "charts", "all"] as const;
export type ResultsPref = (typeof RESULTS_PREFS)[number];
export const RESULTS_PREF_LABELS: Record<ResultsPref, string> = { summary: "Plain-language summary", tables: "Tables and numbers", charts: "Charts", all: "All of them" };
export const MEMORY_KINDS = ["role", "situation", "preference", "decision", "solution", "other"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = { role: "Role", situation: "Situation", preference: "Preference", decision: "Decision they can make", solution: "Solution they already use", other: "Other" };
```

plus the six event kinds and `profile` in `PANEL_SECTIONS`.

`lib/profile/schema.ts`:

```ts
import { z } from "zod";
import names from "@/data/country_names.json";
import { lookup } from "@/lib/disease/db";
import { EXPERIENCES, EXPORT_FORMATS, GOALS, RESULTS_PREFS, ROLES, type Experience, type ExportFormat, type Goal, type ParticipantType, type ResultsPref, type Role } from "@/lib/enums";

export type ProfileFields = { role: Role | null; experience: Experience | null; goals: Goal[]; diseaseInterest: string | null; countryInterest: string | null; decisions: string | null; resultsPref: ResultsPref; reportFormat: ExportFormat; memoryEnabled: boolean; completedAt: string | null };
export const EMPTY_PROFILE: ProfileFields = { role: null, experience: null, goals: [], diseaseInterest: null, countryInterest: null, decisions: null, resultsPref: "all", reportFormat: "pdf", memoryEnabled: true, completedAt: null };

const COUNTRIES = names as Record<string, string>;
export function isCountry(iso3: string): boolean { return Object.hasOwn(COUNTRIES, iso3); }

/** The database's key when the text names a disease, else the text as typed. */
export function diseaseKeyOrText(text: string): string {
  const trimmed = text.trim();
  return lookup(trimmed)?.key ?? trimmed;
}

const country = z.string().refine(isCountry, "Not a country in the list");
const optionalText = (max: number) => z.string().trim().max(max).transform((s) => (s.length === 0 ? null : s)).nullable().optional();
const fields = {
  diseaseInterest: optionalText(60),
  countryInterest: country.nullable().optional(),
  decisions: optionalText(200),
  resultsPref: z.enum(RESULTS_PREFS).optional(),
  reportFormat: z.enum(EXPORT_FORMATS).optional(),
};
export const SetupInput = z.strictObject({ role: z.enum(ROLES), experience: z.enum(EXPERIENCES), goals: z.array(z.enum(GOALS)).min(1), ...fields });
export type SetupArgs = z.infer<typeof SetupInput>;
export const ProfilePatch = z.strictObject({ role: z.enum(ROLES).optional(), experience: z.enum(EXPERIENCES).optional(), goals: z.array(z.enum(GOALS)).min(1).optional(), ...fields, memoryEnabled: z.boolean().optional() });
export type ProfilePatchArgs = z.infer<typeof ProfilePatch>;

export function prefillRole(type: ParticipantType | null): Role | null {
  if (type === "graduate_student") return "student";
  if (type === "public_health_practitioner") return "public_health_practitioner";
  return null;
}
```

(`lookup` matches keys and aliases case-insensitively and trims; "Measles" → key `measles`. `goals` in a patch keeps `.min(1)` so a participant cannot save none.)

`lib/profile/about.ts`:

```ts
import { countryName } from "@/lib/client/format";
import { lookup } from "@/lib/disease/db";
import { EXPERIENCE_LABELS, GOAL_LABELS, RESULTS_PREF_LABELS, ROLE_LABELS, type MemoryKind } from "@/lib/enums";
import type { ProfileFields } from "./schema";

export type Memory = { id: string; kind: MemoryKind; text: string; source: "agent" | "participant"; createdAt: string };

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const FORMAT: Record<string, string> = { md: "Markdown", html: "HTML", docx: "Word", pdf: "PDF" };

/** The block on a conversation's first message (spec section 8); null until the questionnaire is done. */
export function aboutBlock(profile: ProfileFields, memories: Memory[]): string | null {
  if (!profile.completedAt || !profile.role || !profile.experience) return null;
  const lines = ["About this participant (from their profile and your memory; pitch the detail and the framing by it; do not repeat it back; do not ask for what it already says):"];
  lines.push(`- Role: ${lower(ROLE_LABELS[profile.role])} · Experience with epidemic models: ${lower(EXPERIENCE_LABELS[profile.experience])} · Wants: ${profile.goals.map((g) => lower(GOAL_LABELS[g])).join(", ")}`);
  const disease = profile.diseaseInterest ? (lookup(profile.diseaseInterest)?.display_name.toLowerCase() ?? profile.diseaseInterest) : null;
  const country = profile.countryInterest ? countryName(profile.countryInterest) : null;
  const interest = disease && country ? `${disease} in ${country}` : (disease ?? country);
  const second = [interest ? `Interest: ${interest}` : null, profile.decisions ? `Decisions they can influence: ${profile.decisions}` : null].filter(Boolean);
  if (second.length > 0) lines.push(`- ${second.join(" · ")}`);
  lines.push(`- Prefers: ${lower(RESULTS_PREF_LABELS[profile.resultsPref])} · Report format: ${FORMAT[profile.reportFormat]}`);
  if (profile.memoryEnabled && memories.length > 0) {
    const sorted = [...memories].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    lines.push(`- Remembered: ${sorted.map((m) => `${m.text} (${m.kind})`).join(" · ")}`);
  }
  return lines.join("\n");
}
```

(The Remembered suffix is the kind's key, "(situation)", not its label; `MEMORY_KIND_LABELS` is imported by the tab, not here.) `firstUserMessage(dateIso, text, about?)` returns `` `Today's date: ${dateIso}.\n\n${about ? `${about}\n\n` : ""}${text}` ``.

- [ ] **Step 4: Run the tests** — PASS; typecheck clean (the `ParticipantType` import stays type-only).
- [ ] **Step 5: Commit** — `feat(profile): enums, the questionnaire schema, and the About block`.

---

### Task 2: Migration 0006, the profile fields, the memory store, and the profile gate

**Files:**
- Create: `web/supabase/migrations/0006_profile_memory.sql`, `web/lib/db/memories.ts`
- Modify: `web/lib/profiles.ts` (fields on `Profile`, `saveProfile`, `patchProfile`), `web/lib/participant.ts` (`profile` status, redirect, refusal), `web/lib/participant.server.ts` (pass the completed flag), `web/tests/db/schema.test.ts` (`memories`)
- Test: `web/tests/db/profile.test.ts` (pglite), `web/tests/db/stores.test.ts`, `web/tests/lib/participant.test.ts`

**Interfaces:**
- Produces: `Profile` gains `fields: ProfileFields`; `ProfileStore.saveProfile(userId, input: SetupArgs, now): Promise<{ first: boolean }>` (reads the row, sets `profile_completed_at` when it was null and reports that as `first`, sets `profile_updated_at` always) and `patchProfile(userId, patch: ProfilePatchArgs, now): Promise<void>`; `MemoryStore { list(userId): Promise<Memory[]>; add(userId, kind, text, source, conversationId: string | null): Promise<string>; update(userId, id, patch: { kind?: MemoryKind; text?: string }, now): Promise<boolean>; deactivate(userId, id, now): Promise<boolean>; deactivateAll(userId, now): Promise<number>; countActive(userId): Promise<number>; evictOldestAgent(userId, now): Promise<boolean> }`, `supabaseMemoryStore(admin)`; `ParticipantStatus` gains `"profile"`; `participantStatus(user, profile: ConsentLike & { profile_completed_at?: string | null }, settings, version)`; `redirectFor("profile") === "/profile"`; `apiRefusal("profile")` = 403 `profile_required`.

- [ ] **Step 1: Write the failing tests**

`tests/db/profile.test.ts` (pglite, same harness as `shares.test.ts`): the profile columns accept a full set and refuse a bad role (`check` violation), the defaults (`results_pref` `all`, `report_format` `pdf`, `memory_enabled` true, `goals` `{}`); `memories` accepts the kinds and refuses text over 200 chars and a bad source; cascade is not expected (no FK on user); the step-event kinds `profile_completed` … `memory_toggled` are accepted; the migration applies twice.

`tests/db/stores.test.ts`: `supabaseProfileStore.get` returns `fields` from a row with the new columns (and `EMPTY_PROFILE` values for an old row with nulls); `saveProfile` reads the row (first builder), then updates `role, experience, goals, …, profile_updated_at` and `profile_completed_at` only when the row had none (second builder, `admin.recorded[1]`), answering `{ first: true }` then and `{ first: false }` for a completed row; `patchProfile` updates only the given keys, mapping camelCase to columns; the memory store's calls: `list` selects active ordered by `created_at` desc, `add` inserts with `source` and returns the id, `update`/`deactivate` filter by `user_id` and `id` and report whether a row changed, `deactivateAll` returns the count, `countActive`, `evictOldestAgent` updates the oldest active agent memory and reports whether one existed.

`tests/lib/participant.test.ts`: `participantStatus(user, { ...enrolled, profile_completed_at: null }, settings, "2026-10-07")` → `"profile"`; with a timestamp → `"ok"`; `redirectFor("profile")` → `/profile`; `apiRefusal("profile")` → `{ status: 403, code: "profile_required", message: "Please tell us about yourself before continuing." }`. The existing "admits a consented user" case passes `profile_completed_at`.

- [ ] **Step 2: Run them to verify they fail.**

- [ ] **Step 3: Write the migration**

```sql
-- Profile and memory (sub-project 4d): the questionnaire's columns, the
-- memories table, and six step-event kinds. Apply after 0005 in the SQL
-- editor; safe to run twice.

alter table profiles add column if not exists role text check (role in ('student', 'modeler', 'epidemiologist', 'clinician', 'public_health_practitioner', 'policy_maker', 'communicator', 'general_public', 'other'));
alter table profiles add column if not exists experience text check (experience in ('none', 'some', 'a_lot'));
alter table profiles add column if not exists goals text[] not null default '{}';
alter table profiles add column if not exists disease_interest text check (char_length(disease_interest) <= 60);
alter table profiles add column if not exists country_interest text check (char_length(country_interest) = 3);
alter table profiles add column if not exists decisions text check (char_length(decisions) <= 200);
alter table profiles add column if not exists results_pref text not null default 'all' check (results_pref in ('summary', 'tables', 'charts', 'all'));
alter table profiles add column if not exists report_format text not null default 'pdf' check (report_format in ('md', 'html', 'docx', 'pdf'));
alter table profiles add column if not exists memory_enabled boolean not null default true;
alter table profiles add column if not exists profile_completed_at timestamptz;
alter table profiles add column if not exists profile_updated_at timestamptz;

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('role', 'situation', 'preference', 'decision', 'solution', 'other')),
  text text not null check (char_length(text) between 1 and 200),
  source text not null check (source in ('agent', 'participant')),
  source_conversation_id uuid references conversations(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists memories_user_active_idx on memories (user_id, active, created_at);
alter table memories enable row level security;
-- the privilege block of 0004/0005 for `memories`

alter table step_events drop constraint if exists step_events_kind_check;
alter table step_events add constraint step_events_kind_check check (kind in (
  -- every kind of 0005, then:
  'profile_completed', 'profile_updated', 'memory_added', 'memory_updated', 'memory_removed', 'memory_toggled'
));
```

(Copy 0005's kind list in full; the comment is the plan's shorthand, never the migration's.)

- [ ] **Step 4: Write the stores and the gate** as the Interfaces block says; `Profile.fields` maps columns to `ProfileFields` with `EMPTY_PROFILE` defaults for nulls; `participantStatus` returns `"profile"` when consent is current and `profile.profile_completed_at` is falsy; `loadParticipant` passes `profile_completed_at: profile?.fields.completedAt ?? null` into the status call; `redirectFor` and `apiRefusal` gain the status.

- [ ] **Step 5: Run** `npx vitest run tests/db tests/lib && npm run -s typecheck` — PASS. Every fake `ProfileStore` in tests (`grep -rn "ProfileStore" tests`) gains the two methods.
- [ ] **Step 6: Commit** — `feat(profile): migration 0006, the profile fields, the memory store, and the profile gate`.

---

### Task 3: The profile page, the setup route, and the consent hand-off

**Files:**
- Create: `web/app/profile/page.tsx`, `web/components/ProfileSetup.tsx`, `web/app/api/profile/setup/route.ts`, `web/lib/profile/options.ts`, `web/lib/client/profile.ts` (the country helpers; Task 6 adds the requests)
- Modify: `web/lib/participant.server.ts` (`requireParticipant(options?)`), `web/components/ConsentForm.tsx`, `web/app/consent/page.tsx`, `web/lib/supabase/session.ts` (`PROTECTED_PREFIXES`), `web/next.config.ts`
- Test: `web/tests/api/setupRoute.test.ts`, `web/tests/app/profile.test.ts` (static pins), `web/tests/lib/session.test.ts`, `web/tests/app/pages.test.ts`

**Interfaces:**
- Consumes: `SetupInput`, `SetupArgs`, `prefillRole`, `diseaseKeyOrText`, `EMPTY_PROFILE`, `ProfileFields` (Task 1); `ProfileStore.saveProfile` → `{ first: boolean }` (Task 2); `participantStatus` "profile" (Task 2).
- Produces: `requireParticipant(options?: { allowIncompleteProfile?: boolean }): Promise<Gate>` (status `profile` passes only with the option); `lib/profile/options.ts` `DiseaseOption = { key: string; name: string }`, `diseaseOptions(): DiseaseOption[]` (from `knownDiseases()` and each entry's `display_name`, sorted by name); `lib/client/profile.ts` `COUNTRY_NAMES`, `COUNTRY_OPTIONS: { iso3: string; name: string }[]`, `countryIso3For(text: string): string | null`, `countryLabel(iso3: string | null): string`; `ProfileSetup` props `{ initial: ProfileFields; prefillRole: Role | null; diseases: DiseaseOption[]; completed: boolean }`; `POST /api/profile/setup` body = `SetupArgs`, answers 204, 400 `{ code: "bad_request", field }`, or the gate's refusal; `PROTECTED_PREFIXES` = `["/chat", "/consent", "/admin", "/profile"]`.

- [ ] **Step 1: Write the failing tests**

`tests/api/setupRoute.test.ts` (the pattern of `sharesRoute.test.ts`: mock `@/lib/participant.server` and `@/lib/supabase/admin`, `fakeAdmin` per request):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/participant.server", () => ({ requireParticipant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));
import { POST } from "@/app/api/profile/setup/route";
import { loadSettings } from "@/lib/config";
import { requireParticipant } from "@/lib/participant.server";
import { adminClient } from "@/lib/supabase/admin";
import { callOn, fakeAdmin, type Outcome } from "../helpers/fakeAdmin";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "student@emory.edu" };
const ROW = { user_id: USER.id, email: USER.email, participant_type: "graduate_student", consent_version: "2026-10-10", consented_at: "2026-10-10T00:00:00Z", profile_completed_at: null };
const BODY = { role: "policy_maker", experience: "some", goals: ["deciding"], diseaseInterest: "Measles", countryInterest: "KEN", decisions: "campaign timing" };

function setup(over: Partial<Record<string, Outcome[]>> = {}) {
  const admin = fakeAdmin({ profiles: [{ data: ROW }, { data: null }], step_events: [{ data: null }], ...over });
  vi.mocked(adminClient).mockReturnValue(admin.client);
  return admin;
}
const post = (body: unknown) => POST(new Request("http://localhost/api/profile/setup", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("POST /api/profile/setup", () => {
  beforeEach(() => vi.mocked(requireParticipant).mockResolvedValue({ ok: true, user: USER, settings: loadSettings({}) }));

  it("saves the questionnaire, normalizes the disease to its key, stamps completion, and logs profile_completed", async () => {
    const admin = setup();
    const response = await post(BODY);
    expect(response.status).toBe(204);
    expect(vi.mocked(requireParticipant)).toHaveBeenCalledWith({ allowIncompleteProfile: true });
    const update = admin.recorded.filter((r) => r.table === "profiles")[1].calls.find(([m]) => m === "update")?.[1][0] as Record<string, unknown>;
    expect(update).toMatchObject({ role: "policy_maker", experience: "some", goals: ["deciding"], disease_interest: "measles", country_interest: "KEN", decisions: "campaign timing" });
    expect(typeof update.profile_completed_at).toBe("string");
    const event = (callOn(admin.recorded, "step_events", "insert")?.[0] as { kind: string; meta: Record<string, unknown> }[])[0];
    expect(event).toMatchObject({ kind: "profile_completed", meta: { role: "policy_maker", experience: "some", goals: "deciding", has_disease: true, has_country: true, has_decisions: true } });
  });

  it("logs profile_updated instead when the profile was already complete", async () => {
    const admin = setup({ profiles: [{ data: { ...ROW, profile_completed_at: "2026-10-09T00:00:00Z" } }, { data: null }] });
    expect((await post(BODY)).status).toBe(204);
    const event = (callOn(admin.recorded, "step_events", "insert")?.[0] as { kind: string }[])[0];
    expect(event.kind).toBe("profile_updated");
  });

  it("names the missing or bad field in a 400 and passes the gate's refusal through", async () => {
    setup();
    const missing = await post({ role: "student", experience: "none", goals: [] });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ code: "bad_request", field: "goals" });
    const country = await post({ ...BODY, countryInterest: "XXX" });
    expect(await country.json()).toEqual({ code: "bad_request", field: "countryInterest" });
    expect((await post("{not json")).status).toBe(400);
    vi.mocked(requireParticipant).mockResolvedValue({ ok: false, response: Response.json({ code: "consent_required" }, { status: 403 }) });
    expect((await post(BODY)).status).toBe(403);
  });
});
```

`tests/app/profile.test.ts` (this task's `describe("the profile page")`): the page source contains `loadParticipant()`, `force-dynamic`, `redirect("/consent")`, `redirect("/sign-in")`, `<ProfileSetup`, `prefillRole(`, `diseaseOptions()`; `ProfileSetup.tsx` contains `Tell us about yourself`, `fetch("/api/profile/setup"`, `router.replace("/chat")`, `<datalist`, `countryIso3For(`, `"Could not save. Please try again."`, `required`; `ConsentForm.tsx` contains `"/profile"` and no longer `? "/chat"`; `app/consent/page.tsx` contains `redirect("/profile")`; `next.config.ts` contains `"/profile"`, `"/api/profile"`, `"/api/profile/setup"`, `"/api/memories"`, `"/api/memories/[id]"`. `tests/lib/session.test.ts`: the prefixes gain `/profile`. `tests/app/pages.test.ts`: add `app/profile/page.tsx` to the protected-pages loop. `tests/client/profile.test.ts` (this task's part): `countryIso3For("Kenya")`, `("kenya")`, `("KEN")`, `("ken")` → `KEN`; `("Narnia")` and `("")` → null; `countryLabel("KEN")` → `Kenya`, `countryLabel(null)` → `""`.

- [ ] **Step 2: Run them to verify they fail.**

- [ ] **Step 3: Implement**

`requireParticipant(options = {})`: `const refusal = options.allowIncompleteProfile && participant.status === "profile" ? null : apiRefusal(participant.status)` and the rest unchanged.

`lib/profile/options.ts`:

```ts
import { knownDiseases, lookup } from "@/lib/disease/db";
export type DiseaseOption = { key: string; name: string };
/** The database's diseases for the two suggestion lists, by display name. */
export function diseaseOptions(): DiseaseOption[] {
  return knownDiseases().map((key) => ({ key, name: lookup(key)?.display_name ?? key })).sort((a, b) => a.name.localeCompare(b.name));
}
```

(`knownDiseases()` returns the keys; if it returns entries, map their `key` and `display_name`.)

`lib/client/profile.ts` (this task's part):

```ts
import names from "@/data/country_names.json";
export const COUNTRY_NAMES = names as Record<string, string>;
export const COUNTRY_OPTIONS: { iso3: string; name: string }[] = Object.entries(COUNTRY_NAMES).map(([iso3, name]) => ({ iso3, name })).sort((a, b) => a.name.localeCompare(b.name));
/** The ISO3 for a typed name or code (case-insensitive), or null. */
export function countryIso3For(text: string): string | null {
  const t = text.trim();
  if (t.length === 0) return null;
  if (Object.hasOwn(COUNTRY_NAMES, t.toUpperCase())) return t.toUpperCase();
  const hit = COUNTRY_OPTIONS.find((c) => c.name.toLowerCase() === t.toLowerCase());
  return hit?.iso3 ?? null;
}
export function countryLabel(iso3: string | null): string { return iso3 ? (COUNTRY_NAMES[iso3] ?? iso3) : ""; }
```

`app/profile/page.tsx`: `loadParticipant()`; `sign_in`/`forbidden` → `redirect("/sign-in")`; `consent` → `redirect("/consent")`; render `<Brand />`, "Signed in as …", and `<ProfileSetup initial={participant.profile?.fields ?? EMPTY_PROFILE} prefillRole={participant.profile?.fields.role ?? prefillRole(participant.profile?.participantType ?? null)} diseases={diseaseOptions()} completed={participant.status === "ok"} />`; `export const dynamic = "force-dynamic"`.

`components/ProfileSetup.tsx` ("use client"): heading `Tell us about yourself` and one line "Your answers shape how much detail the assistant gives and how it frames results. You can change them any time in the Profile tab."; the form: role `<select required>` (ROLE_LABELS, a blank first option, preselected from `prefillRole`), experience radios (EXPERIENCE_LABELS), goals checkboxes (GOAL_LABELS), disease `<input list="disease-options">` with a `<datalist>` of the names, country `<input list="country-options">` with the names from `COUNTRY_OPTIONS`, decisions `<input maxLength={200}>`, results select, report format select; Save disabled while busy. Validation before submit: role, experience, one goal (mark with `aria-invalid` and a line "Please choose …"); a non-empty country that `countryIso3For` cannot resolve: "Pick a country from the list". Submit `POST /api/profile/setup`; 204 → `router.replace("/chat"); router.refresh()`; 400 with a field → mark it; else "Could not save. Please try again.". The button reads "Save and continue"; when `completed`, a quiet link "Back to the chat" (`/chat`) sits beside it.

`app/api/profile/setup/route.ts`: gate with the option; parse with `SetupInput` (400 `{ code: "bad_request", field: String(issue.path[0] ?? "body") }` on the first issue; bad JSON → field "body"); `diseaseInterest` → `diseaseKeyOrText`; `const { first } = await supabaseProfileStore(admin).saveProfile(user.id, input, now)`; event `first ? "profile_completed" : "profile_updated"` with meta `{ role, experience, goals: goals.join(","), has_disease, has_country, has_decisions }`; 204; a thrown store error → 500 `{ code: "service_unavailable", message: "Something went wrong. Please try again." }`.

`ConsentForm`: `router.replace(body.decision === "agree" ? "/profile" : "/sign-in?declined=1")`. Consent page: `if (participant.status === "profile") redirect("/profile")` before the `ok` line. `PROTECTED_PREFIXES` gains `"/profile"`. `next.config.ts` gains the five tracing entries.

- [ ] **Step 4: Run** `npx vitest run tests/api/setupRoute.test.ts tests/app tests/lib/session.test.ts tests/client/profile.test.ts && npm run -s typecheck && npm run -s lint` — PASS.
- [ ] **Step 5: Commit** — `feat(profile): the questionnaire page, the setup route, and the consent hand-off`.

---

### Task 4: The profile and memory routes

**Files:**
- Create: `web/app/api/profile/route.ts` (GET, PATCH), `web/app/api/memories/route.ts` (GET, POST, DELETE), `web/app/api/memories/[id]/route.ts` (PATCH, DELETE)
- Modify: `web/lib/db/memories.ts` (`MemoryInput`, `MemoryPatchInput`)
- Test: `web/tests/api/profileRoute.test.ts`, `web/tests/api/memoriesRoute.test.ts`

**Interfaces:**
- Consumes: `ProfilePatch`, `diseaseKeyOrText` (Task 1); `ProfileStore.get/patchProfile`, `MemoryStore`, `MEMORY_CAP` (Task 2); `requireParticipant()` (status `ok` only).
- Produces: `GET /api/profile` → 200 `{ profile: ProfileFields }`; `PATCH /api/profile` body `ProfilePatch` → 200 `{ profile }` (re-read), 400 `{ code: "bad_request", field }` (an empty patch: field "body"); events `profile_updated { fields: "role,goals" }` for profile keys and `memory_toggled { enabled }` when `memoryEnabled` is among them. `GET /api/memories` → `{ memories: Memory[] }` newest first; `POST /api/memories` `{ kind, text }` → 201 `{ memory }`, 409 `{ code: "memory_full", message: "Your memory list is full (30). Remove one to add another." }`, event `memory_added { memory_id, kind, source: "participant", replaced: false }`; `DELETE /api/memories` → 200 `{ count }`, event `memory_removed { all: true, count }`; `PATCH /api/memories/[id]` `{ kind?, text? }` → 204, 404 `{ code: "not_found" }`, event `memory_updated { memory_id, fields }`; `DELETE /api/memories/[id]` → 204 or 404, event `memory_removed { memory_id }`. `MemoryInput` zod in `lib/db/memories.ts`: `{ kind: z.enum(MEMORY_KINDS), text: z.string().trim().min(3).max(200) }`; `MemoryPatchInput` with both optional and at least one (`.refine`).

- [ ] **Step 1: Write the failing tests** — `profileRoute.test.ts`: GET maps the row to fields; PATCH `{ goals: ["exploring"], diseaseInterest: "Measles" }` updates `goals` and `disease_interest: "measles"`, logs `profile_updated` with `fields: "goals,diseaseInterest"`, answers the re-read profile; PATCH `{ memoryEnabled: false }` logs `memory_toggled { enabled: false }` and no `profile_updated`; PATCH `{}` → 400; PATCH `{ goals: [] }` → 400 field "goals"; the gate passes through. `memoriesRoute.test.ts`: GET lists; POST inserts with `source: "participant"` and `source_conversation_id: null`, answers 201 with the memory and logs `memory_added`; POST at the cap (count outcome 30) → 409 and no insert; POST with text of two characters → 400; DELETE all → `{ count }` and the `all: true` meta; PATCH `[id]` → 204 and `memory_updated { memory_id, fields: "text" }`; PATCH of a foreign id (update returns no rows) → 404; DELETE `[id]` → 204 / 404; a non-uuid id → 400; the gate passes through for each handler.

- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement** the three route files with the share route's shape: gate, `readBody` with the zod schema, the store, `supabaseStepEventSink(admin).log`, a try/catch answering 500 `service_unavailable`. `[id]` comes from `params` (a Promise) and is validated with `z.uuid()` (400 otherwise).
- [ ] **Step 4: Run** `npx vitest run tests/api && npm run -s typecheck` — PASS.
- [ ] **Step 5: Commit** — `feat(profile): the profile and memory routes`.

---

### Task 5: The `remember` tool, the About block on the first message, and the prompt section

**Files:**
- Create: `web/lib/tools/remember.ts`
- Modify: `web/lib/tools/types.ts` (`MemoryPayload`, `ToolDeps.memory`), `web/lib/tools/index.ts` (eighth tool + registry), `web/lib/enums.ts` (`CARD_KINDS` + `memory`), `web/lib/chat/prompt.ts` (`## The participant`), `web/lib/chat/handleChat.ts` (`ChatDeps.profiles/memories`, the block, the tool list, the event), `web/app/api/chat/route.ts` (the two stores)
- Test: `web/tests/tools/remember.test.ts`, `web/tests/tools/helpers.ts` (`memory` fake), `web/tests/tools/registry.test.ts`, `web/tests/chat/prompt.test.ts`, `web/tests/chat/handleChat.test.ts`

**Interfaces:**
- Consumes: `aboutBlock`, `Memory`, `firstUserMessage(date, text, about)` (Task 1); `ProfileStore.get`, `MemoryStore`, `MEMORY_CAP` (Task 2).
- Produces: `MemoryPayload = { kind: "memory"; memory_id: string; memory_kind: MemoryKind; text: string; replaced: boolean }` in `CardPayload`; `ToolDeps.memory = { enabled: boolean; added: number; list(): Promise<Memory[]>; add(kind: MemoryKind, text: string, replaces?: string): Promise<{ id: string } | "full" | "not_found"> }`; `RememberInput`, `remember(input, deps)`, `MEMORY_OFF`, `MEMORY_LIMIT`, `MEMORY_FULL`, `MEMORY_NOT_FOUND`, `PER_TURN = 3`; `TOOLS[7].name === "remember"`; `ChatDeps` gains `profiles: ProfileStore; memories: MemoryStore`.
- Ruling carried in the plan (ledger it at pre-flight): `replaces` is the **text** of the earlier memory as the About block shows it, not a uuid: the block carries no ids, so a uuid could never be supplied by the model. Matched case-insensitively against the participant's active memories. The tool schema says so.
- Ruling carried in the plan: the report framing by goals lives in the byte-stable prompt section, not in a per-participant `write_report` description, and `composeReport` is unchanged: a per-participant tool description would split the shared prompt cache, which the spec's approach 1 exists to keep.

- [ ] **Step 1: Write the failing tests**

`tests/tools/helpers.ts`: `makeDeps` gains `memory` (over: `memoryEnabled?: boolean; memories?: Memory[]; memoryAdd?: "full" | "not_found" | Error`): `deps.memory = { enabled: over.memoryEnabled ?? true, added: 0, list: async () => over.memories ?? [], add: async (kind, text, replaces) => { deps.remembered.push({ kind, text, replaces }); if (over.memoryAdd instanceof Error) throw over.memoryAdd; return over.memoryAdd ?? { id: "m-new" }; } }` with `FakeDeps.remembered: { kind: string; text: string; replaces?: string }[]`.

`tests/tools/remember.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MEMORY_FULL, MEMORY_LIMIT, MEMORY_NOT_FOUND, MEMORY_OFF, PER_TURN, remember } from "@/lib/tools/remember";
import { executeTool } from "@/lib/tools";
import { makeDeps } from "./helpers";

const INPUT = { kind: "preference" as const, text: "Prefers results as tables" };

describe("remember", () => {
  it("stores an agent memory and answers the model with the payload", async () => {
    const deps = makeDeps();
    const out = await remember(INPUT, deps);
    expect(out).toEqual({ content: "Remembered: Prefers results as tables", payload: { kind: "memory", memory_id: "m-new", memory_kind: "preference", text: "Prefers results as tables", replaced: false } });
    expect(deps.remembered).toEqual([{ kind: "preference", text: "Prefers results as tables", replaces: undefined }]);
    expect(deps.memory.added).toBe(1);
  });

  it("is refused when memory is off, after three in a turn, at the cap, and for an unknown replaces — never as an error", async () => {
    expect(await remember(INPUT, makeDeps({ memoryEnabled: false }))).toEqual({ content: MEMORY_OFF });
    const deps = makeDeps();
    for (let i = 0; i < PER_TURN; i++) expect((await remember(INPUT, deps)).payload?.kind).toBe("memory");
    expect(await remember(INPUT, deps)).toEqual({ content: MEMORY_LIMIT });
    expect(await remember(INPUT, makeDeps({ memoryAdd: "full" }))).toEqual({ content: MEMORY_FULL });
    expect(await remember({ ...INPUT, replaces: "Likes charts" }, makeDeps({ memoryAdd: "not_found" }))).toEqual({ content: MEMORY_NOT_FOUND });
    expect(MEMORY_OFF).toBe("MEMORY OFF: this participant switched memory off.");
    expect(MEMORY_LIMIT).toBe("MEMORY LIMIT: three per turn.");
    expect(MEMORY_FULL).toBe("MEMORY FULL: ask the participant to tidy their memory list.");
    expect(MEMORY_NOT_FOUND).toBe("MEMORY NOT FOUND: no such memory to replace.");
  });

  it("marks a replacement and validates through the registry", async () => {
    const deps = makeDeps();
    const out = await executeTool("remember", { kind: "situation", text: "Works at a county health office", replaces: "Works at a clinic" }, deps);
    expect(out.payload).toMatchObject({ kind: "memory", replaced: true, duration_ms: expect.any(Number) });
    expect((await executeTool("remember", { kind: "wish", text: "x" }, deps)).isError).toBe(true);
    expect((await executeTool("remember", { kind: "role", text: "ab" }, deps)).isError).toBe(true);
    expect((await executeTool("remember", { kind: "role", text: "A modeler", replaces: null }, deps)).payload).toMatchObject({ replaced: false });
  });
});
```

`tests/tools/registry.test.ts`: the eight tools, `remember` last, `required: ["kind", "text"]`, `kind` enum equal to `MEMORY_KINDS`. `tests/chat/prompt.test.ts`: `## The participant` between `## About EpiChat` and `## Decisions recap`; phrases `About this participant`, `never use a name`, `one in ten`, `sensitivity runs`, `quotable`, `preferred format first`, `replaces`.

`tests/chat/handleChat.test.ts` — `setup` gains fakes `profiles: ProfileStore` (get → `{ userId, email, participantType: "graduate_student", consentVersion, consentedAt, fields: over.profile ?? EMPTY_PROFILE }`, the other methods no-ops; `over.profileError` makes `get` throw) and `memories: MemoryStore` (list → `over.memories ?? []`, `countActive` → `over.memoryCount ?? 0`, `evictOldestAgent` → `over.evicted ?? true`, `add` records `calls.memoriesAdded.push([userId, kind, text, source, conversationId])` and returns `"m-new"`, `deactivate` records `calls.deactivated.push([userId, id])` and returns true; the rest no-ops). Existing pins: the tool-name list gains `"remember"` before `"web_search"`. New cases:

```ts
const COMPLETE = { ...EMPTY_PROFILE, role: "policy_maker" as const, experience: "some" as const, goals: ["deciding" as const], completedAt: "2026-10-09T10:00:00Z" };
const REMEMBERED: Memory = { id: "m1", kind: "situation", text: "Works at a county health office", source: "agent", createdAt: "2026-10-08T10:00:00Z" };

it("puts the About block on a conversation's first message only", async () => {
  const first = setup([{ message: ANSWER }], { profile: COMPLETE, memories: [REMEMBERED] });
  await first.run({ ...HELLO, sessionId: SESSION });
  expect(first.requests[0].messages).toEqual([{ role: "user", content: firstUserMessage("2026-10-05", HELLO.text, aboutBlock(COMPLETE, [REMEMBERED])) }]);
  expect(first.finished[0].turn.user_text).toBe(HELLO.text);
  const resumed = setup([{ message: ANSWER }], { profile: COMPLETE, memories: [REMEMBERED], history: HISTORY });
  await resumed.run({ conversationId: CONVERSATION, sessionId: SESSION, text: "Run it" });
  expect(resumed.requests[0].messages.at(-1)).toEqual({ role: "user", content: "Run it" });
});

it("withholds remember and the Remembered line when memory is off", async () => {
  const { run, requests } = setup([{ message: ANSWER }], { profile: { ...COMPLETE, memoryEnabled: false }, memories: [REMEMBERED] });
  await run({ ...HELLO, sessionId: SESSION });
  expect((requests[0].tools as { name: string }[]).map((t) => t.name)).not.toContain("remember");
  expect(String((requests[0].messages as { content: string }[])[0].content)).not.toContain("Remembered");
});

it("stores an agent memory from a remember call, deactivating the one it replaces, and logs memory_added", async () => {
  const REMEMBER = message([toolUse("tu_m", "remember", { kind: "preference", text: "Prefers tables", replaces: "works at a county health office" })], "tool_use");
  const { run, finished, memoriesAdded, deactivated } = setup([{ message: REMEMBER }, { message: ANSWER }], { profile: COMPLETE, memories: [REMEMBERED] });
  await run({ ...HELLO, sessionId: SESSION });
  expect(memoriesAdded).toEqual([[USER.id, "preference", "Prefers tables", "agent", CONVERSATION]]);
  expect(deactivated).toEqual([[USER.id, "m1"]]);
  expect(finished[0].step_events.find((e) => e.kind === "memory_added")).toMatchObject({ tool: "remember", meta: { memory_id: "m-new", kind: "preference", replaced: true } });
});

it("answers MEMORY FULL at the cap when every memory is the participant's own, and evicts the oldest agent memory otherwise", async () => {
  const REMEMBER = message([toolUse("tu_m", "remember", { kind: "preference", text: "Prefers tables" })], "tool_use");
  const full = setup([{ message: REMEMBER }, { message: ANSWER }], { profile: COMPLETE, memoryCount: 30, evicted: false });
  await full.run({ ...HELLO, sessionId: SESSION });
  expect(full.memoriesAdded).toEqual([]);
  expect((full.requests[1].messages as { content: { content: string }[] }[]).at(-1)?.content[0].content).toBe("MEMORY FULL: ask the participant to tidy their memory list.");
  const evicting = setup([{ message: REMEMBER }, { message: ANSWER }], { profile: COMPLETE, memoryCount: 30, evicted: true });
  await evicting.run({ ...HELLO, sessionId: SESSION });
  expect(evicting.memoriesAdded).toHaveLength(1);
});

it("answers without a block or the remember tool when the profile cannot be read", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const { run, requests, emitted } = setup([{ message: ANSWER }], { profileError: new Error("down") });
  await run({ ...HELLO, sessionId: SESSION });
  expect((requests[0].tools as { name: string }[]).map((t) => t.name)).not.toContain("remember");
  expect(requests[0].messages).toEqual([{ role: "user", content: "Today's date: 2026-10-05.\n\nModel measles in Kenya" }]);
  expect(emitted.at(-1)).toMatchObject({ type: "done" });
  logged.mockRestore();
});
```

(The tool-result content shape in the MEMORY FULL assertion follows what `runTurn` appends; read `tests/chat/runTurn.test.ts` for the exact block and adjust the path, not the expectation.)

- [ ] **Step 2: Run them to verify they fail.**

- [ ] **Step 3: Implement**

`lib/tools/remember.ts`:

```ts
import { z } from "zod";
import { MEMORY_KINDS } from "@/lib/enums";
import type { MemoryPayload, ToolDeps, ToolOutcome } from "./types";

export const RememberInput = z.strictObject({
  kind: z.enum(MEMORY_KINDS),
  text: z.string().trim().min(3).max(200),
  replaces: z.string().trim().min(3).max(200).nullable().optional().transform((v) => v ?? undefined),
});
export type RememberArgs = z.infer<typeof RememberInput>;
export const MEMORY_OFF = "MEMORY OFF: this participant switched memory off.";
export const MEMORY_LIMIT = "MEMORY LIMIT: three per turn.";
export const MEMORY_FULL = "MEMORY FULL: ask the participant to tidy their memory list.";
export const MEMORY_NOT_FOUND = "MEMORY NOT FOUND: no such memory to replace.";
export const PER_TURN = 3;

/** Profile spec, section 9: never an error outcome; the refusals are plain text for the model. */
export async function remember(input: RememberArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const memory = deps.memory;
  if (!memory.enabled) return { content: MEMORY_OFF };
  if (memory.added >= PER_TURN) return { content: MEMORY_LIMIT };
  const result = await memory.add(input.kind, input.text, input.replaces);
  if (result === "full") return { content: MEMORY_FULL };
  if (result === "not_found") return { content: MEMORY_NOT_FOUND };
  memory.added += 1;
  const payload: MemoryPayload = { kind: "memory", memory_id: result.id, memory_kind: input.kind, text: input.text, replaced: input.replaces !== undefined };
  return { content: `Remembered: ${input.text}`, payload };
}
```

The tool entry (after `write_report`): description = "Remember something about this participant for future conversations: a role, their situation, a preference about how they like results, a decision they can make, a solution they already use. One short line, in the third person, without their name. Use it when they state such a thing, not for facts about the disease or the scenario. Pass replaces with the exact text of an earlier memory from the About block to update it."; `input_schema.properties`: `kind: { type: "string", enum: [...MEMORY_KINDS], description: "What kind of thing this is." }`, `text: { type: "string", description: "One line, 3 to 200 characters, in the third person." }`, `replaces: { type: ["string", "null"], description: "The exact text of the memory this one supersedes, as the About block shows it." }`; `required: ["kind", "text"]`.

`handleChat`: after the conversation is loaded, read the profile once:

```ts
let fields: ProfileFields | null = null;
try {
  fields = (await deps.profiles.get(user.id))?.fields ?? null;
} catch (error) {
  console.error("profile read failed", failureText(error));
}
const memoryOn = fields?.memoryEnabled === true;
let memories: Memory[] = [];
if (history.length === 0 && memoryOn) {
  try { memories = await deps.memories.list(user.id); } catch (error) { console.error("memories read failed", failureText(error)); }
}
const about = fields && history.length === 0 ? aboutBlock(fields, memories) : null;
const userMessage: Message = { role: "user", content: history.length === 0 ? firstUserMessage(day, request.text, about) : request.text };
```

`toolDeps.memory` as in the Interfaces block: `add` looks the replacement up by text (case-insensitive, trimmed) in `deps.memories.list(user.id)` → `"not_found"`; with a replacement: `deactivate` then `add`; without: `countActive >= MEMORY_CAP` → `evictOldestAgent` → `"full"` when nothing was evicted; then `add(user.id, kind, text, "agent", conversationId)`. `runTool`: when `outcome.payload?.kind === "memory"`, also `step("memory_added", { tool: name, meta: { memory_id, kind: memory_kind, replaced } })`. The request: `tools: [...(memoryOn ? TOOLS : TOOLS.filter((t) => t.name !== "remember")), ...WEB_TOOLS]`. The chat route adds `profiles: supabaseProfileStore(admin), memories: supabaseMemoryStore(admin)`.

The prompt section, inserted after the About EpiChat bullets and before `## Decisions recap`:

```
## The participant

- The first message of a conversation may carry an "About this participant" block from their profile and your memory. Use it to pitch the detail and the framing; never repeat it back, never ask for what it already says, and never use a name.
- Experience "none": explain every term the first time it comes up, lead with what the numbers mean for people, keep parameter names out of the prose unless asked, and use comparisons such as "about one in ten". "Some": the standard voice. "A lot": name parameters, methods, and caveats in full, and offer sensitivity runs.
- Wants "learning": teach as you go, one idea at a time. "Exploring scenarios": propose comparisons and what-ifs. "Making decisions": lead with implications and options, and say what the model can and cannot tell them. "Communicating to others": give quotable one-sentence findings and name the figure that shows each.
- Prefers "plain-language summary": fewer numbers in the prose. "Tables and numbers": a Markdown table for every comparison. "Charts": point to the panel's chart views. "All of them": the standard.
- When offering the report, name their preferred format first. When writing it, lead the summary the way their goals ask: implications and options for decisions, a teaching thread for learning, comparisons for exploring, quotable findings for communicating.
- Call remember when the participant states something about themselves worth keeping for future conversations: their role, their situation, a preference about results, a decision they can make, a solution they already use. One short line in the third person, never a name, never a fact about the disease or the scenario. When they correct something the About block remembered, call it with replaces set to that memory's text.
```

- [ ] **Step 4: Run** `npx vitest run tests/tools tests/chat && npm run -s typecheck` — PASS.
- [ ] **Step 5: Commit** — `feat(profile): the remember tool, the About block, and the participant prompt section`.

---

### Task 6: The client helpers for the tab, the activity line, and the download order

**Files:**
- Modify: `web/lib/client/profile.ts` (requests), `web/lib/client/artifacts.ts` (`memoryWrites`), `web/lib/client/activity.ts`, `web/lib/client/toolLine.ts`, `web/lib/client/download.ts` (`orderFormats`)
- Test: `web/tests/client/profile.test.ts`, `web/tests/client/artifacts.test.ts`, `web/tests/client/activity.test.ts`, `web/tests/client/download.test.ts`

**Interfaces:**
- Consumes: `MemoryPayload` (Task 5); the route contracts (Task 4).
- Produces in `lib/client/profile.ts`: `loadProfile(send?)`, `patchProfile(patch: ProfilePatchArgs, send?)` → `{ ok: true; profile: ProfileFields } | { ok: false; message: string }`; `loadMemories(send?)` → `{ ok: true; memories: Memory[] } | { ok: false }`; `addMemory(kind, text, send?)` → `{ ok: true; memory: Memory } | { ok: false; message: string }` ("Your memory list is full (30). Remove one to add another." on 409, else "Could not save. Please try again."); `updateMemory(id, patch, send?)`, `removeMemory(id, send?)`, `forgetAll(send?)` → `{ ok: true } | { ok: false; message: string }`; `memoryAddedLine(m: Memory)`: `Added by the assistant on 9 October 2026` / `Added by you on 9 October 2026` (the share helper's date format). `Artifacts.memoryWrites: number` (count of successful `remember` results). `summarizeActivity` → `Remembered: <text>` for a `memory` payload, `Remembered` without one. `TOOL_LABELS.remember = "🧠 Remembered"`, `TOOL_STATUS.remember = "Remembering…"`. `orderFormats(preferred: ExportFormat): ExportFormat[]` → the preferred first, the rest in `EXPORT_FORMATS` order.

- [ ] **Step 1: Write the failing tests** — `tests/client/profile.test.ts` with a fake `send` (the pattern of `tests/client/share.test.ts`): each request's method, path, and body; the 409 message; the generic failure; `memoryAddedLine` for both sources. `artifacts.test.ts`: two `remember` results and one failed one → `memoryWrites` 2; `emptyArtifacts().memoryWrites` 0. `activity.test.ts`: `summarizeActivity([tool("remember", { kind: "memory", memory_id: "m1", memory_kind: "preference", text: "Prefers tables", replaced: false })])` → `Remembered: Prefers tables`; `toolLabel("remember")` → `🧠 Remembered`. `download.test.ts`: `orderFormats("docx")` → `["docx", "md", "html", "pdf"]`; `orderFormats("md")` → the default order.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement** as the Interfaces block says.
- [ ] **Step 4: Run** `npx vitest run tests/client && npm run -s typecheck` — PASS.
- [ ] **Step 5: Commit** — `feat(profile): client helpers for the Profile tab and the memory line`.

---

### Task 7: The Profile tab in the right column

**Files:**
- Create: `web/components/panel/PanelTabs.tsx`, `web/components/panel/ProfilePanel.tsx`
- Modify: `web/components/Chat.tsx`, `web/components/panel/DetailsPanel.tsx` (drop the `Details` h2; `preferredFormat` prop through to `ReportSection`), `web/components/panel/ReportSection.tsx` (`preferredFormat`, `orderFormats`), `web/components/Welcome.tsx`, `web/app/chat/page.tsx`, `web/app/chat/[id]/page.tsx`
- Test: `web/tests/app/profile.test.ts` (static pins), `web/tests/app/pages.test.ts`, `web/tests/app/workspace.test.ts` (if a pin names the h2)

**Interfaces:**
- Consumes: `ProfileFields`, `EMPTY_PROFILE`, labels (Task 1); `DiseaseOption`, `diseaseOptions()`, `COUNTRY_OPTIONS`, `countryIso3For`, `countryLabel` (Task 3); the requests, `memoryAddedLine`, `orderFormats`, `Artifacts.memoryWrites` (Task 6).
- Produces: `PanelTabs` props `{ tab: PanelTab; onTab: (tab: PanelTab) => void; details: ReactNode; profile: ReactNode }` with `type PanelTab = "details" | "profile"`, `role="tablist"`, two `role="tab"` buttons with `aria-selected` and `aria-controls`, ArrowLeft/ArrowRight/Home/End moving the selection, one `role="tabpanel"`; `ProfilePanel` props `{ profile: ProfileFields; diseases: DiseaseOption[]; memoryWrites: number; onProfileChange: (profile: ProfileFields) => void; onSectionOpen: (section: PanelSection) => void }`; `Chat` props gain `initialProfile: ProfileFields` and `diseases: DiseaseOption[]`; both chat pages pass them.

- [ ] **Step 1: Write the failing static pins** in `tests/app/profile.test.ts`, `describe("the Profile tab")`: `PanelTabs.tsx` contains `role="tablist"`, `role="tab"`, `aria-selected`, `role="tabpanel"`, `"ArrowRight"`, `"ArrowLeft"`, `Details`, `Profile`; `ProfilePanel.tsx` contains `title="Profile"`, `title="Preferences"`, `title="Memory"`, `Changes reach the assistant from your next conversation.`, `Remember things about me across conversations`, `Nothing remembered yet. The assistant adds what you tell it about your role, your situation, and your preferences; you can add your own.`, `Forget everything`, `Memory could not be loaded.`, `Retry`, `Could not save. Please try again.`, `loadMemories(`, `patchProfile(`, `addMemory(`, `updateMemory(`, `removeMemory(`, `forgetAll(`, `memoryAddedLine(`, `memoryWrites`, `<datalist`, `countryIso3For(`, and not `window.confirm`; `Chat.tsx` contains `<PanelTabs`, `<ProfilePanel`, `"profile_required"`, `router.replace("/profile")`, `onSectionOpen("profile")`, `memoryWrites={artifacts.memoryWrites}`, `preferredFormat={profile.reportFormat}`; `DetailsPanel.tsx` contains `preferredFormat` and not `>Details</h2>`; `ReportSection.tsx` contains `orderFormats(`; `Welcome.tsx` contains `Profile tab`; both chat pages contain `initialProfile=` and `diseases={diseaseOptions()}`.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement**

`PanelTabs`: a `div role="tablist" aria-label="Right column"` with two buttons (`id="tab-details"`, `id="tab-profile"`, `aria-controls="panel-details"|"panel-profile"`, `tabIndex` 0 on the selected and -1 on the other, the keyboard handler on the list), then `<div role="tabpanel" id=… aria-labelledby=…>` holding `details` or `profile`. Styles: the selected tab with `border-b-2 border-accent text-ink`, the other `text-ink-soft`.

`ProfilePanel`: three `Section`s (open by default: profile true, preferences false, memory true), each `onToggle` calling `onSectionOpen("profile")` when opening. **Profile**: a form bound to a `draft` copy of `profile` (`useState`), the same inputs as `ProfileSetup` (share the helpers; the form is small), Save (`patchProfile` with the keys that differ; on success `onProfileChange(result.profile)` and a "Saved." line for a moment) and Cancel (draft ← profile); the note line; a failed save keeps the draft and shows the message. **Preferences**: results select, report format select, and `<input type="checkbox" role="switch">` for memory; each change saves at once with `patchProfile({ … })`. **Memory**: `useEffect` keyed on `memoryWrites` loading the list (`loadMemories`); states loading / failed (the message + Retry) / ready; items newest first with the kind badge (`MEMORY_KIND_LABELS`), `memoryAddedLine`, Edit (inline text + kind select with Save/Cancel → `updateMemory`, then reload) and Delete (`removeMemory`, then reload); an Add row (kind select, text input `maxLength={200}`, Add → `addMemory`, the 409 message shown under the row); "Forget everything" opens an inline confirmation ("Forget all N memories?" with Forget and Keep; `forgetAll`, then reload); the empty state. When `profile.memoryEnabled` is false the list stays visible under a line "Memory is off: the assistant does not read or add to this list."

`Chat`: `const [tab, setTab] = useState<PanelTab>("details")`, `const [profile, setProfile] = useState(initialProfile)`; `panel={<PanelTabs tab={tab} onTab={(next) => { setTab(next); if (next === "profile") onSectionOpen("profile"); }} details={<DetailsPanel … preferredFormat={profile.reportFormat} />} profile={<ProfilePanel profile={profile} diseases={diseases} memoryWrites={artifacts.memoryWrites} onProfileChange={setProfile} onSectionOpen={onSectionOpen} />} />}`; the 403 branch: `if (response.status === 403 && problem?.code === "profile_required") { router.replace("/profile"); return; }`. `ReportSection`'s `ReportDownloads` maps `orderFormats(preferredFormat)` to the `FORMATS` entries. `Welcome`: under the contact line, `<p className="mt-2 text-center text-xs text-ink-faint">Your profile shapes the answers. Edit it in the Profile tab.</p>`. The pages: `initialProfile={participant.profile?.fields ?? EMPTY_PROFILE} diseases={diseaseOptions()}`.

- [ ] **Step 4: Run** `npx vitest run tests/app && npm run -s typecheck && npm run -s lint` — PASS; then `npm run build` once (the pages' props must serialize).
- [ ] **Step 5: Commit** — `feat(profile): the Profile tab, the preferred download first, and the chat wiring`.

---

### Task 8: Consent, the deploy document, and the pins

**Files:**
- Modify: `web/content/consent.md`, `web/docs/DEPLOY.md` (section 1.2 and a new `## 6g. Profile verification`), `web/tests/app/deploy.test.ts`, `web/tests/app/share.test.ts`, `web/tests/app/profile.test.ts`

- [ ] **Step 1: Write the failing pins** — `profile.test.ts`, `describe("consent and deployment (profile)")`: `content/consent.md` contains `version: 2026-10-10` and, whitespace-collapsed, `Your answers to the profile questions and what the assistant remembers about you, which you can see and edit.`; `docs/DEPLOY.md` contains `0006_profile_memory.sql`, `Profile verification`, `/api/profile`, `/api/memories`, `profile_completed`, `memory_added`, `version: 2026-10-10`. `share.test.ts`: the consent pin moves to `version: 2026-10-10`. `deploy.test.ts`: the phrase list gains `0006_profile_memory.sql`, `/api/profile`, `/api/memories`, `Profile verification`.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Write** the bullet after the share bullet under "What we collect"; the version line; DEPLOY.md 1.2: "Sub-project 4d adds `web/supabase/migrations/0006_profile_memory.sql` (the profile columns, the `memories` table, and six step-event kinds); run it after 0005, twice, before the profile code deploys, or every chat turn fails on the profile read. The same deploy carries `content/consent.md` at `version: 2026-10-10`, so every participant passes the consent page and then the profile page once."; section 6g with the spec's section 18 steps, numbered, in the style of 6f, including the Table Editor queries `select content from messages where conversation_id = '<id>' and seq = 1` and `select kind, meta from step_events where kind in ('profile_completed', 'profile_updated', 'memory_added', 'memory_updated', 'memory_removed', 'memory_toggled') order by at`.
- [ ] **Step 4: Run** `npm test` (the whole suite), `npm run -s typecheck`, `npm run -s lint` — PASS.
- [ ] **Step 5: Commit** — `feat(profile): consent bullet and version 2026-10-10, DEPLOY 6g`.

---

## Self-review

- **Spec coverage.** §3 flow: Tasks 3 (page), 7 (tab), 5 (block + tool), 7 (edit/delete/off/forget). §4 fields and pre-fill: Task 1. §5 table and cap: Tasks 2 and 5. §6 migration: Task 2. §7 gate and store: Tasks 2 and 3. §8 block: Tasks 1 and 5. §9 tool: Task 5 (`replaces` by text: a plan ruling). §10 prompt: Task 5; the report framing in the prompt and `composeReport` unchanged: a plan ruling; `ReportDownloads` order: Tasks 6 and 7. §11 tab: Task 7. §12 routes: Tasks 3 and 4. §13 consent: Task 8. §14 errors: Tasks 3, 4, 5, 7. §15 tests: every file named has a task; `tests/report/compose.test.ts` stays untouched since `composeReport` is unchanged. §17: `lib/client/drafts.ts` is not modified (nothing in the spec's body needs it). §18: Task 8.
- **Placeholders.** None; the forms are specified by their inputs and messages, the routes by their contracts.
- **Type consistency.** `ProfileFields`, `Memory`, `MemoryStore`, `ToolDeps.memory`, `saveProfile → { first }`, `countryIso3For`, `diseaseOptions`, `orderFormats`, `memoryWrites` are named the same in every task that uses them.
- **Review Focus.** Each line names its test: 1 → Task 2 refusal + Task 7 pin; 2 → Task 5 handler + Task 1 about; 3 → Task 5 handler ("MEMORY FULL at the cap") + Task 2 store; 4 → Task 5 handler ("first message only"); 5 → Task 1 schema + Task 3 route.
