import { getPath, setPath } from "@/lib/sim/paths";
import { appliesTo, specFor, type ParamSpec } from "@/lib/sim/registry";

type Obj = Record<string, unknown>;

/**
 * Spec 9.1: apply an `advanced` patch of registry paths to a v2-shaped object
 * in place. Every path is checked before anything is written, so a bad patch
 * leaves the object untouched; the message names the first path that fails.
 * The caller validates the whole object afterwards (rule 5).
 */
export function applyAdvanced(base: Obj, patch: Record<string, unknown>): string | null {
  const model = String(patch["disease.model"] ?? getPath(base, "disease.model") ?? "sir");
  const entries = Object.entries(patch);
  for (const [path, value] of entries) {
    if (path.startsWith("interventions[]")) return `${path} is set through the vaccine, treatment and seasonality fields, not through advanced`;
    const spec = specFor(path);
    if (!spec) return `unknown parameter path "${path}"; call describe_parameters for the list`;
    if (!appliesTo(spec, model)) return `${path} does not apply to the ${model} model (it applies to ${spec.models.join(", ")})`;
    const problem = checkValue(spec, value);
    if (problem) return `${path} ${problem}`;
    for (const partner of spec.requires) {
      // A partner is needed when the value is not the default (constant needs no sd) and nothing supplies it.
      if (value !== spec.default && !(partner in patch) && (getPath(base, partner) ?? null) === null) return `${path} needs ${partner} in the same call`;
    }
  }
  for (const [path, value] of entries) setPath(base, path, value);
  return null;
}

/** Spec 9.1 (3): the kind and the bounds, stated with the unit. Null is allowed only where the registry default is null. */
export function checkValue(spec: ParamSpec, value: unknown): string | null {
  if (value === null) return spec.default === null ? null : "cannot be unset";
  switch (spec.kind) {
    case "bool":
      return typeof value === "boolean" ? null : "must be true or false";
    case "string":
      return typeof value === "string" ? null : "must be text";
    case "enum":
      return typeof value === "string" && (spec.choices ?? []).includes(value) ? null : `must be one of ${(spec.choices ?? []).join(", ")}`;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) return "must be a whole number";
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
      break;
  }
  const n = value as number;
  if (spec.bounds && (n < spec.bounds[0] || n > spec.bounds[1])) return `must be between ${spec.bounds[0]} and ${spec.bounds[1]}${spec.unit ? ` ${spec.unit}` : ""}`;
  return null;
}
