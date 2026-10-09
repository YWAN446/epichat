"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { COUNTRY_OPTIONS, countryIso3For, countryLabel, diseaseLabel } from "@/lib/client/profile";
import {
  EXPERIENCES,
  EXPERIENCE_LABELS,
  EXPORT_FORMATS,
  GOALS,
  GOAL_LABELS,
  RESULTS_PREFS,
  RESULTS_PREF_LABELS,
  ROLES,
  ROLE_LABELS,
  type Experience,
  type ExportFormat,
  type Goal,
  type ResultsPref,
  type Role,
} from "@/lib/enums";
import type { DiseaseOption } from "@/lib/profile/options";
import type { ProfileFields } from "@/lib/profile/schema";

const INPUT = "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 focus-visible:border-accent";
const PRIMARY = "rounded-full bg-accent px-5 py-2.5 font-semibold text-white hover:bg-accent-deep disabled:bg-line disabled:text-ink-faint";
const QUIET = "rounded-full px-5 py-2.5 font-medium text-ink-soft hover:bg-paper-2 hover:text-ink";
const PROBLEM = "mt-1 text-sm text-warn-ink";

export const FORMAT_LABELS: Record<ExportFormat, string> = { md: "Markdown", html: "HTML", docx: "Word", pdf: "PDF" };

type Field = "role" | "experience" | "goals" | "countryInterest";
const PROBLEMS: Record<Field, string> = {
  role: "Please choose a role.",
  experience: "Please choose your experience with epidemic models.",
  goals: "Please choose at least one goal.",
  countryInterest: "Pick a country from the list.",
};

type Props = {
  initial: ProfileFields;
  /** The role the study category implies, when the profile has none yet. */
  prefillRole: Role | null;
  diseases: DiseaseOption[];
  /** True when the questionnaire was saved before: the participant came back to edit. */
  completed: boolean;
};

/** The questionnaire after consent (profile spec, section 3): role, experience, and goals required; the rest optional. */
export function ProfileSetup({ initial, prefillRole, diseases, completed }: Props) {
  const router = useRouter();
  const [role, setRole] = useState<Role | "">(initial.role ?? prefillRole ?? "");
  const [experience, setExperience] = useState<Experience | "">(initial.experience ?? "");
  const [goals, setGoals] = useState<Goal[]>(initial.goals);
  const [disease, setDisease] = useState(diseaseLabel(initial.diseaseInterest, diseases));
  const [country, setCountry] = useState(countryLabel(initial.countryInterest));
  const [decisions, setDecisions] = useState(initial.decisions ?? "");
  const [resultsPref, setResultsPref] = useState<ResultsPref>(initial.resultsPref);
  const [reportFormat, setReportFormat] = useState<ExportFormat>(initial.reportFormat);
  const [problem, setProblem] = useState<Field | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleGoal(goal: Goal) {
    setGoals((list) => (list.includes(goal) ? list.filter((g) => g !== goal) : [...list, goal]));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const iso3 = countryIso3For(country);
    const missing: Field | null = !role ? "role" : !experience ? "experience" : goals.length === 0 ? "goals" : country.trim() && !iso3 ? "countryInterest" : null;
    setProblem(missing);
    if (missing) return;
    setBusy(true);
    const body = { role, experience, goals, diseaseInterest: disease.trim() || null, countryInterest: iso3, decisions: decisions.trim() || null, resultsPref, reportFormat };
    const response = await fetch("/api/profile/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (response?.status === 204) {
      router.replace("/chat");
      router.refresh();
      return;
    }
    if (response?.status === 400) {
      const detail = (await response.json().catch(() => null)) as { field?: string } | null;
      if (detail?.field && Object.hasOwn(PROBLEMS, detail.field)) {
        setProblem(detail.field as Field);
        return;
      }
    }
    setError("Could not save. Please try again.");
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tell us about yourself</h1>
        <p className="mt-2 text-sm text-ink-soft">Your answers shape how much detail the assistant gives and how it frames results. You can change them any time in the Profile tab.</p>
      </div>

      <div>
        <label htmlFor="role" className="text-sm font-medium">
          Role or position
        </label>
        <select id="role" required value={role} onChange={(e) => setRole(e.target.value as Role | "")} aria-invalid={problem === "role"} className={`${INPUT} mt-1`}>
          <option value="">Choose…</option>
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </select>
        {problem === "role" && <p className={PROBLEM}>{PROBLEMS.role}</p>}
      </div>

      <fieldset aria-invalid={problem === "experience"}>
        <legend className="mb-1 text-sm font-medium">Experience with epidemic models</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {EXPERIENCES.map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="experience" required value={value} checked={experience === value} onChange={() => setExperience(value)} className="accent-accent" />
              {EXPERIENCE_LABELS[value]}
            </label>
          ))}
        </div>
        {problem === "experience" && <p className={PROBLEM}>{PROBLEMS.experience}</p>}
      </fieldset>

      <fieldset aria-invalid={problem === "goals"}>
        <legend className="mb-1 text-sm font-medium">What you want from simulations</legend>
        <div className="flex flex-col gap-2">
          {GOALS.map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input type="checkbox" name="goals" value={value} checked={goals.includes(value)} onChange={() => toggleGoal(value)} className="accent-accent" />
              {GOAL_LABELS[value]}
            </label>
          ))}
        </div>
        {problem === "goals" && <p className={PROBLEM}>{PROBLEMS.goals}</p>}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="disease" className="text-sm font-medium">
            Disease of interest <span className="font-normal text-ink-faint">(optional)</span>
          </label>
          <input id="disease" list="disease-options" value={disease} onChange={(e) => setDisease(e.target.value)} maxLength={60} autoComplete="off" className={`${INPUT} mt-1`} />
          <datalist id="disease-options">
            {diseases.map((option) => (
              <option key={option.key} value={option.name} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="country" className="text-sm font-medium">
            Country of interest <span className="font-normal text-ink-faint">(optional)</span>
          </label>
          <input id="country" list="country-options" value={country} onChange={(e) => setCountry(e.target.value)} aria-invalid={problem === "countryInterest"} autoComplete="off" className={`${INPUT} mt-1`} />
          <datalist id="country-options">
            {COUNTRY_OPTIONS.map((option) => (
              <option key={option.iso3} value={option.name} />
            ))}
          </datalist>
          {problem === "countryInterest" && <p className={PROBLEM}>{PROBLEMS.countryInterest}</p>}
        </div>
      </div>

      <div>
        <label htmlFor="decisions" className="text-sm font-medium">
          Decisions you can influence <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <input id="decisions" value={decisions} onChange={(e) => setDecisions(e.target.value)} maxLength={200} placeholder="e.g. vaccination campaigns, school closures" className={`${INPUT} mt-1`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="results" className="text-sm font-medium">
            How you prefer results
          </label>
          <select id="results" value={resultsPref} onChange={(e) => setResultsPref(e.target.value as ResultsPref)} className={`${INPUT} mt-1`}>
            {RESULTS_PREFS.map((value) => (
              <option key={value} value={value}>
                {RESULTS_PREF_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="format" className="text-sm font-medium">
            Preferred report format
          </label>
          <select id="format" value={reportFormat} onChange={(e) => setReportFormat(e.target.value as ExportFormat)} className={`${INPUT} mt-1`}>
            {EXPORT_FORMATS.map((value) => (
              <option key={value} value={value}>
                {FORMAT_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={PRIMARY}>
          Save and continue
        </button>
        {completed && (
          <Link href="/chat" className={QUIET}>
            Back to the chat
          </Link>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-r-lg border-l-[3px] border-warn bg-warn-wash px-3.5 py-2.5 text-sm text-warn-ink">
          {error}
        </p>
      )}
    </form>
  );
}
