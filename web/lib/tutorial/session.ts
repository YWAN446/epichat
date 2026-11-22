/** The tutorial's progress, kept for the browser tab so a reload resumes where the participant was. Storage may be missing or blocked; then nothing is kept. */
import { restore, type TutorialState } from "./machine";

export const KEY = "epichat.tutorial";

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function saveProgress(state: TutorialState, replay: boolean): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ state, replay }));
  } catch {
    // Private windows and blocked site data: the tutorial simply starts again after a reload.
  }
}

/** The saved state and whether that run-through was a replay; null when nothing usable is saved. */
export function loadProgress(): { state: TutorialState; replay: boolean } | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { state?: unknown; replay?: unknown } | null;
    const state = restore(saved?.state);
    return state && typeof saved?.replay === "boolean" ? { state, replay: saved.replay } : null;
  } catch {
    return null;
  }
}

export function clearProgress(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
