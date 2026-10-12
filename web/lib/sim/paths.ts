/** Dotted paths over nested parameter objects ("disease.dur_inf.mean_days"); mirrors epichat/params/paths.py. */
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function flattenParams(obj: Obj, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}${key}`;
    if (isObj(value)) Object.assign(out, flattenParams(value, `${path}.`));
    else out[path] = value;
  }
  return out;
}

export function getPath(obj: Obj, path: string): unknown {
  let node: unknown = obj;
  for (const part of path.split(".")) {
    if (!isObj(node) || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

export function setPath(obj: Obj, path: string, value: unknown): void {
  const parts = path.split(".");
  let node: Obj = obj;
  for (const part of parts.slice(0, -1)) {
    if (!isObj(node[part])) node[part] = {};
    node = node[part] as Obj;
  }
  node[parts[parts.length - 1]] = value;
}

export type ParamChange = { field: string; from: unknown; to: unknown };

export function diffParams(before: Obj, after: Obj): ParamChange[] {
  const old = flattenParams(before);
  const now = flattenParams(after);
  const changes: ParamChange[] = [];
  for (const key of Object.keys(old)) if (JSON.stringify(old[key]) !== JSON.stringify(now[key])) changes.push({ field: key, from: old[key], to: now[key] ?? null });
  for (const key of Object.keys(now)) if (!(key in old)) changes.push({ field: key, from: null, to: now[key] });
  return changes;
}
