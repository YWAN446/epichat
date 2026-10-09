"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { COUNTRY_OPTIONS, addMemory, countryIso3For, countryLabel, diseaseLabel, forgetAll, loadMemories, memoryAddedLine, patchProfile, removeMemory, updateMemory } from "@/lib/client/profile";
import {
  EXPERIENCES,
  EXPERIENCE_LABELS,
  EXPORT_FORMATS,
  GOALS,
  GOAL_LABELS,
  MEMORY_KINDS,
  MEMORY_KIND_LABELS,
  RESULTS_PREFS,
  RESULTS_PREF_LABELS,
  ROLES,
  ROLE_LABELS,
  type Experience,
  type ExportFormat,
  type Goal,
  type MemoryKind,
  type PanelSection,
  type ResultsPref,
  type Role,
} from "@/lib/enums";
import type { Memory } from "@/lib/profile/about";
import type { DiseaseOption } from "@/lib/profile/options";
import type { ProfileFields, ProfilePatchArgs } from "@/lib/profile/schema";
import { Section } from "./Section";

const FORMAT_LABELS: Record<ExportFormat, string> = { md: "Markdown", html: "HTML", docx: "Word", pdf: "PDF" };
const INPUT = "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus-visible:border-accent";
const LABEL = "text-xs font-medium text-ink-soft";
const BUTTON = "rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-accent hover:border-accent hover:bg-accent-wash disabled:opacity-50";
const PRIMARY = "rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-deep disabled:bg-line disabled:text-ink-faint";
const QUIET = "rounded-full px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-paper-2 hover:text-ink disabled:opacity-50";
const NOTE = "text-xs text-ink-faint";
const WARN = "text-xs text-warn-ink";
const SAVE_FAILED = "Could not save. Please try again.";
const NEXT_CONVERSATION = "Changes reach the assistant from your next conversation.";
const EMPTY_MEMORY = "Nothing remembered yet. The assistant adds what you tell it about your role, your situation, and your preferences; you can add your own.";

type Props = {
  profile: ProfileFields;
  diseases: DiseaseOption[];
  /** Successful remember calls so far; the list is re-read when it grows. */
  memoryWrites: number;
  onProfileChange: (profile: ProfileFields) => void;
  onSectionOpen: (section: PanelSection) => void;
};

/** The right column's Profile tab (profile spec, section 11): the fields, the preferences, and the memory, every item editable in place. */
export function ProfilePanel({ profile, diseases, memoryWrites, onProfileChange, onSectionOpen }: Props) {
  const [open, setOpen] = useState({ profile: true, preferences: false, memory: true });
  const toggle = (section: keyof typeof open) => (next: boolean) => {
    setOpen((state) => ({ ...state, [section]: next }));
    if (next) onSectionOpen("profile");
  };
  return (
    <div className="text-sm">
      <Section id="panel-profile-fields" title="Profile" open={open.profile} onToggle={toggle("profile")}>
        <ProfileForm profile={profile} diseases={diseases} onProfileChange={onProfileChange} />
      </Section>
      <Section id="panel-preferences" title="Preferences" open={open.preferences} onToggle={toggle("preferences")}>
        <Preferences profile={profile} onProfileChange={onProfileChange} />
      </Section>
      <Section id="panel-memory" title="Memory" open={open.memory} onToggle={toggle("memory")}>
        <MemoryList enabled={profile.memoryEnabled} memoryWrites={memoryWrites} />
      </Section>
    </div>
  );
}

/* The profile fields. */

type Draft = { role: Role | ""; experience: Experience | ""; goals: Goal[]; disease: string; country: string; decisions: string };

function draftOf(profile: ProfileFields, diseases: DiseaseOption[]): Draft {
  return {
    role: profile.role ?? "",
    experience: profile.experience ?? "",
    goals: profile.goals,
    disease: diseaseLabel(profile.diseaseInterest, diseases),
    country: countryLabel(profile.countryInterest),
    decisions: profile.decisions ?? "",
  };
}

/** The patch a draft implies against the saved profile; empty when nothing changed. */
function patchOf(draft: Draft, profile: ProfileFields, diseases: DiseaseOption[], iso3: string | null): ProfilePatchArgs {
  const patch: ProfilePatchArgs = {};
  if (draft.role && draft.role !== profile.role) patch.role = draft.role;
  if (draft.experience && draft.experience !== profile.experience) patch.experience = draft.experience;
  if (draft.goals.join(",") !== profile.goals.join(",")) patch.goals = draft.goals;
  if (draft.disease.trim() !== diseaseLabel(profile.diseaseInterest, diseases)) patch.diseaseInterest = draft.disease.trim() || null;
  if (iso3 !== profile.countryInterest) patch.countryInterest = iso3;
  if ((draft.decisions.trim() || null) !== profile.decisions) patch.decisions = draft.decisions.trim() || null;
  return patch;
}

function ProfileForm({ profile, diseases, onProfileChange }: { profile: ProfileFields; diseases: DiseaseOption[]; onProfileChange: (profile: ProfileFields) => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(profile, diseases));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((state) => ({ ...state, [key]: value }));
  const toggleGoal = (goal: Goal) => set("goals", draft.goals.includes(goal) ? draft.goals.filter((g) => g !== goal) : [...draft.goals, goal]);

  function flash() {
    setSaved(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaved(false), 3000);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const iso3 = countryIso3For(draft.country);
    if (draft.goals.length === 0) {
      setProblem("Please choose at least one goal.");
      return;
    }
    if (draft.country.trim() && !iso3) {
      setProblem("Pick a country from the list.");
      return;
    }
    const patch = patchOf(draft, profile, diseases, iso3);
    if (Object.keys(patch).length === 0) {
      flash();
      return;
    }
    setBusy(true);
    const result = await patchProfile(patch);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message || SAVE_FAILED);
      return;
    }
    onProfileChange(result.profile);
    setDraft(draftOf(result.profile, diseases));
    flash();
  }

  function cancel() {
    setDraft(draftOf(profile, diseases));
    setProblem(null);
  }

  return (
    <form onSubmit={save} noValidate className="space-y-3">
      <label className="block">
        <span className={LABEL}>Role or position</span>
        <select value={draft.role} onChange={(e) => set("role", e.target.value as Role | "")} className={`${INPUT} mt-1`}>
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className={LABEL}>Experience with epidemic models</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {EXPERIENCES.map((value) => (
            <label key={value} className="flex items-center gap-1.5">
              <input type="radio" name="panel-experience" value={value} checked={draft.experience === value} onChange={() => set("experience", value)} className="accent-accent" />
              {EXPERIENCE_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className={LABEL}>What you want from simulations</legend>
        <div className="mt-1 flex flex-col gap-1">
          {GOALS.map((value) => (
            <label key={value} className="flex items-center gap-1.5">
              <input type="checkbox" checked={draft.goals.includes(value)} onChange={() => toggleGoal(value)} className="accent-accent" />
              {GOAL_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className={LABEL}>Disease of interest</span>
        <input list="panel-disease-options" value={draft.disease} onChange={(e) => set("disease", e.target.value)} maxLength={60} autoComplete="off" className={`${INPUT} mt-1`} />
        <datalist id="panel-disease-options">
          {diseases.map((option) => (
            <option key={option.key} value={option.name} />
          ))}
        </datalist>
      </label>
      <label className="block">
        <span className={LABEL}>Country of interest</span>
        <input list="panel-country-options" value={draft.country} onChange={(e) => set("country", e.target.value)} autoComplete="off" className={`${INPUT} mt-1`} />
        <datalist id="panel-country-options">
          {COUNTRY_OPTIONS.map((option) => (
            <option key={option.iso3} value={option.name} />
          ))}
        </datalist>
      </label>
      <label className="block">
        <span className={LABEL}>Decisions you can influence</span>
        <input value={draft.decisions} onChange={(e) => set("decisions", e.target.value)} maxLength={200} className={`${INPUT} mt-1`} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className={PRIMARY}>
          Save
        </button>
        <button type="button" disabled={busy} onClick={cancel} className={QUIET}>
          Cancel
        </button>
        {saved && (
          <span role="status" className={NOTE}>
            Saved.
          </span>
        )}
      </div>
      {problem && (
        <p role="alert" className={WARN}>
          {problem}
        </p>
      )}
      <p className={NOTE}>{NEXT_CONVERSATION}</p>
    </form>
  );
}

/* The preferences: each change saves at once. */

function Preferences({ profile, onProfileChange }: { profile: ProfileFields; onProfileChange: (profile: ProfileFields) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function change(patch: ProfilePatchArgs) {
    setBusy(true);
    setProblem(null);
    const result = await patchProfile(patch);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message || SAVE_FAILED);
      return;
    }
    onProfileChange(result.profile);
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className={LABEL}>How you prefer results</span>
        <select value={profile.resultsPref} disabled={busy} onChange={(e) => void change({ resultsPref: e.target.value as ResultsPref })} className={`${INPUT} mt-1`}>
          {RESULTS_PREFS.map((value) => (
            <option key={value} value={value}>
              {RESULTS_PREF_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={LABEL}>Preferred report format</span>
        <select value={profile.reportFormat} disabled={busy} onChange={(e) => void change({ reportFormat: e.target.value as ExportFormat })} className={`${INPUT} mt-1`}>
          {EXPORT_FORMATS.map((value) => (
            <option key={value} value={value}>
              {FORMAT_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" role="switch" aria-checked={profile.memoryEnabled} checked={profile.memoryEnabled} disabled={busy} onChange={(e) => void change({ memoryEnabled: e.target.checked })} className="accent-accent" />
        <span>Remember things about me across conversations</span>
      </label>
      {problem && (
        <p role="alert" className={WARN}>
          {problem}
        </p>
      )}
      <p className={NOTE}>{NEXT_CONVERSATION}</p>
    </div>
  );
}

/* The memory list. */

type ListState = { status: "loading" } | { status: "failed" } | { status: "ready"; items: Memory[] };
type Outcome = { ok: boolean; message?: string };

function MemoryList({ enabled, memoryWrites }: { enabled: boolean; memoryWrites: number }) {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  // The list is re-read after every edit and whenever a turn's remember call lands; a stale answer is dropped.
  const reload = useCallback(async () => {
    const mine = ++generation.current;
    const result = await loadMemories();
    if (mine !== generation.current) return;
    setState(result.ok ? { status: "ready", items: result.memories } : { status: "failed" });
  }, []);
  useEffect(() => {
    void reload();
  }, [reload, memoryWrites]);

  async function act(task: () => Promise<Outcome>): Promise<boolean> {
    setBusy(true);
    setProblem(null);
    const result = await task();
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message ?? SAVE_FAILED);
      return false;
    }
    await reload();
    return true;
  }

  const items = state.status === "ready" ? state.items : [];
  return (
    <div className="space-y-3">
      {!enabled && <p className={NOTE}>Memory is off: the assistant does not read or add to this list.</p>}
      {state.status === "loading" && <p className={NOTE}>Loading…</p>}
      {state.status === "failed" && (
        <p className={WARN}>
          Memory could not be loaded.{" "}
          <button type="button" onClick={() => void reload()} className={BUTTON}>
            Retry
          </button>
        </p>
      )}
      {state.status === "ready" && items.length === 0 && <p className={NOTE}>{EMPTY_MEMORY}</p>}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((memory) => (
            <MemoryItem key={memory.id} memory={memory} busy={busy} onSave={(patch) => act(() => updateMemory(memory.id, patch))} onRemove={() => void act(() => removeMemory(memory.id))} />
          ))}
        </ul>
      )}
      <AddRow busy={busy} onAdd={(kind, text) => act(() => addMemory(kind, text))} />
      {items.length > 0 &&
        (confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs">Forget all {items.length === 1 ? "1 memory" : `${items.length} memories`}?</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                void act(() => forgetAll());
              }}
              className={PRIMARY}
            >
              Forget
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={QUIET}>
              Keep
            </button>
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => setConfirming(true)} className={QUIET}>
            Forget everything
          </button>
        ))}
      {problem && (
        <p role="alert" className={WARN}>
          {problem}
        </p>
      )}
    </div>
  );
}

type ItemProps = { memory: Memory; busy: boolean; onSave: (patch: { kind?: MemoryKind; text?: string }) => Promise<boolean>; onRemove: () => void };

function MemoryItem({ memory, busy, onSave, onRemove }: ItemProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.text);
  const [kind, setKind] = useState<MemoryKind>(memory.kind);

  function startEditing() {
    setText(memory.text);
    setKind(memory.kind);
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const patch: { kind?: MemoryKind; text?: string } = {};
    if (text.trim() !== memory.text) patch.text = text.trim();
    if (kind !== memory.kind) patch.kind = kind;
    if (Object.keys(patch).length === 0 || (await onSave(patch))) setEditing(false);
  }

  return (
    <li className="rounded-lg border border-line bg-surface px-3 py-2">
      {editing ? (
        <form onSubmit={save} className="space-y-2">
          <select value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)} className={INPUT}>
            {MEMORY_KINDS.map((value) => (
              <option key={value} value={value}>
                {MEMORY_KIND_LABELS[value]}
              </option>
            ))}
          </select>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} className={INPUT} />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || text.trim().length < 3} className={PRIMARY}>
              Save
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className={QUIET}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <span className="shrink-0 rounded-full bg-paper-2 px-2 text-[11px] font-medium text-ink-soft">{MEMORY_KIND_LABELS[memory.kind]}</span>
            <p className="flex-1">{memory.text}</p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={NOTE}>{memoryAddedLine(memory)}</span>
            <button type="button" disabled={busy} onClick={startEditing} className={QUIET}>
              Edit
            </button>
            <button type="button" disabled={busy} onClick={onRemove} className={QUIET}>
              Delete
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function AddRow({ busy, onAdd }: { busy: boolean; onAdd: (kind: MemoryKind, text: string) => Promise<boolean> }) {
  const [kind, setKind] = useState<MemoryKind>("preference");
  const [text, setText] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length < 3) return;
    if (await onAdd(kind, trimmed)) setText("");
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)} className={`${INPUT} w-auto`}>
        {MEMORY_KINDS.map((value) => (
          <option key={value} value={value}>
            {MEMORY_KIND_LABELS[value]}
          </option>
        ))}
      </select>
      <input aria-label="Something to remember" placeholder="Something to remember" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} className={`${INPUT} min-w-40 flex-1`} />
      <button type="submit" disabled={busy || text.trim().length < 3} className={BUTTON}>
        Add
      </button>
    </form>
  );
}
