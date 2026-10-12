/**
 * The parameter registry as Python exports it (scripts/export_web_data.py
 * writes data/param_registry.json from epichat/params/registry.py). Bounds
 * and defaults for the zod schema come from here, so the two languages
 * cannot disagree about them.
 */
import raw from "@/data/param_registry.json";

export type ParamSpec = {
  path: string;
  module: "disease" | "network" | "demographics" | "interventions" | "run";
  label: string;
  description: string;
  kind: "number" | "integer" | "bool" | "enum" | "string";
  unit: string | null;
  default: unknown;
  bounds: [number, number] | null;
  choices: string[] | null;
  models: string[];
  tier: "core" | "advanced" | "expert";
  db_field: string | null;
  starsim_target: string;
  affects: string[];
  requires: string[];
};

const FILE = raw as unknown as { version: number; params: ParamSpec[] };
export const REGISTRY_VERSION = FILE.version;
export const PARAM_REGISTRY: readonly ParamSpec[] = FILE.params;
const BY_PATH = new Map(PARAM_REGISTRY.map((s) => [s.path, s]));

export function specFor(path: string): ParamSpec | null {
  return BY_PATH.get(path) ?? null;
}

export function appliesTo(spec: ParamSpec, model: string): boolean {
  return spec.models.length === 0 || spec.models.includes(model);
}

export function applicableSpecs(model: string): ParamSpec[] {
  return PARAM_REGISTRY.filter((s) => appliesTo(s, model));
}

export function boundsOf(path: string): [number, number] {
  const spec = BY_PATH.get(path);
  if (!spec?.bounds) throw new Error(`no bounds for ${path}`);
  return spec.bounds;
}

export function defaultOf<T>(path: string): T {
  const spec = BY_PATH.get(path);
  if (!spec) throw new Error(`no registry entry for ${path}`);
  return spec.default as T;
}
